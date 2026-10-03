import { app, dialog, globalShortcut, net, safeStorage, session, type Tray } from 'electron'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'
import { MaimemoClient } from './maimemo/client'
import { UapiDictionary } from './dictionary/uapi'
import { CredentialStore } from './storage/credential-store'
import { OperationsDatabase } from './storage/database'
import { SettingsStore } from './storage/settings'
import { VocabularyService } from './services/vocabulary-service'
import { StudyService } from './services/study-service'
import { SessionService } from './services/session-service'
import { registerIpc, type DesktopControls } from './ipc'
import { ShortcutManager } from './shortcuts'
import { WindowManager } from './windows'
import { createTray } from './tray'
import { channels } from '../shared/contracts'
import { AiStore } from './storage/ai-store'
import { AnalysisService } from './services/analysis-service'
import { registerAnalysisIpc } from './ipc/analysis'
import { createAiLogger } from './ai/logging'
import brand from '../shared/brand.json'
import { DATABASE_FILENAME, resolveDataPath } from './storage/data-path'

let windows: WindowManager | undefined
let tray: Tray | null = null
let database: OperationsDatabase | undefined
let shortcuts: ShortcutManager | undefined
let analysis: AnalysisService | undefined
app.setName(brand.packageName)
const dataPath = resolveDataPath(app.getPath('appData'), app.getPath('userData'))
if (dataPath !== app.getPath('userData')) { app.setPath('userData', dataPath); app.setPath('sessionData', dataPath) }
const locked = app.requestSingleInstanceLock()
if (!locked) app.quit()
else {
  app.on('second-instance', () => windows?.reveal('search'))
  app.on('activate', () => windows?.reveal('search'))
  void app.whenReady().then(() => {
    app.setAppUserModelId(brand.appId)
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
    session.defaultSession.setPermissionCheckHandler(() => false)
    mkdirSync(app.getPath('userData'), { recursive: true })
    database = new OperationsDatabase(join(app.getPath('userData'), DATABASE_FILENAME))
    database.recoverInterrupted()
    const settings = new SettingsStore(database)
    const credentials = new CredentialStore(join(app.getPath('userData'), 'credentials.v1.json'), safeStorage)
    const client = new MaimemoClient((url, init) => net.fetch(url, init), undefined, undefined,
      entry => console.info('[api]', JSON.stringify(entry)))
    const vocabulary = new VocabularyService(client, new UapiDictionary((url, init) => net.fetch(url, init)))
    const study = new StudyService(client, undefined, database)
    const changed = () => {
      if (windows && !windows.window.isDestroyed()) windows.window.webContents.send(channels.changed)
    }
    const account = new SessionService(credentials, database, vocabulary, study, changed)
    account.initialize()
    // Linux tray construction does not prove that the desktop has a visible tray host.
    const hideSupported = () => process.platform !== 'linux' && !!tray && !tray.isDestroyed()
    windows = new WindowManager(settings, hideSupported)
    tray = createTray(page => windows?.reveal(page), () => app.quit())
    shortcuts = new ShortcutManager(globalShortcut, () => windows?.reveal('search'))
    try { shortcuts.change(settings.read().shortcut, () => {}) }
    catch { console.info('[desktop] shortcut-unavailable') }
    const desktop: DesktopControls = {
      status: () => ({ settings: settings.read(), shortcutRegistered: shortcuts!.available,
        trayAvailable: !!tray && !tray.isDestroyed(), hideSupported: hideSupported(), recovering: account.recovering }),
      save: next => {
        shortcuts!.change(next.shortcut, () => settings.save(next))
        windows!.applyTheme(next)
        changed()
        return desktop.status()
      },
      hide: () => windows!.hide(),
      devTools: () => windows!.window.webContents.openDevTools({ mode: 'detach' }),
      quit: () => { setTimeout(() => app.quit(), 50) }
    }
    registerIpc(windows.window, windows.allowedUrl, credentials, vocabulary, study, account, database, desktop)
    analysis = new AnalysisService(new AiStore(database, safeStorage), (url, init) => net.fetch(url, init),
      createAiLogger(join(app.getPath('userData'), 'logs', 'ai.log'), process.env.CIJING_AI_LOG_CONTENT !== '0'))
    registerAnalysisIpc(windows.window, windows.allowedUrl, analysis)
    windows.load()
    void account.recover()
  }).catch(() => {
    dialog.showErrorBox('词境启动失败', '无法初始化本地数据或桌面窗口。请检查应用数据目录权限、磁盘空间和 SQLite 原生依赖版本；已有数据不会被重置。')
    app.quit()
  })
  app.on('will-quit', () => {
    analysis?.cancel()
    shortcuts?.dispose()
    tray?.destroy()
    windows?.dispose()
    database?.close()
  })
}
