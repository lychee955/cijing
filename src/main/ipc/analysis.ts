import { ipcMain, type BrowserWindow } from 'electron'
import { z } from 'zod'
import { channels } from '../../shared/contracts'
import { AiError, aiResult } from '../ai/errors'
import { profileInputSchema, templates } from '../ai/config'
import { AnalysisService, analysisRequestSchema } from '../services/analysis-service'
import { validateSender } from './security'
export function registerAnalysisIpc(window: BrowserWindow, allowedUrl: string, service: AnalysisService): void {
  const registered: string[] = []
  const handle = <T extends unknown[]>(channel: string, schema: z.ZodType<T>, action: (...args: T) => unknown) => {
    registered.push(channel)
    ipcMain.handle(channel, (event, ...args: unknown[]) => aiResult(async () => {
      try { validateSender({ trustedContents: event.sender === window.webContents, mainFrame: event.senderFrame !== null && event.senderFrame === window.webContents.mainFrame, url: event.senderFrame?.url ?? '' }, allowedUrl) } catch { throw new AiError('FORBIDDEN') }
      const parsed = schema.safeParse(args)
      if (!parsed.success) throw new AiError('INVALID_INPUT')
      return action(...parsed.data)
    }))
  }
  const id = z.string().uuid(), noArgs = z.tuple([])
  handle(channels.aiConfig, noArgs, () => service.store.configuration())
  handle(channels.aiTemplates, noArgs, () => templates)
  handle(channels.aiSave, z.tuple([profileInputSchema]), value => service.saveProfile(value))
  handle(channels.aiDelete, z.tuple([id]), value => service.deleteProfile(value))
  handle(channels.aiSelect, z.tuple([id]), value => service.select(value))
  handle(channels.aiSupplement, z.tuple([z.string().max(4000)]), value => service.supplement(value))
  handle(channels.aiTest, z.tuple([id]), value => service.test(value))
  handle(channels.analysisRun, z.tuple([analysisRequestSchema]), value => service.analyze(value))
  handle(channels.analysisCancel, z.tuple([id.optional()]), (value?: string) => service.cancel(value))
  handle(channels.analysisHistory, z.tuple([z.number().int().min(0).max(1_000_000), z.number().int().min(1).max(50)]), (offset, limit) => service.store.history(offset, limit))
  handle(channels.analysisGet, z.tuple([id]), value => { const record = service.store.get(value); if (!record) throw new AiError('AI_CONFIG'); return record })
  handle(channels.analysisDelete, z.tuple([id.optional()]), (value?: string) => service.store.deleteHistory(value))
  window.on('closed', () => { service.cancel(); for (const channel of registered) ipcMain.removeHandler(channel) })
}
