import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useAnalysisStore } from '../../src/renderer/src/stores/analysis'
beforeEach(() => setActivePinia(createPinia()))
afterEach(() => vi.unstubAllGlobals())
it('ignores cancelled renderer response and prevents duplicate clicks', async () => {
  let finish!: (v: unknown) => void
  const run = vi.fn(() => new Promise(r => { finish = r })), cancel = vi.fn().mockResolvedValue({ ok: true })
  vi.stubGlobal('window', { desktop: { analysis: { run, cancel } } })
  const store = useAnalysisStore(); store.input = 'Birds sing.'
  const pending = store.run(); await store.run(); expect(run).toHaveBeenCalledTimes(1)
  await store.cancel(); finish({ ok: true, data: { record: { id: 'late' }, reused: false } }); await pending
  expect(store.record).toBeUndefined(); expect(store.busy).toBe(false); expect(store.input).toBe('Birds sing.')
})
it('profile switching cancels before selecting and preserves input and completed record', async () => {
  const cancel = vi.fn().mockResolvedValue({ ok: true }), select = vi.fn().mockResolvedValue({ ok: true }), configuration = vi.fn().mockResolvedValue({ ok: true, data: { profiles: [], activeId: 'next', supplement: '' } })
  vi.stubGlobal('window', { desktop: { analysis: { cancel }, ai: { select, configuration } } })
  const store = useAnalysisStore(); store.input = 'Birds sing.'; store.busy = true; await store.select('next')
  expect(cancel.mock.invocationCallOrder[0]).toBeLessThan(select.mock.invocationCallOrder[0]!); expect(store.configuration.activeId).toBe('next'); expect(store.input).toBe('Birds sing.'); expect(store.busy).toBe(false)
})
