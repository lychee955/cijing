import { ref } from 'vue'

export type Accent = 'uk' | 'us'

export function usePronunciation(createAudio = () => new Audio()) {
  const activeKey = ref('')
  const state = ref<'idle' | 'loading' | 'playing' | 'error'>('idle')
  const error = ref('')
  let audio: HTMLAudioElement | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let sequence = 0

  function stop(): void {
    sequence++
    clearTimeout(timer)
    if (audio) {
      audio.onplaying = null
      audio.onended = null
      audio.onerror = null
      audio.pause()
      audio.removeAttribute('src')
      audio.load()
      audio = undefined
    }
    activeKey.value = ''
    state.value = 'idle'
    error.value = ''
  }

  function play(word: string, accent: Accent): void {
    const key = `${word}:${accent}`
    if (activeKey.value === key && state.value === 'loading') return
    stop()
    activeKey.value = key
    if (!word.trim() || word.length > 64) {
      state.value = 'error'
      error.value = '发音仅支持 1–64 个字符的单词或短语。'
      return
    }
    const request = sequence
    const fail = (message: string): void => {
      if (request !== sequence) return
      stop()
      activeKey.value = key
      state.value = 'error'
      error.value = message
    }
    try {
      // Neither the media element nor its URL exists until an explicit click.
      audio = createAudio()
      audio.preload = 'none'
      // Plain media playback does not need CORS. UAPI does not return CORS
      // headers for MP3 responses and rejects the file renderer's null Origin.
      const url = new URL('https://uapis.cn/api/v1/dictionary/audio')
      url.searchParams.set('word', word)
      url.searchParams.set('accent', accent)
      audio.src = url.href
      state.value = 'loading'
      audio.onplaying = () => {
        if (request !== sequence) return
        clearTimeout(timer)
        state.value = 'playing'
      }
      audio.onended = () => { if (request === sequence) stop() }
      audio.onerror = () => fail('发音加载失败，请检查网络或稍后重试。')
      timer = setTimeout(() => fail('发音加载超时，请点击重试。'), 15_000)
      void audio.play().catch(() => fail('发音播放失败，请点击重试。'))
    } catch { fail('发音播放失败，请点击重试。') }
  }
  return { activeKey, state, error, play, stop }
}
