import {z} from "zod";
import {randomUUID} from "node:crypto";
import type {AiUsage, OutputMode} from "../../shared/ai";
import type {AnalysisMode} from "../../shared/analysis";
import type {AiSnapshot} from "../storage/ai-store";
import {AiError, apiErrorDetails} from "./errors";
import {geminiSchema, jsonSchema} from "./schema";
import type {AiLog} from "./logging";
export type AiFetch = (url: string, init: RequestInit) => Promise<Response>;
export interface Generation {
    text: string;
    model?: string;
    finishReason: string;
    usage?: AiUsage;
}
export interface AiAdapter {
    generate(
        snapshot: AiSnapshot,
        prompt: string,
        input: string,
        mode: OutputMode,
        signal: AbortSignal,
        purpose?: AnalysisMode
    ): Promise<Generation>;
}
const usageNumber = z.number().int().nonnegative().optional();
const openaiResponse = z.object({
    model: z.string().optional(),
    choices: z.array(
        z.object({
            finish_reason: z.string().nullable(),
            message: z.object({
                content: z.string().nullable().optional(),
                refusal: z.string().nullable().optional()
            })
        })
    ),
    usage: z
        .object({
            prompt_tokens: usageNumber,
            completion_tokens: usageNumber,
            total_tokens: usageNumber,
            completion_tokens_details: z.object({reasoning_tokens: usageNumber}).optional()
        })
        .optional()
});
const geminiResponse = z
    .object({
        modelVersion: z.string().optional(),
        promptFeedback: z.object({blockReason: z.string().optional()}).optional(),
        candidates: z
            .array(
                z.object({
                    finishReason: z.string().optional(),
                    content: z
                        .object({
                            parts: z.array(
                                z.object({
                                    text: z.string().optional(),
                                    thought: z.boolean().optional()
                                })
                            )
                        })
                        .optional()
                })
            )
            .optional(),
        usageMetadata: z
            .object({
                promptTokenCount: usageNumber,
                candidatesTokenCount: usageNumber,
                totalTokenCount: usageNumber,
                thoughtsTokenCount: usageNumber
            })
            .optional()
    })
    .refine((r) => r.candidates !== undefined || r.promptFeedback !== undefined);
function truncationDetails(reason: string, characters: number, output?: number, reasoning?: number): string {
    return `服务结束原因：${reason}\n应用未发送输出长度上限，生成由服务端结束。\n输出用量：${output ?? "未知"} Token\n推理用量：${reasoning ?? "未知"} Token\n返回正文：${characters} 字符`;
}
async function readBody(response: Response): Promise<string> {
    if (Number(response.headers.get("content-length")) > 2_000_000) throw new AiError("AI_FORMAT");
    if (!response.body) return "";
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let bytes = 0,
        body = "";
    try {
        while (true) {
            const part = await reader.read();
            if (part.done) break;
            bytes += part.value.byteLength;
            if (bytes > 2_000_000) {
                await reader.cancel();
                throw new AiError("AI_FORMAT");
            }
            body += decoder.decode(part.value, {stream: true});
        }
        return body + decoder.decode();
    } finally {
        reader.releaseLock();
    }
}
export function retryAfter(value: string | null): number | undefined {
    if (!value) return;
    const n = Number(value),
        seconds = Number.isFinite(n) ? n : (Date.parse(value) - Date.now()) / 1000;
    return Number.isFinite(seconds) ? Math.max(1, Math.ceil(seconds)) : undefined;
}
abstract class HttpAdapter implements AiAdapter {
    constructor(
        private readonly fetcher: AiFetch,
        private readonly logger: AiLog = () => {}
    ) {}
    abstract generate(
        s: AiSnapshot,
        prompt: string,
        input: string,
        mode: OutputMode,
        signal: AbortSignal,
        purpose?: AnalysisMode
    ): Promise<Generation>;
    protected async request(
        snapshot: AiSnapshot,
        url: string,
        headers: Record<string, string>,
        body: unknown,
        mode: OutputMode,
        signal: AbortSignal
    ): Promise<unknown> {
        const requestId = randomUUID(),
            startedAt = Date.now();
        const context = {
            requestId,
            profileId: snapshot.profile.id,
            protocol: snapshot.profile.protocol,
            model: snapshot.profile.model,
            outputMode: mode,
            url
        };
        const log = (entry: Record<string, unknown>) => {
            try {
                this.logger({...context, ...entry}, [snapshot.key]);
            } catch {
                /* Do not fail network calls because of logging. */
            }
        };
        log({
            phase: "request",
            method: "POST",
            headers: {"Content-Type": "application/json", ...headers},
            body
        });
        let response: Response;
        try {
            response = await this.fetcher(url, {
                method: "POST",
                redirect: "error",
                headers: {"Content-Type": "application/json", ...headers},
                body: JSON.stringify(body),
                signal
            });
        } catch {
            log({
                phase: "transport-error",
                elapsedMs: Date.now() - startedAt,
                reason: signal.aborted ? "cancelled" : "network"
            });
            throw new AiError(signal.aborted ? "AI_CANCELLED" : "AI_NETWORK");
        }
        let raw: string;
        try {
            raw = await readBody(response);
        } catch (error) {
            log({
                phase: "response-read-error",
                status: response.status,
                elapsedMs: Date.now() - startedAt
            });
            throw error;
        }
        let parsed: unknown;
        try {
            parsed = JSON.parse(raw);
        } catch {
            /* Log non-JSON responses too. */
        }
        const delay = retryAfter(response.headers.get("retry-after"));
        log({
            phase: "response",
            status: response.status,
            elapsedMs: Date.now() - startedAt,
            retryAfterSeconds: delay,
            headers: Object.fromEntries(response.headers.entries()),
            body: parsed ?? raw
        });
        const envelope = z
            .object({
                error: z.object({
                    code: z.union([z.number(), z.string()]).optional(),
                    metadata: z.object({error_type: z.string().optional()}).optional()
                })
            })
            .safeParse(parsed);
        const embeddedCode = envelope.success ? Number(envelope.data.error.code) : undefined;
        const status =
            response.ok && envelope.success
                ? embeddedCode || (envelope.data.error.metadata?.error_type === "rate_limit_exceeded" ? 429 : 500)
                : response.status;
        if (!response.ok || envelope.success) {
            const details = apiErrorDetails(response.status, parsed ?? raw, snapshot.key);
            if (status === 401 || status === 403) throw new AiError("AI_AUTH", 0, undefined, details);
            if (status === 429 || (status === 402 && delay)) throw new AiError("AI_RATE_LIMIT", 0, delay, details);
            if (status === 402) throw new AiError("AI_QUOTA", 0, undefined, details);
            if (status === 404 || /model.{0,80}(?:not found|not exist|does not exist|unavailable)/i.test(raw))
                throw new AiError("AI_MODEL", 0, undefined, details);
            if (status >= 500) throw new AiError("AI_SERVER", 0, undefined, details);
            if (
                (status === 400 || status === 422) &&
                mode !== "text" &&
                /(?:response_format|response.?schema|response.?json.?schema|response.?mime.?type|json_schema)/i.test(
                    raw
                ) &&
                /(?:unsupported|not supported|unknown|unrecognized|not allowed|invalid (?:parameter|argument)|not available)/i.test(
                    raw
                )
            )
                throw new AiError("AI_UNSUPPORTED", 0, undefined, details);
            throw new AiError("AI_FORMAT", 0, undefined, details);
        }
        if (parsed === undefined) throw new AiError("AI_FORMAT");
        return parsed;
    }
}
export class OpenAiAdapter extends HttpAdapter {
    async generate(
        s: AiSnapshot,
        prompt: string,
        input: string,
        mode: OutputMode,
        signal: AbortSignal,
        purpose: AnalysisMode = "detailed"
    ): Promise<Generation> {
        const format =
            mode === "schema"
                ? {
                      type: "json_schema",
                      json_schema: {
                          name: "sentence_analysis",
                          strict: true,
                          schema: jsonSchema
                      }
                  }
                : {type: "json_object"};
        const body = {
            model: s.profile.model,
            messages: [
                {role: "system", content: prompt},
                {
                    role: "user",
                    content: purpose === "translation" ? input : JSON.stringify({text: input})
                }
            ],
            ...(mode === "text" ? {} : {response_format: format})
        };
        const parsed = openaiResponse.safeParse(
            await this.request(
                s,
                `${s.profile.baseUrl}/chat/completions`,
                {Authorization: `Bearer ${s.key}`},
                body,
                mode,
                signal
            )
        );
        if (!parsed.success) throw new AiError("AI_FORMAT");
        const r = parsed.data,
            c = r.choices[0];
        if (c?.message.refusal || c?.finish_reason === "content_filter") throw new AiError("AI_REFUSAL");
        if (c?.finish_reason === "length")
            throw new AiError(
                "AI_TRUNCATED",
                0,
                undefined,
                truncationDetails(
                    c.finish_reason,
                    c.message.content?.length ?? 0,
                    r.usage?.completion_tokens,
                    r.usage?.completion_tokens_details?.reasoning_tokens
                )
            );
        if (!c?.message.content?.trim()) throw new AiError("AI_EMPTY");
        if (c.finish_reason !== "stop") throw new AiError("AI_FORMAT");
        return {
            text: c.message.content,
            model: r.model,
            finishReason: c.finish_reason,
            usage: r.usage
                ? {
                      inputTokens: r.usage.prompt_tokens,
                      outputTokens: r.usage.completion_tokens,
                      totalTokens: r.usage.total_tokens
                  }
                : undefined
        };
    }
}
export class GeminiAdapter extends HttpAdapter {
    async generate(
        s: AiSnapshot,
        prompt: string,
        input: string,
        mode: OutputMode,
        signal: AbortSignal,
        purpose: AnalysisMode = "detailed"
    ): Promise<Generation> {
        const model = s.profile.model.replace(/^models\//, "");
        const body = {
            systemInstruction: {parts: [{text: prompt}]},
            contents: [
                {
                    role: "user",
                    parts: [
                        {
                            text: purpose === "translation" ? input : JSON.stringify({text: input})
                        }
                    ]
                }
            ],
            generationConfig: {
                ...(mode === "text" ? {} : {responseMimeType: "application/json"}),
                ...(mode === "schema" ? {responseJsonSchema: geminiSchema(jsonSchema)} : {})
            }
        };
        const parsed = geminiResponse.safeParse(
            await this.request(
                s,
                `${s.profile.baseUrl}/models/${encodeURIComponent(model)}:generateContent`,
                {"x-goog-api-key": s.key},
                body,
                mode,
                signal
            )
        );
        if (!parsed.success) throw new AiError("AI_FORMAT");
        const r = parsed.data,
            c = r.candidates?.[0];
        if (
            r.promptFeedback?.blockReason ||
            (c?.finishReason && ["SAFETY", "RECITATION", "BLOCKLIST", "PROHIBITED_CONTENT"].includes(c.finishReason))
        )
            throw new AiError("AI_REFUSAL");
        const text = c?.content?.parts
            .filter((p) => !p.thought)
            .map((p) => p.text ?? "")
            .join("");
        if (c?.finishReason === "MAX_TOKENS")
            throw new AiError(
                "AI_TRUNCATED",
                0,
                undefined,
                truncationDetails(
                    c.finishReason,
                    text?.length ?? 0,
                    r.usageMetadata?.candidatesTokenCount,
                    r.usageMetadata?.thoughtsTokenCount
                )
            );
        if (!text?.trim()) throw new AiError("AI_EMPTY");
        if (c?.finishReason !== "STOP") throw new AiError("AI_FORMAT");
        return {
            text,
            model: r.modelVersion,
            finishReason: c.finishReason,
            usage: r.usageMetadata
                ? {
                      inputTokens: r.usageMetadata.promptTokenCount,
                      outputTokens: r.usageMetadata.candidatesTokenCount,
                      totalTokens: r.usageMetadata.totalTokenCount
                  }
                : undefined
        };
    }
}
export function adapterRegistry(fetcher: AiFetch, logger?: AiLog): Record<"openai" | "gemini", AiAdapter> {
    return {
        openai: new OpenAiAdapter(fetcher, logger),
        gemini: new GeminiAdapter(fetcher, logger)
    };
}
