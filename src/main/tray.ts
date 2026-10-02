import { Menu, Tray } from 'electron'
import type { PageName } from '../shared/models'
import { trayIcon } from './icon'
import brand from '../shared/brand.json'

export function createTray(reveal: (page: PageName) => void, quit: () => void): Tray | null {
  let tray: Tray | null = null
  try {
    tray = new Tray(trayIcon())
    tray.setToolTip(brand.title)
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: '查词', click: () => reveal('search') },
      { label: '最近添加记录', click: () => reveal('history') },
      { label: '设置', click: () => reveal('settings') },
      { type: 'separator' }, { label: `退出${brand.name}`, click: quit }
    ]))
    tray.on('click', () => reveal('search'))
    tray.on('double-click', () => reveal('search'))
    return tray
  } catch { tray?.destroy(); return null }
}
