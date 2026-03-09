import type { SearchResult } from '@shared/models'
import type { Db } from '../db/db'
import { createLogger } from '../logger'
import type { AppStore } from '../store'
import type { EmbeddingsClient } from './embeddings-client'
import { buildFtsQuery, compactWhitespace, normalizeForSearch, queryCoverageScore, splitSentences, tokenizeForSearch } from './nlp'

const log = createLogger('search')

type ScoreParts = {
  chunkId: number
  scoreVector: number | null
  scoreKeyword: number | null
  scoreCoverage: number
  score: number
}

type ChunkDetails = {
  chunkId: number
  docId: string
  docName: string
  pageStart: number
  pageEnd: number
  content: string
}

function dot(a: Float32Array, b: Float32Array) {
  const n = Math.min(a.length, b.length)
  let s = 0
  for (let i = 0; i < n; i++) s += a[i]! * b[i]!
  return s
}

function clamp01(x: number) {
  return Math.max(0, Math.min(1, x))
}

function scoreSentence(sentence: string, qTokens: string[], chunkScore: number) {
  const coverage = queryCoverageScore(sentence, qTokens)
  if (coverage <= 0) return 0
  const len = sentence.length
  const lenFactor = len < 55 ? 0.72 : len > 360 ? 0.76 : 1
  const completenessBoost = /[.!?]$/.test(sentence) ? 0.08 : 0
  return coverage * lenFactor + chunkScore * 0.22 + completenessBoost
}

function bestExcerpt(content: string, query: string) {
  const text = compactWhitespace(content)
  if (!text) return ''

  const qTokens = tokenizeForSearch(query, { limit: 10, minLen: 2 })
  if (!qTokens.length) return text.length > 420 ? text.slice(0, 420) + '…' : text

  const sentences = splitSentences(text)
  if (sentences.length === 0) return text.length > 420 ? text.slice(0, 420) + '…' : text

  let bestIndex = 0
  let bestScore = -1
  for (let i = 0; i < sentences.length; i++) {
    const score = scoreSentence(sentences[i]!, qTokens, 0)
    if (score > bestScore) {
      bestScore = score
      bestIndex = i
    }
  }

  const picked = [sentences[bestIndex]!]
  const next = sentences[bestIndex + 1]
  if (next && compactWhitespace(picked[0] + ' ' + next).length <= 520) picked.push(next)

  const excerpt = compactWhitespace(picked.join(' '))
  return excerpt.length > 520 ? excerpt.slice(0, 520) + '…' : excerpt
}

export class SearchService {
  constructor(
    private db: Db,
    private store: AppStore,
    private embeddings: EmbeddingsClient,
    private ensureEmbeddingsReady: () => Promise<void>
  ) {}

  async search(
    query: string,
    docIds?: string[],
    collectionId?: string,
    tags?: string[]
  ): Promise<{
    results: SearchResult[]
    answerBullets: { text: string; chunkId: number; docId: string; docName: string; pageStart: number; pageEnd: number; score: number }[]
  }> {
    const cfg = this.store.getConfig()
    const topK = cfg.search.topK

    const q = query.trim()
    const qTokens = tokenizeForSearch(q, { limit: 12, minLen: 2 })
    if (!q) return { results: [], answerBullets: [] }

    try {
      this.db.connection.prepare(`INSERT INTO search_history(query, created_at) VALUES (?, ?)`).run(q.slice(0, 400), Date.now())
    } catch {
      // On ne bloque pas la recherche pour l'historique.
    }

    const resolvedDocIds = this.resolveDocIds(docIds, collectionId, tags)

    const keywordTop = this.keywordSearch(q, resolvedDocIds, Math.max(topK * 6, 60))

    let vectorTop: { chunkId: number; scoreVector: number }[] = []
    let modelKey: string | null = null
    try {
      await this.ensureEmbeddingsReady()
      const embed = await this.embeddings.embedTexts([q])
      const qv = embed.vectors[0]
      if (qv) {
        modelKey = embed.model
        vectorTop = this.vectorSearch(qv, modelKey, resolvedDocIds, Math.max(topK * 6, 60))
      }
    } catch (err) {
      try {
        await this.ensureEmbeddingsReady()
        const embed = await this.embeddings.embedTexts([q])
        const qv = embed.vectors[0]
        if (qv) {
          modelKey = embed.model
          vectorTop = this.vectorSearch(qv, modelKey, resolvedDocIds, Math.max(topK * 6, 60))
        }
      } catch (err2) {
        log.warn({ err, err2 }, 'embeddings unavailable; keyword-only search')
      }
    }

    const merged = new Map<number, ScoreParts>()
    for (const v of vectorTop) {
      merged.set(v.chunkId, { chunkId: v.chunkId, scoreVector: v.scoreVector, scoreKeyword: null, scoreCoverage: 0, score: 0 })
    }
    for (const k of keywordTop) {
      const cur = merged.get(k.chunkId)
      if (cur) cur.scoreKeyword = k.scoreKeyword
      else merged.set(k.chunkId, { chunkId: k.chunkId, scoreVector: null, scoreKeyword: k.scoreKeyword, scoreCoverage: 0, score: 0 })
    }

    let wv = cfg.search.weightVector
    let wk = cfg.search.weightKeyword
    if (vectorTop.length === 0) {
      wv = 0
      wk = 1
    } else if (keywordTop.length === 0) {
      wv = 1
      wk = 0
    } else {
      const sum = wv + wk
      if (sum > 0) {
        wv /= sum
        wk /= sum
      }
    }

    if (merged.size === 0) return { results: [], answerBullets: [] }

    const details = this.fetchChunkDetails(Array.from(merged.keys()))
    const byId = new Map(details.map((detail) => [detail.chunkId, detail]))
    const snippetByChunkId = new Map<number, string>()
    for (const keywordHit of keywordTop) {
      if (keywordHit.snippet) snippetByChunkId.set(keywordHit.chunkId, keywordHit.snippet)
    }

    const normalizedQuery = normalizeForSearch(q)
    for (const scoreParts of merged.values()) {
      const detail = byId.get(scoreParts.chunkId)
      const hybrid = wv * (scoreParts.scoreVector ?? 0) + wk * (scoreParts.scoreKeyword ?? 0)
      if (!detail) {
        scoreParts.score = hybrid
        continue
      }

      const coverage = clamp01(queryCoverageScore(detail.content, qTokens))
      const exactPhrase = normalizedQuery && normalizeForSearch(detail.content).includes(normalizedQuery) ? 1 : 0
      scoreParts.scoreCoverage = coverage
      scoreParts.score = hybrid * 0.68 + coverage * 0.22 + exactPhrase * 0.1
    }

    const scored = Array.from(merged.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(topK * 2, topK))

    const results = scored
      .map((scoreParts) => {
        const detail = byId.get(scoreParts.chunkId)
        if (!detail) return null
        const snippet = snippetByChunkId.get(scoreParts.chunkId)
        const excerpt = snippet ? compactWhitespace(snippet).slice(0, 520) : bestExcerpt(detail.content, q)
        return {
          chunkId: scoreParts.chunkId,
          docId: detail.docId,
          docName: detail.docName,
          pageStart: detail.pageStart,
          pageEnd: detail.pageEnd,
          score: scoreParts.score,
          scoreVector: scoreParts.scoreVector,
          scoreKeyword: scoreParts.scoreKeyword,
          excerpt: excerpt.length > 520 ? excerpt.slice(0, 520) + '…' : excerpt
        } satisfies SearchResult
      })
      .filter(Boolean)
      .slice(0, topK) as SearchResult[]

    const answerBullets = this.buildAnswerBullets(qTokens, scored, byId)
    return { results, answerBullets }
  }

  private buildAnswerBullets(queryTokens: string[], scored: ScoreParts[], byId: Map<number, ChunkDetails>) {
    if (queryTokens.length === 0) return []

    const candidates: { text: string; chunkId: number; docId: string; docName: string; pageStart: number; pageEnd: number; score: number }[] = []

    for (const scoreParts of scored.slice(0, 10)) {
      const detail = byId.get(scoreParts.chunkId)
      if (!detail) continue

      const sentences = splitSentences(detail.content)
      for (let i = 0; i < sentences.length; i++) {
        const current = compactWhitespace(sentences[i]!)
        if (current.length < 45) continue

        let text = current
        const next = sentences[i + 1]
        if (next && text.length < 150) {
          const combined = compactWhitespace(`${text} ${next}`)
          if (combined.length <= 320) text = combined
        }

        const sentenceScore = scoreSentence(text, queryTokens, scoreParts.score)
        if (sentenceScore <= 0) continue

        candidates.push({
          text,
          chunkId: scoreParts.chunkId,
          docId: detail.docId,
          docName: detail.docName,
          pageStart: detail.pageStart,
          pageEnd: detail.pageEnd,
          score: sentenceScore
        })
      }
    }

    candidates.sort((a, b) => b.score - a.score)
    const out: typeof candidates = []
    const seen = new Set<string>()
    const perDoc = new Map<string, number>()
    for (const candidate of candidates) {
      const key = normalizeForSearch(candidate.text).slice(0, 280)
      if (!key || seen.has(key)) continue
      const used = perDoc.get(candidate.docId) ?? 0
      if (used >= 2) continue
      seen.add(key)
      perDoc.set(candidate.docId, used + 1)
      out.push(candidate)
      if (out.length >= 5) break
    }
    return out
  }

  private resolveDocIds(docIds?: string[], collectionId?: string, tags?: string[]) {
    const clauses: string[] = []
    const params: unknown[] = []

    let join = ''
    if (collectionId) {
      join += ` JOIN document_collections dc ON dc.doc_id = d.id`
      clauses.push(`dc.collection_id = ?`)
      params.push(collectionId)
    }
    if (tags && tags.length) {
      join += ` JOIN document_tags dt ON dt.doc_id = d.id`
      clauses.push(`dt.tag IN (${tags.map(() => '?').join(',')})`)
      params.push(...tags.map((tag) => tag.toLowerCase()))
    }
    if (docIds && docIds.length) {
      clauses.push(`d.id IN (${docIds.map(() => '?').join(',')})`)
      params.push(...docIds)
    }

    if (clauses.length === 0) return undefined

    let sql = `SELECT d.id as id FROM documents d${join} WHERE ${clauses.join(' AND ')}`
    if (tags && tags.length) {
      sql = `SELECT d.id as id
             FROM documents d
             JOIN document_tags dt ON dt.doc_id = d.id
             ${collectionId ? 'JOIN document_collections dc ON dc.doc_id = d.id' : ''}
             WHERE ${[
               ...(collectionId ? ['dc.collection_id = ?'] : []),
               `dt.tag IN (${tags.map(() => '?').join(',')})`,
               ...(docIds && docIds.length ? [`d.id IN (${docIds.map(() => '?').join(',')})`] : [])
             ].join(' AND ')}
             GROUP BY d.id
             HAVING COUNT(DISTINCT dt.tag) = ${tags.length}`
    }

    const rows = this.db.connection.prepare(sql).all(...params) as Array<{ id: string }>
    return rows.map((row) => String(row.id))
  }

  private vectorSearch(qv: Float32Array, model: string, docIds: string[] | undefined, limit: number) {
    const run = (modelFilter: string | null) => {
      const results: { chunkId: number; scoreVector: number }[] = []
      const params: unknown[] = []
      let sql =
        `SELECT e.chunk_id as chunkId, e.embedding as embedding
         FROM chunk_embeddings e
         JOIN chunks c ON c.id = e.chunk_id`

      if (modelFilter) {
        sql += ` WHERE e.model = ?`
        params.push(modelFilter)
      } else {
        sql += ` WHERE 1=1`
      }

      if (docIds && docIds.length) {
        sql += ` AND c.doc_id IN (${docIds.map(() => '?').join(',')})`
        params.push(...docIds)
      }

      const stmt = this.db.connection.prepare(sql)
      for (const row of stmt.iterate(...params) as Iterable<{ chunkId: number; embedding: Buffer }>) {
        const vec = new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.byteLength / 4)
        const sim = dot(qv, vec)
        results.push({ chunkId: Number(row.chunkId), scoreVector: clamp01((sim + 1) / 2) })
      }

      results.sort((a, b) => b.scoreVector - a.scoreVector)
      return results.slice(0, limit)
    }

    const primary = run(model)
    if (primary.length > 0) return primary
    log.warn({ model }, 'no embeddings found for current model; falling back to any model')
    return run(null)
  }

  private keywordSearch(query: string, docIds: string[] | undefined, limit: number) {
    const results: { chunkId: number; scoreKeyword: number; snippet?: string }[] = []
    const ftsQuery = buildFtsQuery(query)
    if (!ftsQuery) return results

    const params: unknown[] = [ftsQuery]
    let sql =
      `SELECT chunk_id as chunkId, bm25(fts_chunks) as bm25,
              snippet(fts_chunks, 0, '', '', '…', 18) as snip
       FROM fts_chunks
       WHERE fts_chunks MATCH ?`

    if (docIds && docIds.length) {
      sql += ` AND doc_id IN (${docIds.map(() => '?').join(',')})`
      params.push(...docIds)
    }
    sql += ` LIMIT ${Math.max(limit, 10)}`

    try {
      const rows = this.db.connection.prepare(sql).all(...params) as Array<{ chunkId: number; bm25: number; snip?: string | null }>
      for (const row of rows) {
        const bm25 = Number(row.bm25)
        const keywordScore = bm25 <= 0 ? 1 : 1 / (1 + bm25)
        const snippet = row.snip ? compactWhitespace(row.snip) : ''
        results.push({ chunkId: Number(row.chunkId), scoreKeyword: clamp01(keywordScore), snippet: snippet || undefined })
      }
      results.sort((a, b) => b.scoreKeyword - a.scoreKeyword)
      return results.slice(0, limit)
    } catch (err) {
      log.debug({ err }, 'fts query failed')
      return []
    }
  }

  private fetchChunkDetails(chunkIds: number[]) {
    if (chunkIds.length === 0) return []
    const sql =
      `SELECT c.id as chunkId, c.doc_id as docId, d.file_name as docName, c.page_start as pageStart, c.page_end as pageEnd, c.content as content
       FROM chunks c
       JOIN documents d ON d.id = c.doc_id
       WHERE c.id IN (${chunkIds.map(() => '?').join(',')})`
    return this.db.connection.prepare(sql).all(...chunkIds) as ChunkDetails[]
  }
}
