<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref } from 'vue'
import SearchView from './views/SearchView.vue'
import SettingsView from './views/SettingsView.vue'
import HistoryView from './views/HistoryView.vue'
import AnalysisView from './views/AnalysisView.vue'
import { useSearchStore } from './stores/search'
import { useDesktopStore } from './stores/desktop'
import type { PageName } from '../../shared/models'

const page = ref<PageName>('search')
const searchView = ref<InstanceType<typeof SearchView>>()
const desktop = useDesktopStore()
const search = useSearchStore()
async function lookupFromAnalysis(word: string): Promise<void> {
  if (search.submitting) return
  search.invalidate(); search.input = word; page.value = 'search'
  await nextTick(); searchView.value?.focus(); await search.lookup()
}
let unsubscribe: (() => void) | undefined, unsubscribeChanged: (() => void) | undefined
function keydown(event: KeyboardEvent): void {
  if (event.isComposing || event.keyCode === 229 || event.repeat) return
  if (event.key === 'Escape') {
    event.preventDefault()
    void window.desktop.desktop.hide().then(result => { if (!result.ok) desktop.message = result.error.message })
  } else if ((event.ctrlKey || event.metaKey) && ['1', '2', '3', '4'].includes(event.key)) {
    event.preventDefault(); page.value = event.key === '1' ? 'search' : event.key === '2' ? 'history' : event.key === '3' ? 'settings' : 'analysis'
  }
}
onMounted(() => {
  void desktop.refresh()
  unsubscribe = window.desktop.desktop.onNavigate(next => { page.value = next; if (next === 'search') void nextTick(() => searchView.value?.focus()) })
  unsubscribeChanged = window.desktop.desktop.onChanged(() => { void desktop.refresh() })
  window.addEventListener('keydown', keydown)
})
onUnmounted(() => { unsubscribe?.(); unsubscribeChanged?.(); window.removeEventListener('keydown', keydown) })
</script>

<template>
  <div class="shell">
    <header class="app-header">
      <div class="brand"><span class="brand-mark">墨</span><div><strong>墨墨</strong><span class="brand-sub">桌面查词</span></div></div>
      <nav aria-label="主导航">
        <button :class="{ active: page === 'search' }" @click="page = 'search'">查词</button>
        <button :class="{ active: page === 'analysis' }" @click="page = 'analysis'">句子分析</button>
        <button :class="{ active: page === 'history' }" @click="page = 'history'">历史</button>
        <button :class="{ active: page === 'settings' }" @click="page = 'settings'">设置</button>
      </nav>
    </header>
    <main>
      <p v-if="desktop.credentials.invalid && page !== 'analysis'" class="notice error" role="alert">Token 已失效，当前配置请求已暂停。<button class="text-button" @click="page = 'settings'">更新 Token</button></p>
      <p v-if="desktop.status?.recovering && page !== 'analysis'" class="notice" role="status">正在确认上次未完成的操作，不会重复添加。</p>
      <p v-if="desktop.message" class="notice error" role="alert">{{ desktop.message }}</p>
      <SearchView v-if="page === 'search'" ref="searchView" @settings="page = 'settings'" /><HistoryView v-else-if="page === 'history'" /><AnalysisView v-else-if="page === 'analysis'" @settings="page = 'settings'" @lookup="lookupFromAnalysis" /><SettingsView v-else />
    </main>
    <footer><span>Ctrl / ⌘ + 1 查词 · 2 历史 · 3 设置 · 4 句子分析</span><span>Esc {{ desktop.status?.hideSupported ? '隐藏' : '最小化' }}</span></footer>
  </div>
</template>
