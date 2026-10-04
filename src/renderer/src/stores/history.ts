import {defineStore} from "pinia";
import {reactive, ref} from "vue";
import type {HistoryPage, HistoryQuery} from "../../../shared/models";

export const useHistoryStore = defineStore("history", () => {
    const query = reactive<HistoryQuery>({
        scope: "active",
        offset: 0,
        limit: 20,
        pendingOnly: false
    });
    const page = ref<HistoryPage>({items: [], total: 0});
    const loading = ref(false),
        confirming = ref(""),
        message = ref("");
    let sequence = 0;
    async function load(): Promise<void> {
        const request = ++sequence;
        loading.value = true;
        try {
            const result = await window.desktop.history.list({...query});
            if (request !== sequence) return;
            if (result.ok) page.value = result.data;
            else message.value = result.error.message;
        } catch {
            if (request === sequence) message.value = "无法加载本地历史，请重试。";
        } finally {
            if (request === sequence) loading.value = false;
        }
    }
    async function confirm(id: string): Promise<void> {
        if (confirming.value) return;
        confirming.value = id;
        message.value = "";
        try {
            const result = await window.desktop.history.confirm(id);
            message.value = result.ok ? result.data.message : result.error.message;
            await load();
        } catch {
            message.value = "状态确认未完成，记录会保留。";
        } finally {
            confirming.value = "";
        }
    }
    function filter(): void {
        query.offset = 0;
        message.value = "";
        void load();
    }
    function turn(delta: number): void {
        query.offset = Math.max(0, query.offset + delta * query.limit);
        void load();
    }
    return {
        query,
        page,
        loading,
        confirming,
        message,
        load,
        confirm,
        filter,
        turn
    };
});
