export type AiProtocol = "openai" | "gemini";
export type OutputMode = "text" | "json" | "schema";
export interface AiOptions {
    outputMode: OutputMode;
    timeoutSeconds: number;
}
export interface AiProfile {
    id: string;
    name: string;
    protocol: AiProtocol;
    baseUrl: string;
    model: string;
    options: AiOptions;
    revision: number;
    hasKey: boolean;
    authInvalid: boolean;
    updatedAt: string;
}
export interface AiProfileInput {
    id?: string;
    name: string;
    protocol: AiProtocol;
    baseUrl: string;
    model: string;
    options: AiOptions;
    key?: string;
}
export interface AiConfiguration {
    profiles: AiProfile[];
    activeId: string | null;
    supplement: string;
}
export interface AiTemplate {
    name: string;
    protocol: AiProtocol;
    baseUrl: string;
    model: string;
}
export interface AiUsage {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
}
export interface AiTestResult {
    attempts: number;
    mode: OutputMode;
    message: string;
}
