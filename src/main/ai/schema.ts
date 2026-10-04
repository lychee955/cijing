import {z} from "zod";
import type {AnalysisResult, AnalysisNode, Span} from "../../shared/analysis";
import {AiError} from "./errors";
const text = z.string().min(1).max(12000);
const quoteSchema = z
    .object({
        text: z.string().min(1).max(6000),
        occurrence: z.number().int().min(1).max(300)
    })
    .strict();
export const nodeSchema = z
    .object({
        id: z.string().min(1).max(80),
        parentId: z.string().max(80).nullable(),
        kind: z.enum(["component", "clause"]),
        role: text,
        quotes: z.array(quoteSchema).min(1).max(16),
        explanation: text,
        target: z.string().max(6000)
    })
    .strict();
const sentenceFields = {
    original: z.string().min(1).max(6000),
    translation: text,
    backbone: text,
    grammar: z.array(text).max(40),
    vocabulary: z
        .array(
            z
                .object({
                    word: z.string().min(1).max(100),
                    lemma: z.string().min(1).max(100),
                    meaning: text
                })
                .strict()
        )
        .max(100),
    notes: z.array(text).max(40)
};
export const outputSchema = z
    .object({
        version: z.literal(1),
        summary: z.string().max(12000),
        sentences: z
            .array(z.object({...sentenceFields, nodes: z.array(nodeSchema).max(200)}).strict())
            .min(1)
            .max(40)
    })
    .strict();
const basicSchema = z.object({
    version: z.literal(1),
    summary: z.string().max(12000),
    sentences: z
        .array(z.object({...sentenceFields, nodes: z.array(z.unknown()).max(200)}))
        .min(1)
        .max(40)
});
export const jsonSchema = z.toJSONSchema(outputSchema, {target: "draft-7"});
// Gemini supports a JSON Schema subset; avoid metadata and additionalProperties.
export function geminiSchema(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(geminiSchema);
    if (value && typeof value === "object")
        return Object.fromEntries(
            Object.entries(value)
                .filter(([k]) => !["$schema", "additionalProperties", "minLength", "maxLength"].includes(k))
                .map(([k, v]) =>
                    k === "properties"
                        ? [
                              k,
                              Object.fromEntries(
                                  Object.entries(v as Record<string, unknown>).map(([name, schema]) => [
                                      name,
                                      geminiSchema(schema)
                                  ])
                              )
                          ]
                        : k === "const"
                          ? ["enum", [v]]
                          : [k, geminiSchema(v)]
                )
        );
    return value;
}
export function locate(source: string, quote: string, occurrence: number): Span | undefined {
    let at = -1,
        from = 0;
    for (let i = 0; i < occurrence; i++) {
        at = source.indexOf(quote, from);
        if (at < 0) return;
        from = at + quote.length;
    }
    return {start: at, end: at + quote.length};
}
export function parseAnalysis(raw: string, input: string): AnalysisResult {
    const fence = raw.trim().match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i);
    let object: unknown;
    try {
        object = JSON.parse(fence ? fence[1]! : raw);
    } catch {
        throw new AiError("AI_FORMAT");
    }
    const parsed = basicSchema.safeParse(object);
    if (!parsed.success) throw new AiError("AI_FORMAT");
    if (parsed.data.sentences.reduce((count, s) => count + s.nodes.length, 0) > 400) throw new AiError("AI_FORMAT");
    let cursor = 0,
        degraded = false;
    const sentences = parsed.data.sentences.map((sentence) => {
        const index = input.indexOf(sentence.original, cursor);
        if (index < 0 || input.slice(cursor, index).trim()) throw new AiError("AI_FORMAT");
        cursor = index + sentence.original.length;
        const candidates: AnalysisNode[] = [];
        const unlocated: {role: string; explanation: string}[] = [];
        for (const rawNode of sentence.nodes) {
            const n = nodeSchema.safeParse(rawNode);
            if (!n.success) {
                degraded = true;
                const lecture = z.object({role: text, explanation: text}).safeParse(rawNode);
                if (lecture.success) unlocated.push(lecture.data);
                continue;
            }
            const spans = n.data.quotes.map((q) => locate(sentence.original, q.text, q.occurrence));
            if (spans.some((s) => !s) || (n.data.target && !sentence.original.includes(n.data.target))) {
                degraded = true;
                unlocated.push({role: n.data.role, explanation: n.data.explanation});
                continue;
            }
            candidates.push({...n.data, spans: spans as Span[]});
        }
        const valid = (node: AnalysisNode): boolean => {
            const visited = new Set<string>();
            let current: AnalysisNode | undefined = node;
            while (current) {
                if (
                    visited.has(current.id) ||
                    visited.size >= 8 ||
                    candidates.filter((n) => n.id === current!.id).length !== 1
                )
                    return false;
                visited.add(current.id);
                if (current.parentId === null) return true;
                const parent: AnalysisNode | undefined = candidates.find((n) => n.id === current!.parentId);
                if (
                    !parent ||
                    !current.spans.every((s) => parent.spans.some((p) => p.start <= s.start && p.end >= s.end))
                )
                    return false;
                current = parent;
            }
            return false;
        };
        const nodes = candidates.filter(valid);
        for (const n of candidates) if (!nodes.includes(n)) unlocated.push({role: n.role, explanation: n.explanation});
        if (nodes.length !== sentence.nodes.length) degraded = true;
        if (sentence.vocabulary.some((w) => !sentence.original.includes(w.word))) throw new AiError("AI_FORMAT");
        return {...sentence, nodes, unlocated};
    });
    if (input.slice(cursor).trim()) throw new AiError("AI_FORMAT");
    return {version: 1, summary: parsed.data.summary, sentences, degraded};
}
