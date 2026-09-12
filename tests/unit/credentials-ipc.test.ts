import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { CredentialStore, type Encryption } from '../../src/main/storage/credential-store'
import { validateSender } from '../../src/main/ipc/security'
import { spellingSchema, tokenSchema, wordIdSchema } from '../../src/main/maimemo/schemas'
import { resultOf } from '../../src/main/maimemo/errors'

const directories: string[] = []
function setup(encryption?: Encryption, platform?: NodeJS.Platform) {
  const dir = mkdtempSync(join(tmpdir(), 'momo-credentials-test-'))
  directories.push(dir)
  const path = join(dir, 'credentials.v1.json')
  // This is only a test double. Production always uses Electron safeStorage.
  const crypto: Encryption = encryption ?? {
    isEncryptionAvailable: () => true,
    encryptString: value => Buffer.from(value.split('').reverse().join('')),
    decryptString: value => value.toString().split('').reverse().join('')
  }
  return { path, store: new CredentialStore(path, crypto, platform), crypto }
}
afterEach(() => { for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true }) })

describe('credential boundary', () => {
  it('persists ciphertext, exposes status only, survives reload, and rotates local profile on save', () => {
    const { path, store, crypto } = setup()
    expect(store.status()).toEqual({ configured: false, available: true })
    store.save(' private-token ')
    expect(readFileSync(path, 'utf8')).not.toContain('private-token')
    const first = store.snapshot()
    expect(first.token).toBe('private-token')
    expect(new CredentialStore(path, crypto).snapshot()).toEqual(first)
    expect(store.status()).toEqual({ configured: true, available: true })
    store.save('other-token')
    expect(store.snapshot().profileId).not.toBe(first.profileId)
    store.clear()
    expect(() => store.snapshot()).toThrow()
    expect(store.status().configured).toBe(false)
  })
  it('refuses storage when encryption is unavailable', () => {
    const { store } = setup({ isEncryptionAvailable: () => false, encryptString: () => { throw new Error() }, decryptString: () => '' })
    expect(() => store.save('secret')).toThrow()
    expect(store.status()).toEqual({ configured: false, available: false })
  })
  it('refuses the Linux basic_text backend', () => {
    const { store } = setup({ isEncryptionAvailable: () => true, getSelectedStorageBackend: () => 'basic_text',
      encryptString: value => Buffer.from(value), decryptString: value => value.toString() }, 'linux')
    expect(() => store.save('secret')).toThrow()
  })
  it('reports corrupted storage without exposing contents', () => {
    const { store, path } = setup()
    writeFileSync(path, '{broken SECRET')
    expect(store.status()).toEqual({ configured: true, available: false })
    expect(() => store.snapshot()).toThrow('系统凭证加密不可用')
    store.clear()
  })
  it('never serializes unexpected exception details', async () => {
    expect(await resultOf(() => { throw new Error('Authorization: Bearer SECRET') }))
      .toEqual({ ok: false, error: { code: 'INTERNAL', message: '操作未完成，请重试。' } })
  })
})

describe('IPC validation', () => {
  const allowed = 'file:///app/index.html'
  it('accepts only the owned main frame at the exact renderer URL', () => {
    expect(() => validateSender({ trustedContents: true, mainFrame: true, url: allowed }, allowed)).not.toThrow()
    for (const sender of [
      { trustedContents: false, mainFrame: true, url: allowed },
      { trustedContents: true, mainFrame: false, url: allowed },
      { trustedContents: true, mainFrame: true, url: `${allowed}?evil=true` },
      { trustedContents: true, mainFrame: true, url: 'https://evil.example' }
    ]) expect(() => validateSender(sender, allowed)).toThrow()
  })
  it('trims only surrounding spelling whitespace and validates id/token', () => {
    expect(spellingSchema.parse('  Apple pie  ')).toBe('Apple pie')
    for (const input of ['', ' ', 'x'.repeat(201), 'apple\npear']) expect(spellingSchema.safeParse(input).success).toBe(false)
    for (const input of ['', '../path', 'has space', '<script>']) expect(wordIdSchema.safeParse(input).success).toBe(false)
    expect(tokenSchema.safeParse('Bearer my-token').success).toBe(false)
    expect(tokenSchema.safeParse('token\r\nInjected: value').success).toBe(false)
  })
})
