import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OperationsDatabase } from '../../src/main/storage/database'
import { CredentialStore } from '../../src/main/storage/credential-store'
import { SessionService } from '../../src/main/services/session-service'
import { StudyService } from '../../src/main/services/study-service'
import { VocabularyService } from '../../src/main/services/vocabulary-service'
import { MaimemoClient } from '../../src/main/maimemo/client'
import { ClientError } from '../../src/main/maimemo/errors'

const cleanup: Array<() => void> = []
afterEach(() => { cleanup.splice(0).forEach(action => action()) })
function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'momo-session-test-'))
  const db = new OperationsDatabase(join(dir, 'momo.sqlite3'))
  cleanup.push(() => { db.close(); rmSync(dir, { recursive: true, force: true }) })
  const credentials = new CredentialStore(join(dir, 'credentials.json'), {
    isEncryptionAvailable: () => true, encryptString: value => Buffer.from(value), decryptString: value => value.toString()
  })
  const client = new MaimemoClient(async () => { throw new Error('No real network') })
  const add = vi.spyOn(client, 'add').mockResolvedValue(1), contains = vi.spyOn(client, 'contains').mockResolvedValue(false)
  const vocabulary = new VocabularyService(client), study = new StudyService(client, async () => {}, db)
  const session = new SessionService(credentials, db, vocabulary, study)
  session.save('dummy-token')
  return { credentials, db, client, add, contains, session }
}

describe('credential lifecycle and recovery', () => {
  it('blocks credential replacement while an operation is running', async () => {
    const { session, credentials } = setup()
    let finish!: () => void
    const oldProfile = credentials.snapshot().profileId
    const request = session.request(() => new Promise<void>(resolve => { finish = resolve }))
    expect(() => session.save('new-token')).toThrow()
    expect(() => session.clear()).toThrow()
    expect(credentials.snapshot().profileId).toBe(oldProfile)
    finish(); await request
    session.save('new-token')
    expect(credentials.snapshot().profileId).not.toBe(oldProfile)
  })
  it('persists authentication failure and pauses subsequent calls for that profile', async () => {
    const { session, db, credentials } = setup()
    await expect(session.request(async () => { throw new ClientError('AUTH') })).rejects.toMatchObject({ code: 'AUTH' })
    expect(session.status().invalid).toBe(true)
    expect(db.isInvalid(credentials.snapshot().profileId)).toBe(true)
    const request = vi.fn()
    await expect(session.request(request)).rejects.toMatchObject({ code: 'AUTH' })
    expect(request).not.toHaveBeenCalled()
    session.save('new-token')
    expect(session.status().invalid).toBe(false)
  })
  it('recovers only the current profile and never submits old operations to a new token', async () => {
    const { session, db, credentials, add, contains } = setup()
    const old = credentials.snapshot().profileId
    const id = db.begin(old, { id: 'v1', spelling: 'apple' })
    db.recoverInterrupted()
    session.save('different-account')
    await session.recover()
    expect(contains).not.toHaveBeenCalled()
    expect(add).not.toHaveBeenCalled()
    expect(db.get(id)).toMatchObject({ state: 'uncertain', activeProfile: false })
  })
  it('bounds recovery to five operations per launch and keeps the rest visible', async () => {
    const { session, db, credentials, add, contains } = setup()
    const profile = credentials.snapshot().profileId
    for (let i = 0; i < 8; i++) db.begin(profile, { id: `v${i}`, spelling: `word${i}` })
    db.recoverInterrupted(); contains.mockResolvedValue(true)
    await session.recover()
    expect(contains).toHaveBeenCalledTimes(5)
    expect(db.pending(profile, 20)).toHaveLength(3)
    expect(add).not.toHaveBeenCalled()
    expect(session.recovering).toBe(false)
  })
  it('stops automatic recovery after a network failure and retains pending records', async () => {
    const { session, db, credentials, contains } = setup()
    for (let i = 0; i < 4; i++) db.begin(credentials.snapshot().profileId, { id: `v${i}`, spelling: 'word' })
    db.recoverInterrupted(); contains.mockRejectedValue(new ClientError('NETWORK'))
    await session.recover()
    expect(contains).toHaveBeenCalledTimes(1)
    expect(db.pending(credentials.snapshot().profileId)).toHaveLength(4)
  })
})
