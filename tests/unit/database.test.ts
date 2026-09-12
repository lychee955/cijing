import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OperationsDatabase } from '../../src/main/storage/database'
import { StudyService } from '../../src/main/services/study-service'
import { MaimemoClient } from '../../src/main/maimemo/client'
import { ClientError } from '../../src/main/maimemo/errors'

const handles: OperationsDatabase[] = [], directories: string[] = []
const credentials = { profileId: 'profile1', token: 'dummy' }, word = { id: 'v1', spelling: 'apple' }
function open(path = ':memory:') { const database = new OperationsDatabase(path); handles.push(database); return database }
function path() { const dir = mkdtempSync(join(tmpdir(), 'momo-db-test-')); directories.push(dir); return join(dir, 'momo.sqlite3') }
function setup(database: OperationsDatabase) {
  const client = new MaimemoClient(async () => { throw new Error('No network') })
  const add = vi.spyOn(client, 'add').mockResolvedValue(1)
  const contains = vi.spyOn(client, 'contains').mockResolvedValue(false)
  return { client, add, contains, study: new StudyService(client, async () => {}, database) }
}
afterEach(() => { for (const db of handles.splice(0)) db.close(); for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true }) })

describe('SQLite persistence and recovery', () => {
  it('migrates once, preserves settings and records across reopen', () => {
    const file = path(), db = open(file)
    db.activateProfile('profile1')
    const id = db.begin('profile1', word)
    db.finish(id, { vocId: 'v1', spelling: 'apple', state: 'added', message: '已加入学习规划' })
    db.writeSetting('sample', { theme: 'dark' }); db.close()
    const reloaded = open(file)
    expect(reloaded.connection.pragma('user_version', { simple: true })).toBe(1)
    expect(reloaded.readSetting('sample')).toEqual({ theme: 'dark' })
    expect(reloaded.get(id)).toMatchObject({ state: 'added', activeProfile: true, confirmedAt: null })
    expect(reloaded.activeProfileId()).toBe('profile1')
  })
  it('refuses a future database version without resetting it', () => {
    const file = path(), db = open(file)
    db.connection.pragma('user_version=2'); db.close()
    expect(() => open(file)).toThrow()
  })
  it('persists submitting before the API is called', async () => {
    const db = open(), { study, add } = setup(db)
    add.mockImplementation(async () => {
      expect(db.latest('profile1', 'v1')).toMatchObject({ state: 'submitting' })
      return 1
    })
    const outcome = await study.add(credentials, word)
    expect(db.get(outcome.operationId!)).toMatchObject({ state: 'added' })
  })
  it('never sends a write if recording it fails', async () => {
    const db = open(), { study, add } = setup(db)
    vi.spyOn(db, 'begin').mockImplementation(() => { throw new ClientError('STORAGE_ERROR') })
    await expect(study.add(credentials, word)).rejects.toMatchObject({ code: 'STORAGE_ERROR' })
    expect(add).not.toHaveBeenCalled()
  })
  it('retains uncertain state if persisting a received result fails', async () => {
    const db = open(), { study, add } = setup(db)
    vi.spyOn(db, 'finish').mockImplementation(() => { throw new ClientError('STORAGE_ERROR') })
    expect(await study.add(credentials, word)).toMatchObject({ state: 'uncertain', errorCode: 'STORAGE_ERROR' })
    await study.add(credentials, word)
    expect(add).toHaveBeenCalledTimes(1)
    expect(db.latest('profile1', 'v1')?.state).toBe('submitting')
  })
  it('recovers an interrupted submission and only queries on restart', async () => {
    const file = path(), db = open(file)
    const id = db.begin('profile1', word); db.close()
    const reloaded = open(file)
    expect(reloaded.recoverInterrupted()).toBe(1)
    expect(reloaded.recoverInterrupted()).toBe(0)
    const { study, add, contains } = setup(reloaded)
    expect((await study.add(credentials, word)).state).toBe('uncertain')
    expect(add).not.toHaveBeenCalled()
    contains.mockResolvedValue(true)
    expect((await study.confirm(credentials, word, id)).state).toBe('present')
    expect(reloaded.get(id)).toMatchObject({ state: 'present', confirmedAt: expect.any(String) })
    expect(add).not.toHaveBeenCalled()
  })
  it('does not repeat a known successful addition after restart', async () => {
    const file = path(), db = open(file)
    await setup(db).study.add(credentials, word); db.close()
    const { study, add } = setup(open(file))
    expect((await study.add(credentials, word)).state).toBe('added')
    expect(add).not.toHaveBeenCalled()
  })
  it('paginates deterministically and scopes old configurations as read-only', () => {
    const db = open()
    db.activateProfile('profile1')
    for (let i = 0; i < 25; i++) db.begin('profile1', { id: `v${i}`, spelling: `word${i}` })
    db.activateProfile('profile2')
    db.begin('profile2', word)
    const query = { scope: 'all' as const, offset: 0, limit: 20, pendingOnly: false }
    const first = db.list(query), second = db.list({ ...query, offset: 20 })
    expect(first.total).toBe(26)
    expect(second.items).toHaveLength(6)
    expect(new Set([...first.items, ...second.items].map(row => row.id)).size).toBe(26)
    expect(db.list({ ...query, scope: 'active' }).items).toHaveLength(1)
    expect(first.items.filter(row => row.profileId === 'profile1').every(row => !row.activeProfile)).toBe(true)
  })
  it('confirming an older failed attempt cannot unlock a newer uncertain write', async () => {
    const db = open(), { study, add } = setup(db)
    add.mockRejectedValueOnce(new ClientError('PERMISSION')).mockRejectedValueOnce(new ClientError('NETWORK', true))
    const failed = await study.add(credentials, word)
    expect((await study.add(credentials, word)).state).toBe('uncertain')
    await study.confirm(credentials, word, failed.operationId)
    expect((await study.add(credentials, word)).state).toBe('uncertain')
    expect(add).toHaveBeenCalledTimes(2)
  })
  it('rejects confirmation against another profile', async () => {
    const db = open(), { study } = setup(db)
    const id = db.begin('other', word)
    expect(() => study.confirm(credentials, word, id)).toThrow()
  })
})
