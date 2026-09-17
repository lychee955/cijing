import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useSearchStore } from '../../src/renderer/src/stores/search'
import type { Result } from '../../src/shared/result'
import type { AddOutcome, Vocabulary } from '../../src/shared/models'

const word = { id: 'v1', spelling: 'apple' }
const result = (state: AddOutcome['state']): Result<AddOutcome> => ({ ok: true, data: {
  vocId: word.id, spelling: word.spelling, state, message: state
} })
function setup() {
  const confirm = vi.fn().mockResolvedValue(result('unconfirmed'))
  const add = vi.fn().mockResolvedValue(result('added'))
  const lookup = vi.fn().mockResolvedValue({ ok: true, data: [word] })
  vi.stubGlobal('window', { desktop: { vocabulary: { lookup }, study: { confirm, add } } })
  const store = useSearchStore()
  store.input = 'apple'
  return { store, confirm, add, lookup }
}

describe('renderer request ordering', () => {
  beforeEach(() => setActivePinia(createPinia()))
  afterEach(() => vi.unstubAllGlobals())
  it('displays matches before study checks finish and prevents an add from racing a pending check', async () => {
    const { store, confirm, add } = setup()
    let finish!: (value: Result<AddOutcome>) => void
    confirm.mockReturnValue(new Promise(resolve => { finish = resolve }))
    await store.lookup()
    expect(store.words).toEqual([word])
    expect(store.querying).toBe(false)
    expect(store.checkingSelected).toBe(true)
    await store.submit()
    expect(add).not.toHaveBeenCalled()
    finish(result('present'))
    await vi.waitFor(() => expect(store.checkingSelected).toBe(false))
    expect(store.canAdd).toBe(false)
    expect(store.selectedOutcome?.state).toBe('present')
  })
  it('refreshes records on every search and allows adding when no record is found', async () => {
    const { store, confirm, add } = setup()
    await store.lookup()
    await vi.waitFor(() => expect(store.canAdd).toBe(true))
    await store.lookup()
    await vi.waitFor(() => expect(confirm).toHaveBeenCalledTimes(2))
    await store.submit()
    expect(add).toHaveBeenCalledWith('v1')
    expect(store.studyStatuses.v1?.outcome?.state).toBe('added')
  })
  it('checks each match and retains status when switching selection', async () => {
    const { store, lookup, confirm } = setup()
    lookup.mockResolvedValue({ ok: true, data: [word, { id: 'v2', spelling: 'Apple' }] })
    confirm.mockResolvedValueOnce(result('present'))
    await store.lookup()
    await vi.waitFor(() => expect(store.studyStatuses.v2?.loading).toBe(false))
    expect(confirm.mock.calls).toEqual([['v1'], ['v2']])
    store.select('v1'); expect(store.canAdd).toBe(false)
    store.select('v2'); expect(store.canAdd).toBe(true)
  })
  it('ignores stale study responses after a new search and after input invalidation', async () => {
    const { store, confirm } = setup()
    let finish!: (value: Result<AddOutcome>) => void
    confirm.mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
    await store.lookup()
    await store.lookup()
    await vi.waitFor(() => expect(store.selectedOutcome?.state).toBe('unconfirmed'))
    finish(result('present'))
    await Promise.resolve()
    expect(store.selectedOutcome?.state).toBe('unconfirmed')
    confirm.mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
    await store.lookup()
    store.invalidate()
    finish(result('present'))
    await Promise.resolve()
    expect(store.studyStatuses).toEqual({})
  })
  it('shows read failures without hiding matches and skips reads on empty results', async () => {
    const { store, lookup, confirm } = setup()
    confirm.mockRejectedValue(new Error('offline'))
    await store.lookup()
    await vi.waitFor(() => expect(store.studyStatuses.v1?.error).toContain('无法连接'))
    expect(store.words).toEqual([word])
    lookup.mockResolvedValue({ ok: true, data: [] })
    await store.lookup()
    expect(confirm).toHaveBeenCalledTimes(1)
  })
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
