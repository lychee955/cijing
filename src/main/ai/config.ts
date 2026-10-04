import {z} from "zod";
import type {AiTemplate} from "../../shared/ai";
export function normalizeUrl(value: string): string {
    const url = new URL(value);
    if (
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        /\/(?:chat\/completions|models\/[^/]+:generateContent)\/?$/.test(url.pathname)
    )
        throw new Error("base URL");
    return url.toString().replace(/\/+$/, "");
}
export const optionsSchema = z
    .object({
        outputMode: z.enum(["text", "json", "schema"]),
        timeoutSeconds: z.number().int().min(5).max(180)
    })
    .strict();
export const profileInputSchema = z
    .object({
        id: z.string().uuid().optional(),
        name: z.string().trim().min(1).max(80),
        protocol: z.enum(["openai", "gemini"]),
        baseUrl: z
            .string()
            .max(2048)
            .transform((v, ctx) => {
                try {
                    return normalizeUrl(v.trim());
                } catch {
                    ctx.addIssue({
                        code: "custom",
                        message: "基础地址必须为 HTTPS，不包含完整请求路径、认证或查询参数"
                    });
                    return z.NEVER;
                }
            }),
        model: z
            .string()
            .trim()
            .min(1)
            .max(160)
            .regex(/^[a-zA-Z0-9._:/-]+$/),
        options: optionsSchema,
        key: z
            .string()
            .trim()
            .min(1)
            .max(4096)
            .regex(/^[\x21-\x7e]+$/)
            .optional()
    })
    .strict();
export const templates: AiTemplate[] = [
    {
        name: "OpenRouter",
        protocol: "openai",
        baseUrl: "https://openrouter.ai/api/v1",
        model: "qwen/qwen3.8-27b:free"
    },
    {
        name: "Gemini",
        protocol: "gemini",
        baseUrl: "https://generativelanguage.googleapis.com/v1beta",
        model: "gemini-3.7-flash"
    },
    {
        name: "Groq",
        protocol: "openai",
        baseUrl: "https://api.groq.com/openai/v1",
        model: ""
    },
    {
        name: "GLM（国内标准 API）",
        protocol: "openai",
        baseUrl: "https://open.bigmodel.cn/api/paas/v4",
        model: ""
    },
    {name: "自定义", protocol: "openai", baseUrl: "", model: ""}
];
