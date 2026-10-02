import type { AppError, ErrorCode, Result } from '../../shared/result'

const messages: Partial<Record<ErrorCode, string>> = {
  INVALID_INPUT: '输入不符合要求，请检查后重试。',
  FORBIDDEN: '请求来源不受信任。',
  NO_CREDENTIAL: '请先在设置中保存 Token。',
  CREDENTIAL_UNAVAILABLE: '系统凭证加密不可用，或保存的凭证无法解密，请检查系统密钥存储。',
  STORAGE_ERROR: '本地数据读写失败，请检查应用数据目录权限及磁盘空间。',
  SHORTCUT_CONFLICT: '快捷键已被占用或系统不支持，原快捷键保持不变。',
  BUSY: '请求正在处理，请稍后再操作。',
  AUTH: 'Token 无效或已过期，请在设置中更新。',
  PERMISSION: 'Token 没有此操作权限，请检查开放 API 权限。',
  NOT_FOUND: '未找到对应词条或资源。',
  RATE_LIMIT: '请求过于频繁，请稍后重试。',
  NETWORK: '网络连接中断，请检查网络。',
  TIMEOUT: '请求超时，请稍后确认状态。',
  SERVER: '墨墨服务暂时不可用，请稍后重试。',
  API_ERROR: '墨墨接口返回业务错误，请检查账号权限或稍后重试。',
  INVALID_RESPONSE: '接口响应格式与预期不符，无法确认结果。',
  UNKNOWN_WORD: '请先查询并选择当前账号下返回的词条。',
  INTERNAL: '操作未完成，请重试。'
}

export class ClientError extends Error {
  constructor(public readonly code: ErrorCode, public readonly ambiguous = false) {
    super(messages[code] ?? '操作未完成，请重试。')
  }
}

export function publicError(error: unknown): AppError {
  const code = error instanceof ClientError ? error.code : 'INTERNAL'
  return { code, message: messages[code] ?? '操作未完成，请重试。' }
}

export async function resultOf<T>(action: () => T | Promise<T>): Promise<Result<T>> {
  try { return { ok: true, data: await action() } }
  catch (error) { return { ok: false, error: publicError(error) } }
}
