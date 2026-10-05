import type {AddOutcome, AddState, HistoryEntry, Vocabulary} from "../../shared/models";
import type {CredentialSnapshot} from "../storage/credential-store";
import type {MaimemoClient} from "../maimemo/client";
import {ClientError, publicError} from "../maimemo/errors";
import type {ErrorCode} from "../../shared/result";
import {OperationsDatabase} from "../storage/database";

const messages: Record<Exclude<AddState, "failed">, string> = {
    added: "已加入学习规划",
    present: "已在学习规划中（不代表由本次请求新增）",
    not_added: "未新增，可能已添加或单词上限不足；可稍后再次确认。",
    unconfirmed: "暂未查到学习记录，可确认词条后添加；记录可能存在同步延迟。",
    uncertain: "结果待确认，请勿重复添加；暂未查到记录不能证明添加失败。"
};

export class StudyService {
    private readonly pending = new Map<string, Promise<AddOutcome>>();
    private readonly outcomes = new Map<string, AddOutcome>();
    private readonly invalidProfiles = new Set<string>();
    constructor(
        private readonly client: MaimemoClient,
        private readonly sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
        private readonly database = new OperationsDatabase(":memory:")
    ) {}

    add(credentials: CredentialSnapshot, word: Vocabulary): Promise<AddOutcome> {
        const key = this.key(credentials, word);
        const running = this.pending.get(key);
        if (running) return running;
        const previous = this.previous(credentials, word);
        // A persisted uncertain write cannot be resent, including after restart.
        if (previous && !["failed", "unconfirmed"].includes(previous.state)) return Promise.resolve(previous);
        return this.run(key, async () => {
            this.checkCredentials(credentials);
            // Commit synchronously before allowing ANY network write.
            const operationId = this.database.begin(credentials.profileId, word);
            let outcome: AddOutcome;
            try {
                const count = await this.client.add(credentials.token, word.id);
                outcome = count === 1 ? this.outcome(word, "added") : await this.verify(credentials, word, "not_added");
            } catch (error) {
                if (error instanceof ClientError && error.code === "AUTH") this.invalidate(credentials);
                if (error instanceof ClientError && !error.ambiguous) {
                    outcome = {
                        ...this.outcome(word, "failed"),
                        message: error.message,
                        errorCode: error.code
                    };
                } else outcome = await this.verify(credentials, word, "uncertain", publicError(error).code);
            }
            return this.persist(operationId, outcome);
        });
    }

    confirm(credentials: CredentialSnapshot, word: Vocabulary, operationId?: string): Promise<AddOutcome> {
        const entry = operationId ? this.operation(credentials, operationId, word.id) : undefined;
        return this.confirmWord(credentials, word, entry);
    }

    confirmOperation(credentials: CredentialSnapshot, operationId: string): Promise<AddOutcome> {
        const entry = this.operation(credentials, operationId);
        return this.confirmWord(credentials, {id: entry.vocId, spelling: entry.spelling}, entry);
    }

    private operation(credentials: CredentialSnapshot, id: string, vocId?: string): HistoryEntry {
        const entry = this.database.get(id);
        if (!entry || entry.profileId !== credentials.profileId || (vocId !== undefined && entry.vocId !== vocId))
            throw new ClientError("FORBIDDEN");
        return entry;
    }

    private confirmWord(credentials: CredentialSnapshot, word: Vocabulary, entry?: HistoryEntry): Promise<AddOutcome> {
        const key = this.key(credentials, word);
        const running = this.pending.get(key);
        if (running) return running;
        const previous = entry ? this.asOutcome(entry) : this.previous(credentials, word);
        return this.run(
            key,
            async () => {
                const fallback =
                    !previous || ["unconfirmed", "failed"].includes(previous.state)
                        ? "unconfirmed"
                        : previous.state === "not_added"
                          ? "not_added"
                          : "uncertain";
                const confirmed = await this.verify(credentials, word, fallback);
                // A later read cannot undo the authoritative added_count=1 response.
                let outcome = confirmed;
                if (previous?.state === "added") {
                    outcome = {
                        ...previous,
                        recordConfirmed: confirmed.state === "present",
                        errorCode: confirmed.errorCode,
                        message:
                            confirmed.state === "present"
                                ? "已加入学习规划；学习记录已确认。"
                                : `已加入学习规划；学习记录暂未确认。${confirmed.errorCode ? publicError(new ClientError(confirmed.errorCode)).message : "请等待手机同步后再查询。"}`
                    };
                }
                return previous?.operationId ? this.persist(previous.operationId, outcome) : outcome;
            },
            !entry || this.database.latest(credentials.profileId, word.id)?.id === entry.id
        );
    }

    clear(): void {
        this.outcomes.clear();
        this.invalidProfiles.clear();
    }

    private async verify(
        credentials: CredentialSnapshot,
        word: Vocabulary,
        fallback: "not_added" | "uncertain" | "unconfirmed",
        errorCode?: ErrorCode
    ): Promise<AddOutcome> {
        for (let attempt = 0; attempt < 2; attempt++) {
            if (attempt > 0) await this.sleep(800);
            try {
                this.checkCredentials(credentials);
                if (await this.client.contains(credentials.token, word.id)) return this.outcome(word, "present");
            } catch (error) {
                const safe = publicError(error);
                if (safe.code === "AUTH") this.invalidate(credentials);
                return {
                    ...this.outcome(word, fallback),
                    errorCode: safe.code,
                    message: `${messages[fallback]} ${safe.message}`
                };
            }
        }
        return {
            ...this.outcome(word, fallback),
            ...(errorCode ? {errorCode} : {})
        };
    }

    private outcome(word: Vocabulary, state: AddState): AddOutcome {
        return {
            vocId: word.id,
            spelling: word.spelling,
            state,
            message: state === "failed" ? "添加失败" : messages[state]
        };
    }

    private checkCredentials(credentials: CredentialSnapshot): void {
        if (this.invalidProfiles.has(credentials.profileId) || this.database.isInvalid(credentials.profileId))
            throw new ClientError("AUTH");
    }
    private invalidate(credentials: CredentialSnapshot): void {
        this.invalidProfiles.add(credentials.profileId);
        this.database.invalidateProfile(credentials.profileId);
    }
    private asOutcome(entry: import("../../shared/models").HistoryEntry): AddOutcome {
        return {
            vocId: entry.vocId,
            spelling: entry.spelling,
            state: entry.state === "submitting" ? "uncertain" : entry.state,
            message: entry.state === "submitting" ? messages.uncertain : entry.message,
            errorCode: entry.errorCode,
            operationId: entry.id
        };
    }
    private previous(credentials: CredentialSnapshot, word: Vocabulary): AddOutcome | undefined {
        const cached = this.outcomes.get(this.key(credentials, word));
        if (cached) return cached;
        const entry = this.database.latest(credentials.profileId, word.id);
        return entry ? this.asOutcome(entry) : undefined;
    }
    private persist(operationId: string, outcome: AddOutcome): AddOutcome {
        try {
            this.database.finish(operationId, outcome);
            return {...outcome, operationId};
        } catch {
            return {
                ...outcome,
                operationId,
                state: "uncertain",
                errorCode: "STORAGE_ERROR",
                message: "请求可能已执行，但结果无法保存。请检查磁盘空间并确认状态，不要重复添加。"
            };
        }
    }

    private key(credentials: CredentialSnapshot, word: Vocabulary): string {
        return `${credentials.profileId}:${word.id}`;
    }

    private run(key: string, action: () => Promise<AddOutcome>, cache = true): Promise<AddOutcome> {
        const promise = action()
            .then((outcome) => {
                if (cache) this.outcomes.set(key, outcome);
                return outcome;
            })
            .finally(() => this.pending.delete(key));
        this.pending.set(key, promise);
        return promise;
    }
}
