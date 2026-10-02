import { app, net, safeStorage } from 'electron'
import Database from 'better-sqlite3'
import { join } from 'node:path'
import { mkdirSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { OperationsDatabase } from '../src/main/storage/database'
import { AiStore } from '../src/main/storage/ai-store'
import { AnalysisService } from '../src/main/services/analysis-service'
import { aiResult } from '../src/main/ai/errors'

const option = (name: string) => { const at = process.argv.indexOf(name); return at >= 0 ? process.argv[at + 1] : undefined }
const verificationData = option('--verification-data')
if (verificationData) { app.setPath('userData', verificationData); app.setPath('sessionData', verificationData) }
const samples = [
  'She reads a book every night.', 'The soup tastes delicious.', 'He gave me a book.', 'They elected her president.',
  'The book that you lent me is fascinating.', 'What she said surprised everyone.', 'Although it was raining, we went out.',
  'Seeing the danger, he ran away.', 'I wanted to stay, but she decided to leave.', 'Never have I seen such a beautiful sunset.',
  'It was John who broke the window.', 'I saw the man with a telescope.', 'Anna gave Mary a book. She thanked her.',
  'He go to school every day.', 'I think that that idea works.', 'She has, as you know, finished the work.',
  'I know that you said that birds sing.'
]
void app.whenReady().then(async () => {
  console.info('正在读取已保存的指定 AI 配置…')
  const name = option('--profile'), model = option('--model')
  if (!name || !model) throw new Error('missing selection')
  // Read the user's configuration only. All verification writes use an in-memory database.
  const existing = new Database(join(app.getPath('appData'), 'momo-desktop', 'momo.sqlite3'), { readonly: true, fileMustExist: true })
  const row = existing.prepare('SELECT * FROM ai_profiles WHERE name=? AND model=?').all(name, model) as Record<string, unknown>[]
  if (row.length !== 1) { existing.close(); console.error('配置名称与模型 ID 必须匹配唯一的已保存配置。'); app.exit(1); return }
  const supplement = existing.prepare("SELECT value FROM settings WHERE key='aiSupplement'").get() as { value: string } | undefined
  const database = new OperationsDatabase(':memory:'), store = new AiStore(database, safeStorage)
  const columns = ['id', 'name', 'protocol', 'base_url', 'model', 'options', 'ciphertext', 'revision', 'auth_invalid', 'created_at', 'updated_at']
  database.connection.prepare(`INSERT INTO ai_profiles (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`).run(...columns.map(c => row[0]![c]))
  existing.close(); store.select(row[0]!.id as string)
  if (supplement) store.supplement(JSON.parse(supplement.value))
  const service = new AnalysisService(store, (url, init) => net.fetch(url, init))
  const report: Record<string, unknown> = { testedAt: new Date().toISOString(), profile: name, model, connection: await aiResult(() => service.test(row[0]!.id as string)), analyses: [] }
  console.info(`连接测试：${(report.connection as { ok: boolean }).ok ? '通过' : '未通过'}`)
  const analyses = report.analyses as unknown[]
  if ((report.connection as { ok: boolean }).ok) {
    const inputs = process.argv.includes('--quality') ? samples : [samples[4]!, samples[12]!]
    for (const text of inputs) {
      const result = await aiResult(() => service.analyze({ requestId: randomUUID(), text, force: true }))
      analyses.push({ text, result })
      console.info(`公开样例 ${analyses.length}/${inputs.length}：${result.ok ? '结构校验通过' : result.error.code}`)
      if (!result.ok) break // No unlimited retry or provider fallback.
    }
  }
  const reportPath = join(process.cwd(), 'test-results', 'ai-live-verification.json')
  mkdirSync(join(process.cwd(), 'test-results'), { recursive: true }); writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8')
  database.close()
  console.info(JSON.stringify({ reportPath, connection: (report.connection as { ok: boolean }).ok, analyses: analyses.length }))
  app.exit((report.connection as { ok: boolean }).ok && analyses.every(a => (a as { result: { ok: boolean } }).result.ok) ? 0 : 1)
}).catch(() => { console.error('无法读取已保存的 AI 配置或系统密钥。请先在应用设置中保存配置。'); app.exit(1) })
