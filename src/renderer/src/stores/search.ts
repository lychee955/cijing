import {computed, ref} from "vue";
import {defineStore} from "pinia";
import type {AddOutcome, Vocabulary} from "../../../shared/models";

interface StudyStatus {
    loading: boolean;
    outcome?: AddOutcome;
    error?: string;
}

export const useSearchStore = defineStore("search", () => {
    const input = ref("");
    const words = ref<Vocabulary[]>([]);
    const selectedId = ref("");
    const querying = ref(false);
    const submitting = ref(false);
    const message = ref("");
    const outcome = ref<AddOutcome | null>(null);
    const searched = ref(false);
    const studyStatuses = ref<Record<string, StudyStatus>>({});
    let sequence = 0;
    const selected = computed(() => words.value.find((word) => word.id === selectedId.value));
    const checkingSelected = computed(() => !!studyStatuses.value[selectedId.value]?.loading);
    const selectedOutcome = computed(() => outcome.value ?? studyStatuses.value[selectedId.value]?.outcome);
    const canAdd = computed(
        () =>
            !!selected.value &&
            !submitting.value &&
            !querying.value &&
            !checkingSelected.value &&
            (!selectedOutcome.value || ["failed", "unconfirmed"].includes(selectedOutcome.value.state))
    );

    function invalidate(): void {
        sequence++;
        words.value = [];
        studyStatuses.value = {};
        selectedId.value = "";
        outcome.value = null;
        message.value = "";
        searched.value = false;
        querying.value = false;
    }
    function select(id: string): void {
        selectedId.value = id;
        outcome.value = null;
        message.value = "";
    }
    async function checkStudyRecords(matches: Vocabulary[], request: number): Promise<void> {
        // Keep reads sequential to avoid flooding the API or exceeding the session limit.
        for (const word of matches) {
            if (request !== sequence) return;
            try {
                const result = await window.desktop.study.confirm(word.id);
                if (request !== sequence) return;
                studyStatuses.value[word.id] = result.ok
                    ? {loading: false, outcome: result.data}
                    : {loading: false, error: result.error.message};
            } catch {
                if (request !== sequence) return;
                studyStatuses.value[word.id] = {
                    loading: false,
                    error: "无法连接桌面服务，请重新查询。"
                };
            }
        }
    }
    async function lookup(): Promise<void> {
        if (submitting.value || !input.value.trim()) return;
        const request = ++sequence;
        words.value = [];
        selectedId.value = "";
        outcome.value = null;
        message.value = "";
        searched.value = false;
        studyStatuses.value = {};
        querying.value = true;
        try {
            const result = await window.desktop.vocabulary.lookup(input.value.trim());
            if (request !== sequence) return;
            searched.value = true;
            if (result.ok) {
                words.value = result.data;
                selectedId.value = result.data.length === 1 ? result.data[0]!.id : "";
                studyStatuses.value = Object.fromEntries(result.data.map((word) => [word.id, {loading: true}]));
                void checkStudyRecords(result.data, request);
            } else message.value = result.error.message;
        } catch {
            if (request === sequence) message.value = "无法连接桌面服务，请重启应用。";
        } finally {
            if (request === sequence) querying.value = false;
        }
    }
    async function submit(confirm = false): Promise<void> {
        if (
            !selected.value ||
            submitting.value ||
            querying.value ||
            checkingSelected.value ||
            (!confirm && !canAdd.value)
        )
            return;
        submitting.value = true;
        message.value = "";
        const request = sequence;
        const id = selectedId.value;
        try {
            const result = await window.desktop.study[confirm ? "confirm" : "add"](id);
            if (request !== sequence) return;
            if (result.ok) {
                studyStatuses.value[id] = {loading: false, outcome: result.data};
                if (selectedId.value === id) outcome.value = result.data;
            } else message.value = result.error.message;
        } catch {
            if (request === sequence)
                message.value = confirm ? "学习记录查询失败，请重试。" : "结果待确认：桌面服务连接中断，请勿重复添加。";
        } finally {
            submitting.value = false;
        }
    }
    return {
        input,
        words,
        selectedId,
        selected,
        querying,
        submitting,
        message,
        outcome,
        searched,
        studyStatuses,
        checkingSelected,
        selectedOutcome,
        canAdd,
        invalidate,
        select,
        lookup,
        submit
    };
});
