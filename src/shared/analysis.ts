import type { AiProfile, AiUsage } from './ai'
export type AnalysisMode = 'detailed' | 'translation'
export interface Quote { text: string; occurrence: number }
export interface Span { start: number; end: number }
export interface AnalysisNode {
  id: string; parentId: string | null; kind: 'component' | 'clause'; role: string
  quotes: Quote[]; explanation: string; target: string; spans: Span[]
}
export interface AnalysisWord { word: string; lemma: string; meaning: string }
export interface AnalysisSentence {
  original: string; translation: string; backbone: string; nodes: AnalysisNode[]
  grammar: string[]; vocabulary: AnalysisWord[]; notes: string[]
  unlocated: { role: string; explanation: string }[]
}
export interface AnalysisResult { version: 1; summary: string; sentences: AnalysisSentence[]; degraded: boolean }
export interface TranslationResult { version: 1; translation: string }
interface RecordSource {
  id: string; text: string; source: Omit<AiProfile, 'hasKey' | 'authInvalid'>
  model: string; promptVersion: string; schemaVersion: number; prompt: string; createdAt: string
  usage?: AiUsage; attempts: number
}
// Records saved before translation mode have no mode and remain detailed analyses.
export type AnalysisRecord = RecordSource & (
  { mode?: 'detailed'; result: AnalysisResult } | { mode: 'translation'; result: TranslationResult }
)
export interface AnalysisRequest { requestId: string; text: string; force: boolean; mode?: AnalysisMode }
export interface AnalysisResponse { record: AnalysisRecord; reused: boolean }
export interface AnalysisHistory { items: AnalysisRecord[]; total: number }
