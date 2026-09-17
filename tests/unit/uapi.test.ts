import { describe, expect, it, vi } from 'vitest'
import { UapiDictionary } from '../../src/main/dictionary/uapi'
import type { Fetcher } from '../../src/main/maimemo/client'

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status })
const entry = { found: true, entry: { word: 'apple', definitions: [
  { meaning: 'n. 苹果' }, { part_of_speech: 'n.', meaning: '苹果树' }, { meaning: 'n. 苹果' }, { meaning: ' ' }
], phonetics: { uk: { text: 'æpl' } } } }

describe('UAPI dictionary', () => {
  it('queries encoded spelling without credentials, parses live response shape, and caches duplicate requests', async () => {
    const fetcher = vi.fn<Fetcher>().mockImplementation(async () => json(entry))
    const dictionary = new UapiDictionary(fetcher)
    const [first, second] = await Promise.all([dictionary.lookup('apple & pear'), dictionary.lookup('apple & pear')])
    expect(first).toEqual({ interpretations: ['n. 苹果', 'n. 苹果树'], phonetics: { uk: 'æpl', us: undefined } })
    expect(second).toEqual(first)
    expect(await dictionary.lookup('apple & pear')).toEqual(first)
    expect(fetcher).toHaveBeenCalledTimes(1)
    const [url, options] = fetcher.mock.calls[0]!
    expect(new URL(url).searchParams.get('word')).toBe('apple & pear')
    expect(options).toMatchObject({ method: 'GET', credentials: 'omit', redirect: 'error', headers: { Accept: 'application/json' } })
    expect(options.headers).not.toHaveProperty('Authorization')
    expect(options.body).toBeUndefined()
  })
  it.each([json({ found: false }), json({}, 404), json({ found: true, entry: { word: 'apple' } })])('handles missing words and optional fields', async response => {
    const dictionary = new UapiDictionary(async () => response)
    expect((await dictionary.lookup('unknown')).interpretations).toEqual([])
  })
  it.each([json({}), json({ found: true, entry: { word: 'apple', definitions: [{ meaning: 123 }] } }), new Response('{')])('rejects malformed data', async response => {
    await expect(new UapiDictionary(async () => response).lookup('apple')).rejects.toThrow('格式异常')
  })
  it('backs off after rate limits and does not retry requests automatically', async () => {
    const fetcher = vi.fn<Fetcher>().mockImplementation(async () => json({}, 429))
    const dictionary = new UapiDictionary(fetcher)
    await expect(dictionary.lookup('apple')).rejects.toThrow('额度不足')
    await expect(dictionary.lookup('pear')).rejects.toThrow('额度不足')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('does not cache failures and spaces requests within the 4 QPS limit', async () => {
    const times: number[] = []
    const fetcher = vi.fn<Fetcher>().mockImplementation(async () => {
      times.push(Date.now())
      if (times.length === 1) throw new Error('offline')
      return json(entry)
    })
    const dictionary = new UapiDictionary(fetcher)
    await expect(dictionary.lookup('apple')).rejects.toThrow('无法连接')
    expect((await dictionary.lookup('apple')).interpretations).toContain('n. 苹果')
    expect(times[1]! - times[0]!).toBeGreaterThanOrEqual(290)
  })
  it('limits input and streamed response size', async () => {
    const fetcher = vi.fn<Fetcher>().mockImplementation(async () => new Response('x'.repeat(1024 * 1024 + 1)))
    const dictionary = new UapiDictionary(fetcher)
    await expect(dictionary.lookup('x'.repeat(65))).rejects.toThrow('64')
    expect(fetcher).not.toHaveBeenCalled()
    await expect(dictionary.lookup('apple')).rejects.toThrow('过大')
  })
  it('aborts stalled requests with a dictionary-specific timeout', async () => {
    const fetcher: Fetcher = (_url, init) => new Promise((_resolve, reject) => {
      init.signal!.addEventListener('abort', () => reject(new Error('aborted')))
    })
    await expect(new UapiDictionary(fetcher, 10).lookup('apple')).rejects.toThrow('超时')
  })
})
