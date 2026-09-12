import { contextBridge, ipcRenderer } from 'electron'
import { channels, type DesktopApi } from '../shared/contracts'

const api: DesktopApi = {
  credentials: {
    status: () => ipcRenderer.invoke(channels.credentialStatus),
    save: token => ipcRenderer.invoke(channels.credentialSave, token),
    clear: () => ipcRenderer.invoke(channels.credentialClear),
    copy: () => ipcRenderer.invoke(channels.credentialCopy)
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
