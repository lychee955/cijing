import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

let app: ElectronApplication
let page: Page
let userData: string
async function launch(): Promise<void> {
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined && entry[0] !== 'ELECTRON_RUN_AS_NODE'))
  app = await electron.launch({ args: [join(process.cwd(), 'tests/e2e/bootstrap.cjs')], env: { ...env, MOMO_TEST_USER_DATA: userData } })
  page = await app.firstWindow()
  await expect(page.getByRole('heading', { name: '今天遇见了什么词？' })).toBeVisible()
}
async function configure(): Promise<void> {
  await page.getByRole('button', { name: '设置', exact: true }).click()
  await page.getByLabel('输入 Token').fill('momo-e2e-dummy-token')
  await page.getByRole('button', { name: '保存 Token' }).click()
  await expect(page.getByRole('status')).toHaveText('Token 已加密保存。')
  await page.getByRole('button', { name: '查词', exact: true }).click()
}
async function mode(value: string): Promise<void> {
  await app.evaluate((_electron, value) => {
    (globalThis as unknown as { momoMock: { mode: string } }).momoMock.mode = value
  }, value)
}
async function query(spelling: string): Promise<void> {
  await page.getByRole('textbox', { name: '单词拼写' }).fill(spelling)
  await page.getByRole('textbox', { name: '单词拼写' }).press('Enter')
}
async function writes(): Promise<number> {
  return app.evaluate(() => (globalThis as unknown as { momoMock: { calls: Array<{ path: string }> } })
    .momoMock.calls.filter(call => call.path.endsWith('/add_words')).length)
}

test.beforeEach(async () => { userData = await mkdtemp(join(tmpdir(), 'momo-e2e-')); await launch() })
test.afterEach(async () => { await app?.close(); await rm(userData, { recursive: true, force: true }) })

test('encrypted credentials, sandboxed bridge, candidate selection, keyboard addition and reload', async () => {
  await configure()
  const persisted = await readFile(join(userData, 'credentials.v1.json'), 'utf8')
  expect(persisted).not.toContain('momo-e2e-dummy-token')
  expect(await page.evaluate(() => ({ node: typeof (window as unknown as { require?: unknown }).require,
    methods: Object.keys(window.desktop), credentials: Object.keys(window.desktop.credentials) })))
    .toEqual({ node: 'undefined', methods: ['credentials', 'vocabulary', 'study', 'history', 'desktop'], credentials: ['status', 'save', 'clear', 'copy'] })
  expect(await page.evaluate(() => typeof (window as unknown as { process?: unknown }).process)).toBe('undefined')
  expect(await page.evaluate(() => window.desktop.study.add('invented'))).toMatchObject({ ok: false, error: { code: 'UNKNOWN_WORD' } })
  expect(await page.evaluate(() => window.desktop.vocabulary.lookup(''))).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } })
  await query('multiple')
  await expect(page.getByRole('radio')).toHaveCount(2)
  await expect(page.getByRole('button', { name: '加入学习规划' })).toBeDisabled()
  await page.getByRole('radio').nth(1).check()
  await page.getByRole('button', { name: '查询学习记录' }).click()
  await expect(page.getByRole('status')).toContainText('暂未查到学习记录')
  await expect(page.getByRole('button', { name: '加入学习规划' })).toBeEnabled()
  await page.getByRole('textbox', { name: '单词拼写' }).press('Control+Enter')
  await expect(page.getByRole('status')).toHaveText('已加入学习规划')
  expect(await writes()).toBe(1)
  await page.screenshot({ path: 'test-results/m1-search.png', fullPage: true })
  await page.getByRole('button', { name: '设置', exact: true }).click()
  await expect(page.getByLabel('替换 Token')).toHaveValue('')
  await page.screenshot({ path: 'test-results/m1-settings.png', fullPage: true })
  await app.close()
  await launch()
  await page.getByRole('button', { name: '设置', exact: true }).click()
  await expect(page.getByText('已保存 · ****')).toBeVisible()
  await page.getByRole('button', { name: '清除', exact: true }).click()
  await expect(page.getByText('尚未配置')).toBeVisible()
})

test('uncertain write never becomes success or gets resent; manual read can confirm presence', async () => {
  await configure(); await mode('uncertain'); await query('apple')
  await page.getByRole('button', { name: '加入学习规划' }).click()
  await expect(page.getByRole('status')).toContainText('结果待确认')
  await expect(page.getByRole('button', { name: '加入学习规划' })).toBeDisabled()
  await page.evaluate(() => window.desktop.study.add('v1'))
  expect(await writes()).toBe(1)
  await mode('present')
  await page.getByRole('button', { name: '再次确认状态' }).click()
  await expect(page.getByRole('status')).toContainText('已在学习规划中')
  expect(await writes()).toBe(1)
})

test('zero does not report success, unknown words stay empty, IME Enter cannot submit', async () => {
  await configure(); await mode('zero'); await query('apple')
  await page.getByRole('button', { name: '加入学习规划' }).click()
  await expect(page.getByRole('status')).toContainText('未新增')
  await query('unknown')
  await expect(page.getByText('没有找到对应词条')).toBeVisible()
  const input = page.getByRole('textbox', { name: '单词拼写' })
  await input.fill('apple')
  await input.dispatchEvent('compositionstart')
  await input.dispatchEvent('keydown', { key: 'Enter', isComposing: true })
  await input.dispatchEvent('compositionend')
  await expect(page.getByRole('radio')).toHaveCount(0)
  expect(await writes()).toBe(1)
})
