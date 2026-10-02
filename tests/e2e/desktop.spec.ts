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
  await expect(page.getByRole('status')).toHaveText('Token 已加密保存，验证通过。')
  await page.getByRole('button', { name: '查词', exact: true }).click()
  await expect(page.getByRole('button', { name: '配置个人 Token', exact: true })).toHaveCount(0)
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

test('settings developer-tools button opens DevTools without debug key bindings', async () => {
  const windowId = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.id)
  const opened = () => app.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id)!.webContents.isDevToolsOpened(), windowId)
  const key = (keyCode: string, modifiers: ('control' | 'shift')[] = []) => app.evaluate(({ BrowserWindow }, input) => {
    const contents = BrowserWindow.fromId(input.id)!.webContents
    contents.sendInputEvent({ type: 'keyDown', keyCode: input.keyCode, modifiers: input.modifiers })
    contents.sendInputEvent({ type: 'keyUp', keyCode: input.keyCode, modifiers: input.modifiers })
  }, { id: windowId, keyCode, modifiers })
  expect(await opened()).toBe(false)
  await key('F12'); await key('I', ['control', 'shift'])
  await page.getByRole('button', { name: '设置', exact: true }).click()
  expect(await opened()).toBe(false)
  await page.getByRole('button', { name: '开发者工具', exact: true }).click()
  await expect.poll(opened).toBe(true)
  await app.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id)!.webContents.closeDevTools(), windowId)
  await expect.poll(opened).toBe(false)
  await page.getByRole('button', { name: '开发者工具', exact: true }).click()
  await expect.poll(opened).toBe(true)
})

test('encrypted credentials, sandboxed bridge, candidate selection, keyboard addition and reload', async () => {
  await expect(page.getByRole('button', { name: '配置个人 Token', exact: true })).toBeVisible()
  await configure()
  const persisted = await readFile(join(userData, 'credentials.v1.json'), 'utf8')
  expect(persisted).not.toContain('momo-e2e-dummy-token')
  expect(await page.evaluate(() => ({ node: typeof (window as unknown as { require?: unknown }).require,
    methods: Object.keys(window.desktop), credentials: Object.keys(window.desktop.credentials) })))
    .toEqual({ node: 'undefined', methods: ['ai', 'analysis', 'credentials', 'vocabulary', 'study', 'history', 'desktop'], credentials: ['status', 'save', 'clear', 'copy', 'reveal', 'validate'] })
  expect(await page.evaluate(() => typeof (window as unknown as { process?: unknown }).process)).toBe('undefined')
  expect(await page.evaluate(() => window.desktop.study.add('invented'))).toMatchObject({ ok: false, error: { code: 'UNKNOWN_WORD' } })
  expect(await page.evaluate(() => window.desktop.vocabulary.lookup(''))).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } })
  await query('multiple')
  await expect(page.getByRole('radio')).toHaveCount(2)
  await expect(page.locator('.word-card').nth(0)).toContainText('n. 苹果')
  await expect(page.locator('.word-card').nth(0)).toContainText('n. 苹果树')
  await expect(page.locator('.word-card').nth(0)).toContainText('英 /ˈæpl/')
  await expect(page.getByText('释义、音标与发音由 UAPI 提供，点击音标或喇叭播放。')).toBeVisible()
  await expect(page.locator('.word-card').nth(1)).toContainText('暂无可用释义')
  await expect(page.getByRole('button', { name: '加入学习规划' })).toBeDisabled()
  await page.locator('.word-card').nth(1).click()
  await expect(page.getByRole('radio').nth(1)).toBeChecked()
  await page.getByRole('button', { name: '查询学习记录' }).click()
  await expect(page.getByRole('status')).toContainText('暂未查到学习记录')
  await expect(page.getByRole('button', { name: '加入学习规划' })).toBeEnabled()
  await page.getByRole('textbox', { name: '单词拼写' }).press('Control+Enter')
  await expect(page.getByRole('status')).toHaveText('已加入学习规划')
  expect(await writes()).toBe(1)
  await page.screenshot({ path: 'test-results/m1-search.png', fullPage: true })
  await page.getByRole('button', { name: '设置', exact: true }).click()
  await expect(page.getByLabel('个人 Token')).toHaveAttribute('type', 'password')
  await expect(page.getByLabel('个人 Token')).not.toBeEditable()
  await page.screenshot({ path: 'test-results/m1-settings.png', fullPage: true })
  await app.close()
  await launch()
  await expect.poll(() => page.evaluate(() => window.desktop.credentials.status())).toMatchObject({ ok: true, data: { configured: true } })
  await expect(page.getByRole('button', { name: '配置个人 Token', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: '设置', exact: true }).click()
  await expect(page.getByText('已配置', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '清除', exact: true }).click()
  await expect(page.getByText('尚未配置')).toBeVisible()
  await page.getByRole('button', { name: '查词', exact: true }).click()
  await expect(page.getByRole('button', { name: '配置个人 Token', exact: true })).toBeVisible()
})

test('pronunciation requests audio only on click, supports both accents and retries failures', async () => {
  const requests: URL[] = []
  // A short silent WAV exercises the real browser media pipeline without network or audible test noise.
  const samples = 1600
  const wav = Buffer.alloc(44 + samples * 2)
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8)
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22)
  wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32)
  wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(samples * 2, 40)
  let fail = false
  await page.route('https://uapis.cn/api/v1/dictionary/audio?**', async route => {
    requests.push(new URL(route.request().url()))
    expect(route.request().headers()).not.toHaveProperty('authorization')
    expect(route.request().headers()).not.toHaveProperty('origin')
    await route.fulfill({ status: fail ? 404 : 200, contentType: fail ? 'application/json' : 'audio/wav',
      body: fail ? '{}' : wav })
  })
  await configure()
  await query('multiple')
  const uk = page.getByRole('button', { name: '播放 apple 的英式发音' })
  const us = page.getByRole('button', { name: '播放 apple 的美式发音' })
  await expect(uk).toBeVisible()
  expect(requests).toHaveLength(0)
  await uk.locator('span').first().click()
  await expect.poll(() => requests.length).toBe(1)
  expect(requests[0]!.searchParams.get('accent')).toBe('uk')
  expect(requests[0]!.searchParams.get('word')).toBe('apple')
  await expect(uk).toHaveAttribute('aria-busy', 'false')
  await expect(page.locator('.audio-error')).toHaveCount(0)
  await expect(page.getByRole('radio').first()).not.toBeChecked()
  fail = true
  await us.locator('svg').click()
  await expect(page.locator('.audio-error')).toContainText('发音')
  expect(requests.at(-1)!.searchParams.get('accent')).toBe('us')
  fail = false
  await us.focus()
  await page.keyboard.press('Enter')
  await expect.poll(() => requests.length).toBe(3)
  await expect(us).toHaveAttribute('aria-busy', 'false')
  await expect(page.locator('.audio-error')).toHaveCount(0)
  await page.screenshot({ path: 'test-results/pronunciation.png', fullPage: true })
})

test('live UAPI audio plays in the packaged file renderer without CORS headers', async () => {
  test.skip(process.env.MOMO_LIVE_AUDIO !== '1', 'Opt-in live public audio check')
  await configure()
  await query('apple')
  await page.evaluate(() => {
    const original = HTMLMediaElement.prototype.play
    HTMLMediaElement.prototype.play = function () {
      this.muted = true
      return original.call(this).then(() => {
        document.body.dataset.audioPlayed = String(Number(document.body.dataset.audioPlayed ?? '0') + 1)
      })
    }
  })
  for (const [accent, name, count] of [['uk', '英式', '1'], ['us', '美式', '2']] as const) {
    const response = page.waitForResponse(response => response.url().includes(`/dictionary/audio?word=apple&accent=${accent}`))
    await page.getByRole('button', { name: `播放 apple 的${name}发音` }).click()
    expect((await response).status()).toBe(200)
    await expect(page.locator('body')).toHaveAttribute('data-audio-played', count)
    await expect(page.locator('.audio-error')).toHaveCount(0)
  }
})

test('search automatically checks study records again on each query', async () => {
  await configure()
  await query('apple')
  await expect(page.locator('.study-status')).toContainText('暂未查到学习记录')
  await expect(page.getByText('墨墨词条', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '加入学习规划' })).toBeEnabled()
  expect(await writes()).toBe(0)
  await mode('present')
  await page.getByRole('button', { name: '查询', exact: true }).click()
  await expect(page.locator('.study-status')).toContainText('已在学习规划中')
  await expect(page.getByRole('button', { name: '加入学习规划' })).toBeDisabled()
})

test('UAPI failure keeps matched words selectable and permits adding to Maimemo', async () => {
  await configure()
  await mode('definition-error')
  await query('apple')
  await expect(page.locator('.word-card')).toContainText('UAPI 请求过于频繁或免费额度不足')
  await expect(page.getByRole('button', { name: '加入学习规划' })).toBeEnabled()
  await page.getByRole('button', { name: '加入学习规划' }).click()
  await expect(page.getByRole('status')).toHaveText('已加入学习规划')
  expect(await writes()).toBe(1)
})

test('a word missing from UAPI is still queried and added through Maimemo', async () => {
  await configure()
  await query('uapi-missing')
  await expect(page.locator('.word-card')).toContainText('uapi-missing')
  await expect(page.locator('.word-card')).toContainText('暂无可用释义')
  await expect(page.getByRole('button', { name: '加入学习规划' })).toBeEnabled()

  const calls = await app.evaluate(() => (globalThis as unknown as {
    momoMock: { calls: Array<{ path: string; body?: { spellings?: string[] } }> }
  }).momoMock.calls)
  expect(calls).toEqual(expect.arrayContaining([
    expect.objectContaining({ path: '/open/api/v1/memo/vocabulary/query', body: { spellings: ['uapi-missing'] } }),
    expect.objectContaining({ path: '/api/v1/dictionary/lookup' })
  ]))

  await page.getByRole('button', { name: '加入学习规划' }).click()
  await expect(page.getByRole('status')).toHaveText('已加入学习规划')
  expect(await writes()).toBe(1)
})

test('saved Token can be revealed, concealed and replaced without saving on view', async () => {
  test.setTimeout(60_000)
  await configure()
  const credentialPath = join(userData, 'credentials.v1.json')
  const original = await readFile(credentialPath, 'utf8')
  await page.getByRole('button', { name: '设置', exact: true }).click()
  const saved = page.getByLabel('个人 Token')
  await expect(saved).toHaveAttribute('type', 'password')
  await expect(saved).not.toHaveValue('momo-e2e-dummy-token')
  await page.getByRole('button', { name: '显示 Token', exact: true }).click()
  await expect(saved).toHaveAttribute('type', 'text')
  await expect(saved).toHaveValue('momo-e2e-dummy-token')
  await page.getByRole('button', { name: '隐藏 Token', exact: true }).click()
  await expect(saved).toHaveAttribute('type', 'password')
  await expect(saved).not.toHaveValue('momo-e2e-dummy-token')
  await page.getByRole('button', { name: '显示 Token', exact: true }).click()
  await expect(saved).toHaveValue('momo-e2e-dummy-token')
  await page.evaluate(() => window.dispatchEvent(new Event('blur')))
  await expect(saved).toHaveAttribute('type', 'password')
  await expect(saved).not.toHaveValue('momo-e2e-dummy-token')
  await page.getByRole('button', { name: '显示 Token', exact: true }).click()
  await expect(saved).toHaveValue('momo-e2e-dummy-token')
  await page.getByRole('button', { name: '查词', exact: true }).click()
  await page.getByRole('button', { name: '设置', exact: true }).click()
  await expect(saved).toHaveAttribute('type', 'password')
  await expect(saved).not.toHaveValue('momo-e2e-dummy-token')
  await page.getByRole('button', { name: '更换 Token' }).click()
  const draft = page.getByLabel('替换 Token')
  await expect(draft).toHaveValue('')
  await draft.fill('replacement-dummy-token')
  await page.getByRole('button', { name: '显示 Token', exact: true }).click()
  await expect(draft).toHaveAttribute('type', 'text')
  await expect(draft).toHaveValue('replacement-dummy-token')
  await page.getByRole('button', { name: '取消', exact: true }).click()
  await page.getByRole('button', { name: '显示 Token', exact: true }).click()
  await expect(saved).toHaveValue('momo-e2e-dummy-token')
  expect(await readFile(credentialPath, 'utf8')).toBe(original)
  await page.getByRole('button', { name: '更换 Token' }).click()
  await draft.fill('replacement-dummy-token')
  await page.getByRole('button', { name: '保存 Token' }).click()
  await expect(page.getByRole('status')).toHaveText('Token 已加密保存，验证通过。')
  await expect(saved).toHaveAttribute('type', 'password')
  await page.getByRole('button', { name: '显示 Token', exact: true }).click()
  await expect(saved).toHaveValue('replacement-dummy-token')
  const replaced = await readFile(credentialPath, 'utf8')
  expect(replaced).not.toBe(original)
  expect(replaced).not.toContain('replacement-dummy-token')
})

for (const failure of ['auth', 'offline']) {
  test(`Token validation reports ${failure} without adding words or showing first-use instructions`, async () => {
    await mode(failure)
    await page.getByRole('button', { name: '设置', exact: true }).click()
    await page.getByLabel('输入 Token').fill('validation-dummy-token')
    await page.getByRole('button', { name: '保存 Token' }).click()
    await expect(page.getByRole('status')).toContainText(failure === 'auth' ? '验证失败：Token 无效或已过期' : '暂时无法完成验证：网络连接中断')
    expect(await page.evaluate(() => window.desktop.credentials.status())).toMatchObject({ ok: true, data: { configured: true, invalid: failure === 'auth', verified: false } })
    expect(await writes()).toBe(0)
    await page.getByRole('button', { name: '查词', exact: true }).click()
    await expect(page.getByRole('button', { name: '配置个人 Token', exact: true })).toHaveCount(0)
    if (failure === 'offline') {
      await mode('added')
      await page.getByRole('button', { name: '设置', exact: true }).click()
      await page.getByRole('button', { name: '验证 Token', exact: true }).click()
      await expect(page.getByRole('status')).toHaveText('Token 验证通过。')
      await expect(page.getByText('已验证', { exact: true })).toBeVisible()
      expect(await writes()).toBe(0)
    }
  })
}

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
