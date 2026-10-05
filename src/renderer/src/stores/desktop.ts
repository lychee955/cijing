import {defineStore} from "pinia";
import {ref} from "vue";
import type {CredentialStatus, DesktopStatus} from "../../../shared/models";

export const useDesktopStore = defineStore("desktop", () => {
    const status = ref<DesktopStatus | null>(null);
    const credentials = ref<CredentialStatus>({
        configured: false,
        available: true
    });
    const credentialsLoaded = ref(false);
    const message = ref("");
    let refreshTask: Promise<void> | undefined;
    let refreshQueued = false;
    function applyTheme(): void {
        const theme = status.value?.settings.theme ?? "system";
        document.documentElement.dataset.theme = theme;
        document.documentElement.dataset.colorScheme =
            theme === "system"
                ? window.matchMedia?.("(prefers-color-scheme: dark)").matches
                    ? "dark"
                    : "light"
                : theme;
    }
    async function readStatus(): Promise<void> {
        try {
            const [desktop, credential] = await Promise.all([
                window.desktop.desktop.status(),
                window.desktop.credentials.status()
            ]);
            if (refreshQueued) return;
            if (desktop.ok) {
                status.value = desktop.data;
                applyTheme();
            } else message.value = desktop.error.message;
            if (credential.ok) {
                credentials.value = credential.data;
                credentialsLoaded.value = true;
            } else message.value = credential.error.message;
        } catch {
            if (!refreshQueued) message.value = "无法连接桌面服务，请重启应用。";
        }
    }
    function refresh(fresh = false): Promise<void> {
        if (refreshTask) {
            if (fresh) refreshQueued = true;
            return refreshTask;
        }
        refreshTask = (async () => {
            try {
                do {
                    refreshQueued = false;
                    await readStatus();
                } while (refreshQueued);
            } finally {
                refreshTask = undefined;
            }
        })();
        return refreshTask;
    }
    return {status, credentials, credentialsLoaded, message, refresh, applyTheme};
});
