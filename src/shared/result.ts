export type ErrorCode =
    | "INVALID_INPUT"
    | "FORBIDDEN"
    | "NO_CREDENTIAL"
    | "CREDENTIAL_UNAVAILABLE"
    | "STORAGE_ERROR"
    | "BUSY"
    | "AUTH"
    | "PERMISSION"
    | "NOT_FOUND"
    | "RATE_LIMIT"
    | "NETWORK"
    | "TIMEOUT"
    | "SERVER"
    | "API_ERROR"
    | "INVALID_RESPONSE"
    | "UNKNOWN_WORD"
    | "INTERNAL"
    | "SHORTCUT_CONFLICT"
    | "AI_CONFIG"
    | "AI_KEY"
    | "AI_AUTH"
    | "AI_MODEL"
    | "AI_RATE_LIMIT"
    | "AI_NETWORK"
    | "AI_TIMEOUT"
    | "AI_SERVER"
    | "AI_FORMAT"
    | "AI_REFUSAL"
    | "AI_EMPTY"
    | "AI_TRUNCATED"
    | "AI_CANCELLED"
    | "AI_STORAGE"
    | "AI_UNSUPPORTED"
    | "AI_BUSY"
    | "AI_QUOTA";

export interface AppError {
    code: ErrorCode;
    message: string;
}
export type Result<T> = {ok: true; data: T} | {ok: false; error: AppError};
