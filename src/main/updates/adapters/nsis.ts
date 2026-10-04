import { NsisUpdater, CancellationToken, type UpdateInfo } from 'electron-updater'
import type { DownloadUpdateOptions } from 'electron-updater/out/AppUpdater'
import type { AppAdapter } from 'electron-updater/out/AppAdapter'
import { findFile } from 'electron-updater/out/providers/Provider'
import type { UpdateCandidate, UpdateEnvironment } from '../../../shared/update'
import { downloadBase, UpdateFailure, validateMetadata } from '../release-source'
import { verifyWindowsSignature } from './signature'
import type { StdioOptions } from 'node:child_process'

export interface UpdateInstaller {
  download(candidate: UpdateCandidate, progress: (percent: number) => void): Promise<void>
  install(): void | Promise<void>
  dispose(): void
}

// A fresh, tag-pinned provider prevents GitHub latest changing between discovery and download.
export class PinnedNsisUpdater extends NsisUpdater {
  private installationStarted?: () => void
  constructor(private readonly candidate: UpdateCandidate, private readonly systemVersion: string, appAdapter?: AppAdapter) {
    super({ provider: 'generic', url: downloadBase(candidate.tag), useMultipleRangeRequest: false }, appAdapter)
    this.autoDownload = false
    this.autoInstallOnAppQuit = false
    this.allowPrerelease = false
    this.allowDowngrade = false
    this.disableWebInstaller = true
    this.disableDifferentialDownload = true
    this.logger = null
    this.verifyUpdateCodeSignature = verifyWindowsSignature
    this.on('error', () => {}) // Promise failures are mapped by the service, without raw URLs or paths.
  }
  protected override doDownloadUpdate(options: DownloadUpdateOptions): Promise<string[]> {
    validateMetadata(options.updateInfoAndProvider.info, { ...this.candidate }, this.systemVersion)
    const selected = findFile(options.updateInfoAndProvider.provider.resolveFiles(options.updateInfoAndProvider.info), 'exe')
    if (!selected || selected.url.href !== this.candidate.assetUrl || selected.info.sha512 !== this.candidate.sha512 || selected.packageInfo)
      throw new UpdateFailure('实际选择的更新文件与已确认版本不一致，请重新检查。')
    return super.doDownloadUpdate(options)
  }
  protected override async spawnLog(command: string, args?: string[], env?: NodeJS.ProcessEnv, stdio?: StdioOptions): Promise<boolean> {
    const started = await super.spawnLog(command, args, env, stdio)
    if (started) this.installationStarted?.()
    return started
  }
  installAndWait(): Promise<void> {
    return new Promise((resolve, reject) => {
      const finish = (error?: Error) => {
        clearTimeout(timer); this.installationStarted = undefined; this.removeListener('error', fail)
        if (error) reject(new UpdateFailure('无法启动安装程序，请重新启动应用后重试。'))
        else resolve()
      }
      const fail = (error: Error) => finish(error)
      const timer = setTimeout(() => finish(new Error('Installer launch timeout')), 30_000)
      this.installationStarted = () => finish()
      this.once('error', fail)
      try { if (!this.install(false, true)) finish(new Error('Installer rejected')) }
      catch (error) { finish(error instanceof Error ? error : new Error('Installer failed')) }
    })
  }
}

export class NsisInstaller implements UpdateInstaller {
  private updater?: PinnedNsisUpdater
  private cancellation?: CancellationToken
  private ready = false
  constructor(private readonly environment: UpdateEnvironment) {}
  async download(candidate: UpdateCandidate, progress: (percent: number) => void): Promise<void> {
    if (!this.environment.canInstall || !candidate.sha512) throw new UpdateFailure('此安装版不支持自动安装。')
    this.dispose()
    const updater = new PinnedNsisUpdater(candidate, this.environment.systemVersion)
    this.updater = updater
    const cancellation = new CancellationToken()
    this.cancellation = cancellation
    let downloaded: UpdateInfo | undefined
    const onProgress = (value: { percent: number }) => progress(value.percent)
    const onDownloaded = (info: UpdateInfo) => { downloaded = info }
    updater.on('download-progress', onProgress)
    updater.on('update-downloaded', onDownloaded)
    let timer: ReturnType<typeof setTimeout> | undefined
    const deadline = <T>(promise: Promise<T>, ms: number): Promise<T> => Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => { cancellation.cancel(); reject(new UpdateFailure('更新请求超时，请重试。')) }, ms)
    })]).finally(() => clearTimeout(timer))
    try {
      const result = await deadline(updater.checkForUpdates(), 25_000)
      if (!result?.isUpdateAvailable) throw new UpdateFailure('候选版本已变化或不适用于此设备，请重新检查。')
      validateMetadata(result.updateInfo, { ...candidate }, this.environment.systemVersion)
      const files = await deadline(updater.downloadUpdate(cancellation), 30 * 60_000)
      if (!downloaded || files.length !== 1) throw new UpdateFailure('下载结果不完整，请重试。')
      validateMetadata(downloaded, { ...candidate }, this.environment.systemVersion)
      this.ready = true
    } finally {
      updater.removeListener('download-progress', onProgress)
      updater.removeListener('update-downloaded', onDownloaded)
    }
  }
  async install(): Promise<void> {
    if (!this.ready || !this.updater) throw new UpdateFailure('更新文件尚未通过校验，请重新下载。')
    await this.updater.installAndWait()
  }
  dispose(): void { this.cancellation?.cancel(); this.ready = false; this.updater = undefined }
}
