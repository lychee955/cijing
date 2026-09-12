import { describe, expect, it, vi } from 'vitest'
import { StudyService } from '../../src/main/services/study-service'
import { VocabularyService } from '../../src/main/services/vocabulary-service'
import { MaimemoClient } from '../../src/main/maimemo/client'
import { ClientError } from '../../src/main/maimemo/errors'

const credentials = { profileId: 'profile1', token: 'token' }
const word = { id: 'v1', spelling: 'apple' }
function setup() {
  const client = new MaimemoClient(async () => { throw new Error('No real network') })
  const add = vi.spyOn(client, 'add').mockResolvedValue(1)
  const contains = vi.spyOn(client, 'contains').mockResolvedValue(false)
  const study = new StudyService(client, async () => {})
  return { client, add, contains, study }
}

describe('add outcome safety', () => {
  it('only added_count=1 reports a new addition', async () => {
    const { study, contains } = setup()
    expect((await study.add(credentials, word)).state).toBe('added')
    expect(contains).not.toHaveBeenCalled()
  })
  it('zero plus a matching record is present, never added', async () => {
    const { study, add, contains } = setup()
    add.mockResolvedValue(0); contains.mockResolvedValue(true)
    expect((await study.add(credentials, word)).state).toBe('present')
  })
  it('manual confirmation after success performs a fresh read and retains addition provenance', async () => {
    const { study, contains, add } = setup()
    await study.add(credentials, word)
    contains.mockResolvedValue(true)
    expect(await study.confirm(credentials, word)).toMatchObject({ state: 'added', message: '已加入学习规划；学习记录已确认。' })
    expect(contains).toHaveBeenCalledTimes(1)
    expect(add).toHaveBeenCalledTimes(1)
  })
  it('an empty later read cannot erase a definitive addition', async () => {
    const { study, contains } = setup()
    await study.add(credentials, word)
    const outcome = await study.confirm(credentials, word)
    expect(outcome.state).toBe('added')
    expect(outcome.message).toContain('学习记录暂未确认')
    expect(contains).toHaveBeenCalledTimes(2)
  })
  it('an empty read before any write does not block the first addition', async () => {
    const { study, add } = setup()
    expect((await study.confirm(credentials, word)).state).toBe('unconfirmed')
    expect(add).not.toHaveBeenCalled()
    expect((await study.add(credentials, word)).state).toBe('added')
    expect(add).toHaveBeenCalledTimes(1)
  })
  it('a failed read before any write does not create write uncertainty', async () => {
    const { study, add, contains } = setup()
    contains.mockRejectedValue(new ClientError('NETWORK'))
    expect(await study.confirm(credentials, word)).toMatchObject({ state: 'unconfirmed', errorCode: 'NETWORK' })
    expect(add).not.toHaveBeenCalled()
    expect((await study.add(credentials, word)).state).toBe('added')
  })
  it('zero with no records remains not_added after bounded confirmation', async () => {
    const { study, add, contains } = setup()
    add.mockResolvedValue(0)
    expect((await study.add(credentials, word)).state).toBe('not_added')
    expect(contains).toHaveBeenCalledTimes(2)
  })
  it.each(['TIMEOUT', 'NETWORK', 'SERVER', 'INVALID_RESPONSE'] as const)('%s remains uncertain and cannot be resubmitted', async code => {
    const { study, add, contains } = setup()
    add.mockRejectedValue(new ClientError(code, true))
    expect((await study.add(credentials, word)).state).toBe('uncertain')
    expect((await study.add(credentials, word)).state).toBe('uncertain')
    expect(add).toHaveBeenCalledTimes(1)
    expect(contains).toHaveBeenCalledTimes(2)
    contains.mockResolvedValue(true)
    expect((await study.confirm(credentials, word)).state).toBe('present')
    expect(add).toHaveBeenCalledTimes(1)
  })
  it('handles delayed synchronization after ambiguous writes', async () => {
    const { study, add, contains } = setup()
    add.mockRejectedValue(new ClientError('TIMEOUT', true))
    contains.mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    expect((await study.add(credentials, word)).state).toBe('present')
  })
  it('a failed confirmation must not erase write uncertainty', async () => {
    const { study, add, contains } = setup()
    add.mockRejectedValue(new ClientError('NETWORK', true))
    contains.mockRejectedValue(new ClientError('AUTH'))
    expect(await study.add(credentials, word)).toMatchObject({ state: 'uncertain', errorCode: 'AUTH' })
  })
  it.each(['AUTH', 'PERMISSION', 'INVALID_INPUT', 'RATE_LIMIT'] as const)('explicit %s is failed', async code => {
    const { study, add, contains } = setup()
    add.mockRejectedValue(new ClientError(code))
    expect(await study.add(credentials, word)).toMatchObject({ state: 'failed', errorCode: code })
    expect(contains).not.toHaveBeenCalled()
  })
  it('pauses subsequent writes for an invalid credential profile', async () => {
    const { study, add } = setup()
    add.mockRejectedValue(new ClientError('AUTH'))
    await study.add(credentials, word)
    await expect(study.add(credentials, { id: 'v2', spelling: 'pear' })).rejects.toMatchObject({ code: 'AUTH' })
    expect(add).toHaveBeenCalledTimes(1)
  })
  it('merges concurrent operations by profile and word', async () => {
    const { study, add } = setup()
    const first = study.add(credentials, word)
    expect(study.add(credentials, word)).toBe(first)
    expect(study.confirm(credentials, word)).toBe(first)
    await first
    await study.add({ profileId: 'profile2', token: 'new-token' }, word)
    expect(add).toHaveBeenCalledTimes(2)
  })
  it('requires a query result from the same credential profile', async () => {
    const { client } = setup()
    vi.spyOn(client, 'lookup').mockResolvedValue([word])
    const vocabulary = new VocabularyService(client)
    await vocabulary.lookup(credentials, 'apple')
    expect(vocabulary.get('profile1', 'v1')).toEqual(word)
    expect(() => vocabulary.get('profile2', 'v1')).toThrow()
    expect(() => vocabulary.get('profile1', 'invented')).toThrow()
    vocabulary.clear()
    expect(() => vocabulary.get('profile1', 'v1')).toThrow()
  })
})
