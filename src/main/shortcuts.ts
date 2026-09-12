import { ClientError } from './maimemo/errors'

export interface ShortcutAdapter {
  register(accelerator: string, callback: () => void): boolean
  unregister(accelerator: string): void
}
export class ShortcutManager {
  private registered = ''
  constructor(private readonly adapter: ShortcutAdapter, private readonly reveal: () => void) {}
  get available(): boolean { return this.registered !== '' }
  change(next: string, persist: () => void): void {
    const previous = this.registered
    if (next === previous) { persist(); return }
    let succeeded = !next
    try { if (next) succeeded = this.adapter.register(next, this.reveal) } catch { succeeded = false }
    if (!succeeded) throw new ClientError('SHORTCUT_CONFLICT')
    try { persist() }
    catch (error) { if (next) this.adapter.unregister(next); throw error }
    if (previous) this.adapter.unregister(previous)
    this.registered = next
  }
  dispose(): void { if (this.registered) this.adapter.unregister(this.registered); this.registered = '' }
}
