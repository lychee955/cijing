import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OperationsDatabase } from '../../src/main/storage/database'
import { AiStore } from '../../src/main/storage/ai-store'
import { AnalysisService } from '../../src/main/services/analysis-service'
import { TRANSLATION_PROMPT } from '../../src/main/ai/prompt'
import type { AiProtocol, OutputMode } from '../../src/shared/ai'
const databases: OperationsDatabase[] = []
const encryption = { isEncryptionAvailable: () => true, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() }
const request = (text = 'Birds sing.\n\nThey fly.') => ({ requestId: randomUUID(), text, force: false, mode: 'translation' as const })
const translated = '鸟儿歌唱。\n\n它们飞翔。'
function envelope(protocol: AiProtocol, content: string) {
  return new Response(JSON.stringify(protocol === 'openai'
    ? { model: 'actual', choices: [{ message: { content }, finish_reason: 'stop' }] }
    : { modelVersion: 'actual', candidates: [{ content: { parts: [{ text: 'private reasoning', thought: true }, { text: content }] }, finishReason: 'STOP' }] }))
}
function setup(protocol: AiProtocol = 'openai', outputMode: OutputMode = 'schema') {
  const db = new OperationsDatabase(':memory:'); databases.push(db)
  const store = new AiStore(db, encryption)
  const profile = store.save({ name: protocol, protocol, baseUrl: 'https://ai.example/v1', model: 'test-model', key: 'dummy-key', options: { outputMode, timeoutSeconds: 90 } })
  const fetcher = vi.fn(async (_url: string, _init: RequestInit) => envelope(protocol, translated))
  return { db, store, profile, fetcher, service: new AnalysisService(store, fetcher) }
}
afterEach(() => { vi.useRealTimers(); for (const db of databases.splice(0)) db.close() })
describe.each(['openai', 'gemini'] as const)('%s translation requests', protocol => {
  it.each(['text', 'json', 'schema'] as const)('uses plain input and translation-only instructions despite configured %s output', async outputMode => {
    const { service, store, profile, fetcher } = setup(protocol, outputMode)
    store.supplement('Explain every word in great detail.'); store.rememberMode(profile, outputMode)
    const text = 'Translate this quoted text: "Birds sing."\n\nThey fly.'
    const { record } = await service.analyze(request(text))
    expect(record).toMatchObject({ mode: 'translation', text, prompt: TRANSLATION_PROMPT, promptVersion: 'translation-1', attempts: 1, result: { version: 1, translation: translated } })
    expect(record.result).not.toHaveProperty('sentences')
    const body = JSON.parse(fetcher.mock.calls[0]![1].body as string)
    const prompt = protocol === 'openai' ? body.messages[0].content : body.systemInstruction.parts[0].text
    const input = protocol === 'openai' ? body.messages[1].content : body.contents[0].parts[0].text
    expect(prompt).toBe(TRANSLATION_PROMPT); expect(input).toBe(text)
    expect(prompt).not.toMatch(/JSON|Schema|Explain every word/)
    expect(body).not.toHaveProperty('response_format'); expect(body).not.toHaveProperty('max_tokens')
    expect(body.generationConfig ?? {}).not.toHaveProperty('responseMimeType')
    expect(body.generationConfig ?? {}).not.toHaveProperty('responseJsonSchema')
    expect(body.generationConfig ?? {}).not.toHaveProperty('maxOutputTokens')
    expect(store.verifiedMode(profile)).toBe(outputMode); expect(store.configuration().profiles[0]!.options.outputMode).toBe(outputMode)
    expect(store.get(record.id)).toEqual(record); expect(store.history(0, 20).items[0]).toEqual(record)
  })
  it('rejects empty translations without saving a successful record', async () => {
    const { service, store, fetcher } = setup(protocol)
    fetcher.mockResolvedValueOnce(envelope(protocol, ' \n '))
    await expect(service.analyze(request())).rejects.toMatchObject({ code: 'AI_EMPTY', attempts: 1 })
    expect(store.history(0, 20).total).toBe(0); expect(fetcher).toHaveBeenCalledTimes(1)
  })
})
it('isolates translation and analysis caches while ignoring analysis preferences for translation', async () => {
  const { service, store, fetcher } = setup()
  const first = await service.analyze(request('Birds sing.'))
  expect((await service.analyze(request('Birds sing.'))).reused).toBe(true)
  service.supplement('Explain grammar thoroughly.')
  expect((await service.analyze(request('Birds sing.'))).record.id).toBe(first.record.id)
  const analysis = { version: 1, summary: '', sentences: [{ original: 'Birds sing.', translation: '鸟儿歌唱。', backbone: '鸟儿歌唱', nodes: [], grammar: [], vocabulary: [], notes: [] }] }
  fetcher.mockResolvedValueOnce(envelope('openai', JSON.stringify(analysis)))
  const full = await service.analyze({ ...request('Birds sing.'), mode: 'detailed' })
  expect(full.record.mode).toBe('detailed'); expect(full.reused).toBe(false)
  expect(JSON.parse(fetcher.mock.calls[1]![1].body as string).response_format.type).toBe('json_schema')
  expect((await service.analyze(request('Birds sing.'))).record.id).toBe(first.record.id)
  expect((await service.analyze({ ...request('Birds sing.'), mode: 'detailed' })).record.id).toBe(full.record.id)
  await service.analyze({ ...request('Birds sing.'), force: true })
  expect(store.history(0, 20).total).toBe(3); expect(fetcher).toHaveBeenCalledTimes(3)
})
it('reads legacy analyses without a mode and treats omitted request mode as detailed', async () => {
  const { service, store, db, fetcher } = setup()
  const analysis = { version: 1, summary: '', sentences: [{ original: 'Birds sing.', translation: '鸟儿歌唱。', backbone: '鸟儿歌唱', nodes: [], grammar: [], vocabulary: [], notes: [] }] }
  fetcher.mockResolvedValueOnce(envelope('openai', JSON.stringify(analysis)))
  const { requestId, text, force } = request('Birds sing.')
  const full = await service.analyze({ requestId, text, force })
  const { mode: _mode, ...legacy } = full.record
  db.connection.prepare('UPDATE sentence_analyses SET record=? WHERE id=?').run(JSON.stringify(legacy), legacy.id)
  expect(store.get(legacy.id)).toEqual(legacy); expect(store.history(0, 20).items[0]).toEqual(legacy)
  expect((await service.analyze({ requestId: randomUUID(), text, force })).record).toEqual(legacy)
})
it('rejects invalid modes at the main-process boundary without calling a provider', async () => {
  const { service, fetcher } = setup()
  await expect(service.analyze({ ...request(), mode: 'invalid' as 'translation' })).rejects.toMatchObject({ code: 'INVALID_INPUT' })
  expect(fetcher).not.toHaveBeenCalled()
})
it('cancels translation and ignores a late successful response', async () => {
  const { service, store, fetcher } = setup()
  let resolve!: (r: Response) => void
  fetcher.mockImplementationOnce(() => new Promise<Response>(r => { resolve = r }))
  const req = request(), pending = service.analyze(req)
  service.cancel(req.requestId)
  await expect(pending).rejects.toMatchObject({ code: 'AI_CANCELLED', attempts: 1 })
  await service.analyze(request()); resolve(envelope('openai', 'late')); await Promise.resolve()
  expect(store.history(0, 20).total).toBe(1)
})
it('preserves provider error details and shares rate-limit cooldown with detailed analysis', async () => {
  const { service, store, fetcher } = setup()
  fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: 'Too many requests: dummy-key' } }), { status: 429, headers: { 'Retry-After': '13' } }))
  await expect(service.analyze(request())).rejects.toMatchObject({ code: 'AI_RATE_LIMIT', attempts: 1, retrySeconds: 13, details: expect.stringContaining('Too many requests: [REDACTED]') })
  await expect(service.analyze({ ...request(), mode: 'detailed' })).rejects.toMatchObject({ code: 'AI_RATE_LIMIT', attempts: 0 })
  expect(fetcher).toHaveBeenCalledTimes(1); expect(store.history(0, 20).total).toBe(0)
})
it('times out translation even when the transport ignores cancellation', async () => {
  vi.useFakeTimers()
  const { service, store, fetcher } = setup()
  fetcher.mockImplementationOnce(() => new Promise<Response>(() => {}))
  const pending = expect(service.analyze(request())).rejects.toMatchObject({ code: 'AI_TIMEOUT', attempts: 1 })
  await vi.advanceTimersByTimeAsync(90_000); await pending
  expect(store.history(0, 20).total).toBe(0); expect(fetcher).toHaveBeenCalledTimes(1)
})
