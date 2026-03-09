import type { Db } from '../db/db'
import { createLogger } from '../logger'
import type { AppStore } from '../store'
import { compactWhitespace, normalizeForSearch, queryCoverageScore, splitSentences, tokenizeForSearch } from './nlp'
import { OllamaClient } from './ollama-client'
import type { SearchService } from './search'

const log = createLogger('assistant')

type Source = {
  sourceId: number
  chunkId: number
  docId: string
  docName: string
  pageStart: number
  pageEnd: number
  text: string
}

type AssistantAnswer = {
  provider: 'extractive' | 'ollama'
  model: string | null
  keywords: string[]
  bullets: { text: string; citations: { sourceId: number; chunkId: number; docId: string; docName: string; pageStart: number; pageEnd: number }[] }[]
}

function extractKeywords(text: string) {
  return tokenizeForSearch(text, { limit: 10, minLen: 4 })
}

function scoreCandidate(text: string, queryTokens: string[], sourceRank: number) {
  const coverage = queryCoverageScore(text, queryTokens)
  if (queryTokens.length > 0 && coverage <= 0) return 0
  const len = text.length
  const lenFactor = len < 60 ? 0.75 : len > 360 ? 0.8 : 1
  const punctuationBoost = /[.!?]$/.test(text) ? 0.08 : 0
  return Math.max(coverage, queryTokens.length === 0 ? 0.45 : 0) * lenFactor + punctuationBoost + sourceRank * 0.035
}

function normalizeBulletText(text: string) {
  const clean = compactWhitespace(text)
  if (!clean) return ''
  return /[.!?]$/.test(clean) ? clean : `${clean}.`
}

function buildExtractiveBullets(question: string, sources: Source[], maxBullets = 6): AssistantAnswer['bullets'] {
  const queryTokens = tokenizeForSearch(question, { limit: 12, minLen: 2 })
  const candidates: Array<{ text: string; source: Source; score: number }> = []

  for (let i = 0; i < sources.length; i++) {
    const source = sources[i]!
    const sentences = splitSentences(source.text)
    for (let j = 0; j < sentences.length; j++) {
      let text = compactWhitespace(sentences[j]!)
      if (text.length < 45) continue

      const next = sentences[j + 1]
      if (next && text.length < 150) {
        const combined = compactWhitespace(`${text} ${next}`)
        if (combined.length <= 340) text = combined
      }

      const score = scoreCandidate(text, queryTokens, sources.length - i)
      if (score <= 0) continue
      candidates.push({ text: normalizeBulletText(text), source, score })
    }
  }

  candidates.sort((a, b) => b.score - a.score)

  const out: AssistantAnswer['bullets'] = []
  const seen = new Set<string>()
  const perDoc = new Map<string, number>()
  for (const candidate of candidates) {
    const key = normalizeForSearch(candidate.text).slice(0, 320)
    if (!key || seen.has(key)) continue

    const used = perDoc.get(candidate.source.docId) ?? 0
    if (used >= 2) continue

    seen.add(key)
    perDoc.set(candidate.source.docId, used + 1)
    out.push({
      text: candidate.text,
      citations: [
        {
          sourceId: candidate.source.sourceId,
          chunkId: candidate.source.chunkId,
          docId: candidate.source.docId,
          docName: candidate.source.docName,
          pageStart: candidate.source.pageStart,
          pageEnd: candidate.source.pageEnd
        }
      ]
    })
    if (out.length >= maxBullets) break
  }

  if (out.length > 0) return out

  for (const source of sources.slice(0, maxBullets)) {
    const fallback = normalizeBulletText(source.text.slice(0, 280))
    if (!fallback) continue
    out.push({
      text: fallback,
      citations: [{ sourceId: source.sourceId, chunkId: source.chunkId, docId: source.docId, docName: source.docName, pageStart: source.pageStart, pageEnd: source.pageEnd }]
    })
  }
  return out
}

function validateOllamaJson(obj: unknown): { keywords: string[]; bullets: { text: string; sources: number[] }[] } {
  if (!obj || typeof obj !== 'object') throw new Error('Invalid JSON')
  const raw = obj as { keywords?: unknown; bullets?: unknown }
  const keywords = Array.isArray(raw.keywords) ? raw.keywords.filter((x): x is string => typeof x === 'string').slice(0, 12) : []
  const bullets = Array.isArray(raw.bullets)
    ? raw.bullets
        .map((bullet) => {
          const value = bullet as { text?: unknown; sources?: unknown }
          return {
            text: typeof value.text === 'string' ? normalizeBulletText(value.text) : '',
            sources: Array.isArray(value.sources)
              ? value.sources.filter((n): n is number => typeof n === 'number' && Number.isFinite(n)).map((n) => Number(n))
              : []
          }
        })
        .filter((bullet) => bullet.text && bullet.sources.length > 0)
        .slice(0, 8)
    : []
  return { keywords, bullets }
}

export class AssistantService {
  private ollama: OllamaClient

  constructor(
    private db: Db,
    private store: AppStore,
    private search: SearchService
  ) {
    this.ollama = new OllamaClient(this.store.getConfig().assistant.ollamaHost)
  }

  async answer(query: string, docIds?: string[], collectionId?: string, tags?: string[]): Promise<AssistantAnswer> {
    const cfg = this.store.getConfig()
    this.ollama.setHost(cfg.assistant.ollamaHost)

    const retrieved = await this.search.search(query, docIds, collectionId, tags)
    const top = retrieved.results.slice(0, 12)
    if (!top.length) return { provider: cfg.assistant.provider, model: null, keywords: [], bullets: [] }

    const sources = this.loadSourcesFromChunkIds(top.map((result) => result.chunkId))
    const generated = await this.generateBullets(cfg.assistant.provider, cfg.assistant.ollamaModel, query, sources, 6)
    const keywords = generated.keywords.length ? generated.keywords : extractKeywords(generated.bullets.map((bullet) => bullet.text).join(' '))
    return { provider: generated.provider, model: generated.model, keywords, bullets: generated.bullets }
  }

  async docAnswer(docId: string, question: string): Promise<AssistantAnswer> {
    const cfg = this.store.getConfig()
    this.ollama.setHost(cfg.assistant.ollamaHost)

    const q = question.trim() || 'De quoi parle ce document ?'
    const retrieved = await this.search.search(q, [docId])
    let sources = this.loadSourcesFromChunkIds(retrieved.results.slice(0, 10).map((result) => result.chunkId))

    if (sources.length === 0) {
      const doc = this.db.connection.prepare(`SELECT file_name as name FROM documents WHERE id=?`).get(docId) as { name?: string } | undefined
      const docName = doc?.name ? String(doc.name) : 'Document'
      sources = this.sampleDocSources(docId, docName, 10)
    }

    if (sources.length === 0) {
      return {
        provider: cfg.assistant.provider,
        model: null,
        keywords: [],
        bullets: [{ text: "Ce document n'est pas encore indexe. Lancez une indexation puis reessayez.", citations: [] }]
      }
    }

    const generated = await this.generateBullets(cfg.assistant.provider, cfg.assistant.ollamaModel, q, sources, 7)
    const keywords = generated.keywords.length ? generated.keywords : extractKeywords(generated.bullets.map((bullet) => bullet.text).join(' '))
    return { provider: generated.provider, model: generated.model, keywords, bullets: generated.bullets }
  }

  private loadSourcesFromChunkIds(chunkIds: number[]): Source[] {
    if (chunkIds.length === 0) return []
    const stmt = this.db.connection.prepare(
      `SELECT c.id as chunkId, c.doc_id as docId, d.file_name as docName, c.page_start as pageStart, c.page_end as pageEnd,
              c.chunk_index as chunkIndex, c.content as text
       FROM chunks c
       JOIN documents d ON d.id = c.doc_id
       WHERE c.id = ?`
    )
    const aroundStmt = this.db.connection.prepare(
      `SELECT content
       FROM chunks
       WHERE doc_id = ? AND chunk_index IN (?, ?)
       ORDER BY chunk_index ASC`
    )

    const out: Source[] = []
    let sourceId = 1
    for (const chunkId of chunkIds) {
      const row = stmt.get(chunkId) as
        | {
            chunkId: number
            docId: string
            docName: string
            pageStart: number
            pageEnd: number
            chunkIndex: number
            text: string
          }
        | undefined
      if (!row) continue

      const neighbors = aroundStmt
        .all(row.docId, row.chunkIndex - 1, row.chunkIndex + 1)
        .map((item) => compactWhitespace(String((item as { content: string }).content)))
        .filter(Boolean)

      const combined = compactWhitespace([neighbors[0], row.text, neighbors[1]].filter(Boolean).join(' '))
      out.push({
        sourceId: sourceId++,
        chunkId: Number(row.chunkId),
        docId: String(row.docId),
        docName: String(row.docName),
        pageStart: Number(row.pageStart),
        pageEnd: Number(row.pageEnd),
        text: combined.slice(0, 2200)
      })
    }
    return out
  }

  private sampleDocSources(docId: string, docName: string, maxSources: number): Source[] {
    const rows = this.db.connection
      .prepare(
        `SELECT id as chunkId, page_start as pageStart, page_end as pageEnd, content as text
         FROM chunks
         WHERE doc_id=?
         ORDER BY chunk_index
         LIMIT ?`
      )
      .all(docId, Math.max(1, Math.min(maxSources, 12))) as Array<{ chunkId: number; pageStart: number; pageEnd: number; text: string }>

    return rows.map((row, index) => ({
      sourceId: index + 1,
      chunkId: Number(row.chunkId),
      docId,
      docName,
      pageStart: Number(row.pageStart),
      pageEnd: Number(row.pageEnd),
      text: compactWhitespace(String(row.text ?? ''))
    }))
  }

  private async generateBullets(
    provider: 'extractive' | 'ollama',
    ollamaModel: string,
    question: string,
    sources: Source[],
    maxBullets: number
  ): Promise<{ provider: 'extractive' | 'ollama'; model: string | null; keywords: string[]; bullets: AssistantAnswer['bullets'] }> {
    if (provider !== 'ollama') {
      const bullets = buildExtractiveBullets(question, sources, maxBullets)
      return { provider: 'extractive', model: null, keywords: extractKeywords(bullets.map((bullet) => bullet.text).join(' ')), bullets }
    }

    try {
      await this.ollama.version(1200)
    } catch (err) {
      log.warn({ err }, 'ollama not reachable; falling back to extractive')
      const bullets = buildExtractiveBullets(question, sources, maxBullets)
      return { provider: 'extractive', model: null, keywords: extractKeywords(bullets.map((bullet) => bullet.text).join(' ')), bullets }
    }

    const systemPrompt =
      "Tu es un assistant de recherche documentaire. Reponds en francais, avec des phrases completes, precises et factuelles. " +
      "Utilise uniquement les informations presentes dans les sources. Chaque puce doit etre autonome et citee par id de source."

    const userPrompt =
      `Question: ${question}\n\n` +
      `Sources:\n` +
      sources
        .map((source) => {
          const text = compactWhitespace(source.text)
          const short = text.length > 1100 ? `${text.slice(0, 1100)}…` : text
          return `S${source.sourceId} (${source.docName}, p.${source.pageStart}-${source.pageEnd}): ${short}`
        })
        .join('\n') +
      `\n\nReponds STRICTEMENT en JSON valide avec ce schema:\n` +
      `{"keywords":["..."],"bullets":[{"text":"phrase complete et precise","sources":[1,2]}]}\n`

    try {
      const raw = await this.ollama.chatJson(ollamaModel, [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ])
      const parsed = validateOllamaJson(raw)
      const sourceById = new Map(sources.map((source) => [source.sourceId, source]))
      const bullets = parsed.bullets.slice(0, maxBullets).map((bullet) => ({
        text: bullet.text,
        citations: bullet.sources
          .map((sourceId) => sourceById.get(sourceId))
          .filter(Boolean)
          .map((source) => ({
            sourceId: source!.sourceId,
            chunkId: source!.chunkId,
            docId: source!.docId,
            docName: source!.docName,
            pageStart: source!.pageStart,
            pageEnd: source!.pageEnd
          }))
      }))
      return { provider: 'ollama', model: ollamaModel, keywords: parsed.keywords, bullets }
    } catch (err) {
      log.warn({ err }, 'ollama generation failed; falling back to extractive')
      const bullets = buildExtractiveBullets(question, sources, maxBullets)
      return { provider: 'extractive', model: null, keywords: extractKeywords(bullets.map((bullet) => bullet.text).join(' ')), bullets }
    }
  }
}
