// Explicit real-service verification. Never used by automated tests or the app.
const { join, resolve, dirname, basename } = require('node:path')
const { mkdtempSync, copyFileSync, existsSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { spawnSync } = require('node:child_process')
const root = join(__dirname, '..')
const args = process.argv.slice(2)
if (!args.includes('--profile') || !args.includes('--model')) {
  console.error('用法：node scripts/verify-ai.cjs --profile 配置名称 --model 模型ID [--quality]')
  process.exit(1)
}
const esbuild = require(join(root, 'node_modules/vite/node_modules/esbuild'))
const target = join(root, 'out/live-ai.cjs')
esbuild.buildSync({
  entryPoints: [join(__dirname, 'verify-ai-entry.ts')], outfile: target, bundle: true,
  platform: 'node', format: 'cjs', external: ['electron', 'better-sqlite3', 'zod'], logLevel: 'error'
})
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
// Windows OSCrypt uses the application's Local State encryption key. Copy its
// encrypted metadata to an isolated directory so the real app is never mutated.
const verificationData = mkdtempSync(join(tmpdir(), 'momo-ai-verification-'))
if (process.platform === 'win32') {
  const localState = join(process.env.APPDATA, 'momo-desktop', 'Local State')
  if (existsSync(localState)) copyFileSync(localState, join(verificationData, 'Local State'))
}
const result = spawnSync(require('electron'), [target, ...args, '--verification-data', verificationData], { cwd: root, env, stdio: 'inherit', windowsHide: true })
if (result.status !== 0) console.error(`真实验证未完成（进程状态 ${result.status ?? result.signal ?? '未知'}），详情见验收文件或应用配置。`)
const checkedData = resolve(verificationData)
if (dirname(checkedData) === resolve(tmpdir()) && basename(checkedData).startsWith('momo-ai-verification-')) rmSync(checkedData, { recursive: true, force: true })
if (result.error) console.error('无法启动真实 AI 验证，请检查 Electron 安装。')
process.exit(result.status ?? 1)
