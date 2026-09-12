import type { AddOutcome, CredentialStatus, Vocabulary, HistoryPage, HistoryQuery, DesktopStatus, DesktopSettings, PageName } from './models'
import type { Result } from './result'

export const channels = {
  credentialStatus: 'credentials:status',
  credentialSave: 'credentials:save',
  credentialClear: 'credentials:clear',
  credentialCopy: 'credentials:copy',
  lookup: 'vocabulary:lookup',
  add: 'study:add',
  confirm: 'study:confirm',
  historyList: 'history:list',
  historyConfirm: 'history:confirm',
  desktopStatus: 'desktop:status',
  desktopSave: 'desktop:save',
  desktopHide: 'desktop:hide',
  desktopQuit: 'desktop:quit',
  navigate: 'desktop:navigate',
  changed: 'app:changed'
} as const

export interface DesktopApi {
  credentials: {
    status(): Promise<Result<CredentialStatus>>
    save(token: string): Promise<Result<void>>
    clear(): Promise<Result<void>>
    copy(): Promise<Result<void>>
  }
  vocabulary: { lookup(spelling: string): Promise<Result<Vocabulary[]>> }
  study: {
    add(vocId: string): Promise<Result<AddOutcome>>
    confirm(vocId: string): Promise<Result<AddOutcome>>
  }
  history: {
    list(query: HistoryQuery): Promise<Result<HistoryPage>>
    confirm(operationId: string): Promise<Result<AddOutcome>>
  }
  desktop: {
    status(): Promise<Result<DesktopStatus>>
    save(settings: DesktopSettings): Promise<Result<DesktopStatus>>
    hide(): Promise<Result<void>>
    quit(): Promise<Result<void>>
    onNavigate(callback: (page: PageName) => void): () => void
    onChanged(callback: () => void): () => void
  }
}
