import { describe, expect, it, vi } from 'vitest'
import { MaimemoClient, type Fetcher } from '../../src/main/maimemo/client'
import { RateLimiter } from '../../src/main/maimemo/rate-limiter'

const word = { id: 'v1', spelling: 'apple' }
const json = (body: unknown, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers })
function setup(responses: Array<Response | Error>) {
  const fetcher = vi.fn<Fetcher>().mockImplementation(async () => {
    const response = responses.shift()
    if (response instanceof Error) throw response
    if (!response) throw new Error('Unexpected request')
    return response
  })
  return { fetcher, client: new MaimemoClient(fetcher, undefined, 100, undefined, async () => {}) }
}

describe('official API adapter', () => {
  it('gets definitions by word id without a request body and removes empty duplicates', async () => {
    const { client, fetcher } = setup([json({ data: { interpretations: [
      { interpretation: ' n. 苹果 ' }, { interpretation: '' }, { interpretation: 'n. 苹果' }, { interpretation: 'n. 苹果树' }
    ] } }), json({ interpretations: [] })])
    expect(await client.interpretations('secret', 'v1')).toEqual(['n. 苹果', 'n. 苹果树'])
    expect(fetcher.mock.calls[0]![0]).toBe('https://open.maimemo.com/open/api/v1/memo/interpretations?voc_id=v1')
    expect(fetcher.mock.calls[0]![1]).toMatchObject({ method: 'GET', body: undefined })
    expect(await client.interpretations('secret', 'v2')).toEqual([])
  })
  it('queries one spelling as a list and accepts envelope/multiple matches', async () => {
    const { client, fetcher } = setup([json({ success: true, data: { voc: [word, { id: 'v2', spelling: 'Apple' }] }, errors: [] })])
    expect(await client.lookup('secret', 'apple & pear')).toHaveLength(2)
    const [url, init] = fetcher.mock.calls[0]!
    expect(url).toBe('https://open.maimemo.com/open/api/v1/memo/vocabulary/query')
    expect(JSON.parse(init.body as string)).toEqual({ spellings: ['apple & pear'] })
    expect(init.headers).toMatchObject({ Authorization: 'Bearer secret' })
    expect(init.redirect).toBe('error')
  })
  it('accepts the documented unwrapped response and empty results', async () => {
    const { client } = setup([json({ voc: [word] }), json({ voc: [] })])
    expect(await client.lookup('token', 'apple')).toEqual([word])
    expect(await client.lookup('token', 'unknown')).toEqual([])
  })
  it('sends advance=false and the selected id', async () => {
    const { client, fetcher } = setup([json({ added_count: 1 })])
    expect(await client.add('token', word.id)).toBe(1)
    expect(JSON.parse(fetcher.mock.calls[0]![1].body as string)).toEqual({ words: [{ id: 'v1' }], advance: false })
  })
  it.each([{}, { added_count: '1' }, { added_count: 2 }, { added_count: -1 }, { data: null },
    { success: 'yes', added_count: 1 }, { errors: {}, added_count: 1 }])('rejects malformed success %j', async response => {
    const { client, fetcher } = setup([json(response)])
    await expect(client.add('token', 'v1')).rejects.toMatchObject({ code: 'INVALID_RESPONSE', ambiguous: true })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it.each([{ success: false, data: { added_count: 1 } }, { errors: [{ message: 'secret raw message' }], added_count: 1 }])
    ('checks business errors even under HTTP 200', async response => {
      const { client } = setup([json(response)])
      await expect(client.add('token', 'v1')).rejects.toMatchObject({ code: 'API_ERROR', ambiguous: true })
    })
  it.each([[401, 'AUTH', false], [403, 'PERMISSION', false], [400, 'INVALID_INPUT', false],
    [422, 'INVALID_INPUT', false], [429, 'RATE_LIMIT', false], [500, 'SERVER', true], [408, 'API_ERROR', true]])
    ('maps HTTP %i without exposing raw errors', async (status, code, ambiguous) => {
      const { client, fetcher } = setup([json({ token: 'SECRET' }, status as number)])
      await expect(client.add('token', 'v1')).rejects.toMatchObject({ code, ambiguous })
      expect(fetcher).toHaveBeenCalledTimes(1)
    })
  it('matches study records by exact id, ignoring count and other words', async () => {
    const { client, fetcher } = setup([json({ records: [{ voc_id: 'v2' }], count: 100 }), json({ records: [{ voc_id: 'v1' }], count: 0 })])
    expect(await client.contains('token', 'v1')).toBe(false)
    expect(await client.contains('token', 'v1')).toBe(true)
    expect(JSON.parse(fetcher.mock.calls[0]![1].body as string)).toEqual({ voc_ids: ['v1'], as_count: false, limit: 1000 })
  })
  it('retries reads at most once but never retries sent writes', async () => {
    const read = setup([new TypeError('network'), json({ voc: [word] })])
    expect(await read.client.lookup('token', 'apple')).toEqual([word])
    expect(read.fetcher).toHaveBeenCalledTimes(2)
    const write = setup([new TypeError('network')])
    await expect(write.client.add('token', 'v1')).rejects.toMatchObject({ code: 'NETWORK', ambiguous: true })
    expect(write.fetcher).toHaveBeenCalledTimes(1)
  })
  it('aborts a timed-out write and does not retry it', async () => {
    const fetcher = vi.fn<Fetcher>().mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init.signal!.addEventListener('abort', () => reject(new Error('abort')))
    }))
    await expect(new MaimemoClient(fetcher, undefined, 10).add('token', 'v1')).rejects.toMatchObject({ code: 'TIMEOUT', ambiguous: true })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('limits streamed response size and rejects invalid JSON', async () => {
    for (const response of [new Response('x'.repeat(1024 * 1024 + 1)), new Response('{')]) {
      const { client } = setup([response])
      await expect(client.add('token', 'v1')).rejects.toMatchObject({ code: 'INVALID_RESPONSE', ambiguous: true })
    }
  })
  it('honors server retry-after before another request', async () => {
    const { client, fetcher } = setup([json({}, 429, { 'Retry-After': '60' })])
    await expect(client.lookup('token', 'apple')).rejects.toMatchObject({ code: 'RATE_LIMIT' })
    await expect(client.lookup('token', 'apple')).rejects.toMatchObject({ code: 'RATE_LIMIT' })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('logs only safe metadata', async () => {
    const log = vi.fn()
    const client = new MaimemoClient(async () => json({ added_count: 1 }), undefined, 100, log)
    await client.add('SUPER-SECRET', 'v1')
    expect(JSON.stringify(log.mock.calls)).not.toContain('SUPER-SECRET')
    expect(log.mock.calls[0]![0]).toMatchObject({ operation: 'study/add_words', status: 200 })
  })
})

describe('rate windows', () => {
  it('enforces 20/10s, 40/minute and 2000/5h', () => {
    let now = 0
    const limiter = new RateLimiter(() => now)
    for (let i = 0; i < 20; i++) limiter.take()
    expect(() => limiter.take()).toThrow()
    now = 10_000
    for (let i = 0; i < 20; i++) limiter.take()
    now = 20_000
    expect(() => limiter.take()).toThrow()
    now = 60_000
    for (let batch = 1; batch < 50; batch++) {
      now = batch * 60_000
      for (let i = 0; i < 20; i++) limiter.take()
      now += 10_000
      for (let i = 0; i < 20; i++) limiter.take()
    }
    now += 60_000
    expect(() => limiter.take()).toThrow()
    now = 18_000_000
    expect(() => limiter.take()).not.toThrow()
  })
})
