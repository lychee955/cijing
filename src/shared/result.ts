export type ErrorCode =
  | 'INVALID_INPUT' | 'FORBIDDEN' | 'NO_CREDENTIAL' | 'CREDENTIAL_UNAVAILABLE'
  | 'STORAGE_ERROR' | 'BUSY' | 'AUTH' | 'PERMISSION' | 'NOT_FOUND'
  | 'RATE_LIMIT' | 'NETWORK' | 'TIMEOUT' | 'SERVER' | 'API_ERROR'
  | 'INVALID_RESPONSE' | 'UNKNOWN_WORD' | 'INTERNAL' | 'SHORTCUT_CONFLICT'

export interface AppError { code: ErrorCode; message: string }
export type Result<T> = { ok: true; data: T } | { ok: false; error: AppError }
