<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import type { AiProfile, AiProfileInput, AiTemplate } from '../../../shared/ai'
import { useAnalysisStore } from '../stores/analysis'
const analysis = useAnalysisStore()
const templates = ref<AiTemplate[]>([]), template = ref(0), key = ref(''), supplement = ref(''), message = ref(''), saving = ref(false), testing = ref(false), confirmDelete = ref('')
const deleteDialog = ref<HTMLDialogElement>(), deleting = ref(false)
const editorDialog = ref<HTMLDialogElement>(), formMessage = ref('')
const deleteTarget = computed(() => analysis.configuration.profiles.find(p => p.id === confirmDelete.value))
const defaults = (): AiProfileInput => ({ name: '', protocol: 'openai', baseUrl: '', model: '', options: { outputMode: 'text', timeoutSeconds: 90 } })
const form = ref<AiProfileInput>(defaults())
const editing = computed(() => analysis.configuration.profiles.find(p => p.id === form.value.id))
const changedHost = computed(() => { try { return editing.value && new URL(editing.value.baseUrl).host !== new URL(form.value.baseUrl).host } catch { return false } })
function resetEditor(): void { key.value = ''; form.value = defaults(); formMessage.value = '' }
function useTemplate(): void { const t = templates.value[template.value]; form.value = t ? { ...defaults(), name: t.name, protocol: t.protocol, baseUrl: t.baseUrl, model: t.model } : defaults(); key.value = ''; formMessage.value = '' }
function openEditor(): void { const dialog = editorDialog.value; if (dialog) { dialog.showModal(); dialog.scrollTop = 0 } }
function addProfile(): void { template.value = 0; useTemplate(); openEditor() }
function closeEditor(): void { if (saving.value) return; editorDialog.value?.close(); resetEditor() }
function edit(p: AiProfile): void { form.value = { id: p.id, name: p.name, protocol: p.protocol, baseUrl: p.baseUrl, model: p.model, options: { ...p.options } }; key.value = ''; formMessage.value = ''; confirmDelete.value = ''; openEditor() }
async function save(): Promise<void> {
  if (saving.value || testing.value) return
  saving.value = true; formMessage.value = ''
  try {
    if (analysis.busy) await analysis.cancel()
    const r = await window.desktop.ai.save({ ...form.value, options: { ...form.value.options }, ...(key.value.trim() ? { key: key.value.trim() } : {}) })
    if (r.ok) { await analysis.refresh(); editorDialog.value?.close(); resetEditor(); message.value = r.data.hasKey ? '配置已保存。保存不会调用模型。' : '配置已保存，请补充该服务的 API Key。' }
    else formMessage.value = r.error.message
  } catch { formMessage.value = '无法保存 AI 配置，请重试。' }
  finally { saving.value = false; key.value = '' }
}
async function test(id: string): Promise<void> {
  if (testing.value || saving.value) return
  testing.value = true; message.value = '正在测试公开句子 Birds sing.；最多生成调用 2 次…'
  try { const r = await window.desktop.ai.test(id); message.value = r.ok ? `${r.data.message}（调用 ${r.data.attempts} 次，输出模式 ${r.data.mode}）` : r.error.message; await analysis.refresh() }
  catch { message.value = '连接测试未完成，请重试。' }
  finally { testing.value = false }
}
function requestDelete(p: AiProfile): void { confirmDelete.value = p.id; deleteDialog.value?.showModal() }
function cancelDelete(): void { if (deleting.value) return; deleteDialog.value?.close(); confirmDelete.value = '' }
async function deleteProfile(): Promise<void> {
  const id = confirmDelete.value
  if (!id || deleting.value) return
  deleting.value = true
  try { if (analysis.busy) await analysis.cancel(); const r = await window.desktop.ai.delete(id); message.value = r.ok ? '配置已删除，分析历史保留。' : r.error.message; await analysis.refresh() }
  catch { message.value = '无法删除配置，请重试。' }
  finally { deleting.value = false; cancelDelete() }
}
async function saveSupplement(reset = false): Promise<void> {
  if (reset) supplement.value = ''
  try { if (analysis.busy) await analysis.cancel(); const r = await window.desktop.ai.supplement(supplement.value); message.value = r.ok ? '提示词偏好已保存。' : r.error.message; await analysis.refresh() }
  catch { message.value = '无法保存提示词偏好，请重试。' }
}
function clearKey(): void { key.value = '' }
async function cancelTest(): Promise<void> {
  try { const r = await window.desktop.analysis.cancel(); if (!r.ok) message.value = r.error.message }
  catch { message.value = '取消请求未送达，请重试。' }
}
onMounted(async () => { await analysis.refresh(); supplement.value = analysis.configuration.supplement; const r = await window.desktop.ai.templates(); if (r.ok) templates.value = r.data; window.addEventListener('blur', clearKey) })
onUnmounted(() => { clearKey(); window.removeEventListener('blur', clearKey) })
</script>
<template>
  <section class="settings-card ai-settings">
    <div class="ai-settings-heading"><h2>AI 服务</h2><button :disabled="testing || saving" @click="addProfile">新增 AI 配置</button></div><p class="subtle">独立于墨墨账号。可保存多套服务和模型配置；密钥加密保存，不回填明文。</p>
    <article v-for="p in analysis.configuration.profiles" :key="p.id" class="ai-profile">
      <div><strong>{{ p.name }}</strong><span v-if="p.id === analysis.configuration.activeId" class="status-pill">当前</span><p class="subtle">{{ p.model }} · {{ p.protocol === 'openai' ? 'OpenAI 兼容' : 'Gemini 原生' }} · {{ p.authInvalid ? '密钥需更新' : p.hasKey ? '密钥已保存' : '缺少密钥' }}</p></div>
      <div class="actions"><button :disabled="testing || saving" @click="edit(p)">编辑</button><button :disabled="testing || saving || p.id === analysis.configuration.activeId" @click="analysis.select(p.id)">{{ p.id === analysis.configuration.activeId ? '已是当前' : '设为当前' }}</button><button :disabled="testing || saving || !p.hasKey || analysis.busy" @click="test(p.id)">测试连接</button><button class="danger" :disabled="testing || saving" @click="requestDelete(p)">删除配置</button></div>
    </article>
    <dialog ref="deleteDialog" class="delete-profile-dialog" aria-labelledby="delete-profile-title" aria-describedby="delete-profile-description" :aria-busy="deleting" @cancel.prevent="cancelDelete" @keydown.stop>
      <h2 id="delete-profile-title">删除配置？</h2>
      <p id="delete-profile-description">确定删除“{{ deleteTarget?.name }}”配置？分析历史会保留。</p>
      <div class="actions"><button autofocus :disabled="deleting" @click="cancelDelete">保留</button><button class="danger" :disabled="deleting" @click="deleteProfile">{{ deleting ? '正在删除…' : '确认删除配置' }}</button></div>
    </dialog>
    <p class="subtle">测试连接会消耗一次模型调用；明确格式不支持时最多再调用一次。</p>
    <p v-if="message" class="notice ai-error-message" role="status">{{ message }}</p>
    <button v-if="testing" @click="cancelTest">取消连接测试</button>
    <dialog ref="editorDialog" class="ai-profile-dialog" aria-labelledby="ai-profile-title" :aria-busy="saving" @cancel.prevent="closeEditor" @close="resetEditor" @keydown.stop>
    <form @submit.prevent="save">
      <h2 id="ai-profile-title">{{ form.id ? '编辑 AI 配置' : '新增 AI 配置' }}</h2>
      <label v-if="!form.id"><span>新增配置模板</span><select aria-label="新增配置模板" v-model="template" :disabled="saving" @change="useTemplate"><option v-for="(t, i) in templates" :key="t.name" :value="i">{{ t.name }}</option></select></label>
      <fieldset :disabled="saving">
      <label><span>配置名称</span><input v-model="form.name" required maxlength="80" autofocus /></label>
      <label><span>接口类型</span><select aria-label="接口类型" v-model="form.protocol"><option value="openai">OpenAI 兼容</option><option value="gemini">Gemini 原生</option></select></label>
      <div class="ai-form-field">
        <label><span>API 基础地址</span><input v-model="form.baseUrl" type="url" required placeholder="https://…/v1" aria-describedby="ai-base-url-help" /></label>
        <p id="ai-base-url-help" class="subtle">填写基础地址，不包含 /chat/completions 或 :generateContent。GLM 模板为国内标准 API；国际或专项订阅请使用对应平台基础地址。</p>
        <p v-if="changedHost" class="notice">服务主机已变化，保存时会清除旧密钥；请重新填写新服务的密钥。</p>
      </div>
      <label><span>API Key</span><input v-model="key" type="password" autocomplete="new-password" :placeholder="editing?.hasKey && !changedHost ? '已保存，留空保留' : '填写此服务的密钥'" maxlength="4096" /></label>
      <label><span>模型 ID</span><input v-model="form.model" required maxlength="160" placeholder="填写账号可用的真实模型 ID" /></label>
      <details><summary>高级选项</summary>
        <div class="ai-advanced-fields">
          <label><span>输出格式</span><select aria-label="输出格式" v-model="form.options.outputMode"><option value="text">提示词约束 JSON 文本（默认）</option><option value="json">JSON 对象</option><option value="schema">JSON Schema</option></select></label>
          <label><span>总超时（秒）</span><input v-model.number="form.options.timeoutSeconds" type="number" min="5" max="180" required /></label>
        </div>
      </details>
      </fieldset>
      <p v-if="formMessage" class="notice ai-error-message" role="alert">{{ formMessage }}</p>
      <div class="actions"><button type="button" :disabled="saving" @click="closeEditor">取消</button><button class="primary" :disabled="saving || testing">{{ saving ? '正在保存…' : '保存 AI 配置' }}</button></div>
    </form>
    </dialog>
    <label>补充提示词<textarea v-model="supplement" rows="3" maxlength="4000" placeholder="例如：第一次出现术语时给出解释" /></label>
    <p class="subtle">内置基础提示词固定要求中文、先主干后修饰、指出歧义和原文错误，补充偏好不会改变结果字段；仅翻译模式使用独立提示词，不附带这些偏好。</p>
    <div class="actions"><button :disabled="testing" @click="saveSupplement()">保存提示词偏好</button><button :disabled="testing" @click="saveSupplement(true)">恢复默认提示词</button></div>
  </section>
</template>

<style scoped>
.ai-settings-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.ai-settings-heading h2 { margin: 0; }
.ai-profile .actions { gap: 8px; margin-top: 16px; }
.ai-profile-dialog { width: min(560px, calc(100vw - 40px)); max-height: calc(100vh - 40px); overflow-y: auto; padding: 24px; border: 1px solid #e0e4d9; border-radius: 13px; background: #fff; color: inherit; box-shadow: 0 16px 48px #0003; }
.ai-profile-dialog::backdrop { background: #0006; }
.ai-profile-dialog form, .ai-profile-dialog fieldset, .ai-advanced-fields { display: grid; gap: 20px; }
.ai-profile-dialog h2 { margin: 0 0 4px; font-size: 20px; }
.ai-profile-dialog fieldset { border: 0; padding: 0; margin: 0; min-width: 0; }
.ai-profile-dialog label { display: flex; flex-direction: column; gap: 8px; margin: 0; font-size: 13px; line-height: 1.5; }
.ai-profile-dialog label :is(input, select) { display: block; width: 100%; min-width: 0; margin: 0; padding: 10px 12px; line-height: 1.5; }
.ai-form-field { display: grid; gap: 8px; }
.ai-profile-dialog p { margin: 0; overflow-wrap: anywhere; }
.ai-profile-dialog summary { padding: 0; }
.ai-advanced-fields { margin-top: 16px; }
.ai-profile-dialog .actions { justify-content: flex-end; margin-top: 4px; }
:global(:root[data-theme=dark] .ai-profile-dialog) { background: #2c352c; border-color: #475544; }
.delete-profile-dialog { width: min(420px, calc(100vw - 40px)); max-height: calc(100vh - 40px); overflow-y: auto; padding: 24px; border: 1px solid #e0e4d9; border-radius: 13px; background: #fff; color: inherit; box-shadow: 0 16px 48px #0003; }
.delete-profile-dialog::backdrop { background: #0006; }
.delete-profile-dialog p { margin: 0; font-size: 14px; line-height: 1.8; overflow-wrap: anywhere; }
.delete-profile-dialog .actions { justify-content: flex-end; }
:global(:root[data-theme=dark] .delete-profile-dialog) { background: #2c352c; border-color: #475544; }
:global(:root[data-theme=dark] .delete-profile-dialog .danger) { color: #e0a18d; }
@media (prefers-color-scheme: dark) {
  :global(:root[data-theme=system] .ai-profile-dialog) { background: #2c352c; border-color: #475544; }
  :global(:root[data-theme=system] .delete-profile-dialog) { background: #2c352c; border-color: #475544; }
  :global(:root[data-theme=system] .delete-profile-dialog .danger) { color: #e0a18d; }
}
</style>
