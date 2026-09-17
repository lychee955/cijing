// Separate test entry: never imported or bundled by the real application.
const { app, net, BrowserWindow, globalShortcut, nativeImage } = require('electron')
const { join } = require('node:path')
if (!process.env.MOMO_TEST_USER_DATA) throw new Error('Isolated test directory required')
app.setPath('userData', process.env.MOMO_TEST_USER_DATA)
globalThis.momoMock = { mode: process.env.MOMO_TEST_MODE || 'added', calls: [], shows: 0, hides: 0, shortcuts: {} }
BrowserWindow.prototype.show = function () { globalThis.momoMock.shows++ } // No desktop focus stealing.
BrowserWindow.prototype.focus = function () {}
const originalHide = BrowserWindow.prototype.hide
BrowserWindow.prototype.hide = function () { globalThis.momoMock.hides++; return originalHide.call(this) }
const originalRegister = globalShortcut.register.bind(globalShortcut)
globalShortcut.register = (key, callback) => {
  if (process.env.MOMO_TEST_SHORTCUT_FAIL || key === 'Control+Alt+F12') return false
  const success = originalRegister(key, callback)
  if (success) globalThis.momoMock.shortcuts[key] = callback
  return success
}
if (process.env.MOMO_TEST_TRAY_FAIL) nativeImage.createFromBitmap = () => { throw new Error('Simulated missing tray') }
net.fetch = async (url, init) => {
  const path = new URL(url).pathname
  if (new URL(url).origin === 'https://uapis.cn' && path === '/api/v1/dictionary/lookup') {
    if (init.headers.Authorization) throw new Error('Maimemo credentials leaked to dictionary')
    globalThis.momoMock.calls.push({ path, word: new URL(url).searchParams.get('word') })
    if (globalThis.momoMock.mode === 'definition-error') return new Response('{}', { status: 429 })
    const word = new URL(url).searchParams.get('word')
    return new Response(JSON.stringify(word === 'apple' ? {
      found: true, entry: { word, definitions: [{ meaning: 'n. 苹果' }, { part_of_speech: 'n.', meaning: '苹果树' }],
        phonetics: { uk: { text: 'ˈæpl' }, us: { text: 'ˈæpəl' } } }
    } : { found: false }))
  }
  if (!url.startsWith('https://open.maimemo.com/open/api/v1/memo/')) throw new Error('Unexpected host')
  const body = init.body ? JSON.parse(init.body) : null
  globalThis.momoMock.calls.push({ path, body })
  await new Promise(resolve => setTimeout(resolve, 40))
  if (globalThis.momoMock.mode === 'auth') return new Response('{}', { status: 401 })
  if (globalThis.momoMock.mode === 'offline') throw new TypeError('Simulated offline connection')
  if (globalThis.momoMock.mode === 'rate') return new Response('{}', { status: 429, headers: { 'Retry-After': '60' } })
  let data
  if (path.endsWith('/vocabulary/query')) {
    const spelling = body.spellings[0]
    data = { voc: spelling === 'unknown' ? [] : spelling === 'multiple'
      ? [{ id: 'v1', spelling: 'apple' }, { id: 'v2', spelling: 'Apple' }]
      : [{ id: spelling === 'apple' ? 'v1' : 'v-' + spelling.replace(/[^a-zA-Z0-9]/g, '_'), spelling }] }
  } else if (path.endsWith('/interpretations')) {
    if (globalThis.momoMock.mode === 'definition-error') return new Response('{}', { status: 403 })
    const id = new URL(url).searchParams.get('voc_id')
    data = { interpretations: id === 'v1' ? [{ interpretation: 'n. 苹果' }, { interpretation: 'n. 苹果树' }] : [] }
  } else if (path.endsWith('/study/add_words')) {
    if (globalThis.momoMock.mode === 'uncertain') throw new TypeError('Simulated connection loss')
    if (globalThis.momoMock.mode === 'pending') return new Promise(() => {})
    data = { added_count: globalThis.momoMock.mode === 'zero' ? 0 : 1 }
  } else if (path.endsWith('/study/query_study_records')) {
    data = { records: globalThis.momoMock.mode === 'present' ? [{ voc_id: body.voc_ids[0] }] : [], count: 0 }
  } else throw new Error('Unexpected endpoint')
  return new Response(JSON.stringify({ success: true, data, errors: [] }), { status: 200 })
}
require(join(__dirname, '../../out/main/index.js'))
