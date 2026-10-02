import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import brand from '../../shared/brand.json'

// Keep the complete old profile in place, including Chromium's encryption metadata.
// Explicit userData overrides (e.g. isolated tests) always take precedence.
export function resolveDataPath(appData: string, current = join(appData, brand.packageName)): string {
  const defaults = [join(appData, brand.packageName), join(appData, brand.name)]
  if (!defaults.some(path => resolve(path) === resolve(current))) return current
  if (existsSync(join(current, 'momo.sqlite3'))) return current
  const legacy = join(appData, 'momo-desktop')
  return existsSync(legacy) ? legacy : current
}
