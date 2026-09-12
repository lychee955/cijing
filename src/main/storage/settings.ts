import { z } from 'zod'
import type { DesktopSettings, WindowBounds } from '../../shared/models'
import type { OperationsDatabase } from './database'

export const shortcutSchema = z.string().max(100).refine(value => value === '' ||
  /^(?:(?:CommandOrControl|Control|Command|Alt|Shift|Super)\+){1,4}(?:[A-Z0-9]|F(?:[1-9]|1\d|2[0-4])|Space)$/.test(value) &&
  value.split('+').slice(0, -1).some(key => key !== 'Shift') &&
  new Set(value.split('+')).size === value.split('+').length)
export const settingsSchema = z.object({
  shortcut: shortcutSchema,
  closeBehavior: z.enum(['hide', 'quit']),
  theme: z.enum(['system', 'light', 'dark'])
}).strict()
export const boundsSchema = z.object({ x: z.number().int(), y: z.number().int(), width: z.number().int().min(100).max(10000), height: z.number().int().min(100).max(10000) })
export const defaultSettings: DesktopSettings = { shortcut: 'CommandOrControl+Shift+M', closeBehavior: 'hide', theme: 'system' }
export class SettingsStore {
  constructor(private readonly database: OperationsDatabase) {}
  read(): DesktopSettings { return settingsSchema.safeParse(this.database.readSetting('desktop')).data ?? { ...defaultSettings } }
  save(settings: DesktopSettings): void { this.database.writeSetting('desktop', settingsSchema.parse(settings)) }
  bounds(): WindowBounds | undefined { return boundsSchema.safeParse(this.database.readSetting('windowBounds')).data }
  saveBounds(bounds: WindowBounds): void { this.database.writeSetting('windowBounds', boundsSchema.parse(bounds)) }
}
