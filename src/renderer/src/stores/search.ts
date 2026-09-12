import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type { AddOutcome, Vocabulary } from '../../../shared/models'

export const useSearchStore = defineStore('search', () => {
  const input = ref('')
  const words = ref<Vocabulary[]>([])
  const selectedId = ref('')
  const querying = ref(false)
  const submitting = ref(false)
  const message = ref('')
  const outcome = ref<AddOutcome | null>(null)
  const searched = ref(false)
  let sequence = 0
  const selected = computed(() => words.value.find(word => word.id === selectedId.value))

  function invalidate(): void {
    sequence++
    words.value = []
    selectedId.value = ''
    outcome.value = null
    message.value = ''
    searched.value = false
    querying.value = false
  }
  function select(id: string): void { selectedId.value = id; outcome.value = null; message.value = '' }
  async function lookup(): Promise<void> {
    if (submitting.value || !input.value.trim()) return
    const request = ++sequence
    words.value = []; selectedId.value = ''; outcome.value = null; message.value = ''; searched.value = false
    querying.value = true
    try {
      const result = await window.desktop.vocabulary.lookup(input.value.trim())
      if (request !== sequence) return
      searched.value = true
      if (result.ok) {
        words.value = result.data
        selectedId.value = result.data.length === 1 ? result.data[0]!.id : ''
      } else message.value = result.error.message
    } catch { if (request === sequence) message.value = '无法连接桌面服务，请重启应用。' }
    finally { if (request === sequence) querying.value = false }
  }
  async function submit(confirm = false): Promise<void> {
    if (!selected.value || submitting.value || querying.value) return
    submitting.value = true
    message.value = ''
    const request = sequence
    try {
      const result = await window.desktop.study[confirm ? 'confirm' : 'add'](selectedId.value)
      if (request !== sequence) return
      if (result.ok) outcome.value = result.data
      else message.value = result.error.message
    } catch { message.value = '结果待确认：桌面服务连接中断，请勿重复添加。' }
    finally { submitting.value = false }
  }
  return { input, words, selectedId, selected, querying, submitting, message, outcome, searched, invalidate, select, lookup, submit }
})
