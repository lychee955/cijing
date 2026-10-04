export type UpdatePhase = 'idle' | 'checking' | 'upToDate' | 'noCompatiblePackage' | 'unsupported' | 'available' | 'downloading' | 'downloaded' | 'installing' | 'error'
export interface UpdateEnvironment {
  version: string
  platform: string
  arch: string
  systemVersion: string
  installation: 'nsis' | 'portable' | 'mac-app' | 'development' | 'unknown'
  channel: 'stable'
  canCheck: boolean
  canInstall: boolean
  reason?: string
}
export interface UpdateCandidate {
  version: string
  tag: string
  releaseUrl: string
  publishedAt: string
  notes: string
  assetName: string
  assetUrl: string
  size: number
  sha512?: string
  minimumSystemVersion?: string
}
export interface UpdateStatus {
  revision: number
  phase: UpdatePhase
  environment: UpdateEnvironment
  candidate?: UpdateCandidate
  progress?: number
  lastCheckedAt?: string
  lastSuccessAt?: string
  errorStage?: 'check' | 'download' | 'install' | 'openRelease'
  message: string
  retryAt?: string
}
