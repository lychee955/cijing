import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveDataPath } from '../../src/main/storage/data-path'

const directories: string[] = []
function appData(): string { const path = mkdtempSync(join(tmpdir(), 'cijing-profile-')); directories.push(path); return path }
afterEach(() => { for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true }) })

describe('Cijing profile compatibility', () => {
  it('uses the new profile for a new installation', () => {
    const root = appData()
    expect(resolveDataPath(root)).toBe(join(root, 'cijing'))
  })
  it('keeps the complete existing profile without relocating encrypted credentials', () => {
    const root = appData(), legacy = join(root, 'momo-desktop')
    mkdirSync(legacy)
    for (const name of ['momo.sqlite3', 'credentials.v1.json', 'Local State']) writeFileSync(join(legacy, name), 'old profile')
    expect(resolveDataPath(root)).toBe(legacy)
    expect(resolveDataPath(root, join(root, '词境'))).toBe(legacy)
  })
  it('respects isolated/custom overrides and an existing new database', () => {
    const root = appData(), current = join(root, 'cijing'), explicit = join(root, 'isolated')
    mkdirSync(join(root, 'momo-desktop'))
    expect(resolveDataPath(root, explicit)).toBe(explicit)
    mkdirSync(current); writeFileSync(join(current, 'momo.sqlite3'), 'new profile')
    expect(resolveDataPath(root)).toBe(current)
  })
})
