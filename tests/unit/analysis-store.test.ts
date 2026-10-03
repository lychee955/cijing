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

it('persists translation selection and sends an explicit mode without discarding paragraph breaks', async () => {
  const saved = new Map<string, string>(), storage = { getItem: (key: string) => saved.get(key) ?? null, setItem: (key: string, value: string) => saved.set(key, value) }
  const run = vi.fn().mockResolvedValue({ ok: true, data: { record: { id: 'translated', mode: 'translation', result: { version: 1, translation: '鸟儿歌唱。\n\n它们飞翔。' } }, reused: false } })
  const history = vi.fn().mockResolvedValue({ ok: true, data: { items: [], total: 1 } })
  vi.stubGlobal('window', { localStorage: storage, desktop: { analysis: { run, history } } })
  const store = useAnalysisStore(); expect(store.detailed).toBe(true)
  store.detailed = false; store.input = 'Birds sing.\n\nThey fly.'; await store.run()
  expect(run).toHaveBeenCalledWith(expect.objectContaining({ text: store.input, mode: 'translation', force: false }))
  setActivePinia(createPinia()); expect(useAnalysisStore().detailed).toBe(false)
})
it('opening translation or legacy history restores the corresponding mode', async () => {
  const get = vi.fn().mockResolvedValueOnce({ ok: true, data: { id: 'translation', text: 'Birds sing.', mode: 'translation', result: { version: 1, translation: '鸟儿歌唱。' } } })
    .mockResolvedValueOnce({ ok: true, data: { id: 'legacy', text: 'Birds sing.', result: { version: 1, summary: '', sentences: [], degraded: false } } })
  vi.stubGlobal('window', { desktop: { analysis: { get } } })
  const store = useAnalysisStore(); await store.open('translation'); expect(store.detailed).toBe(false); expect(store.record?.mode).toBe('translation')
  await store.open('legacy'); expect(store.detailed).toBe(true); expect(store.record?.id).toBe('legacy')
})
