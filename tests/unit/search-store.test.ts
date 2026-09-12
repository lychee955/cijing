import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useSearchStore } from '../../src/renderer/src/stores/search'
import type { Result } from '../../src/shared/result'
import type { Vocabulary } from '../../src/shared/models'

describe('renderer request ordering', () => {
  beforeEach(() => setActivePinia(createPinia()))
  it('ignores a slow old lookup and preserves the original input', async () => {
    let finishOld!: (value: Result<Vocabulary[]>) => void
    const lookup = vi.fn().mockReturnValueOnce(new Promise(resolve => { finishOld = resolve }))
      .mockResolvedValueOnce({ ok: true, data: [{ id: 'new', spelling: 'New' }] })
    vi.stubGlobal('window', { desktop: { vocabulary: { lookup } } })
    const store = useSearchStore()
    store.input = ' old '
    const old = store.lookup()
    store.input = ' New '
    store.invalidate()
    await store.lookup()
    finishOld({ ok: true, data: [{ id: 'old', spelling: 'old' }] })
    await old
    expect(store.words).toEqual([{ id: 'new', spelling: 'New' }])
    expect(store.input).toBe(' New ')
    expect(lookup).toHaveBeenNthCalledWith(2, 'New')
    vi.unstubAllGlobals()
  })
  it('invalidates results when input changes without another query', async () => {
    let finish!: (value: Result<Vocabulary[]>) => void
    vi.stubGlobal('window', { desktop: { vocabulary: { lookup: () => new Promise(resolve => { finish = resolve }) } } })
    const store = useSearchStore()
    store.input = 'apple'
    const old = store.lookup()
    store.input = 'pear'; store.invalidate()
    finish({ ok: true, data: [{ id: 'v1', spelling: 'apple' }] })
    await old
    expect(store.words).toEqual([])
    expect(store.selected).toBeUndefined()
    vi.unstubAllGlobals()
  })
})
