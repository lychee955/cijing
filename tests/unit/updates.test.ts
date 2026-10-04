import { describe, expect, it, vi, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { dump } from 'js-yaml'
import { GithubReleaseSource, UpdateFailure, validateReleaseUrl, validateMetadata } from '../../src/main/updates/release-source'
import { detectEnvironment } from '../../src/main/updates/environment'
import { ExitGate } from '../../src/main/updates/exit-gate'
import { UpdateService } from '../../src/main/updates/service'
import type { UpdateCandidate, UpdateEnvironment } from '../../src/shared/update'

const env: UpdateEnvironment = { version: '0.9.0', platform: 'win32', arch: 'x64', systemVersion: '10.0.26100', installation: 'nsis', channel: 'stable', canCheck: true, canInstall: true }
const sha512 = Buffer.alloc(64, 1).toString('base64')
function fixture(version = '0.10.0') {
  const tag = `v${version}`, name = `cijing-${version}-win-x64-setup.exe`
  const base = `https://github.com/lychee955/cijing/releases/download/${tag}/`
  const metadata = { version, path: name, sha512, files: [{ url: name, sha512, size: 100 }] }
  const release = { tag_name: tag, html_url: `https://github.com/lychee955/cijing/releases/tag/${tag}`,
    draft: false, prerelease: false, published_at: '2026-10-03T00:00:00Z', body: '<script>alert(1)</script>',
    assets: [name, `${name}.blockmap`, `cijing-${version}-win-x64-portable.exe`, 'latest.yml'].map(name => ({ name, size: 100, browser_download_url: base + name })) }
  const fetcher = vi.fn(async (url: string, init: RequestInit) => {
    expect(init.headers).not.toHaveProperty('Authorization')
    return new Response(url.endsWith('/latest') ? JSON.stringify(release) : dump(metadata))
  })
  const candidate: UpdateCandidate = { version, tag, releaseUrl: release.html_url, publishedAt: release.published_at,
    notes: release.body, assetName: name, assetUrl: base + name, size: 100, sha512 }
  return { metadata, release, fetcher, candidate, source: new GithubReleaseSource(fetcher) }
}
describe('release selection and completeness', () => {
  it('uses semantic version ordering and pins assets to one release', async () => {
    const f = fixture()
    expect(await f.source.check(env)).toMatchObject({ phase: 'available', candidate: { version: '0.10.0', sha512 } })
    expect(f.fetcher.mock.calls[1]![0]).toBe('https://github.com/lychee955/cijing/releases/download/v0.10.0/latest.yml')
  })
  it.each(['0.9.0', '0.8.9'])('does not update to equal or older %s', async version => {
    expect(await fixture(version).source.check(env)).toMatchObject({ phase: 'upToDate' })
  })
  it.each(['draft', 'prerelease'] as const)('does not offer %s releases', async flag => {
    const f = fixture(); f.release[flag] = true
    await expect(f.source.check(env)).rejects.toThrow('非正式')
  })
  it('does not offer semver prereleases even if the API labels them stable', async () => {
    await expect(fixture('0.10.0-beta.1').source.check(env)).rejects.toThrow('非正式')
  })
  it.each([{ platform: 'darwin' }, { arch: 'arm64' }])('never offers mismatched platform or arch %o', async patch => {
    expect(await fixture().source.check({ ...env, ...patch })).toMatchObject({ phase: 'noCompatiblePackage' })
  })
  it('selects portable separately, without assigning installer checksum', async () => {
    const result = await fixture().source.check({ ...env, installation: 'portable', canInstall: false })
    expect(result).toMatchObject({ phase: 'available', candidate: { assetName: 'cijing-0.10.0-win-x64-portable.exe' } })
    if (result.phase === 'available') expect(result.candidate.sha512).toBeUndefined()
  })
  it.each(['latest.yml', 'cijing-0.10.0-win-x64-setup.exe.blockmap', 'cijing-0.10.0-win-x64-portable.exe'])('rejects incomplete release missing %s', async name => {
    const f = fixture(); f.release.assets = f.release.assets.filter(a => a.name !== name)
    await expect(f.source.check(env)).rejects.toThrow('不完整')
  })
  it('distinguishes missing target from missing metadata', async () => {
    const f = fixture(); f.release.assets = f.release.assets.filter(a => !a.name.endsWith('setup.exe'))
    expect(await f.source.check(env)).toMatchObject({ phase: 'noCompatiblePackage' })
  })
  it('rejects metadata referencing a different version, architecture or checksum', () => {
    const { metadata, candidate } = fixture()
    for (const patch of [{ version: '0.11.0' }, { path: 'arm64.exe' }, { sha512: 'wrong' }, { files: [{ ...metadata.files[0], size: 101 }] }, { files: [...metadata.files, ...metadata.files] }])
      expect(() => validateMetadata({ ...metadata, ...patch }, { ...candidate }, env.systemVersion)).toThrow('不完整')
  })
  it('enforces minimum OS and refuses unknown metadata formats', () => {
    const { metadata, candidate } = fixture()
    expect(() => validateMetadata({ ...metadata, minimumSystemVersion: '11.0.0' }, candidate, env.systemVersion)).toThrow('更高')
    expect(() => validateMetadata({ ...metadata, packages: {} }, candidate, env.systemVersion)).toThrow('不完整')
  })
  it.each(['http://github.com/lychee955/cijing/releases/tag/v0.10.0', 'https://evil.test/', 'https://github.com/other/repo/releases/tag/v0.10.0', 'https://github.com/lychee955/cijing/releases/tag/v0.10.0?x=1'])('refuses untrusted release URL %s', url => {
    expect(() => validateReleaseUrl(url, 'v0.10.0')).toThrow()
  })
  it('maps offline, metadata 404 and rate limits to failures', async () => {
    await expect(new GithubReleaseSource(async () => { throw new Error('secret') }).check(env)).rejects.toThrow('网络')
    const f = fixture()
    await expect(new GithubReleaseSource(async url => url.endsWith('/latest') ? new Response(JSON.stringify(f.release)) : new Response('', { status: 404 })).check(env)).rejects.toThrow('无法确认')
    await expect(new GithubReleaseSource(async () => new Response('', { status: 429, headers: { 'retry-after': '120' } }), () => 1000).check(env)).rejects.toMatchObject({ retryAt: 121000 })
  })
})
function service() {
  const f = fixture()
  const source = { check: vi.fn(async () => ({ phase: 'available' as const, candidate: f.candidate, message: '新版' })) }
  const installer = { download: vi.fn(async (_c: UpdateCandidate, progress: (p: number) => void) => { progress(45) }), install: vi.fn(), dispose: vi.fn() }
  const gate = new ExitGate(), busy = vi.fn(() => false), quitForUpdate = vi.fn((install: () => void) => install()), changed = vi.fn(), openExternal = vi.fn(async () => {})
  const deps = { source, installer, gate, busy, quitForUpdate, changed, openExternal }
  return { ...deps, candidate: f.candidate, service: new UpdateService(env, deps), deps }
}
describe('update state machine and exit coordination', () => {
  afterEach(() => vi.useRealTimers())
  it('merges checks/downloads, preserves progress and installs only on explicit action', async () => {
    const f = service()
    const first = f.service.check(); expect(f.service.check()).toBe(first)
    await first; expect(f.source.check).toHaveBeenCalledTimes(1)
    const downloading = f.service.download(); expect(f.service.download()).toBe(downloading)
    await downloading
    expect(f.installer.download).toHaveBeenCalledTimes(1)
    expect(f.service.status().phase).toBe('downloaded')
    expect(f.installer.install).not.toHaveBeenCalled()
    expect(f.service.install().phase).toBe('installing')
    expect(f.installer.install).toHaveBeenCalledOnce()
    f.service.install(); expect(f.installer.install).toHaveBeenCalledOnce()
    await expect(f.gate.run(() => {})).rejects.toThrow()
  })
  it('blocks install while business is busy and permits retry after idle', async () => {
    const f = service(); await f.service.check(); await f.service.download()
    f.busy.mockReturnValue(true)
    expect(f.service.install()).toMatchObject({ phase: 'downloaded', message: expect.stringContaining('业务任务') })
    expect(f.quitForUpdate).not.toHaveBeenCalled(); f.busy.mockReturnValue(false)
    expect(f.service.install().phase).toBe('installing')
  })
  it('makes the business gate atomic with new IPC work', async () => {
    const gate = new ExitGate(); let finish!: () => void
    const task = gate.run(() => new Promise<void>(resolve => { finish = resolve }))
    expect(gate.acquire(() => false)).toBe(false)
    finish(); await task
    expect(gate.acquire(() => false)).toBe(true)
    await expect(gate.run(() => 'write')).rejects.toThrow()
  })
  it('keeps a failed download retryable, never marks it downloaded', async () => {
    const f = service(); await f.service.check()
    f.installer.download.mockRejectedValueOnce(new Error('bad sha512'))
    expect(await f.service.download()).toMatchObject({ phase: 'error', errorStage: 'download', candidate: f.candidate })
    expect(f.service.install().phase).toBe('error')
    expect(await f.service.download()).toMatchObject({ phase: 'downloaded' })
  })
  it('rechecks the exact candidate before downloading', async () => {
    const f = service(); await f.service.check()
    f.source.check.mockResolvedValueOnce({ phase: 'available', candidate: { ...f.candidate, sha512: 'changed' }, message: '' })
    expect(await f.service.download()).toMatchObject({ phase: 'error' })
    expect(f.installer.download).not.toHaveBeenCalled()
  })
  it('never accesses the source in development or invokes installer for portable', async () => {
    const f = service()
    const development = new UpdateService({ ...env, canCheck: false, canInstall: false }, f.deps)
    development.start(); await development.check(); await development.download(); development.install()
    expect(f.source.check).not.toHaveBeenCalled()
    const portable = new UpdateService({ ...env, canInstall: false, installation: 'portable' }, f.deps)
    await portable.check(); await portable.download(); portable.install()
    expect(f.installer.download).not.toHaveBeenCalled(); expect(f.installer.install).not.toHaveBeenCalled()
  })
  it('honors cooldown and does not disguise failure as up to date', async () => {
    const f = service()
    f.source.check.mockRejectedValue(new UpdateFailure('限流', Date.now() + 60_000))
    expect(await f.service.check()).toMatchObject({ phase: 'error', errorStage: 'check' })
    await f.service.check(); expect(f.source.check).toHaveBeenCalledOnce()
    expect(f.service.status().lastSuccessAt).toBeUndefined()
  })
  it('checks at 10 seconds then 6 hours, stops scheduled work on dispose', async () => {
    vi.useFakeTimers(); const f = service(); f.service.start()
    await vi.advanceTimersByTimeAsync(9999); expect(f.source.check).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1); expect(f.source.check).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(6 * 60 * 60_000); expect(f.source.check).toHaveBeenCalledTimes(2)
    f.service.dispose(); await vi.advanceTimersByTimeAsync(6 * 60 * 60_000); expect(f.source.check).toHaveBeenCalledTimes(2)
  })
  it('does not allow stale results or progress to mutate disposed service', async () => {
    const f = service(); let resolve!: (v: Awaited<ReturnType<typeof f.source.check>>) => void
    f.source.check.mockImplementation(() => new Promise(r => { resolve = r }))
    const task = f.service.check(); await Promise.resolve(); f.service.dispose(); const snapshot = f.service.status()
    resolve({ phase: 'available', candidate: f.candidate, message: '' }); await task
    expect(f.service.status()).toEqual(snapshot)
  })
})
describe('installation capabilities', () => {
  it('requires installer marker, uninstaller, signing policy and acceptance; portable overrides markers', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cijing-update-env-'))
    const resources = join(dir, 'resources'); mkdirSync(resources)
    const input = { packaged: true, version: '0.2.1', platform: 'win32', arch: 'x64', systemVersion: '10.0.0', resourcesPath: resources, execPath: join(dir, '词境.exe'), validated: true }
    try {
      expect(detectEnvironment(input)).toMatchObject({ installation: 'unknown', canInstall: false })
      writeFileSync(join(resources, 'cijing-nsis-installation'), 'com.lychee955.cijing')
      writeFileSync(join(dir, 'Uninstall 词境.exe'), '')
      expect(detectEnvironment(input)).toMatchObject({ installation: 'nsis', canInstall: false })
      writeFileSync(join(resources, 'app-update.yml'), 'publisherName: CN=Example publisher, O=Example\n')
      expect(detectEnvironment(input).canInstall).toBe(true)
      expect(detectEnvironment({ ...input, validated: false }).canInstall).toBe(false)
      expect(detectEnvironment({ ...input, portable: 'cijing.exe' })).toMatchObject({ installation: 'portable', canInstall: false })
      expect(detectEnvironment({ ...input, arch: 'arm64' }).canInstall).toBe(false)
      expect(detectEnvironment({ ...input, packaged: false })).toMatchObject({ installation: 'development', canCheck: false })
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})
