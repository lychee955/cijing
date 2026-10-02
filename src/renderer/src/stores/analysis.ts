import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type { AiConfiguration } from '../../../shared/ai'
import type { AnalysisRecord } from '../../../shared/analysis'
export const useAnalysisStore = defineStore('analysis', () => {
  const configuration = ref<AiConfiguration>({ profiles: [], activeId: null, supplement: '' })
  const input = ref(''), message = ref(''), busy = ref(false), record = ref<AnalysisRecord>(), reused = ref(false)
  const history = ref<AnalysisRecord[]>([]), total = ref(0), offset = ref(0), startedAt = ref(0)
  const active = computed(() => configuration.value.profiles.find(p => p.id === configuration.value.activeId))
  let sequence = 0, requestId: string | undefined
  async function refresh(): Promise<void> {
    try { const r = await window.desktop.ai.configuration(); if (r.ok) configuration.value = r.data; else message.value = r.error.message }
    catch { message.value = '无法读取 AI 配置，请重试。' }
  }
  async function loadHistory(): Promise<void> {
    try { const r = await window.desktop.analysis.history(offset.value, 20); if (r.ok) { history.value = r.data.items; total.value = r.data.total } else message.value = r.error.message }
    catch { message.value = '无法读取分析历史，请重试。' }
  }
  async function cancel(): Promise<void> {
    const id = requestId; sequence++; busy.value = false; requestId = undefined; message.value = '分析已取消。'
    try { const r = await window.desktop.analysis.cancel(id); if (!r.ok) message.value = r.error.message }
    catch { message.value = '取消请求未送达，请重试。' }
  }
  async function select(id: string): Promise<void> {
    if (busy.value) await cancel()
    try { const r = await window.desktop.ai.select(id); if (!r.ok) message.value = r.error.message; await refresh() }
    catch { message.value = '无法切换 AI 配置，请重试。' }
  }
  async function run(force = false): Promise<void> {
    if (busy.value || !input.value.trim()) return
    const current = ++sequence, id = crypto.randomUUID()
    requestId = id; startedAt.value = Date.now(); busy.value = true; message.value = ''; record.value = undefined; reused.value = false
    try {
      const r = await window.desktop.analysis.run({ requestId: id, text: input.value, force })
      if (current !== sequence) return
      if (r.ok) { record.value = r.data.record; reused.value = r.data.reused; await loadHistory() }
      else { message.value = r.error.message; await refresh() }
    } catch { if (current === sequence) message.value = '无法连接分析服务，输入已保留。' }
    finally { if (current === sequence) { busy.value = false; requestId = undefined } }
  }
  async function open(id: string): Promise<void> {
    if (busy.value) await cancel()
    try { const r = await window.desktop.analysis.get(id); if (r.ok) { input.value = r.data.text; record.value = r.data; reused.value = false; message.value = '' } else message.value = r.error.message }
    catch { message.value = '无法打开分析历史，请重试。' }
  }
  async function remove(id?: string): Promise<void> {
    try { const r = await window.desktop.analysis.delete(id); if (r.ok) { if (!id || record.value?.id === id) record.value = undefined; if (offset.value >= total.value - 1) offset.value = 0; await loadHistory() } else message.value = r.error.message }
    catch { message.value = '无法删除分析历史，请重试。' }
  }
  return { configuration, input, message, busy, record, reused, active, history, total, offset, startedAt, refresh, loadHistory, cancel, select, run, open, remove }
})
