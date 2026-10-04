import type { UpdateCandidate, UpdateEnvironment, UpdateStatus } from '../../shared/update'
import type { UpdateInstaller } from './adapters/nsis'
import { UpdateFailure, validateReleaseUrl, type ReleaseResult } from './release-source'
import type { ExitGate } from './exit-gate'

interface Dependencies {
  source: { check(environment: UpdateEnvironment): Promise<ReleaseResult> }
  installer?: UpdateInstaller
  gate: ExitGate
  busy(): boolean
  // Invoked only after the gate is locked. The callback must close storage before starting installation.
  quitForUpdate(install: () => void | Promise<void>): void
  openExternal(url: string): Promise<void>
  changed(status: UpdateStatus): void
  log?(entry: object): void
  now?: () => number
}
export class UpdateService {
  private state: UpdateStatus
  private checkTask?: Promise<UpdateStatus>
  private downloadTask?: Promise<UpdateStatus>
  private timer?: ReturnType<typeof setTimeout>
  private stopped = false
  private readonly now: () => number
  constructor(environment: UpdateEnvironment, private readonly deps: Dependencies) {
    this.now = deps.now ?? Date.now
    this.state = { revision: 0, phase: environment.canCheck ? 'idle' : 'unsupported', environment, message: environment.reason ?? '可手动检查新版本。' }
  }
  status(): UpdateStatus { return structuredClone(this.state) }
  private set(patch: Partial<UpdateStatus>): UpdateStatus {
    if (this.stopped) return this.status()
    const previous = this.state.phase
    this.state = { ...this.state, ...patch, revision: this.state.revision + 1 }
    if (this.state.phase !== previous) this.deps.log?.({ phase: this.state.phase, version: this.state.environment.version,
      target: this.state.candidate?.version, platform: this.state.environment.platform, arch: this.state.environment.arch, errorStage: this.state.errorStage })
    this.deps.changed(this.status())
    return this.status()
  }
  private fail(stage: UpdateStatus['errorStage'], error: unknown): UpdateStatus {
    const message = error instanceof UpdateFailure ? error.message : stage === 'download'
      ? '下载或校验失败，请检查网络、磁盘空间及安装包签名后重试。' : '更新操作失败，请稍后重试。'
    return this.set({ phase: 'error', errorStage: stage, message,
      retryAt: error instanceof UpdateFailure && error.retryAt ? new Date(error.retryAt).toISOString() : undefined })
  }
  check(): Promise<UpdateStatus> {
    if (this.checkTask) return this.checkTask
    if (this.stopped || !this.state.environment.canCheck || this.downloadTask || ['downloaded', 'installing'].includes(this.state.phase)) return Promise.resolve(this.status())
    if (this.state.retryAt && Date.parse(this.state.retryAt) > this.now()) return Promise.resolve(this.status())
    this.set({ phase: 'checking', errorStage: undefined, message: '正在检查更新…', lastCheckedAt: new Date(this.now()).toISOString() })
    this.checkTask = Promise.resolve().then(() => this.deps.source.check(this.state.environment)).then(result => {
      return this.set({ ...result, candidate: result.phase === 'available' ? result.candidate : undefined,
        lastSuccessAt: new Date(this.now()).toISOString(), retryAt: undefined, progress: undefined })
    }).catch(error => this.fail('check', error)).finally(() => { this.checkTask = undefined })
    return this.checkTask
  }
  download(): Promise<UpdateStatus> {
    if (this.downloadTask) return this.downloadTask
    if (this.state.retryAt && Date.parse(this.state.retryAt) > this.now()) return Promise.resolve(this.status())
    const candidate = this.state.candidate
    if (this.stopped || this.checkTask || !candidate || !this.state.environment.canInstall || !this.deps.installer
      || !(this.state.phase === 'available' || (this.state.phase === 'error' && this.state.errorStage === 'download'))) return Promise.resolve(this.status())
    this.set({ phase: 'downloading', progress: 0, errorStage: undefined, message: '正在下载更新，可继续使用词境。' })
    const installer = this.deps.installer
    this.downloadTask = Promise.resolve().then(async () => {
      const latest = await this.deps.source.check(this.state.environment)
      if (latest.phase !== 'available' || !sameCandidate(candidate, latest.candidate))
        throw new UpdateFailure('发布版本或附件已变化，请重新检查后下载。')
      await installer.download(candidate, percent => {
        if (this.state.phase === 'downloading' && Number.isFinite(percent)) this.set({ progress: Math.round(Math.max(0, Math.min(100, percent))) })
      })
      return this.set({ phase: 'downloaded', progress: 100, message: '下载和校验完成，点击后重启并更新。' })
    }).catch(error => this.fail('download', error)).finally(() => { this.downloadTask = undefined })
    return this.downloadTask
  }
  install(): UpdateStatus {
    if (this.stopped || this.state.phase !== 'downloaded' || !this.state.environment.canInstall || !this.deps.installer) return this.status()
    if (!this.deps.gate.acquire(this.deps.busy)) return this.set({ message: '仍有业务任务进行中，请等待任务完成后再安装。' })
    this.set({ phase: 'installing', message: '正在退出词境并启动安装程序…' })
    try { this.deps.quitForUpdate(() => this.deps.installer!.install()) }
    catch (error) { this.deps.gate.release(); return this.fail('install', error) }
    return this.status()
  }
  async openRelease(): Promise<UpdateStatus> {
    const candidate = this.state.candidate
    if (!candidate) return this.status()
    try { validateReleaseUrl(candidate.releaseUrl, candidate.tag); await this.deps.openExternal(candidate.releaseUrl) }
    catch { return this.set({ message: '无法打开发布页面，请稍后重试。' }) }
    return this.status()
  }
  start(): void {
    if (!this.state.environment.canCheck || this.timer || this.stopped) return
    const run = async () => {
      await this.check()
      if (!this.stopped) this.timer = setTimeout(run, 6 * 60 * 60_000)
    }
    this.timer = setTimeout(run, 10_000)
  }
  dispose(): void { this.stopped = true; clearTimeout(this.timer); this.deps.installer?.dispose() }
}
export function sameCandidate(a: UpdateCandidate, b: UpdateCandidate): boolean {
  return a.tag === b.tag && a.version === b.version && a.assetUrl === b.assetUrl && a.size === b.size && a.sha512 === b.sha512
    && a.minimumSystemVersion === b.minimumSystemVersion
}
