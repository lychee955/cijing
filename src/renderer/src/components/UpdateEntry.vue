<script setup lang="ts">
import {computed, onMounted, onUnmounted, ref} from "vue";
import {useUpdatesStore} from "../stores/updates";
const updates = useUpdatesStore();
const panel = ref<HTMLDialogElement>();
const entry = ref<HTMLButtonElement>();
let unsubscribe: (() => void) | undefined;
onMounted(() => {
    unsubscribe = window.desktop.updates.onChanged(updates.receive);
    void updates.act("status");
});
onUnmounted(() => unsubscribe?.());
const status = computed(() => updates.status);
const environmentLabel = computed(() => {
    const e = status.value?.environment;
    if (!e) return "";
    const platform =
        ({win32: "Windows", darwin: "macOS", linux: "Linux"} as Record<string, string>)[e.platform] ?? e.platform;
    const installation = {
        nsis: "安装版",
        portable: "便携版",
        "mac-app": "应用程序",
        development: "开发运行",
        unknown: "未识别形式"
    }[e.installation];
    return `${platform} · ${e.arch} · ${installation}`;
});
const label = computed(() => {
    const s = status.value;
    if (!s) return "版本与更新";
    if (s.phase === "checking") return "正在检查更新…";
    if (s.phase === "downloading") return `下载更新 ${s.progress ?? 0}%`;
    if (s.phase === "downloaded") return "重启并更新";
    if (s.phase === "installing") return "正在重启…";
    if (s.phase === "available")
        return `NEW · v${s.candidate?.version} ${s.environment.canInstall ? "可更新" : "可下载"}`;
    return `v${s.environment.version}${s.phase === "error" ? " · 重试" : ""}`;
});
const canDownload = computed(
    () =>
        status.value?.environment.canInstall &&
        (status.value.phase === "available" ||
            (status.value.phase === "error" && status.value.errorStage === "download"))
);
const locked = computed(() =>
    ["checking", "downloading", "downloaded", "installing"].includes(status.value?.phase ?? "")
);
function close(): void {
    panel.value?.close();
    entry.value?.focus();
}
function date(value?: string): string {
    return value ? new Date(value).toLocaleString("zh-CN") : "尚未检查";
}
</script>

<template>
    <button
        ref="entry"
        class="update-entry"
        :class="{'has-update': status?.phase === 'available'}"
        aria-haspopup="dialog"
        @click="panel?.showModal()"
    >
        {{ label }}
    </button>
    <Teleport to="body">
        <dialog
            ref="panel"
            class="update-panel"
            aria-labelledby="update-title"
            @cancel.prevent="close"
            @keydown.stop
            @close="entry?.focus()"
        >
            <div class="update-heading">
                <h2 id="update-title">版本与更新</h2>
                <button aria-label="关闭更新面板" autofocus @click="close">关闭</button>
            </div>
            <template v-if="status">
                <dl class="update-details">
                    <div>
                        <dt>当前版本</dt>
                        <dd>v{{ status.environment.version }}</dd>
                    </div>
                    <div>
                        <dt>运行环境</dt>
                        <dd>{{ environmentLabel }}</dd>
                    </div>
                    <div v-if="status.candidate">
                        <dt>目标版本</dt>
                        <dd>v{{ status.candidate.version }}</dd>
                    </div>
                    <div v-if="status.candidate">
                        <dt>发布日期</dt>
                        <dd>{{ date(status.candidate.publishedAt) }}</dd>
                    </div>
                    <div>
                        <dt>最后检查</dt>
                        <dd>{{ date(status.lastCheckedAt) }}</dd>
                    </div>
                </dl>
                <p class="notice" role="status">
                    {{ status.message }}
                </p>
                <p v-if="status.environment.reason && status.environment.reason !== status.message" class="update-note">
                    {{ status.environment.reason }}
                </p>
                <p v-if="status.retryAt" class="update-note">可重试时间：{{ date(status.retryAt) }}</p>
                <progress
                    v-if="status.phase === 'downloading'"
                    :value="status.progress ?? 0"
                    max="100"
                    aria-label="更新下载进度"
                />
                <section v-if="status.candidate" class="update-notes">
                    <h3>更新说明</h3>
                    <p>{{ status.candidate.notes || "此版本暂无更新说明。" }}</p>
                </section>
                <div class="actions">
                    <button :disabled="!status.environment.canCheck || locked" @click="updates.act('check')">
                        检查更新
                    </button>
                    <button v-if="canDownload" class="primary" @click="updates.act('download')">下载更新</button>
                    <button v-if="status.phase === 'downloaded'" class="primary" @click="updates.act('install')">
                        重启并更新
                    </button>
                    <button
                        v-if="status.candidate && !['checking', 'installing'].includes(status.phase)"
                        @click="updates.act('openRelease')"
                    >
                        前往发布页面下载
                    </button>
                </div>
            </template>
            <p v-if="updates.error" class="notice error" role="alert">
                {{ updates.error }}
            </p>
        </dialog>
    </Teleport>
</template>
