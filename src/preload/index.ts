import { contextBridge, ipcRenderer } from 'electron'
import { channels, type DesktopApi } from '../shared/contracts'

const api: DesktopApi = {
  updates: {
    status: () => ipcRenderer.invoke(channels.updateStatus), check: () => ipcRenderer.invoke(channels.updateCheck),
    download: () => ipcRenderer.invoke(channels.updateDownload), install: () => ipcRenderer.invoke(channels.updateInstall),
    openRelease: () => ipcRenderer.invoke(channels.updateOpenRelease),
    onChanged: callback => {
      const listener = (_event: Electron.IpcRendererEvent, status: import('../shared/update').UpdateStatus) => callback(status)
      ipcRenderer.on(channels.updateChanged, listener)
      return () => ipcRenderer.removeListener(channels.updateChanged, listener)
    }
  },
  ai: {
    configuration: () => ipcRenderer.invoke(channels.aiConfig), templates: () => ipcRenderer.invoke(channels.aiTemplates),
    save: input => ipcRenderer.invoke(channels.aiSave, input), delete: id => ipcRenderer.invoke(channels.aiDelete, id),
    select: id => ipcRenderer.invoke(channels.aiSelect, id), supplement: value => ipcRenderer.invoke(channels.aiSupplement, value), test: id => ipcRenderer.invoke(channels.aiTest, id)
  },
  analysis: {
    run: request => ipcRenderer.invoke(channels.analysisRun, request), cancel: id => ipcRenderer.invoke(channels.analysisCancel, id),
    history: (offset, limit) => ipcRenderer.invoke(channels.analysisHistory, offset, limit), get: id => ipcRenderer.invoke(channels.analysisGet, id), delete: id => ipcRenderer.invoke(channels.analysisDelete, id)
  },
  credentials: {
    status: () => ipcRenderer.invoke(channels.credentialStatus),
    save: token => ipcRenderer.invoke(channels.credentialSave, token),
    clear: () => ipcRenderer.invoke(channels.credentialClear),
    copy: () => ipcRenderer.invoke(channels.credentialCopy),
    reveal: () => ipcRenderer.invoke(channels.credentialReveal),
    validate: () => ipcRenderer.invoke(channels.credentialValidate)
  },
  vocabulary: { lookup: spelling => ipcRenderer.invoke(channels.lookup, spelling) },
  study: {
    add: id => ipcRenderer.invoke(channels.add, id),
    confirm: id => ipcRenderer.invoke(channels.confirm, id)
  },
  history: {
    list: query => ipcRenderer.invoke(channels.historyList, query),
    confirm: id => ipcRenderer.invoke(channels.historyConfirm, id)
  },
  desktop: {
    status: () => ipcRenderer.invoke(channels.desktopStatus),
    save: settings => ipcRenderer.invoke(channels.desktopSave, settings),
    hide: () => ipcRenderer.invoke(channels.desktopHide),
    quit: () => ipcRenderer.invoke(channels.desktopQuit),
    devTools: () => ipcRenderer.invoke(channels.desktopDevTools),
    onNavigate: callback => {
      const listener = (_event: Electron.IpcRendererEvent, page: import('../shared/models').PageName) => callback(page)
      ipcRenderer.on(channels.navigate, listener)
      return () => ipcRenderer.removeListener(channels.navigate, listener)
    },
    onChanged: callback => {
      const listener = () => callback()
      ipcRenderer.on(channels.changed, listener)
      return () => ipcRenderer.removeListener(channels.changed, listener)
    }
  }
}
contextBridge.exposeInMainWorld('desktop', api)
