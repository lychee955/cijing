import { ipcMain, type BrowserWindow } from 'electron'
import { channels } from '../../shared/contracts'
import { ClientError, resultOf } from '../maimemo/errors'
import { validateSender } from './security'
import type { UpdateService } from '../updates/service'

export function registerUpdateIpc(window: BrowserWindow, allowedUrl: string, service: UpdateService): void {
  const actions = { [channels.updateStatus]: () => service.status(), [channels.updateCheck]: () => service.check(),
    [channels.updateDownload]: () => service.download(), [channels.updateInstall]: () => service.install(),
    [channels.updateOpenRelease]: () => service.openRelease() }
  for (const [channel, action] of Object.entries(actions)) ipcMain.handle(channel, (event, ...args: unknown[]) => resultOf(() => {
    validateSender({ trustedContents: event.sender === window.webContents,
      mainFrame: event.senderFrame !== null && event.senderFrame === window.webContents.mainFrame, url: event.senderFrame?.url ?? '' }, allowedUrl)
    if (args.length) throw new ClientError('INVALID_INPUT')
    return action()
  }))
  window.on('closed', () => { for (const channel of Object.keys(actions)) ipcMain.removeHandler(channel) })
}
