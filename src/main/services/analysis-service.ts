import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { AnalysisRequest, AnalysisResponse } from '../../shared/analysis'
import type { AiProfileInput, AiTestResult, OutputMode } from '../../shared/ai'
import { AiStore, type AiSnapshot } from '../storage/ai-store'
import { adapterRegistry, type AiFetch, type Generation } from '../ai/adapters'
import { AiError } from '../ai/errors'
import { effectivePrompt, PROMPT_VERSION } from '../ai/prompt'
import { parseAnalysis } from '../ai/schema'
import type { AiLog } from '../ai/logging'
export const analysisTextSchema = z.string().min(1).max(6000).refine(v => v.trim().length > 0 && (v.match(/[a-zA-Z]+(?:['’\-][a-zA-Z]+)*/g) ?? []).length <= 300 && /[a-zA-Z]/.test(v))
export const analysisRequestSchema = z.object({ requestId: z.string().uuid(), text: analysisTextSchema, force: z.boolean() }).strict()
interface Task { id: string; profileId: string; controller: AbortController; timer: ReturnType<typeof setTimeout>; timedOut: boolean; promise?: Promise<AnalysisResponse> }
export class AnalysisService {
  private task?: Task
  private readonly adapters
  private readonly cooldown = new Map<string, number>()
  constructor(readonly store: AiStore, fetcher: AiFetch, private readonly logger: AiLog = () => {}) { this.adapters = adapterRegistry(fetcher, logger) }
  cancel(requestId?: string): void {
    if (this.task && (!requestId || this.task.id === requestId)) { this.task.controller.abort(); clearTimeout(this.task.timer); this.task = undefined }
  }
  saveProfile(input: AiProfileInput) { if (input.id === this.task?.profileId) this.cancel(); return this.store.save(input) }
  deleteProfile(id: string): void { if (id === this.task?.profileId) this.cancel(); this.store.deleteProfile(id) }
  select(id: string): void { this.store.select(id); this.cancel() }
  supplement(value: string): void { this.cancel(); this.store.supplement(value) }
  analyze(request: AnalysisRequest): Promise<AnalysisResponse> {
    try { return this.beginAnalysis(request) } catch (error) { return Promise.reject(error) }
  }
  private beginAnalysis(request: AnalysisRequest): Promise<AnalysisResponse> {
    if (!analysisRequestSchema.safeParse(request).success) return Promise.reject(new AiError('INVALID_INPUT'))
    if (this.task) {
      if (this.task.id === request.requestId && this.task.promise) return this.task.promise
      return Promise.reject(new AiError('AI_BUSY'))
    }
    const config = this.store.configuration()
    if (!config.activeId) return Promise.reject(new AiError('AI_CONFIG'))
    const snapshot = this.store.snapshot(config.activeId), prompt = effectivePrompt(config.supplement)
    if (snapshot.profile.authInvalid) return Promise.reject(new AiError('AI_AUTH'))
    const reuseKey = createHash('sha256').update(JSON.stringify({ text: request.text, profileId: snapshot.profile.id, revision: snapshot.profile.revision,
      protocol: snapshot.profile.protocol, baseUrl: snapshot.profile.baseUrl, model: snapshot.profile.model, prompt, options: snapshot.profile.options, schemaVersion: 1, promptVersion: PROMPT_VERSION })).digest('hex')
    const existing = request.force ? undefined : this.store.reuse(reuseKey)
    if (existing) return Promise.resolve({ record: existing, reused: true })
    const task = this.start(request.requestId, snapshot)
    task.promise = this.run(task, snapshot, prompt, request.text).then(generated => {
      this.ensure(task)
      let result
      try { result = parseAnalysis(generated.response.text, request.text) } catch { throw new AiError('AI_FORMAT', generated.attempts) }
      this.store.rememberMode(snapshot.profile, generated.mode)
      const { hasKey: _hasKey, authInvalid: _invalid, ...source } = snapshot.profile
      const record = { id: randomUUID(), text: request.text, result, source, model: generated.response.model ?? source.model, promptVersion: PROMPT_VERSION,
        schemaVersion: 1, prompt, createdAt: new Date().toISOString(), usage: generated.response.usage, attempts: generated.attempts }
      this.ensure(task)
      this.store.saveAnalysis(record, reuseKey)
      return { record, reused: false }
    }).finally(() => this.finish(task))
    return task.promise
  }
  async test(id: string): Promise<AiTestResult> {
    if (this.task) throw new AiError('AI_BUSY')
    const snapshot = this.store.snapshot(id), task = this.start(randomUUID(), snapshot)
    try {
      const text = 'Birds sing.'
      const generated = await this.run(task, snapshot, effectivePrompt(''), text)
      this.ensure(task)
      try { parseAnalysis(generated.response.text, text) } catch { throw new AiError('AI_FORMAT', generated.attempts) }
      this.store.markValid(id)
      this.store.rememberMode(snapshot.profile, generated.mode)
      return { attempts: generated.attempts, mode: generated.mode, message: '连接成功，当前模型返回了可校验的分析。' }
    } finally { this.finish(task) }
  }
  private start(id: string, s: AiSnapshot): Task {
    const until = this.cooldown.get(s.profile.id) ?? 0
    if (until > Date.now()) {
      const seconds = Math.ceil((until - Date.now()) / 1000)
      try { this.logger({ phase: 'cooldown', requestId: id, profileId: s.profile.id, model: s.profile.model, retryAfterSeconds: seconds, requestSent: false }) } catch { /* best effort */ }
      throw new AiError('AI_RATE_LIMIT', 0, seconds)
    }
    const task = { id, profileId: s.profile.id, controller: new AbortController(), timedOut: false } as Task
    task.timer = setTimeout(() => { task.timedOut = true; task.controller.abort() }, s.profile.options.timeoutSeconds * 1000)
    this.task = task
    return task
  }
  private ensure(task: Task): void { if (task.timedOut) throw new AiError('AI_TIMEOUT'); if (task.controller.signal.aborted || this.task !== task) throw new AiError('AI_CANCELLED') }
  private finish(task: Task): void { clearTimeout(task.timer); if (this.task === task) this.task = undefined }
  private async run(task: Task, snapshot: AiSnapshot, prompt: string, text: string): Promise<{ response: Generation; attempts: number; mode: OutputMode }> {
    let mode = this.store.verifiedMode(snapshot.profile) ?? snapshot.profile.options.outputMode
    for (let attempts = 1; attempts <= 2; attempts++) {
      try {
        this.ensure(task)
        // A timeout/cancel must resolve even if a transport ignores AbortSignal.
        const response = await this.aborted(task, this.adapters[snapshot.profile.protocol].generate(snapshot, prompt, text, mode, task.controller.signal))
        this.ensure(task)
        return { response, attempts, mode }
      } catch (error) {
        if (task.timedOut) throw new AiError('AI_TIMEOUT', attempts)
        if (task.controller.signal.aborted || this.task !== task) throw new AiError('AI_CANCELLED', attempts)
        const e = error instanceof AiError ? error : new AiError('AI_NETWORK')
        if (e.code === 'AI_UNSUPPORTED' && mode !== 'text' && attempts === 1) { mode = 'text'; continue }
        if (e.code === 'AI_AUTH') this.store.markInvalid(snapshot.profile.id)
        if (e.code === 'AI_RATE_LIMIT') this.cooldown.set(snapshot.profile.id, Date.now() + (e.retrySeconds ?? 30) * 1000)
        throw new AiError(e.code, attempts, e.retrySeconds, e.details)
      }
    }
    throw new AiError('AI_FORMAT', 2)
  }
  private aborted<T>(task: Task, promise: Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const abort = () => reject(new AiError(task.timedOut ? 'AI_TIMEOUT' : 'AI_CANCELLED'))
      task.controller.signal.addEventListener('abort', abort, { once: true })
      promise.then(resolve, reject).finally(() => task.controller.signal.removeEventListener('abort', abort))
      if (task.controller.signal.aborted) abort()
    })
  }
}
