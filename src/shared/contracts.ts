import type { AddOutcome, CredentialStatus, Vocabulary, HistoryPage, HistoryQuery, DesktopStatus, DesktopSettings, PageName } from './models'
import type { Result } from './result'
import type { AiConfiguration, AiProfile, AiProfileInput, AiTemplate, AiTestResult } from './ai'
import type { AnalysisRequest, AnalysisResponse, AnalysisRecord, AnalysisHistory } from './analysis'
import type { UpdateStatus } from './update'

export const channels = {
  updateStatus: 'updates:status', updateCheck: 'updates:check', updateDownload: 'updates:download',
  updateInstall: 'updates:install', updateOpenRelease: 'updates:open-release', updateChanged: 'updates:changed',
  aiConfig: 'ai:config', aiTemplates: 'ai:templates', aiSave: 'ai:save', aiDelete: 'ai:delete', aiSelect: 'ai:select', aiSupplement: 'ai:supplement', aiTest: 'ai:test',
  analysisRun: 'analysis:run', analysisCancel: 'analysis:cancel', analysisHistory: 'analysis:history', analysisGet: 'analysis:get', analysisDelete: 'analysis:delete',
  credentialStatus: 'credentials:status',
  credentialSave: 'credentials:save',
  credentialClear: 'credentials:clear',
  credentialCopy: 'credentials:copy',
  credentialReveal: 'credentials:reveal',
  credentialValidate: 'credentials:validate',
  lookup: 'vocabulary:lookup',
  add: 'study:add',
  confirm: 'study:confirm',
  historyList: 'history:list',
  historyConfirm: 'history:confirm',
  desktopStatus: 'desktop:status',
  desktopSave: 'desktop:save',
  desktopHide: 'desktop:hide',
  desktopQuit: 'desktop:quit',
  desktopDevTools: 'desktop:dev-tools',
  navigate: 'desktop:navigate',
  changed: 'app:changed'
} as const

export interface DesktopApi {
  updates: {
    status(): Promise<Result<UpdateStatus>>
    check(): Promise<Result<UpdateStatus>>
    download(): Promise<Result<UpdateStatus>>
    install(): Promise<Result<UpdateStatus>>
    openRelease(): Promise<Result<UpdateStatus>>
    onChanged(callback: (status: UpdateStatus) => void): () => void
  }
  ai: {
    configuration(): Promise<Result<AiConfiguration>>
    templates(): Promise<Result<AiTemplate[]>>
    save(input: AiProfileInput): Promise<Result<AiProfile>>
    delete(id: string): Promise<Result<void>>
    select(id: string): Promise<Result<void>>
    supplement(value: string): Promise<Result<void>>
    test(id: string): Promise<Result<AiTestResult>>
  }
  analysis: {
    run(request: AnalysisRequest): Promise<Result<AnalysisResponse>>
    cancel(requestId?: string): Promise<Result<void>>
    history(offset: number, limit: number): Promise<Result<AnalysisHistory>>
    get(id: string): Promise<Result<AnalysisRecord>>
    delete(id?: string): Promise<Result<void>>
  }
  credentials: {
    status(): Promise<Result<CredentialStatus>>
    save(token: string): Promise<Result<void>>
    clear(): Promise<Result<void>>
    copy(): Promise<Result<void>>
    reveal(): Promise<Result<string>>
    validate(): Promise<Result<void>>
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
    devTools(): Promise<Result<void>>
    onNavigate(callback: (page: PageName) => void): () => void
    onChanged(callback: () => void): () => void
  }
}
