import { z } from 'zod'
import { ClientError } from './errors'
import { addSchema, lookupSchema, recordsSchema } from './schemas'
import { RateLimiter } from './rate-limiter'

const BASE_URL = 'https://open.maimemo.com/open/api/v1/memo/'
const MAX_BYTES = 1024 * 1024
export type Fetcher = (url: string, init: RequestInit) => Promise<Response>
export interface ApiLog { operation: string; durationMs: number; status?: number; errorCode?: string }

export class MaimemoClient {
  constructor(
    private readonly fetcher: Fetcher,
    private readonly limiter = new RateLimiter(),
    private readonly timeoutMs = 15_000,
    private readonly log: (entry: ApiLog) => void = () => {},
    private readonly sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))
  ) {}

  async lookup(token: string, spelling: string) {
    const result = await this.request('vocabulary/query', token, { spellings: [spelling] }, lookupSchema, false)
    return result.voc
  }

  async add(token: string, id: string): Promise<number> {
    return (await this.request('study/add_words', token, { words: [{ id }], advance: false }, addSchema, true)).added_count
  }

  async contains(token: string, id: string): Promise<boolean> {
    const result = await this.request('study/query_study_records', token,
      { voc_ids: [id], as_count: false, limit: 1000 }, recordsSchema, false)
    return result.records.some(record => record.voc_id === id)
  }

  private async request<T>(path: string, token: string, body: unknown, schema: z.ZodType<T>, write: boolean): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try { return await this.once(path, token, body, schema, write) }
      catch (error) {
        // POST query endpoints are reads. Sent add requests are NEVER retried.
        if (write || attempt >= 1 || !(error instanceof ClientError) ||
          !['NETWORK', 'TIMEOUT', 'SERVER'].includes(error.code)) throw error
        await this.sleep(400 * (attempt + 1))
      }
    }
  }

  private async once<T>(path: string, token: string, body: unknown, schema: z.ZodType<T>, write: boolean): Promise<T> {
    this.limiter.take()
    const controller = new AbortController()
    let timedOut = false
    const timer = setTimeout(() => { timedOut = true; controller.abort() }, this.timeoutMs)
    const started = Date.now()
    let status: number | undefined
    let errorCode: string | undefined
    try {
      const response = await this.fetcher(new URL(path, BASE_URL).href, {
        method: 'POST', redirect: 'error', credentials: 'omit', cache: 'no-store',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(body), signal: controller.signal
      })
      status = response.status
      if (!response.ok) {
        void response.body?.cancel().catch(() => {})
        if (status === 401) throw new ClientError('AUTH')
        if (status === 403) throw new ClientError('PERMISSION')
        if (status === 429) { this.limiter.block(response.headers.get('retry-after')); throw new ClientError('RATE_LIMIT') }
        if (status === 404) throw new ClientError('NOT_FOUND')
        if (status === 400 || status === 422) throw new ClientError('INVALID_INPUT')
        throw new ClientError(status >= 500 ? 'SERVER' : 'API_ERROR', write)
      }
      const raw = await this.readJson(response, controller, write)
      const object = z.record(z.string(), z.unknown()).safeParse(raw)
      if (!object.success) throw new ClientError('INVALID_RESPONSE', write)
      const envelope = object.data
      if (envelope.success === false || (Array.isArray(envelope.errors) && envelope.errors.length > 0)) {
        // Business error meanings are not enumerated in the spec. Do not infer write failure.
        throw new ClientError('API_ERROR', write)
      }
      if (('success' in envelope && envelope.success !== true) ||
        ('errors' in envelope && !Array.isArray(envelope.errors))) throw new ClientError('INVALID_RESPONSE', write)
      const parsed = schema.safeParse('data' in envelope ? envelope.data : envelope)
      if (!parsed.success) throw new ClientError('INVALID_RESPONSE', write)
      return parsed.data
    } catch (error) {
      const safeError = error instanceof ClientError ? error : new ClientError(timedOut ? 'TIMEOUT' : 'NETWORK', write)
      errorCode = safeError.code
      throw safeError
    } finally {
      clearTimeout(timer)
      this.log({ operation: path, durationMs: Date.now() - started, status, errorCode })
    }
  }

  private async readJson(response: Response, controller: AbortController, write: boolean): Promise<unknown> {
    if (Number(response.headers.get('content-length')) > MAX_BYTES) {
      controller.abort()
      throw new ClientError('INVALID_RESPONSE', write)
    }
    const reader = response.body?.getReader()
    if (!reader) throw new ClientError('INVALID_RESPONSE', write)
    const chunks: Uint8Array[] = []
    let bytes = 0
    try {
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        bytes += value.byteLength
        if (bytes > MAX_BYTES) {
          controller.abort()
          void reader.cancel().catch(() => {})
          throw new ClientError('INVALID_RESPONSE', write)
        }
        chunks.push(value)
      }
    } finally { reader.releaseLock() }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown }
    catch { throw new ClientError('INVALID_RESPONSE', write) }
  }
}
