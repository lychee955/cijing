import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { createAiLogger, redact } from '../../src/main/ai/logging'
import { OpenAiAdapter, GeminiAdapter } from '../../src/main/ai/adapters'
import type { AiSnapshot } from '../../src/main/storage/ai-store'
import { aiResult } from '../../src/main/ai/errors'
const dirs: string[] = []
function logFile() { const dir = mkdtempSync(join(tmpdir(), 'momo-ai-log-')); dirs.push(dir); return join(dir, 'ai.log') }
const snapshot: AiSnapshot = { key: 'private-ai-key', profile: { id: 'profile', name: '测试', protocol: 'openai', baseUrl: 'https://ai.example/v1', model: 'model', revision: 1, hasKey: true, authInvalid: false, updatedAt: 'now', options: { outputMode: 'text', timeoutSeconds: 90 } } }
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })
it('redacts headers, nested credentials and echoed secrets without hiding token limits or error messages', () => {
  const safe = redact({ Authorization: 'Bearer private-ai-key', 'x-goog-api-key': 'private-ai-key', max_tokens: 8192,
    body: { message: 'Rate limit exceeded: private-ai-key', metadata: { api_key: 'other', password: 'private', raw: 'Bearer unknown-key' } } }, ['private-ai-key'])
  expect(JSON.stringify(safe)).not.toMatch(/private-ai-key|unknown-key|"other"|"private"/)
  expect(safe).toMatchObject({ max_tokens: 8192, body: { message: 'Rate limit exceeded: [REDACTED]' } })
})
it.each(['openai', 'gemini'] as const)('%s logs matching request and response, provider reason and Retry-After to console and file', async protocol => {
  const path = logFile(), sink = vi.fn(), logger = createAiLogger(path, true, sink)
  const response = { error: { code: 429, message: 'Provider temporarily rate limited', metadata: { provider_name: 'Example', raw: 'private-ai-key' } } }
  const fetcher = vi.fn(async () => new Response(JSON.stringify(response), { status: 429, headers: { 'Retry-After': '13', 'x-request-id': 'provider-id', 'Set-Cookie': 'session-secret' } }))
  const adapter = protocol === 'openai' ? new OpenAiAdapter(fetcher, logger) : new GeminiAdapter(fetcher, logger)
  await expect(adapter.generate({ ...snapshot, profile: { ...snapshot.profile, protocol } }, 'system prompt', 'Birds sing.', 'text', new AbortController().signal)).rejects.toMatchObject({ code: 'AI_RATE_LIMIT', retrySeconds: 13 })
  const content = readFileSync(path, 'utf8'), entries = content.trim().split('\n').map(line => JSON.parse(line))
  expect(entries).toHaveLength(2); expect(entries[0].requestId).toBe(entries[1].requestId)
  expect(entries[0]).toMatchObject({ phase: 'request', model: 'model', method: 'POST' })
  expect(entries[1]).toMatchObject({ phase: 'response', status: 429, retryAfterSeconds: 13, body: { error: { message: 'Provider temporarily rate limited' } } })
  expect(content).toContain('Birds sing.'); expect(content).not.toMatch(/private-ai-key|session-secret/)
  expect(sink).toHaveBeenCalledTimes(2); expect(sink.mock.calls[1]![0]).toContain('provider-id')
})
it('can omit content, bound large bodies and rotate the file', () => {
  const path = logFile(), logger = createAiLogger(path, false, () => {})
  logger({ phase: 'request', body: { text: 'private sentence' } }); expect(readFileSync(path, 'utf8')).not.toContain('private sentence')
  const full = createAiLogger(path, true, () => {}); full({ phase: 'response', body: 'x'.repeat(100_000) })
  expect(readFileSync(path, 'utf8')).toContain('"truncated":true'); expect(readFileSync(path, 'utf8').length).toBeLessThan(70_000)
  writeFileSync(path, 'x'.repeat(4_000_000)); full({ phase: 'cooldown', requestSent: false }); expect(existsSync(path + '.1')).toBe(true)
  expect(readFileSync(path, 'utf8')).toContain('"requestSent":false')
})
it('logging and transport errors cannot leak exception details or break successful requests', async () => {
  const adapter = new OpenAiAdapter(async () => new Response(JSON.stringify({ choices: [{ message: { content: '{}' }, finish_reason: 'stop' }] })), () => { throw new Error('sink failure') })
  expect((await adapter.generate(snapshot, '', '', 'text', new AbortController().signal)).text).toBe('{}')
  const path = logFile(), logger = createAiLogger(path, true, () => {})
  await expect(new OpenAiAdapter(async () => { throw new Error('private-ai-key network exception') }, logger).generate(snapshot, '', '', 'text', new AbortController().signal)).rejects.toMatchObject({ code: 'AI_NETWORK' })
  expect(readFileSync(path, 'utf8')).toContain('transport-error'); expect(readFileSync(path, 'utf8')).not.toContain('private-ai-key')
})
it.each([402, 200])('distinguishes insufficient credits and errors carried in HTTP %s bodies', async status => {
  const adapter = new OpenAiAdapter(async () => new Response(JSON.stringify({ error: { code: status === 402 ? 402 : 429, message: 'error' } }), { status }))
  await expect(adapter.generate(snapshot, '', '', 'text', new AbortController().signal)).rejects.toMatchObject({ code: status === 402 ? 'AI_QUOTA' : 'AI_RATE_LIMIT' })
})
it('honors transient budget 402 with Retry-After without treating it as permanent missing credits', async () => {
  const adapter = new OpenAiAdapter(async () => new Response('{}', { status: 402, headers: { 'Retry-After': '13' } }))
  await expect(adapter.generate(snapshot, '', '', 'text', new AbortController().signal)).rejects.toMatchObject({ code: 'AI_RATE_LIMIT', retrySeconds: 13 })
})

it.each(['openai', 'gemini'] as const)('%s exposes sanitized provider error details for JSON, plain text, empty and HTTP 200 error responses', async protocol => {
  const cases = [
    { status: 503, body: JSON.stringify({ error: { code: 503, message: 'Provider returned error', metadata: { provider_name: 'ModelRun', raw: 'Model unavailable: private-ai-key', api_key: 'another-secret' } } }), expected: 'Model unavailable: [REDACTED]' },
    { status: 400, body: 'Invalid parameter; Bearer private-ai-key', expected: 'Invalid parameter; Bearer [REDACTED]' },
    { status: 200, body: JSON.stringify({ error: { code: 500, message: 'Generation failed upstream' } }), expected: 'Generation failed upstream' },
    { status: 502, body: '', expected: '服务端未返回错误内容。' }
  ]
  for (const item of cases) {
    const adapter = protocol === 'openai' ? new OpenAiAdapter(async () => new Response(item.body, { status: item.status })) : new GeminiAdapter(async () => new Response(item.body, { status: item.status }))
    const result = await aiResult(() => adapter.generate({ ...snapshot, profile: { ...snapshot.profile, protocol } }, '', 'Birds sing.', 'text', new AbortController().signal))
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toContain(`接口报错信息：\nHTTP ${item.status}`)
      expect(result.error.message).toContain(item.expected)
      expect(result.error.message).not.toMatch(/private-ai-key|another-secret/)
    }
  }
})
it('bounds error details displayed to the renderer and redacts before truncating', async () => {
  const body = 'private-ai-key ' + 'x'.repeat(10_000)
  const result = await aiResult(() => new OpenAiAdapter(async () => new Response(body, { status: 500 })).generate(snapshot, '', '', 'text', new AbortController().signal))
  expect(JSON.stringify(result)).not.toContain('private-ai-key')
  if (!result.ok) { expect(result.error.message).toContain('完整响应请查看日志'); expect(result.error.message.length).toBeLessThan(8200) }
})

it.each(['openai', 'gemini'] as const)('%s never sends a token limit even when legacy options contain one', async protocol => {
  const body = protocol === 'openai' ? { choices: [{ message: { content: '{}' }, finish_reason: 'stop' }] } : { candidates: [{ content: { parts: [{ text: '{}' }] }, finishReason: 'STOP' }] }
  const fetcher = vi.fn(async (_url: string, _init: RequestInit) => new Response(JSON.stringify(body)))
  const adapter = protocol === 'openai' ? new OpenAiAdapter(fetcher) : new GeminiAdapter(fetcher)
  for (const limit of [0, 8192, 65536]) {
    const legacyOptions = { ...snapshot.profile.options, maxOutputTokens: limit }
    for (const mode of ['text', 'json', 'schema'] as const) {
      await adapter.generate({ ...snapshot, profile: { ...snapshot.profile, protocol, options: legacyOptions } }, '', '', mode, new AbortController().signal)
      const request = JSON.parse(fetcher.mock.calls.at(-1)![1].body as string)
      expect(request).not.toHaveProperty('max_tokens')
      expect(request).not.toHaveProperty('max_completion_tokens')
      expect(request.generationConfig ?? {}).not.toHaveProperty('maxOutputTokens')
    }
  }
})

it.each(['openai', 'gemini'] as const)('%s reports provider truncation, reasoning usage and empty answer without suggesting an application limit', async protocol => {
  const body = protocol === 'openai'
    ? { choices: [{ message: { content: '' }, finish_reason: 'length' }], usage: { completion_tokens: 8192, completion_tokens_details: { reasoning_tokens: 8192 } } }
    : { candidates: [{ content: { parts: [{ text: 'private-thought', thought: true }] }, finishReason: 'MAX_TOKENS' }], usageMetadata: { thoughtsTokenCount: 8192, candidatesTokenCount: 0 } }
  const fetcher = async () => new Response(JSON.stringify(body))
  const adapter = protocol === 'openai' ? new OpenAiAdapter(fetcher) : new GeminiAdapter(fetcher)
  for (const limit of [8192, 0]) {
    const legacyOptions = { ...snapshot.profile.options, maxOutputTokens: limit }
    const result = await aiResult(() => adapter.generate({ ...snapshot, profile: { ...snapshot.profile, protocol, options: legacyOptions } }, '', '', 'text', new AbortController().signal))
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('AI_TRUNCATED')
      expect(result.error.message).toContain(protocol === 'openai' ? '服务结束原因：length' : '服务结束原因：MAX_TOKENS')
      expect(result.error.message).toContain('推理用量：8192 Token')
      expect(result.error.message).toContain('分析正文：0 字符')
      expect(result.error.message).toContain('应用未发送输出长度上限，生成由服务端结束。')
      expect(result.error.message).not.toContain('private-thought')
    }
  }
})
