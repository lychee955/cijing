import { afterEach, describe, expect, it, vi } from 'vitest'
import { usePronunciation } from '../../src/renderer/src/composables/pronunciation'

function setup() {
  const audios: ReturnType<typeof makeAudio>[] = []
  function makeAudio() {
    return { src: '', preload: '', crossOrigin: '', onplaying: null as (() => void) | null,
      onended: null as (() => void) | null, onerror: null as (() => void) | null,
      play: vi.fn().mockResolvedValue(undefined), pause: vi.fn(), removeAttribute: vi.fn(), load: vi.fn() }
  }
  const create = vi.fn(() => {
    const audio = makeAudio()
    audios.push(audio)
    return audio as unknown as HTMLAudioElement
  })
  return { create, audios, player: usePronunciation(create) }
}
afterEach(() => vi.useRealTimers())

describe('lazy pronunciation playback', () => {
  it('does not create or preload audio until a click, and encodes word and accent', () => {
    const { player, create, audios } = setup()
    expect(create).not.toHaveBeenCalled()
    player.play('apple & pear', 'us')
    const audio = audios[0]!
    expect(new URL(audio.src).searchParams.get('word')).toBe('apple & pear')
    expect(new URL(audio.src).searchParams.get('accent')).toBe('us')
    expect(audio.preload).toBe('none')
    expect(audio.crossOrigin).toBe('')
    expect(audio.play).toHaveBeenCalledTimes(1)
    player.play('apple & pear', 'us')
    expect(create).toHaveBeenCalledTimes(1)
    audio.onplaying!()
    expect(player.state.value).toBe('playing')
    audio.onended!()
    expect(player.state.value).toBe('idle')
    expect(audio.pause).toHaveBeenCalled()
  })
  it('stops the previous accent and ignores late errors after switching or leaving', async () => {
    const { player, audios } = setup()
    player.play('apple', 'uk')
    const previousError = audios[0]!.onerror!
    player.play('apple', 'us')
    expect(audios[0]!.pause).toHaveBeenCalled()
    expect(audios[0]!.removeAttribute).toHaveBeenCalledWith('src')
    previousError()
    expect(player.activeKey.value).toBe('apple:us')
    expect(player.error.value).toBe('')
    const currentError = audios[1]!.onerror!
    player.stop()
    currentError()
    await Promise.resolve()
    expect(player.state.value).toBe('idle')
  })
  it('shows a retryable error and permits another click after a failed load', () => {
    const { player, audios, create } = setup()
    player.play('apple', 'uk')
    audios[0]!.onerror!()
    expect(player.error.value).toContain('加载失败')
    player.play('apple', 'uk')
    expect(create).toHaveBeenCalledTimes(2)
    expect(player.error.value).toBe('')
    player.stop()
  })
  it('times out stalled audio and cancels the timeout once playing', () => {
    vi.useFakeTimers()
    const { player, audios } = setup()
    player.play('apple', 'uk')
    vi.advanceTimersByTime(15_000)
    expect(player.error.value).toContain('超时')
    player.play('apple', 'us')
    audios[1]!.onplaying!()
    vi.advanceTimersByTime(15_000)
    expect(player.state.value).toBe('playing')
    player.stop()
  })
  it('handles a rejected play promise without an unhandled rejection', async () => {
    const audio = { pause: vi.fn(), load: vi.fn(), removeAttribute: vi.fn(), play: () => Promise.reject(new Error('NotAllowedError')) }
    const player = usePronunciation(() => audio as unknown as HTMLAudioElement)
    player.play('apple', 'uk')
    await Promise.resolve()
    expect(player.error.value).toContain('播放失败')
    player.stop()
  })
})
