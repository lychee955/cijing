import { clipboard, ipcMain, type BrowserWindow } from 'electron'
import { z } from 'zod'
import { channels } from '../../shared/contracts'
import type { DesktopSettings, DesktopStatus } from '../../shared/models'
import { ClientError, resultOf } from '../maimemo/errors'
import { spellingSchema, tokenSchema, wordIdSchema } from '../maimemo/schemas'
import type { CredentialStore } from '../storage/credential-store'
import type { VocabularyService } from '../services/vocabulary-service'
import type { StudyService } from '../services/study-service'
import type { SessionService } from '../services/session-service'
import type { OperationsDatabase } from '../storage/database'
import { settingsSchema } from '../storage/settings'
import { validateSender } from './security'

export interface DesktopControls {
  status(): DesktopStatus
  save(settings: DesktopSettings): DesktopStatus
  hide(): void
  quit(): void
}
export const historyQuerySchema = z.object({
  scope: z.enum(['active', 'all']), offset: z.number().int().min(0).max(1_000_000),
  limit: z.number().int().min(1).max(100), pendingOnly: z.boolean()
}).strict()

export function registerIpc(window: BrowserWindow, allowedUrl: string, credentials: CredentialStore,
  vocabulary: VocabularyService, study: StudyService, session: SessionService, database: OperationsDatabase,
  desktop: DesktopControls): void {
  const registered: string[] = []
  const noArgs = z.tuple([])
  const handle = <T extends unknown[]>(channel: string, schema: z.ZodType<T>, action: (...args: T) => unknown) => {
    registered.push(channel)
    ipcMain.handle(channel, (event, ...args: unknown[]) => resultOf(async () => {
      validateSender({ trustedContents: event.sender === window.webContents,
        mainFrame: event.senderFrame !== null && event.senderFrame === window.webContents.mainFrame,
        url: event.senderFrame?.url ?? '' }, allowedUrl)
      const parsed = schema.safeParse(args)
      if (!parsed.success) throw new ClientError('INVALID_INPUT')
      return action(...parsed.data)
    }))
  }
  handle(channels.credentialStatus, noArgs, () => session.status())
  handle(channels.credentialSave, z.tuple([tokenSchema]), token => session.save(token))
  handle(channels.credentialClear, noArgs, () => session.clear())
  handle(channels.credentialCopy, noArgs, () => { clipboard.writeText(credentials.snapshot().token) })
  handle(channels.lookup, z.tuple([spellingSchema]), spelling => session.request(snapshot => vocabulary.lookup(snapshot, spelling)))
  handle(channels.add, z.tuple([wordIdSchema]), id => session.request(snapshot => study.add(snapshot, vocabulary.get(snapshot.profileId, id))))
  handle(channels.confirm, z.tuple([wordIdSchema]), id => session.request(snapshot => study.confirm(snapshot, vocabulary.get(snapshot.profileId, id))))
  handle(channels.historyList, z.tuple([historyQuerySchema]), query => database.list(query))
  handle(channels.historyConfirm, z.tuple([z.string().uuid()]), id => session.request(snapshot => {
    const operation = database.get(id)
    if (!operation || operation.profileId !== snapshot.profileId) throw new ClientError('FORBIDDEN')
    return study.confirm(snapshot, { id: operation.vocId, spelling: operation.spelling }, id)
  }))
  handle(channels.desktopStatus, noArgs, () => desktop.status())
  handle(channels.desktopSave, z.tuple([settingsSchema]), settings => desktop.save(settings))
  handle(channels.desktopHide, noArgs, () => desktop.hide())
  handle(channels.desktopQuit, noArgs, () => desktop.quit())
  window.on('closed', () => { for (const channel of registered) ipcMain.removeHandler(channel) })
}
