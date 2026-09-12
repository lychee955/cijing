<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import { useSearchStore } from '../stores/search'

defineEmits<{ settings: [] }>()
const search = useSearchStore()
const input = ref<HTMLInputElement>()
const composing = ref(false)
const needsConfirmation = computed(() => search.outcome && ['uncertain', 'not_added'].includes(search.outcome.state))
const canAdd = computed(() => search.selected && !search.submitting && !search.querying &&
  (!search.outcome || ['failed', 'unconfirmed'].includes(search.outcome.state)))
function keydown(event: KeyboardEvent): void {
  if (event.isComposing || composing.value || event.keyCode === 229 || event.repeat) return
  if (event.key === 'Enter' && (event.target === input.value || event.ctrlKey || event.metaKey)) {
    event.preventDefault()
    if (event.ctrlKey || event.metaKey) { if (canAdd.value) void search.submit() }
    else if (event.target === input.value) void search.lookup()
  }
}
function focus(): void { void nextTick(() => input.value?.focus()) }
defineExpose({ focus })
onMounted(() => { focus(); window.addEventListener('focus', focus) })
onUnmounted(() => window.removeEventListener('focus', focus))
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
      <label v-for="word in search.words" :key="word.id" class="word-card" :class="{ selected: search.selectedId === word.id }">
        <input type="radio" name="word" :value="word.id" :checked="search.selectedId === word.id"
          :disabled="search.submitting" @change="search.select(word.id)" />
        <span class="word-spelling">{{ word.spelling }}</span><span class="word-label">墨墨词条</span>
      </label>
      <p class="subtle">此处提供词条匹配，暂不提供词典释义。</p>
      <div v-if="search.outcome" class="notice" :class="search.outcome.state" role="status">{{ search.outcome.message }}</div>
      <div class="actions">
        <button class="primary" :disabled="!canAdd" @click="search.submit()">{{ search.submitting ? '处理并确认中…' : '加入学习规划' }}</button>
        <button :disabled="!search.selected || search.submitting" @click="search.submit(true)">{{ needsConfirmation ? '再次确认状态' : '查询学习记录' }}</button>
      </div>
    </div>
    <div v-else-if="search.searched && !search.message" class="empty"><strong>没有找到对应词条</strong><p>检查拼写后重试。不会自动修改你的输入。</p></div>
    <div v-else-if="!search.message && !search.querying" class="empty"><span class="empty-symbol">Aa</span><strong>从一个新单词开始</strong><p>首次使用，请先<button class="text-button" @click="$emit('settings')">配置个人 Token</button>。</p></div>
  </section>
</template>
