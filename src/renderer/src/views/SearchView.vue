<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useSearchStore } from '../stores/search'
import { useDesktopStore } from '../stores/desktop'
import { usePronunciation } from '../composables/pronunciation'

defineEmits<{ settings: [] }>()
const search = useSearchStore()
const desktop = useDesktopStore()
const input = ref<HTMLInputElement>()
const composing = ref(false)
const { activeKey: audioKey, state: audioState, error: audioError, play, stop } = usePronunciation()
const accents = [{ id: 'uk', label: '英', name: '英式' }, { id: 'us', label: '美', name: '美式' }] as const
watch(() => search.words, stop, { flush: 'sync' })
const needsConfirmation = computed(() => search.selectedOutcome && ['uncertain', 'not_added'].includes(search.selectedOutcome.state))
function keydown(event: KeyboardEvent): void {
  if (event.isComposing || composing.value || event.keyCode === 229 || event.repeat) return
  if (event.key === 'Enter' && (event.target === input.value || event.ctrlKey || event.metaKey)) {
    event.preventDefault()
    if (event.ctrlKey || event.metaKey) { if (search.canAdd) void search.submit() }
    else if (event.target === input.value) void search.lookup()
  }
}
function focus(): void { void nextTick(() => input.value?.focus()) }
defineExpose({ focus })
onMounted(() => { focus(); window.addEventListener('focus', focus) })
onUnmounted(() => { window.removeEventListener('focus', focus); stop() })
</script>

<template>
  <section @keydown="keydown">
    <div class="eyebrow">一个生词，一点进步</div>
    <h1>今天遇见了什么词？</h1>
    <p class="intro">查询词条，确认拼写，然后加入墨墨学习规划。</p>
    <div class="search-box">
      <input ref="input" v-model="search.input" aria-label="单词拼写" placeholder="输入单词或短语，例如 apple"
        maxlength="200" :disabled="search.submitting" autocomplete="off" spellcheck="false"
        @input="search.invalidate()" @compositionstart="composing = true" @compositionend="composing = false" />
      <button class="primary" :disabled="!search.input.trim() || search.querying || search.submitting || composing"
        @click="search.lookup()">{{ search.querying ? '查询中…' : '查询' }}</button>
    </div>
    <div class="input-hint"><span>Enter 查询</span><span>Ctrl / ⌘ + Enter 添加</span></div>
    <p v-if="search.message" class="notice error" role="alert">{{ search.message }}</p>
    <div v-if="search.words.length" class="results">
      <div class="section-label">匹配词条 <span>{{ search.words.length }} 个结果 · 请确认拼写</span></div>
      <div v-for="word in search.words" :key="word.id" class="word-card" :class="{ selected: search.selectedId === word.id }"
        @click="!search.submitting && search.select(word.id)">
        <input type="radio" name="word" :value="word.id" :checked="search.selectedId === word.id"
          :aria-label="word.spelling" :disabled="search.submitting" @change="search.select(word.id)" />
        <span class="word-details">
          <span class="word-spelling">{{ word.spelling }}</span>
          <span v-if="word.phonetics?.uk || word.phonetics?.us" class="phonetics">
            <template v-for="accent in accents" :key="accent.id">
              <button v-if="word.phonetics?.[accent.id]" type="button" class="pronunciation"
                :class="{ playing: audioKey === `${word.spelling}:${accent.id}` && audioState === 'playing' }"
                :aria-label="`播放 ${word.spelling} 的${accent.name}发音`" :title="`点击播放${accent.name}发音`"
                :aria-busy="audioKey === `${word.spelling}:${accent.id}` && audioState === 'loading'"
                @click.stop="play(word.spelling, accent.id)">
                <span>{{ accent.label }} /{{ word.phonetics[accent.id] }}/</span>
                <svg class="speaker-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true">
                  <path d="M11 5 6 9H3v6h3l5 4V5Z" stroke-linejoin="round" />
                  <path d="M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14" stroke-linecap="round" />
                </svg>
                <span v-if="audioKey === `${word.spelling}:${accent.id}` && audioState === 'loading'">加载中…</span>
              </button>
            </template>
          </span>
          <span v-if="audioError && accents.some(accent => audioKey === `${word.spelling}:${accent.id}`)" class="word-definition audio-error" role="alert">{{ audioError }}</span>
          <span v-if="word.interpretationError" class="word-definition">释义加载失败：{{ word.interpretationError }} 重新查询可重试。</span>
          <span v-else-if="word.interpretations?.length" class="word-definitions">
            <span v-for="meaning in word.interpretations" :key="meaning" class="word-definition">{{ meaning }}</span>
          </span>
          <span v-else class="word-definition">暂无可用释义</span>
          <span class="word-definition study-status" aria-live="polite">
            <template v-if="search.studyStatuses[word.id]?.loading">正在查询学习记录…</template>
            <template v-else-if="search.studyStatuses[word.id]?.error">学习记录查询失败：{{ search.studyStatuses[word.id]?.error }}</template>
            <template v-else>{{ search.studyStatuses[word.id]?.outcome?.message }}</template>
          </span>
        </span>
      </div>
      <p class="subtle">释义、音标与发音由 UAPI 提供，点击音标或喇叭播放。</p>
      <div v-if="search.outcome" class="notice" :class="search.outcome.state" role="status">{{ search.outcome.message }}</div>
      <div class="actions">
        <button class="primary" :disabled="!search.canAdd" @click="search.submit()">{{ search.submitting ? '处理并确认中…' : '加入学习规划' }}</button>
        <button :disabled="!search.selected || search.submitting || search.checkingSelected" @click="search.submit(true)">{{ search.checkingSelected ? '查询学习记录中…' : needsConfirmation ? '再次确认状态' : '查询学习记录' }}</button>
      </div>
    </div>
    <div v-else-if="search.searched && !search.message" class="empty"><strong>没有找到对应词条</strong><p>检查拼写后重试。不会自动修改你的输入。</p></div>
    <div v-else-if="!search.message && !search.querying" class="empty"><span class="empty-symbol">Aa</span><strong>从一个新单词开始</strong><p v-if="desktop.credentialsLoaded && !desktop.credentials.configured">首次使用，请先<button class="text-button" @click="$emit('settings')">配置个人 Token</button>。</p></div>
  </section>
</template>
