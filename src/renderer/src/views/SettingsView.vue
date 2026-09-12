<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { CredentialStatus } from '../../../shared/models'
import { useSearchStore } from '../stores/search'
import { useDesktopStore } from '../stores/desktop'
import type { DesktopSettings } from '../../../shared/models'

const search = useSearchStore()
const desktop = useDesktopStore()
const preferences = ref<DesktopSettings>({ shortcut: '', closeBehavior: 'hide', theme: 'system' })
const preferencesMessage = ref('')
const savingPreferences = ref(false)
async function desktopAction(action: 'hide' | 'quit'): Promise<void> {
  try {
    const result = await window.desktop.desktop[action]()
    if (!result.ok) preferencesMessage.value = result.error.message
  } catch { preferencesMessage.value = '桌面操作未完成，请重试。' }
}
async function savePreferences(): Promise<void> {
  if (savingPreferences.value) return
  savingPreferences.value = true; preferencesMessage.value = ''
  try {
    const result = await window.desktop.desktop.save({ ...preferences.value })
    preferencesMessage.value = result.ok ? '桌面设置已保存。' : result.error.message
    await desktop.refresh()
    if (!result.ok && desktop.status) preferences.value = { ...desktop.status.settings }
  } catch { preferencesMessage.value = '无法保存桌面设置，请重试。' }
  finally { savingPreferences.value = false }
}
function captureShortcut(event: KeyboardEvent): void {
  if (event.key === 'Tab' || event.key === 'Escape') return
  event.preventDefault()
  event.stopPropagation()
  if (event.isComposing || event.repeat || ['Control', 'Meta', 'Alt', 'Shift'].includes(event.key)) return
  if (!event.ctrlKey && !event.metaKey && !event.altKey) return
  const key = event.code === 'Space' ? 'Space' : event.key.toUpperCase()
  if (!/^(?:[A-Z0-9]|F(?:[1-9]|1\d|2[0-4])|Space)$/.test(key)) return
  preferences.value.shortcut = [...(event.ctrlKey || event.metaKey ? ['CommandOrControl'] : []),
    ...(event.altKey ? ['Alt'] : []), ...(event.shiftKey ? ['Shift'] : []), key].join('+')
}
const status = ref<CredentialStatus>({ configured: false, available: false })
const token = ref('')
const message = ref('')
const busy = ref(false)
const loaded = ref(false)
async function refresh(): Promise<void> {
  const result = await window.desktop.credentials.status()
  if (result.ok) status.value = result.data
  else message.value = result.error.message
  loaded.value = true
}
async function act(action: 'save' | 'clear' | 'copy'): Promise<void> {
  if (busy.value) return
  busy.value = true; message.value = ''
  try {
    const result = action === 'save' ? await window.desktop.credentials.save(token.value) : await window.desktop.credentials[action]()
    if (result.ok) {
      message.value = action === 'save' ? 'Token 已加密保存。' : action === 'clear' ? 'Token 已清除。' : 'Token 已复制到系统剪贴板。'
      if (action !== 'copy') { token.value = ''; search.invalidate(); await refresh() }
    } else message.value = result.error.message
  } catch { message.value = '无法连接桌面服务，请重启应用。' }
  finally { busy.value = false }
}
onMounted(() => {
  void refresh().catch(() => { message.value = '无法读取凭证状态。' })
  void desktop.refresh().then(() => { if (desktop.status) preferences.value = { ...desktop.status.settings } })
})
</script>

<template>
  <section>
    <div class="eyebrow">连接你的学习规划</div><h1>个人 Token</h1>
    <p class="intro">在墨墨 App 的「我的 → 更多设置 → 实验功能 → 开放 API」获取。</p>
    <div class="settings-card">
      <div class="section-label">凭证状态<span>{{ !loaded ? '读取中…' : status.configured ? '已保存 · ****' : '尚未配置' }}</span></div>
      <p v-if="loaded && !status.available" class="notice error">系统加密不可用或凭证无法解密，请检查密钥存储；可清除旧凭证后重新保存。</p>
      <label for="token">{{ status.configured ? '替换 Token' : '输入 Token' }}</label>
      <input id="token" v-model="token" type="password" :placeholder="status.configured ? '****' : '粘贴个人 Token'"
        maxlength="8192" autocomplete="off" spellcheck="false" :disabled="busy || search.submitting" @keydown.enter="!$event.isComposing && token.trim() && act('save')" />
      <p class="subtle">Token 经系统加密保存在本机。替换后创建新配置，旧历史保留为只读，不再自动确认旧任务。</p>
      <div class="actions">
        <button class="primary" :disabled="busy || !token.trim() || search.submitting" @click="act('save')">保存 Token</button>
        <button :disabled="busy || !status.configured || !status.available" @click="act('copy')">复制 Token</button>
        <button class="danger" :disabled="busy || !status.configured || search.submitting" @click="act('clear')">清除</button>
      </div>
      <p v-if="message" class="notice" role="status">{{ message }}</p>
    </div>
    <p class="subtle setup-note">请在手机 App 开启自动同步。学习记录可能延迟，结果待确认时应先查询状态。</p>
    <div class="settings-card desktop-settings">
      <h2>桌面行为</h2>
      <label for="shortcut">唤出查词快捷键</label>
      <div class="shortcut-row"><input id="shortcut" :value="preferences.shortcut" placeholder="点击后按下组合键" readonly @keydown="captureShortcut" />
        <button @click="preferences.shortcut = ''">停用</button></div>
      <p class="subtle">{{ desktop.status?.shortcutRegistered ? '全局快捷键已注册' : '全局快捷键未注册或已停用' }}。可使用 Ctrl / ⌘、Alt、Shift 组合字母或功能键。</p>
      <label for="close-behavior">关闭窗口时</label>
      <select id="close-behavior" v-model="preferences.closeBehavior"><option value="hide">隐藏到托盘</option><option value="quit">退出应用</option></select>
      <p v-if="desktop.status && !desktop.status.hideSupported" class="subtle">当前桌面无法保证托盘入口可见，隐藏操作将改为最小化，保留窗口入口。</p>
      <label for="theme">外观</label>
      <select id="theme" v-model="preferences.theme"><option value="system">跟随系统</option><option value="light">浅色</option><option value="dark">深色</option></select>
      <div class="actions"><button class="primary" :disabled="savingPreferences" @click="savePreferences()">保存桌面设置</button>
        <button @click="desktopAction('hide')">{{ desktop.status?.hideSupported ? '隐藏窗口' : '最小化窗口' }}</button>
        <button class="danger" @click="desktopAction('quit')">退出应用</button></div>
      <p v-if="preferencesMessage" class="notice" role="status">{{ preferencesMessage }}</p>
    </div>
  </section>
</template>
