<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import { useHistoryStore } from '../stores/history'
import type { OperationState } from '../../../shared/models'

const history = useHistoryStore()
const labels: Record<OperationState, string> = { submitting: '提交中', added: '本次新增', present: '已在规划中', not_added: '未新增', uncertain: '待确认', failed: '失败' }
const date = (value: string) => new Date(value).toLocaleString('zh-CN', { hour12: false })
let unsubscribe: (() => void) | undefined
onMounted(() => { void history.load(); unsubscribe = window.desktop.desktop.onChanged(() => { void history.load() }) })
onUnmounted(() => unsubscribe?.())
</script>

<template>
  <section>
    <div class="eyebrow">每一次添加，都有记录</div><h1>最近添加记录</h1>
    <p class="intro">本客户端的操作历史，不代表手机端全部学习状态。</p>
    <div class="history-toolbar">
      <select v-model="history.query.scope" aria-label="历史范围" @change="history.filter()">
        <option value="active">当前配置</option><option value="all">全部本地记录</option>
      </select>
      <label class="check-label"><input v-model="history.query.pendingOnly" type="checkbox" @change="history.filter()" />仅显示待处理</label>
      <button :disabled="history.loading" @click="history.load()">刷新</button>
    </div>
    <p v-if="history.message" class="notice" role="status">{{ history.message }}</p>
    <p v-if="!history.page.items.length" class="empty">{{ history.loading ? '正在读取历史…' : '这里还没有操作记录。' }}</p>
    <ol v-else class="history-list">
      <li v-for="entry in history.page.items" :key="entry.id" class="history-card">
        <div class="history-title"><strong>{{ entry.spelling }}</strong><span class="status-pill" :class="entry.state">{{ labels[entry.state] }}</span><span v-if="!entry.activeProfile" class="subtle">旧配置 · 只读</span></div>
        <p class="history-message">{{ entry.message }}</p>
        <div class="history-meta"><time :datetime="entry.createdAt">{{ date(entry.createdAt) }}</time>
          <button v-if="entry.activeProfile" :disabled="!!history.confirming || entry.state === 'submitting'" @click="history.confirm(entry.id)">{{ history.confirming === entry.id ? '查询中…' : entry.confirmedAt && ['added', 'present'].includes(entry.state) ? '重新查询' : '确认学习记录' }}</button></div>
        <p v-if="entry.confirmedAt" class="subtle confirmed-at">记录确认于 {{ date(entry.confirmedAt) }}</p>
      </li>
    </ol>
    <div class="pagination"><span>共 {{ history.page.total }} 条 · 第 {{ Math.floor(history.query.offset / history.query.limit) + 1 }} 页</span>
      <div><button :disabled="history.loading || history.query.offset === 0" @click="history.turn(-1)">上一页</button>
        <button :disabled="history.loading || history.query.offset + history.query.limit >= history.page.total" @click="history.turn(1)">下一页</button></div></div>
  </section>
</template>
