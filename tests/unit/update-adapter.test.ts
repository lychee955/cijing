import { afterEach, expect, it, vi } from 'vitest'
import { CancellationToken, NsisUpdater } from 'electron-updater'
import type { DownloadUpdateOptions } from 'electron-updater/out/AppUpdater'
import type { AppAdapter } from 'electron-updater/out/AppAdapter'
import { resolveFiles } from 'electron-updater/out/providers/Provider'
import { PinnedNsisUpdater } from '../../src/main/updates/adapters/nsis'
import { verifyWindowsSignature } from '../../src/main/updates/adapters/signature'

const hash = Buffer.alloc(64, 1).toString('base64')
const base = 'https://github.com/lychee955/cijing/releases/download/v0.3.0/'
const file = { url: 'cijing-0.3.0-win-x64-setup.exe', size: 100, sha512: hash }
const candidate = { version: '0.3.0', tag: 'v0.3.0', assetName: file.url, assetUrl: base + file.url,
  releaseUrl: 'https://github.com/lychee955/cijing/releases/tag/v0.3.0', size: file.size, sha512: hash, publishedAt: '', notes: '' }
class TestUpdater extends PinnedNsisUpdater {
  preflight(options: DownloadUpdateOptions) { return this.doDownloadUpdate(options) }
}
const adapter = { version: '0.2.1', name: 'cijing', isPackaged: true } as AppAdapter
afterEach(() => vi.restoreAllMocks())
it('pins the updater candidate and enforces user actions and signature verification', async () => {
  const updater = new TestUpdater(candidate, '10.0.26100', adapter)
  expect(updater.autoDownload).toBe(false)
  expect(updater.autoInstallOnAppQuit).toBe(false)
  expect(updater.allowDowngrade).toBe(false)
  expect(updater.allowPrerelease).toBe(false)
  expect(updater.verifyUpdateCodeSignature).toBe(verifyWindowsSignature)
  const info = { version: candidate.version, files: [file], path: file.url, sha512: hash, releaseDate: '2026-10-03' }
  const provider = { resolveFiles: () => resolveFiles(info, new URL(base)) }
  const options = { updateInfoAndProvider: { info, provider }, cancellationToken: new CancellationToken() } as unknown as DownloadUpdateOptions
  const download = vi.spyOn(NsisUpdater.prototype as unknown as { doDownloadUpdate(options: DownloadUpdateOptions): Promise<string[]> }, 'doDownloadUpdate').mockResolvedValue(['verified.exe'])
  expect(await updater.preflight(options)).toEqual(['verified.exe'])
  expect(download).toHaveBeenCalledOnce()
  provider.resolveFiles = () => resolveFiles(info, new URL('https://evil.test/'))
  expect(() => updater.preflight(options)).toThrow('不一致')
  info.files = [{ ...file, url: 'cijing-0.3.0-win-arm64-setup.exe' }]
  expect(() => updater.preflight(options)).toThrow('不完整')
  expect(download).toHaveBeenCalledOnce()
})
it('waits for installer launch and surfaces asynchronous launch errors', async () => {
  const updater = new TestUpdater(candidate, '10.0.26100', adapter)
  vi.spyOn(updater, 'install').mockImplementation(() => { queueMicrotask(() => updater.emit('error', new Error('spawn failed'))); return true })
  await expect(updater.installAndWait()).rejects.toThrow('无法启动')
})
