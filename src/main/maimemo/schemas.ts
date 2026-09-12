import { z } from 'zod'

export const wordIdSchema = z.string().min(1).max(256).regex(/^[A-Za-z0-9_-]+$/)
export const spellingSchema = z.string().trim().min(1).max(200).refine(v => !/[\x00-\x1f\x7f]/.test(v))
export const tokenSchema = z.string().trim().min(1).max(8192).regex(/^[\x21-\x7e]+$/)
export const vocabularySchema = z.object({ id: wordIdSchema, spelling: z.string().min(1).max(200) })
export const lookupSchema = z.object({ voc: z.array(vocabularySchema).max(1000) })
export const addSchema = z.object({ added_count: z.number().int().min(0).max(1) })
export const recordsSchema = z.object({
  records: z.array(z.object({ voc_id: wordIdSchema })).max(1000),
  count: z.number().int().nonnegative()
})
