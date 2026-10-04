import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { UpdateStatus } from '../../../shared/update'

export const useUpdatesStore = defineStore('updates', () => {
  const status = ref<UpdateStatus>()
  const error = ref('')
  function receive(next: UpdateStatus): void {
    if (!status.value || next.revision >= status.value.revision) status.value = next
  }
  async function act(action: 'status' | 'check' | 'download' | 'install' | 'openRelease'): Promise<void> {
    error.value = ''
    try {
      const result = await window.desktop.updates[action]()
      if (result.ok) receive(result.data)
      else error.value = result.error.message
    } catch { error.value = '无法读取更新状态，请重试。' }
  }
  return { status, error, receive, act }
})
