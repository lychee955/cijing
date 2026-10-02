import type { AiProfile, AiUsage } from './ai'
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
export interface AnalysisRecord {
  id: string; text: string; result: AnalysisResult; source: Omit<AiProfile, 'hasKey' | 'authInvalid'>
  model: string; promptVersion: string; schemaVersion: number; prompt: string; createdAt: string
  usage?: AiUsage; attempts: number
}
export interface AnalysisRequest { requestId: string; text: string; force: boolean }
export interface AnalysisResponse { record: AnalysisRecord; reused: boolean }
export interface AnalysisHistory { items: AnalysisRecord[]; total: number }
