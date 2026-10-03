import type { ErrorCode, Result } from '../../shared/result'
import { redact } from './logging'

export function apiErrorDetails(status: number, body: unknown, key: string): string {
  const safe = redact(body, [key])
  const text = typeof safe === 'string' ? safe : JSON.stringify(safe, null, 2)
  const content = text?.trim() || '服务端未返回错误内容。'
  return `HTTP ${status}\n${content.length > 8000 ? content.slice(0, 8000) + '\n…内容过长，完整响应请查看日志。' : content}`
}
const messages: Partial<Record<ErrorCode, string>> = {
  AI_CONFIG: '请先保存并选择可用的 AI 配置。', AI_KEY: 'AI 密钥不可用，请重新填写；系统加密服务需可用。',
  AI_AUTH: 'AI 密钥无效或无权使用此服务，请更新该配置。', AI_MODEL: '模型不存在或当前账号无权使用，请核对模型 ID。',
  AI_RATE_LIMIT: 'AI 服务请求受限或模型繁忙，请稍后重试。', AI_QUOTA: 'AI 服务余额或额度不足，请检查账号额度和密钥预算。', AI_NETWORK: '无法连接 AI 服务，请检查网络与基础地址。',
  AI_TIMEOUT: 'AI 请求超时，输入已保留，请重试。', AI_SERVER: 'AI 服务暂时异常，请稍后重试。',
  AI_FORMAT: '返回格式不完整或原文不匹配，请重试。', AI_REFUSAL: '模型拒绝此次请求，请调整输入。',
  AI_EMPTY: '模型没有返回内容，请重试。', AI_TRUNCATED: '服务端报告生成达到输出上限，未返回完整结果。',
  AI_CANCELLED: 'AI 请求已取消。', AI_STORAGE: '无法读写 AI 本地数据，请检查磁盘和权限。',
  AI_UNSUPPORTED: '模型不支持所选输出格式，请改为 JSON 文本模式。', AI_BUSY: '已有 AI 任务正在处理，请先取消或等待完成。',
  INVALID_INPUT: '输入或配置不符合要求：最多 300 个英文单词、6,000 字符；远程地址必须为 HTTPS。', FORBIDDEN: '此页面无权调用 AI 服务。'
}
export class AiError extends Error {
  constructor(readonly code: ErrorCode, readonly attempts = 0, readonly retrySeconds?: number, readonly details?: string) { super(messages[code] ?? 'AI 操作未完成，请重试。') }
}
export async function aiResult<T>(action: () => T | Promise<T>): Promise<Result<T>> {
  try { return { ok: true, data: await action() } }
  catch (error) {
    const e = error instanceof AiError ? error : new AiError('AI_STORAGE')
    return { ok: false, error: { code: e.code, message: e.message + (e.retrySeconds ? ` 建议 ${e.retrySeconds} 秒后重试。` : '') + (e.attempts ? `（生成调用 ${e.attempts} 次）` : '') + (e.details ? `\n\n${e.code === 'AI_TRUNCATED' ? '服务返回信息' : '接口报错信息'}：\n${e.details}` : '') } }
  }
}
