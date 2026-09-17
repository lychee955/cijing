import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { CredentialStatus, DesktopStatus } from '../../../shared/models'

export const useDesktopStore = defineStore('desktop', () => {
  const status = ref<DesktopStatus | null>(null)
  const credentials = ref<CredentialStatus>({ configured: false, available: true })
  const credentialsLoaded = ref(false)
  const message = ref('')
  let sequence = 0
  async function refresh(): Promise<void> {
    const request = ++sequence
    try {
      const [desktop, credential] = await Promise.all([window.desktop.desktop.status(), window.desktop.credentials.status()])
      if (request !== sequence) return
      if (desktop.ok) { status.value = desktop.data; document.documentElement.dataset.theme = desktop.data.settings.theme }
      else message.value = desktop.error.message
      if (credential.ok) { credentials.value = credential.data; credentialsLoaded.value = true }
      else message.value = credential.error.message
    } catch { message.value = '无法连接桌面服务，请重启应用。' }
  }
  return { status, credentials, credentialsLoaded, message, refresh }
})
