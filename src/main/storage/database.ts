import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import type { AddOutcome, HistoryEntry, HistoryPage, HistoryQuery, Vocabulary } from '../../shared/models'
import { ClientError } from '../maimemo/errors'
import { initialMigration } from './migrations/001-initial'
import { analysisMigration } from './migrations/002-analysis'

const columns = `o.id, o.profile_id AS profileId, o.voc_id AS vocId, o.spelling, o.state,
 o.message, o.created_at AS createdAt, o.updated_at AS updatedAt, o.confirmed_at AS confirmedAt,
 o.error_code AS errorCode, p.active AS activeProfile`

export class OperationsDatabase {
  readonly connection: Database.Database
  constructor(path: string) {
    this.connection = this.guard(() => new Database(path))
    try {
      this.connection.pragma('foreign_keys = ON')
      this.connection.pragma('journal_mode = WAL')
      this.connection.pragma('synchronous = FULL')
      this.connection.pragma('busy_timeout = 3000')
      const version = this.connection.pragma('user_version', { simple: true }) as number
      if (version > 2) throw new ClientError('STORAGE_ERROR')
      this.connection.transaction(() => {
        if (version === 0) this.connection.exec(initialMigration)
        if (version < 2) this.connection.exec(analysisMigration)
        this.connection.pragma('user_version = 2')
      })()
    } catch { this.connection.close(); throw new ClientError('STORAGE_ERROR') }
  }

  ensureProfile(id: string): void {
    this.guard(() => this.connection.prepare(`INSERT OR IGNORE INTO profiles
      (id,name,credential_ref,created_at) VALUES (?,?,?,?)`).run(id, '个人配置', 'credentials.v1.json', new Date().toISOString()))
  }

  activateProfile(id: string | null): void {
    this.guard(() => this.connection.transaction(() => {
      if (id) this.ensureProfile(id)
      this.connection.prepare('UPDATE profiles SET active=0 WHERE active=1').run()
      if (id) this.connection.prepare('UPDATE profiles SET active=1 WHERE id=?').run(id)
    })())
  }

  activeProfileId(): string | null {
    return this.guard(() => (this.connection.prepare('SELECT id FROM profiles WHERE active=1').get() as { id: string } | undefined)?.id ?? null)
  }
  invalidateProfile(id: string): void {
    this.guard(() => this.connection.prepare('UPDATE profiles SET auth_invalid=1 WHERE id=?').run(id))
  }
  isInvalid(id: string): boolean {
    return this.guard(() => !!(this.connection.prepare('SELECT auth_invalid FROM profiles WHERE id=?').get(id) as { auth_invalid: number } | undefined)?.auth_invalid)
  }

  begin(profileId: string, word: Vocabulary): string {
    const id = randomUUID(), now = new Date().toISOString()
    this.guard(() => this.connection.transaction(() => {
      this.ensureProfile(profileId)
      this.connection.prepare(`INSERT INTO word_operations
        (id,profile_id,voc_id,spelling,state,message,created_at,updated_at)
        VALUES (?,?,?,?,'submitting',?,?,?)`).run(id, profileId, word.id, word.spelling, '提交中', now, now)
    })())
    return id
  }

  finish(id: string, outcome: AddOutcome): void {
    if (outcome.state === 'unconfirmed') return
    const now = new Date().toISOString()
    this.guard(() => this.connection.transaction(() => {
      const result = this.connection.prepare(`UPDATE word_operations SET state=?,message=?,updated_at=?,
        confirmed_at=CASE WHEN ? THEN ? ELSE confirmed_at END,error_code=? WHERE id=?`)
        .run(outcome.state, outcome.message, now, Number(outcome.state === 'present' || outcome.recordConfirmed === true), now, outcome.errorCode ?? null, id)
      if (result.changes !== 1) throw new ClientError('STORAGE_ERROR')
    })())
  }

  recoverInterrupted(): number {
    return this.guard(() => this.connection.prepare(`UPDATE word_operations SET state='uncertain',message=?,updated_at=?
      WHERE state='submitting'`).run('上次提交被中断，结果待确认；不会自动重新添加。', new Date().toISOString()).changes)
  }
  pending(profileId: string, limit = 5): HistoryEntry[] {
    return this.rows(`WHERE o.profile_id=? AND o.state='uncertain' ORDER BY o.created_at ASC, o.rowid ASC LIMIT ?`, [profileId, limit])
  }
  latest(profileId: string, vocId: string): HistoryEntry | undefined {
    return this.rows('WHERE o.profile_id=? AND o.voc_id=? ORDER BY o.created_at DESC, o.rowid DESC LIMIT 1', [profileId, vocId])[0]
  }
  get(id: string): HistoryEntry | undefined { return this.rows('WHERE o.id=?', [id])[0] }
  list(query: HistoryQuery): HistoryPage {
    const where = `WHERE ${query.scope === 'active' ? 'p.active=1' : '1=1'}${query.pendingOnly ? " AND o.state IN ('submitting','uncertain','not_added')" : ''}`
    const total = this.guard(() => (this.connection.prepare(`SELECT count(*) AS total FROM word_operations o JOIN profiles p ON p.id=o.profile_id ${where}`).get() as { total: number }).total)
    return { total, items: this.rows(`${where} ORDER BY o.created_at DESC, o.rowid DESC LIMIT ? OFFSET ?`, [query.limit, query.offset]) }
  }

  readSetting(key: string): unknown {
    return this.guard(() => {
      const row = this.connection.prepare('SELECT value FROM settings WHERE key=?').get(key) as { value: string } | undefined
      return row ? JSON.parse(row.value) as unknown : undefined
    })
  }
  writeSetting(key: string, value: unknown): void {
    this.guard(() => this.connection.prepare('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, JSON.stringify(value)))
  }
  close(): void { if (this.connection.open) this.connection.close() }

  private rows(suffix: string, params: (string | number)[]): HistoryEntry[] {
    return this.guard(() => (this.connection.prepare(`SELECT ${columns} FROM word_operations o JOIN profiles p ON p.id=o.profile_id ${suffix}`).all(...params) as HistoryEntry[])
      .map(row => ({ ...row, operationId: row.id, activeProfile: !!row.activeProfile, errorCode: row.errorCode ?? undefined })))
  }
  private guard<T>(action: () => T): T {
    try { return action() } catch { throw new ClientError('STORAGE_ERROR') }
  }
}
