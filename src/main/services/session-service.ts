import type { CredentialStatus } from '../../shared/models'
import { ClientError } from '../maimemo/errors'
import type { CredentialSnapshot, CredentialStore } from '../storage/credential-store'
import type { OperationsDatabase } from '../storage/database'
import type { StudyService } from './study-service'
import type { VocabularyService } from './vocabulary-service'

export class SessionService {
  private activeRequests = 0
  private verifiedProfile: string | null = null
  recovering = false
  constructor(private readonly credentials: CredentialStore, private readonly database: OperationsDatabase,
    private readonly vocabulary: VocabularyService, private readonly study: StudyService,
    private readonly changed: () => void = () => {}) {}

  initialize(): void { this.database.activateProfile(this.credentials.identity()) }
  status(): CredentialStatus {
    const status = this.credentials.status()
    const id = this.database.activeProfileId()
    const invalid = !!id && this.database.isInvalid(id)
    return { ...status, invalid, verified: !!id && id === this.verifiedProfile && status.available && !invalid }
  }
  save(token: string): void {
    this.change(() => this.credentials.save(token))
  }
  clear(): void { this.change(() => this.credentials.clear()) }
  async validate(): Promise<void> {
    this.verifiedProfile = null
    await this.request(async credentials => {
      await this.vocabulary.validate(credentials)
      this.verifiedProfile = credentials.profileId
    })
  }
  private change(action: () => void): void {
    if (this.activeRequests > 0) throw new ClientError('BUSY')
    action()
    this.verifiedProfile = null
    this.initialize()
    this.vocabulary.clear()
    this.study.clear()
    this.changed()
  }

  async request<T>(action: (credentials: CredentialSnapshot) => Promise<T>): Promise<T> {
    if (this.activeRequests >= 8) throw new ClientError('BUSY')
    const credentials = this.credentials.snapshot()
    if (credentials.profileId !== this.database.activeProfileId()) throw new ClientError('CREDENTIAL_UNAVAILABLE')
    if (this.database.isInvalid(credentials.profileId)) throw new ClientError('AUTH')
    this.activeRequests++
    try { return await action(credentials) }
    catch (error) {
      if (error instanceof ClientError && error.code === 'AUTH') this.database.invalidateProfile(credentials.profileId)
      throw error
    } finally { this.activeRequests--; this.changed() }
  }

  async recover(): Promise<void> {
    if (this.recovering) return
    this.recovering = true
    this.changed()
    try {
      await this.request(async credentials => {
        // Bounded recovery on launch; remaining operations stay visible in History.
        for (const operation of this.database.pending(credentials.profileId, 5)) {
          if (this.database.isInvalid(credentials.profileId)) break
          const outcome = await this.study.confirm(credentials, { id: operation.vocId, spelling: operation.spelling }, operation.id)
          if (outcome.errorCode) break // do not flood an offline/rate-limited service
        }
      })
    } catch { /* Nothing is resubmitted; pending history remains available for manual confirmation. */ }
    finally { this.recovering = false; this.changed() }
  }
}
