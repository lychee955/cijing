<script setup lang="ts">
import {computed, onMounted, onUnmounted, ref} from "vue";
import type {CredentialStatus} from "../../../shared/models";
import AiSettings from "../components/AiSettings.vue";
import {useSearchStore} from "../stores/search";
import {useDesktopStore} from "../stores/desktop";
import type {DesktopSettings} from "../../../shared/models";

const search = useSearchStore();
const desktop = useDesktopStore();
const preferences = ref<DesktopSettings>({
    shortcut: "",
    closeBehavior: "hide",
    theme: "system"
});
const preferencesMessage = ref("");
const savingPreferences = ref(false);
async function desktopAction(action: "hide" | "quit" | "devTools"): Promise<void> {
    try {
        const result = await window.desktop.desktop[action]();
        if (!result.ok) preferencesMessage.value = result.error.message;
    } catch {
        preferencesMessage.value = "桌面操作未完成，请重试。";
    }
}
async function savePreferences(): Promise<void> {
    if (savingPreferences.value) return;
    savingPreferences.value = true;
    preferencesMessage.value = "";
    try {
        const result = await window.desktop.desktop.save({...preferences.value});
        preferencesMessage.value = result.ok ? "桌面设置已保存。" : result.error.message;
        await desktop.refresh();
        if (!result.ok && desktop.status) preferences.value = {...desktop.status.settings};
    } catch {
        preferencesMessage.value = "无法保存桌面设置，请重试。";
    } finally {
        savingPreferences.value = false;
    }
}
function captureShortcut(event: KeyboardEvent): void {
    if (event.key === "Tab" || event.key === "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    if (event.isComposing || event.repeat || ["Control", "Meta", "Alt", "Shift"].includes(event.key)) return;
    if (!event.ctrlKey && !event.metaKey && !event.altKey) return;
    const key = event.code === "Space" ? "Space" : event.key.toUpperCase();
    if (!/^(?:[A-Z0-9]|F(?:[1-9]|1\d|2[0-4])|Space)$/.test(key)) return;
    preferences.value.shortcut = [
        ...(event.ctrlKey || event.metaKey ? ["CommandOrControl"] : []),
        ...(event.altKey ? ["Alt"] : []),
        ...(event.shiftKey ? ["Shift"] : []),
        key
    ].join("+");
}
const status = ref<CredentialStatus>({configured: false, available: false});
const token = ref("");
const editing = ref(false);
const isEditing = computed(() => !status.value.configured || editing.value);
const visible = ref(false);
const revealedToken = ref("");
const revealing = ref(false);
let revealSequence = 0;
function conceal(): void {
    revealSequence++;
    visible.value = false;
    revealedToken.value = "";
    revealing.value = false;
}
function editToken(): void {
    conceal();
    token.value = "";
    editing.value = true;
    message.value = "";
}
function cancelEdit(): void {
    conceal();
    token.value = "";
    editing.value = false;
    message.value = "";
}
async function toggleVisibility(): Promise<void> {
    if (visible.value) {
        conceal();
        return;
    }
    if (isEditing.value) {
        visible.value = true;
        return;
    }
    if (revealing.value) return;
    const request = ++revealSequence;
    revealing.value = true;
    try {
        const result = await window.desktop.credentials.reveal();
        if (request !== revealSequence) return;
        if (result.ok) {
            revealedToken.value = result.data;
            visible.value = true;
        } else message.value = result.error.message;
    } catch {
        if (request === revealSequence) message.value = "暂时无法显示 Token，请重试。";
    } finally {
        if (request === revealSequence) revealing.value = false;
    }
}
const message = ref("");
const busy = ref(false);
const loaded = ref(false);
const validating = ref(false);
async function validateToken(saved = false): Promise<void> {
    validating.value = true;
    message.value = saved ? "Token 已加密保存，正在验证…" : "正在验证 Token…";
    try {
        const result = await window.desktop.credentials.validate();
        message.value = result.ok
            ? saved
                ? "Token 已加密保存，验证通过。"
                : "Token 验证通过。"
            : `${saved ? "Token 已保存。" : ""}${result.error.code === "AUTH" || result.error.code === "PERMISSION" ? "验证失败：" : "暂时无法完成验证："}${result.error.message}`;
    } catch {
        message.value = "暂时无法完成验证，请稍后重试。";
    } finally {
        validating.value = false;
        await Promise.all([refresh(), desktop.refresh()]);
    }
}
async function revalidate(): Promise<void> {
    if (busy.value) return;
    busy.value = true;
    try {
        await validateToken();
    } catch {
        message.value = "无法读取凭证状态，请稍后重试。";
    } finally {
        busy.value = false;
    }
}
async function refresh(): Promise<void> {
    const result = await window.desktop.credentials.status();
    if (result.ok) status.value = result.data;
    else message.value = result.error.message;
    loaded.value = true;
}
async function act(action: "save" | "clear" | "copy"): Promise<void> {
    if (busy.value) return;
    busy.value = true;
    message.value = "";
    try {
        const result =
            action === "save"
                ? await window.desktop.credentials.save(token.value)
                : await window.desktop.credentials[action]();
        if (result.ok) {
            message.value =
                action === "save"
                    ? "Token 已加密保存。"
                    : action === "clear"
                      ? "Token 已清除。"
                      : "Token 已复制到系统剪贴板。";
            if (action !== "copy") {
                conceal();
                token.value = "";
                editing.value = false;
                search.invalidate();
                await Promise.all([refresh(), desktop.refresh()]);
                if (action === "save") await validateToken(true);
            }
        } else message.value = result.error.message;
    } catch {
        message.value = "无法连接桌面服务，请重启应用。";
    } finally {
        busy.value = false;
    }
}
onMounted(() => {
    window.addEventListener("blur", conceal);
    void refresh().catch(() => {
        message.value = "无法读取凭证状态。";
    });
    void desktop.refresh().then(() => {
        if (desktop.status) preferences.value = {...desktop.status.settings};
    });
});
onUnmounted(() => {
    conceal();
    token.value = "";
    window.removeEventListener("blur", conceal);
});
</script>

<template>
    <section class="settings-page">
        <div class="eyebrow">让查词更顺手</div>
        <h1>设置</h1>
        <p class="intro">管理账号连接和桌面偏好。</p>
        <div class="settings-card account-card">
            <div class="account-heading">
                <span class="account-icon" aria-hidden="true"
                    ><svg viewBox="0 0 24 24">
                        <path
                            d="M8 5h10a2 2 0 0 1 2 2v13H8a4 4 0 0 1-4-4V5a2 2 0 0 1 2-2h2v13H6a2 2 0 0 0 0 4M12 9h4m-4 4h4"
                        /></svg
                ></span>
                <div>
                    <h2>墨墨账号</h2>
                    <p>连接学习规划，收录遇见的生词。</p>
                </div>
                <span class="connection-badge" :class="{connected: status.configured, invalid: status.invalid}"
                    ><i aria-hidden="true"></i
                    >{{
                        !loaded
                            ? "读取中"
                            : validating
                              ? "验证中"
                              : status.invalid
                                ? "需更新"
                                : status.verified
                                  ? "已验证"
                                  : status.configured
                                    ? "已配置"
                                    : "尚未配置"
                    }}</span
                >
            </div>
            <p v-if="loaded && !status.available" class="notice error">
                系统加密不可用或凭证无法解密，请检查密钥存储；可清除旧凭证后重新保存。
            </p>
            <label for="token">{{
                isEditing ? (status.configured ? "替换 Token" : "输入 Token") : "个人 Token"
            }}</label>
            <div class="token-field" :class="{masked: !visible && !isEditing}">
                <input
                    id="token"
                    :value="isEditing ? token : visible ? revealedToken : '••••••••••••••••••••••••'"
                    :type="visible ? 'text' : 'password'"
                    :readonly="!isEditing"
                    placeholder="粘贴你的个人 Token"
                    maxlength="8192"
                    autocomplete="off"
                    spellcheck="false"
                    :disabled="!loaded || busy || search.submitting"
                    @input="isEditing && (token = ($event.target as HTMLInputElement).value)"
                    @keydown.enter="isEditing && !$event.isComposing && token.trim() && act('save')"
                />
                <div class="token-tools">
                    <button
                        class="icon-button"
                        :aria-label="visible ? '隐藏 Token' : '显示 Token'"
                        :title="visible ? '隐藏 Token' : '显示 Token'"
                        :aria-pressed="visible"
                        :disabled="!loaded || busy || revealing || (!isEditing && !status.available)"
                        @click="toggleVisibility()"
                    >
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                            <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
                            <circle cx="12" cy="12" r="3" />
                            <path v-if="visible" d="m3 3 18 18" />
                        </svg>
                    </button>
                    <button
                        v-if="!isEditing"
                        class="icon-button"
                        aria-label="复制 Token"
                        title="复制 Token"
                        :disabled="busy || !status.available"
                        @click="act('copy')"
                    >
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                            <rect x="8" y="8" width="12" height="12" rx="2" />
                            <path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" />
                        </svg>
                    </button>
                </div>
            </div>
            <p class="token-caption">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                    <rect x="5" y="10" width="14" height="10" rx="2" />
                    <path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg
                >{{ isEditing ? "仅保存在本机，保存时自动加密。" : "已加密保存，点击小眼睛查看明文。" }}
            </p>
            <p v-if="editing && status.configured" class="subtle">更换后保留旧历史，新操作使用新配置。</p>
            <div class="account-actions">
                <template v-if="isEditing">
                    <button class="primary" :disabled="busy || !token.trim() || search.submitting" @click="act('save')">
                        保存 Token
                    </button>
                    <button v-if="status.configured" :disabled="busy" @click="cancelEdit()">取消</button>
                </template>
                <button v-else :disabled="busy || search.submitting" @click="editToken()">更换 Token</button>
                <button
                    v-if="!isEditing"
                    :disabled="busy || !status.available || search.submitting"
                    @click="revalidate()"
                >
                    {{ validating ? "验证中…" : "验证 Token" }}
                </button>
                <button
                    v-if="status.configured"
                    class="clear-token"
                    :disabled="busy || search.submitting"
                    @click="act('clear')"
                >
                    清除
                </button>
            </div>
            <p v-if="message" class="notice" role="status">
                {{ message }}
            </p>
            <details class="token-help">
                <summary>如何获取 Token？</summary>
                <p>打开墨墨 App，在「我的 → 更多设置 → 实验功能 → 开放 API」获取个人 Token。</p>
            </details>
        </div>
        <p class="subtle setup-note">请在手机 App 开启自动同步。学习记录可能延迟，结果待确认时应先查询状态。</p>
        <AiSettings />
        <div class="settings-card desktop-settings">
            <h2>桌面行为</h2>
            <label for="shortcut">唤出查词快捷键</label>
            <div class="shortcut-row">
                <input
                    id="shortcut"
                    :value="preferences.shortcut"
                    placeholder="点击后按下组合键"
                    readonly
                    @keydown="captureShortcut"
                />
                <button @click="preferences.shortcut = ''">停用</button>
            </div>
            <p class="subtle">
                {{ desktop.status?.shortcutRegistered ? "全局快捷键已注册" : "全局快捷键未注册或已停用" }}。可使用 Ctrl
                / ⌘、Alt、Shift 组合字母或功能键。
            </p>
            <label for="close-behavior">关闭窗口时</label>
            <select id="close-behavior" v-model="preferences.closeBehavior">
                <option value="hide">隐藏到托盘</option>
                <option value="quit">退出应用</option>
            </select>
            <p v-if="desktop.status && !desktop.status.hideSupported" class="subtle">
                当前桌面无法保证托盘入口可见，隐藏操作将改为最小化，保留窗口入口。
            </p>
            <label for="theme">外观</label>
            <select id="theme" v-model="preferences.theme">
                <option value="system">跟随系统</option>
                <option value="light">浅色</option>
                <option value="dark">深色</option>
            </select>
            <div class="actions">
                <button class="primary" :disabled="savingPreferences" @click="savePreferences()">保存桌面设置</button>
                <button @click="desktopAction('hide')">
                    {{ desktop.status?.hideSupported ? "隐藏窗口" : "最小化窗口" }}
                </button>
                <button @click="desktopAction('devTools')">开发者工具</button>
                <button class="danger" @click="desktopAction('quit')">退出应用</button>
            </div>
            <p v-if="preferencesMessage" class="notice" role="status">
                {{ preferencesMessage }}
            </p>
        </div>
    </section>
</template>
