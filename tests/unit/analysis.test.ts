import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OperationsDatabase } from '../../src/main/storage/database'
import { initialMigration } from '../../src/main/storage/migrations/001-initial'
import { AiStore } from '../../src/main/storage/ai-store'
import { AnalysisService, analysisTextSchema } from '../../src/main/services/analysis-service'
import { OpenAiAdapter, GeminiAdapter } from '../../src/main/ai/adapters'
import { parseAnalysis } from '../../src/main/ai/schema'
import { profileInputSchema } from '../../src/main/ai/config'
import { aiResult } from '../../src/main/ai/errors'
import type { AiProfileInput } from '../../src/shared/ai'
const handles: OperationsDatabase[] = [], dirs: string[] = []
const encryption = { isEncryptionAvailable: () => true, encryptString: (s: string) => Buffer.from(s.split('').reverse().join('')), decryptString: (b: Buffer) => b.toString().split('').reverse().join('') }
function open(path = ':memory:') { const db = new OperationsDatabase(path); handles.push(db); return db }
function file() { const dir = mkdtempSync(join(tmpdir(), 'momo-ai-')); dirs.push(dir); return join(dir, 'test.sqlite') }
const input = (overrides: Partial<AiProfileInput> = {}): AiProfileInput => ({ name: '测试', protocol: 'openai', baseUrl: 'https://ai.example/v1', model: 'test-model', key: 'secret-key', options: { outputMode: 'text', timeoutSeconds: 90 }, ...overrides })
function output(text = 'Birds sing.', nodes: unknown[] = []) { return { version: 1, summary: '', sentences: [{ original: text, translation: '鸟儿歌唱。', backbone: '鸟儿（主语）歌唱（谓语）。', nodes, grammar: [], vocabulary: [], notes: [] }] } }
function response(text = 'Birds sing.') { return new Response(JSON.stringify({ model: 'actual', choices: [{ message: { content: JSON.stringify(output(text)) }, finish_reason: 'stop' }] })) }
function setup(fetcher = vi.fn(async () => response())) { const db = open(), store = new AiStore(db, encryption), profile = store.save(input()); return { db, store, profile, fetcher, service: new AnalysisService(store, fetcher) } }
const request = (text = 'Birds sing.', force = false) => ({ requestId: randomUUID(), text, force })
const node = (id: string, text: string, parentId: string | null = null, occurrence = 1) => ({ id, parentId, kind: 'component', role: '主语', quotes: [{ text, occurrence }], explanation: '成分解释', target: '' })
afterEach(() => { vi.useRealTimers(); for (const db of handles.splice(0)) db.close(); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

describe('AI migration and encrypted profiles', () => {
  it('ignores legacy saved token limits and removes them when saving an existing profile', async () => {
    const { db, store, profile, service, fetcher } = setup()
    db.connection.prepare('UPDATE ai_profiles SET options=? WHERE id=?').run(JSON.stringify({ ...profile.options, maxOutputTokens: 8192 }), profile.id)
    const restored = store.configuration().profiles[0]!
    expect(restored.options).not.toHaveProperty('maxOutputTokens')
    expect(store.snapshot(profile.id).profile.options).not.toHaveProperty('maxOutputTokens')
    await service.analyze(request())
    const init = (fetcher.mock.calls[0] as unknown as [string, RequestInit])[1]
    expect(JSON.parse(init.body as string)).not.toHaveProperty('max_tokens')
    store.save(input({ id: profile.id, options: restored.options, key: undefined }))
    expect((db.connection.prepare('SELECT options FROM ai_profiles WHERE id=?').get(profile.id) as { options: string }).options).not.toContain('maxOutputTokens')
    expect(store.snapshot(profile.id).key).toBe('secret-key')
    expect(profileInputSchema.safeParse({ ...input(), options: { ...profile.options, maxOutputTokens: 8192 } }).success).toBe(false)
  })
  it('upgrades version 1 atomically and preserves Maimemo records and settings', () => {
    const path = file(), old = new Database(path); old.exec(initialMigration); old.pragma('user_version=1')
    old.prepare('INSERT INTO settings VALUES (?,?)').run('old', '"kept"')
    old.prepare('INSERT INTO profiles (id,name,credential_ref,created_at) VALUES (?,?,?,?)').run('old', '旧账号', 'token', '2026')
    old.close(); const db = open(path)
    expect(db.connection.pragma('user_version', { simple: true })).toBe(2); expect(db.readSetting('old')).toBe('kept')
    expect(db.connection.prepare('SELECT name FROM profiles').get()).toEqual({ name: '旧账号' })
  })
  it('rolls back a failed migration without damaging version 1', () => {
    const path = file(), old = new Database(path); old.exec(initialMigration); old.pragma('user_version=1'); old.exec('CREATE TABLE sentence_analyses (id TEXT)'); old.prepare('INSERT INTO settings VALUES (?,?)').run('old', '1'); old.close()
    expect(() => new OperationsDatabase(path)).toThrow(); const check = new Database(path)
    expect(check.pragma('user_version', { simple: true })).toBe(1); expect(check.prepare('SELECT value FROM settings').get()).toEqual({ value: '1' })
    expect(check.prepare("SELECT name FROM sqlite_master WHERE name='ai_profiles'").get()).toBeUndefined(); check.close()
  })
  it('stores independent encrypted keys, exposes no plaintext, switches and reloads', () => {
    const path = file(), db = open(path), store = new AiStore(db, encryption), a = store.save(input()), b = store.save(input({ name: '第二套', key: 'other-secret' }))
    store.select(b.id); expect(store.snapshot(a.id).key).toBe('secret-key'); expect(store.snapshot(b.id).key).toBe('other-secret')
    expect(JSON.stringify(store.configuration())).not.toMatch(/secret-key|other-secret|ciphertext/)
    expect((db.connection.prepare('SELECT ciphertext FROM ai_profiles WHERE id=?').get(a.id) as { ciphertext: Buffer }).ciphertext.toString()).not.toContain('secret-key')
    db.close(); const reloaded = new AiStore(open(path), encryption); expect(reloaded.configuration().activeId).toBe(b.id); expect(reloaded.snapshot(a.id).key).toBe('secret-key')
  })
  it('clears key on host change and leaves prior revision intact when encryption fails', () => {
    const { store, profile, db } = setup()
    const { key: _key, ...edit } = input({ id: profile.id, baseUrl: 'https://other.example/v1' })
    expect(store.save(edit).hasKey).toBe(false); expect(() => store.snapshot(profile.id)).toThrow()
    const before = store.configuration(); const bad = new AiStore(db, { ...encryption, encryptString: () => { throw new Error('secret') } })
    expect(() => bad.save(input({ id: profile.id }))).toThrow(); expect(store.configuration()).toEqual(before)
  })
  it('refuses insecure encryption and unsafe base URLs', () => {
    const db = open(); expect(() => new AiStore(db, { ...encryption, isEncryptionAvailable: () => false }).save(input())).toThrow()
    expect(() => new AiStore(db, { ...encryption, getSelectedStorageBackend: () => 'basic_text' }, 'linux').save(input())).toThrow()
    for (const baseUrl of ['http://localhost/v1', 'https://user:secret@example.com', 'https://example.com/v1?key=secret', 'https://example.com/chat/completions']) expect(profileInputSchema.safeParse(input({ baseUrl })).success).toBe(false)
  })
})

describe.each(['openai', 'gemini'] as const)('%s adapter boundary', protocol => {
  function adapter(fetcher: (url: string, init: RequestInit) => Promise<Response>) { return protocol === 'openai' ? new OpenAiAdapter(fetcher) : new GeminiAdapter(fetcher) }
  function snapshot() { const { store, profile } = setup(); return { ...store.snapshot(profile.id), profile: { ...profile, protocol, model: 'models/test-model' } } }
  function envelope(content = '{}', finish = protocol === 'openai' ? 'stop' : 'STOP') { return protocol === 'openai' ? { model: 'actual', choices: [{ message: { content }, finish_reason: finish }] } : { modelVersion: 'actual', candidates: [{ finishReason: finish, content: { parts: [{ text: 'private-thought', thought: true }, { text: content }] } }] } }
  it('maps path, auth, messages, format modes and optional usage without sending foreign credentials', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(envelope())))
    const a = adapter(fetcher), s = snapshot()
    for (const mode of ['text', 'json', 'schema'] as const) {
      const r = await a.generate(s, 'prompt', 'Birds sing.', mode, new AbortController().signal)
      expect(r).toMatchObject({ model: 'actual', text: '{}', usage: undefined })
      const [url, init] = fetcher.mock.calls.at(-1)! as unknown as [string, RequestInit]
      expect(init.redirect).toBe('error'); const body = JSON.parse(init.body as string)
      if (protocol === 'openai') { expect(url).toBe('https://ai.example/v1/chat/completions'); expect(init.headers).toMatchObject({ Authorization: 'Bearer secret-key' }); expect(body.messages[1].content).toBe(JSON.stringify({ text: 'Birds sing.' })); expect(body.response_format?.type).toBe(mode === 'text' ? undefined : mode === 'json' ? 'json_object' : 'json_schema') }
      else { expect(url).toBe('https://ai.example/v1/models/test-model:generateContent'); expect(init.headers).toMatchObject({ 'x-goog-api-key': 'secret-key' }); expect(body.systemInstruction.parts[0].text).toBe('prompt'); expect(body.generationConfig.responseMimeType).toBe(mode === 'text' ? undefined : 'application/json'); expect(!!body.generationConfig.responseJsonSchema).toBe(mode === 'schema'); expect(JSON.stringify(body.generationConfig.responseJsonSchema ?? {})).not.toContain('minLength') }
      expect(JSON.stringify(body)).not.toContain('secret-key')
    }
  })
  it.each([[401, 'AI_AUTH'], [403, 'AI_AUTH'], [404, 'AI_MODEL'], [429, 'AI_RATE_LIMIT'], [500, 'AI_SERVER'], [503, 'AI_SERVER']] as const)('maps HTTP %i to %s', async (status, code) => {
    const fetcher = vi.fn(async () => new Response('{}', { status, headers: { 'Retry-After': '60' } }))
    await expect(adapter(fetcher).generate(snapshot(), '', '', 'text', new AbortController().signal)).rejects.toMatchObject({ code, ...(status === 429 ? { retrySeconds: 60 } : {}) })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('distinguishes empty, refusal, truncation and malformed responses', async () => {
    const s = snapshot()
    for (const [body, code] of [[envelope(''), 'AI_EMPTY'], [envelope('{}', protocol === 'openai' ? 'length' : 'MAX_TOKENS'), 'AI_TRUNCATED'], [protocol === 'openai' ? { choices: [{ message: { refusal: 'no' }, finish_reason: 'stop' }] } : { promptFeedback: { blockReason: 'SAFETY' } }, 'AI_REFUSAL'], [{ unexpected: true }, 'AI_FORMAT']] as const) await expect(adapter(async () => new Response(JSON.stringify(body))).generate(s, '', '', 'text', new AbortController().signal)).rejects.toMatchObject({ code })
    await expect(adapter(async () => { throw new Error('Authorization: secret') }).generate(s, '', '', 'text', new AbortController().signal)).rejects.toMatchObject({ code: 'AI_NETWORK' })
  })
  it('rejects oversized body and detects explicit unsupported format only', async () => {
    const s = snapshot()
    await expect(adapter(async () => new Response('x'.repeat(2_000_001))).generate(s, '', '', 'text', new AbortController().signal)).rejects.toMatchObject({ code: 'AI_FORMAT' })
    await expect(adapter(async () => new Response('response_format not supported', { status: 400 })).generate(s, '', '', 'schema', new AbortController().signal)).rejects.toMatchObject({ code: 'AI_UNSUPPORTED' })
    await expect(adapter(async () => new Response('response_format incorrect schema', { status: 400 })).generate(s, '', '', 'schema', new AbortController().signal)).rejects.toMatchObject({ code: 'AI_FORMAT' })
  })
})

describe('analysis local validation', () => {
  it('matches repeated words, punctuation, newlines and discontinuous structures', () => {
    const text = 'I think,\nI know I can.'
    const discontinuous = { ...node('d', 'I'), quotes: [{ text: 'I', occurrence: 2 }, { text: 'can', occurrence: 1 }] }
    const r = parseAnalysis('```json\n' + JSON.stringify(output(text, [discontinuous])) + '\n```', text)
    expect(r.degraded).toBe(false); expect(r.sentences[0]!.nodes[0]!.spans).toEqual([{ start: 9, end: 10 }, { start: 18, end: 21 }])
  })
  it('supports nested clauses and empty optional components', () => {
    const text = 'I know that you said that birds sing.'
    const nodes = [{ ...node('a', 'that you said that birds sing'), kind: 'clause' }, { ...node('b', 'that birds sing', 'a'), kind: 'clause' }, node('c', 'birds', 'b')]
    expect(parseAnalysis(JSON.stringify(output(text, nodes)), text).degraded).toBe(false)
    expect(parseAnalysis(JSON.stringify(output()), 'Birds sing.').sentences[0]!.nodes).toEqual([])
  })
  it('degrades missing quotes, cycles, duplicate IDs, escaped children and invalid depth', () => {
    for (const nodes of [[node('a', 'absent')], [node('a', 'Birds', 'b'), node('b', 'Birds', 'a')], [node('a', 'Birds'), node('a', 'sing')], [node('p', 'Birds'), node('c', 'sing', 'p')], Array.from({ length: 9 }, (_, i) => node(String(i), 'Birds', i ? String(i - 1) : null))]) {
      const r = parseAnalysis(JSON.stringify(output('Birds sing.', nodes)), 'Birds sing.'); expect(r.degraded).toBe(true)
      expect(r.sentences[0]!.unlocated.length).toBeGreaterThan(0)
    }
  })
  it('rejects missing core fields, omitted input, incorrect order, fabricated vocabulary and speculative JSON repair', () => {
    for (const raw of ['{}', JSON.stringify(output('Wrong.')), '{"version":1', JSON.stringify({ ...output(), sentences: [{ ...output().sentences[0], vocabulary: [{ word: 'fake', lemma: 'fake', meaning: '虚构' }] }] })]) expect(() => parseAnalysis(raw, 'Birds sing.')).toThrow()
    expect(() => parseAnalysis(JSON.stringify(output()), 'Birds sing. Cats sleep.')).toThrow()
  })
  it('enforces input limits independently of renderer', () => { expect(analysisTextSchema.safeParse('word '.repeat(301)).success).toBe(false); expect(analysisTextSchema.safeParse('a'.repeat(6001)).success).toBe(false); expect(analysisTextSchema.safeParse('只有中文').success).toBe(false) })
})

describe('generation orchestration', () => {
  it('merges the same request, rejects other concurrent requests and caches exact results', async () => {
    let resolve!: (r: Response) => void
    const fetcher = vi.fn(() => new Promise<Response>(r => { resolve = r })), { service, store } = setup(fetcher), req = request()
    const first = service.analyze(req); expect(service.analyze(req)).toBe(first); await expect(service.analyze(request())).rejects.toMatchObject({ code: 'AI_BUSY' })
    resolve(response()); const r = await first; expect(r.reused).toBe(false); expect(r.record.usage).toBeUndefined()
    expect((await service.analyze(request())).reused).toBe(true); expect(fetcher).toHaveBeenCalledTimes(1); expect(store.history(0, 20).total).toBe(1)
  })
  it('cancel and late responses cannot write history or replace a newer task', async () => {
    let resolve!: (r: Response) => void
    const fetcher = vi.fn(() => new Promise<Response>(r => { resolve = r })), { service, store } = setup(fetcher), req = request()
    const pending = service.analyze(req); service.cancel(req.requestId); await expect(pending).rejects.toMatchObject({ code: 'AI_CANCELLED' })
    fetcher.mockImplementation(async () => response()); await service.analyze(request()); resolve(response()); await Promise.resolve(); expect(store.history(0, 20).total).toBe(1)
  })
  it.each(['select', 'save', 'delete'] as const)('%s cancels the affected profile task', async action => {
    const { service, store, profile } = setup(vi.fn(() => new Promise<Response>(() => {}))), pending = service.analyze(request())
    if (action === 'select') { const other = store.save(input({ name: 'other' })); service.select(other.id) }
    if (action === 'save') service.saveProfile(input({ id: profile.id }))
    if (action === 'delete') service.deleteProfile(profile.id)
    await expect(pending).rejects.toMatchObject({ code: 'AI_CANCELLED' }); expect(store.history(0, 20).total).toBe(0)
  })
  it.each(['openai', 'gemini'] as const)('%s times out once even when transport ignores abort', async protocol => {
    vi.useFakeTimers(); const { service, fetcher } = setup(vi.fn(() => new Promise<Response>(() => {})))
    const p = service.store.configuration().profiles[0]!; service.saveProfile(input({ id: p.id, protocol }))
    const checked = expect(service.analyze(request())).rejects.toMatchObject({ code: 'AI_TIMEOUT', attempts: 1 })
    await vi.advanceTimersByTimeAsync(90_000); await checked; expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('fallback is limited to one call and verified mode is remembered per endpoint/model', async () => {
    const fetcher = vi.fn(async () => response()), { service, store, profile } = setup(fetcher)
    service.saveProfile(input({ id: profile.id, options: { ...profile.options, outputMode: 'schema' } }))
    fetcher.mockResolvedValueOnce(new Response('response_format unsupported', { status: 400 }))
    const r = await service.analyze(request()); expect(r.record.attempts).toBe(2); expect(fetcher).toHaveBeenCalledTimes(2)
    await service.analyze(request('Birds sing.', true)); expect(JSON.parse((fetcher.mock.calls.at(-1)! as unknown as [string, RequestInit])[1].body as string).response_format).toBeUndefined()
    expect(store.configuration().profiles[0]!.options.outputMode).toBe('schema')
  })
  it('does not retry ordinary errors, honors cooldown and isolates auth to AI', async () => {
    const fetcher = vi.fn(async () => new Response('{}', { status: 429, headers: { 'Retry-After': '60' } })), { service, store, profile, db } = setup(fetcher)
    db.activateProfile('maimemo')
    await expect(service.analyze(request())).rejects.toMatchObject({ code: 'AI_RATE_LIMIT', attempts: 1 })
    await expect(service.analyze(request())).rejects.toMatchObject({ code: 'AI_RATE_LIMIT' }); expect(fetcher).toHaveBeenCalledTimes(1)
    const other = store.save(input({ name: 'another' })); service.select(other.id); fetcher.mockResolvedValue(new Response('{}', { status: 401 }))
    await expect(service.analyze(request())).rejects.toMatchObject({ code: 'AI_AUTH' })
    expect(store.configuration().profiles.find(p => p.id === other.id)?.authInvalid).toBe(true); expect(store.configuration().profiles.find(p => p.id === profile.id)?.authInvalid).toBe(false); expect(db.isInvalid('maimemo')).toBe(false)
  })
  it('logs local cooldown without issuing another network request', async () => {
    const { store } = setup(), logger = vi.fn(), fetcher = vi.fn(async () => new Response('{}', { status: 429, headers: { 'Retry-After': '13' } }))
    const service = new AnalysisService(store, fetcher, logger)
    await expect(service.analyze(request())).rejects.toMatchObject({ code: 'AI_RATE_LIMIT' })
    await expect(service.analyze(request())).rejects.toMatchObject({ code: 'AI_RATE_LIMIT' })
    expect(fetcher).toHaveBeenCalledTimes(1); expect(logger.mock.calls.at(-1)![0]).toMatchObject({ phase: 'cooldown', requestSent: false, retryAfterSeconds: 13 })
  })
  it('isolates cache by prompt, model, generation options and revisions; force preserves old records', async () => {
    const { service, store, profile, fetcher } = setup()
    const first = await service.analyze(request()); await service.analyze(request('Birds sing.', true)); expect(store.history(0, 20).total).toBe(2)
    service.supplement('详细'); expect((await service.analyze(request())).reused).toBe(false)
    service.saveProfile(input({ id: profile.id, model: 'other-model' })); expect((await service.analyze(request())).reused).toBe(false)
    service.saveProfile(input({ id: profile.id, options: { ...profile.options, timeoutSeconds: 95 } })); expect((await service.analyze(request())).reused).toBe(false)
    expect(fetcher).toHaveBeenCalledTimes(5); service.deleteProfile(profile.id); expect(store.get(first.record.id)?.source.name).toBe('测试'); store.deleteHistory(); expect(store.history(0, 20).total).toBe(0)
  })
  it('retains degraded explanations in history but never automatically reuses them', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(output('Birds sing.', [node('bad', 'absent')])) }, finish_reason: 'stop' }] }))), { service, store } = setup(fetcher)
    expect((await service.analyze(request())).record.result.degraded).toBe(true); expect((await service.analyze(request())).reused).toBe(false); expect(fetcher).toHaveBeenCalledTimes(2); expect(store.history(0, 20).total).toBe(2)
  })
  it('connection testing does not save history and sanitized errors reveal no secrets', async () => {
    const { service, profile, store } = setup(); expect(await service.test(profile.id)).toMatchObject({ attempts: 1, mode: 'text' }); expect(store.history(0, 20).total).toBe(0)
    expect(JSON.stringify(await aiResult(() => { throw new Error('secret-key FULL RESPONSE') }))).not.toMatch(/secret-key|FULL RESPONSE/)
  })
  it('preserves provider details through analysis and connection-test error wrapping', async () => {
    const { service, profile } = setup(vi.fn(async () => new Response(JSON.stringify({ error: { message: 'Provider returned error', metadata: { raw: 'ModelRun unavailable: secret-key' } } }), { status: 503 })))
    for (const action of [() => service.analyze(request()), () => service.test(profile.id)]) {
      const result = await aiResult<unknown>(action)
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.message).toContain('生成调用 1 次')
        expect(result.error.message).toContain('HTTP 503')
        expect(result.error.message).toContain('ModelRun unavailable: [REDACTED]')
        expect(result.error.message).not.toContain('secret-key')
      }
    }
  })
})
