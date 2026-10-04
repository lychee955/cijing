import {appendFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync} from "node:fs";
import {dirname} from "node:path";

export type AiLog = (entry: Record<string, unknown>, secrets?: string[]) => void;
const sensitive = new Set([
    "authorization",
    "proxyauthorization",
    "apikey",
    "xgoogapikey",
    "key",
    "token",
    "accesstoken",
    "refreshtoken",
    "secret",
    "password",
    "cookie",
    "setcookie",
    "ciphertext"
]);
function redactText(value: string, secrets: string[]): string {
    let result = value;
    for (const secret of secrets.filter(Boolean)) result = result.split(secret).join("[REDACTED]");
    return result
        .replace(/\b(?:sk-(?:or-v1-)?|gsk_)[A-Za-z0-9_-]{8,}\b/g, "[REDACTED]")
        .replace(/\bBearer\s+[^\s"',;}]+/gi, "Bearer [REDACTED]");
}
export function redact(value: unknown, secrets: string[] = []): unknown {
    if (typeof value === "string") return redactText(value, secrets);
    if (Array.isArray(value)) return value.map((v) => redact(v, secrets));
    if (value && typeof value === "object")
        return Object.fromEntries(
            Object.entries(value).map(([key, v]) => [
                key,
                sensitive.has(key.toLowerCase().replace(/[-_]/g, "")) ? "[REDACTED]" : redact(v, secrets)
            ])
        );
    return value;
}
export function createAiLogger(
    path: string,
    includeContent = true,
    output: (line: string) => void = (line) => console.info("[ai-http]", line)
): AiLog {
    return (entry, secrets = []) => {
        try {
            const sanitized = redact(entry, secrets) as Record<string, unknown>;
            if (!includeContent && "body" in sanitized) sanitized.body = "[内容日志已关闭]";
            if ("body" in sanitized) {
                const encoded = JSON.stringify(sanitized.body);
                if (encoded.length > 64_000)
                    sanitized.body = {
                        preview: encoded.slice(0, 64_000),
                        truncated: true,
                        totalCharacters: encoded.length
                    };
            }
            const line = JSON.stringify({
                timestamp: new Date().toISOString(),
                ...sanitized
            });
            // A diagnostic failure must never alter request handling.
            try {
                output(line);
            } catch {
                /* optional console sink */
            }
            mkdirSync(dirname(path), {recursive: true});
            if (existsSync(path) && statSync(path).size + Buffer.byteLength(line) > 4_000_000) {
                rmSync(`${path}.1`, {force: true});
                renameSync(path, `${path}.1`);
            }
            appendFileSync(path, line + "\n", {encoding: "utf8", mode: 0o600});
        } catch {
            /* Logging is best effort, with no plaintext fallback. */
        }
    };
}
