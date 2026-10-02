import type { ErrorCode } from './result'

export interface Vocabulary {
  id: string
  spelling: string
  interpretations?: string[]
  interpretationError?: string
  phonetics?: { uk?: string; us?: string }
}
export interface DictionaryEntry {
  interpretations: string[]
  phonetics?: { uk?: string; us?: string }
}
export interface CredentialStatus { configured: boolean; available: boolean; invalid?: boolean; verified?: boolean }
export type AddState = 'added' | 'present' | 'not_added' | 'uncertain' | 'unconfirmed' | 'failed'
export interface AddOutcome {
  vocId: string
  spelling: string
  state: AddState
  message: string
  errorCode?: ErrorCode
  operationId?: string
  recordConfirmed?: boolean
}

export type OperationState = Exclude<AddState, 'unconfirmed'> | 'submitting'
export interface HistoryEntry extends Omit<AddOutcome, 'state'> {
  id: string
  profileId: string
  state: OperationState
  createdAt: string
  updatedAt: string
  confirmedAt: string | null
  activeProfile: boolean
}
export interface HistoryQuery { scope: 'active' | 'all'; offset: number; limit: number; pendingOnly: boolean }
export interface HistoryPage { items: HistoryEntry[]; total: number }
export interface WindowBounds { x: number; y: number; width: number; height: number }
export interface DesktopSettings {
  shortcut: string
  closeBehavior: 'hide' | 'quit'
  theme: 'system' | 'light' | 'dark'
}
export interface DesktopStatus {
  settings: DesktopSettings
  shortcutRegistered: boolean
  trayAvailable: boolean
  hideSupported: boolean
  recovering: boolean
}
export type PageName = 'search' | 'history' | 'settings' | 'analysis'
