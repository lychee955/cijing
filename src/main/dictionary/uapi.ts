import {z} from "zod";
import type {DictionaryEntry} from "../../shared/models";
import type {Fetcher} from "../maimemo/client";

const textSchema = z.string().max(100_000);
const accentSchema = z.object({text: textSchema.optional()});
const responseSchema = z.discriminatedUnion("found", [
    z.object({found: z.literal(false)}),
    z.object({
        found: z.literal(true),
        entry: z.object({
            word: z.string().min(1),
            definitions: z
                .array(
                    z.object({
                        meaning: textSchema,
                        part_of_speech: textSchema.optional()
                    })
                )
                .max(1000)
                .optional(),
            phonetics: z.object({uk: accentSchema.optional(), us: accentSchema.optional()}).optional()
        })
    })
]);
const MAX_BYTES = 1024 * 1024;

export interface Dictionary {
    lookup(spelling: string): Promise<DictionaryEntry>;
}
export class DictionaryError extends Error {}

export class UapiDictionary implements Dictionary {
    private readonly cache = new Map<string, {expires: number; value: DictionaryEntry}>();
    private readonly pending = new Map<string, Promise<DictionaryEntry>>();
    private queue: Promise<unknown> = Promise.resolve();
    private nextRequest = 0;
    private blockedUntil = 0;

    constructor(
        private readonly fetcher: Fetcher,
        private readonly timeoutMs = 10_000
    ) {}

    lookup(spelling: string): Promise<DictionaryEntry> {
        const word = spelling.trim();
        if (!word || word.length > 64)
            return Promise.reject(new DictionaryError("UAPI 仅支持查询 1–64 个字符的单词或短语。"));
        const cached = this.cache.get(word);
        if (cached && cached.expires > Date.now()) return Promise.resolve(cached.value);
        const pending = this.pending.get(word);
        if (pending) return pending;
        const request = this.queue
            .then(async () => {
                if (Date.now() < this.blockedUntil)
                    throw new DictionaryError("UAPI 请求过于频繁或免费额度不足，请稍后重试。");
                const wait = this.nextRequest - Date.now();
                if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
                this.nextRequest = Date.now() + 300;
                const value = await this.fetchEntry(word);
                this.cache.delete(word);
                this.cache.set(word, {expires: Date.now() + 10 * 60_000, value});
                if (this.cache.size > 200) this.cache.delete(this.cache.keys().next().value!);
                return value;
            })
            .finally(() => {
                this.pending.delete(word);
            });
        this.pending.set(word, request);
        this.queue = request.catch(() => {});
        return request;
    }

    private async fetchEntry(word: string): Promise<DictionaryEntry> {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeoutMs);
        try {
            const url = new URL("https://uapis.cn/api/v1/dictionary/lookup");
            url.searchParams.set("word", word);
            const response = await this.fetcher(url.href, {
                method: "GET",
                headers: {Accept: "application/json"},
                credentials: "omit",
                redirect: "error",
                cache: "no-store",
                signal: controller.signal
            });
            if (!response.ok) {
                void response.body?.cancel().catch(() => {});
                if (response.status === 404) return {interpretations: []};
                if (response.status === 429) {
                    const retry = response.headers.get("retry-after");
                    const delay =
                        retry && /^\d+$/.test(retry) ? Number(retry) * 1000 : Date.parse(retry ?? "") - Date.now();
                    this.blockedUntil = Date.now() + (Number.isFinite(delay) && delay > 0 ? delay : 60_000);
                    throw new DictionaryError("UAPI 请求过于频繁或免费额度不足，请稍后重试。");
                }
                if ([401, 402, 403].includes(response.status))
                    throw new DictionaryError("UAPI 免费访问受限或额度不足，请稍后重试。");
                throw new DictionaryError("UAPI 词典服务暂时不可用，请稍后重试。");
            }
            const reader = response.body?.getReader();
            if (!reader) throw new DictionaryError("UAPI 返回的释义格式异常。");
            const chunks: Uint8Array[] = [];
            let bytes = 0;
            try {
                while (true) {
                    const {value, done} = await reader.read();
                    if (done) break;
                    bytes += value.byteLength;
                    if (bytes > MAX_BYTES) {
                        void reader.cancel().catch(() => {});
                        throw new DictionaryError("UAPI 返回的释义过大。");
                    }
                    chunks.push(value);
                }
            } finally {
                reader.releaseLock();
            }
            let raw: unknown;
            try {
                raw = JSON.parse(Buffer.concat(chunks).toString("utf8"));
            } catch {
                throw new DictionaryError("UAPI 返回的释义格式异常。");
            }
            const parsed = responseSchema.safeParse(raw);
            if (!parsed.success) throw new DictionaryError("UAPI 返回的释义格式异常。");
            if (!parsed.data.found) return {interpretations: []};
            const entry = parsed.data.entry;
            return {
                interpretations: [
                    ...new Set(
                        (entry.definitions ?? [])
                            .filter((item) => item.meaning.trim())
                            .map((item) => {
                                const meaning = item.meaning.trim(),
                                    pos = item.part_of_speech?.trim();
                                return pos && !meaning.startsWith(pos) ? `${pos} ${meaning}` : meaning;
                            })
                    )
                ],
                phonetics: {
                    uk: entry.phonetics?.uk?.text,
                    us: entry.phonetics?.us?.text
                }
            };
        } catch (error) {
            if (error instanceof DictionaryError) throw error;
            throw new DictionaryError(
                controller.signal.aborted ? "UAPI 释义查询超时，请稍后重试。" : "无法连接 UAPI 词典，请检查网络。"
            );
        } finally {
            clearTimeout(timer);
        }
    }
}
