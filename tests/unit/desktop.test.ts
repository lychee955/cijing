import { describe, expect, it, vi } from 'vitest'
import { ShortcutManager } from '../../src/main/shortcuts'
import { shortcutSchema } from '../../src/main/storage/settings'
import { visibleBounds } from '../../src/main/window-bounds'

describe('global shortcut registration', () => {
  it('keeps the previous binding when the new key conflicts', () => {
    const adapter = { register: vi.fn().mockReturnValueOnce(true).mockReturnValueOnce(false), unregister: vi.fn() }
    const manager = new ShortcutManager(adapter, () => {})
    manager.change('Control+Shift+M', () => {})
    const persist = vi.fn()
    expect(() => manager.change('Control+Shift+N', persist)).toThrow()
    expect(adapter.unregister).not.toHaveBeenCalled()
    expect(persist).not.toHaveBeenCalled()
    expect(manager.available).toBe(true)
  })
  it('rolls back the new binding if saving settings fails', () => {
    const adapter = { register: vi.fn(() => true), unregister: vi.fn() }
    const manager = new ShortcutManager(adapter, () => {})
    manager.change('Control+Shift+M', () => {})
    expect(() => manager.change('Control+Shift+N', () => { throw new Error('disk full') })).toThrow()
    expect(adapter.unregister.mock.calls).toEqual([['Control+Shift+N']])
  })
  it('invokes reveal and unregisters on disable/exit', () => {
    const adapter = { register: vi.fn(() => true), unregister: vi.fn() }, reveal = vi.fn()
    const manager = new ShortcutManager(adapter, reveal)
    manager.change('Control+Shift+M', () => {})
    expect(adapter.register).toHaveBeenCalledWith('Control+Shift+M', reveal)
    manager.change('', () => {})
    expect(manager.available).toBe(false)
    manager.change('Control+Shift+M', () => {}); manager.dispose()
    expect(adapter.unregister).toHaveBeenCalledTimes(2)
  })
  it('rejects malformed or unmodified shortcuts', () => {
    for (const value of ['M', 'Shift+M', 'Control+Control+M', 'Control+bad', 'Control+F30', 'Control+M\n']) {
      expect(shortcutSchema.safeParse(value).success).toBe(false)
    }
    for (const value of ['', 'CommandOrControl+Shift+M', 'Alt+F12']) expect(shortcutSchema.safeParse(value).success).toBe(true)
  })
})
describe('window visibility', () => {
  const primary = { x: 0, y: 0, width: 1920, height: 1040 }
  it('moves a disconnected monitor window into the primary work area', () => {
    const result = visibleBounds({ x: 4000, y: -500, width: 820, height: 720 }, [primary])
    expect(result).toEqual({ x: 1100, y: 0, width: 820, height: 720 })
  })
  it('preserves a visible negative-coordinate secondary monitor', () => {
    const saved = { x: -1200, y: 100, width: 820, height: 720 }
    expect(visibleBounds(saved, [primary, { x: -1280, y: 0, width: 1280, height: 1024 }])).toEqual(saved)
  })
  it('clamps oversized windows and centers first launch', () => {
    const area = { x: 0, y: 0, width: 600, height: 500 }
    expect(visibleBounds({ x: 10, y: 20, width: 2000, height: 1500 }, [area])).toEqual(area)
    expect(visibleBounds(undefined, [primary])).toEqual({ x: 550, y: 160, width: 820, height: 720 })
  })
})
