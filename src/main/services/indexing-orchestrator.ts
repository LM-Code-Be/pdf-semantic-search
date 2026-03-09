import { nanoid } from 'nanoid'
import type { Db } from '../db/db'
import type { AppStore } from '../store'
import { createLogger } from '../logger'
import { PdfTextExtractor } from './pdf-extract'
import { chunkPages } from './chunking'
import { EmbeddingsPythonManager } from './embeddings-python-manager'
import type { IndexingProgress } from '@shared/models'
import { OcrService } from './ocr'
import { renderPdfPagesToPng } from './pdf-ocr'
import { normalizeExtractedText } from './text-normalize'

const log = createLogger('indexing')

type ProgressEmitter = (p: IndexingProgress) => void

export class IndexingOrchestrator {
  private paused = false
  private running = false
  private embeddingsPython: EmbeddingsPythonManager
  private cancelDocIds = new Set<string>()
  private ocr = new OcrService()

  constructor(
    private db: Db,
    private store: AppStore,
    private emitProgress: ProgressEmitter,
    pythonDir: string
  ) {
    this.embeddingsPython = new EmbeddingsPythonManager(pythonDir, store)
    this.recoverFromCrash()
    this.pruneJobs()
  }

  private recoverFromCrash() {
    const tx = this.db.connection.transaction(() => {
      this.db.connection.prepare(`UPDATE indexing_jobs SET status='queued' WHERE status='running'`).run()
      this.db.connection
        .prepare(`UPDATE documents SET indexing_status='queued' WHERE indexing_status='indexing'`)
        .run()
    })
    tx()
  }

  private pruneJobs() {
    try {
      const keep = 500
      const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000
      const tx = this.db.connection.transaction(() => {
        this.db.connection
          .prepare(`DELETE FROM indexing_jobs WHERE status IN ('done','failed','canceled') AND updated_at < ?`)
          .run(cutoff)
        const extra = this.db.connection
          .prepare(`SELECT id FROM indexing_jobs ORDER BY updated_at DESC LIMIT -1 OFFSET ?`)
          .all(keep) as any[]
        if (extra.length) {
          const ids = extra.map((r) => String(r.id))
          // On garde toujours les jobs actifs.
          this.db.connection
            .prepare(
              `DELETE FROM indexing_jobs
               WHERE id IN (${ids.map(() => '?').join(',')})
                 AND status IN ('done','failed','canceled')`
            )
            .run(...ids)
        }
      })
      tx()
    } catch {
      // On ignore cette purge si elle échoue.
    }
  }

  getEmbeddingsClient() {
    return this.embeddingsPython.getClient()
  }

  async ensureEmbeddingsReady() {
    await this.embeddingsPython.ensureStarted()
  }

  queueAll(includeIndexed: boolean) {
    const rows = this.db.connection
      .prepare(
        includeIndexed
          ? `SELECT id FROM documents`
          : `SELECT id FROM documents WHERE indexing_status IN ('not_indexed','failed')`
      )
      .all() as any[]
    for (const r of rows) this.queueDoc(String(r.id))
  }

  queueAllNotIndexed() {
    this.queueAll(false)
  }

  queueDoc(docId: string) {
    const now = Date.now()
    const jobId = nanoid()
    const tx = this.db.connection.transaction(() => {
      const cur = this.db.connection
        .prepare(`SELECT indexing_status as s FROM documents WHERE id=?`)
        .get(docId) as any
      if (cur?.s === 'queued' || cur?.s === 'indexing') return

      this.db.connection.prepare(`DELETE FROM indexing_jobs WHERE doc_id=? AND status IN ('queued','running')`).run(docId)
      this.db.connection
        .prepare(`UPDATE documents SET indexing_status='queued', last_error=NULL WHERE id=?`)
        .run(docId)
      this.db.connection
        .prepare(
          `INSERT INTO indexing_jobs(id, doc_id, status, created_at, updated_at, error)
           VALUES (?, ?, 'queued', ?, ?, NULL)`
        )
        .run(jobId, docId, now, now)
    })
    tx()
  }

  pause() {
    this.paused = true
  }

  resume() {
    this.paused = false
  }

  cancelDoc(docId: string) {
    this.cancelDocIds.add(docId)
  }

  cancelAll() {
    const rows = this.db.connection.prepare(`SELECT doc_id as docId FROM indexing_jobs WHERE status IN ('queued','running')`).all() as any[]
    for (const r of rows) this.cancelDocIds.add(String(r.docId))
    this.db.connection.prepare(`DELETE FROM indexing_jobs WHERE status='queued'`).run()
    this.db.connection
      .prepare(`UPDATE documents SET indexing_status='not_indexed' WHERE indexing_status='queued'`)
      .run()
  }

  kick() {
    if (this.paused || this.running) return
    void this.runNext()
  }

  private async runNext() {
    if (this.paused || this.running) return

    const job = this.db.connection
      .prepare(`SELECT id, doc_id as docId FROM indexing_jobs WHERE status='queued' ORDER BY created_at ASC LIMIT 1`)
      .get() as any
    if (!job) return

    this.running = true
    try {
      await this.processJob(String(job.id), String(job.docId))
      this.db.connection.prepare(`UPDATE indexing_jobs SET status='done', updated_at=? WHERE id=?`).run(Date.now(), job.id)
      this.kick()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      const now = Date.now()
      if (msg.toLowerCase().includes('cancel')) {
        log.info({ docId: job.docId }, 'job canceled')
        this.cancelDocIds.delete(String(job.docId))
        const tx = this.db.connection.transaction(() => {
          this.db.connection.prepare(`UPDATE indexing_jobs SET status='canceled', updated_at=?, error=NULL WHERE id=?`).run(now, job.id)
          this.db.connection
            .prepare(`UPDATE documents SET indexing_status='not_indexed', last_error=NULL WHERE id=?`)
            .run(job.docId)
        })
        tx()
      } else {
        log.error({ err }, 'job failed')
        const tx = this.db.connection.transaction(() => {
          this.db.connection
            .prepare(`UPDATE indexing_jobs SET status='failed', updated_at=?, error=? WHERE id=?`)
            .run(now, msg, job.id)
          this.db.connection
            .prepare(`UPDATE documents SET indexing_status='failed', last_error=? WHERE id=?`)
            .run(msg, job.docId)
        })
        tx()
      }
      this.kick()
    } finally {
      this.running = false
    }
  }

  private async processJob(jobId: string, docId: string) {
    if (this.cancelDocIds.has(docId)) {
      this.cancelDocIds.delete(docId)
      this.db.connection.prepare(`UPDATE indexing_jobs SET status='canceled', updated_at=? WHERE id=?`).run(Date.now(), jobId)
      this.db.connection.prepare(`UPDATE documents SET indexing_status='not_indexed' WHERE id=?`).run(docId)
      return
    }
    const row = this.db.connection.prepare(`SELECT path FROM documents WHERE id=?`).get(docId) as any
    if (!row?.path) throw new Error('Document not found')
    const pdfPath = String(row.path)

    this.db.connection.prepare(`UPDATE indexing_jobs SET status='running', updated_at=? WHERE id=?`).run(Date.now(), jobId)
    this.db.connection.prepare(`UPDATE documents SET indexing_status='indexing' WHERE id=?`).run(docId)

    const cfg = this.store.getConfig()

    this.emitProgress({
      jobId,
      docId,
      stage: 'extract',
      processedPages: 0,
      totalPages: null,
      processedChunks: 0,
      totalChunks: null,
      message: 'Extraction du texte…'
    })

    const extractor = new PdfTextExtractor()
    const { pages, pageCount } = await extractor.extractPages(pdfPath, (done, total) => {
      if (this.cancelDocIds.has(docId)) throw new Error('Cancelled')
      this.emitProgress({
        jobId,
        docId,
        stage: 'extract',
        processedPages: done,
        totalPages: total,
        processedChunks: 0,
        totalChunks: null,
        message: null
      })
    })

    this.db.connection.prepare(`UPDATE documents SET page_count=? WHERE id=?`).run(pageCount, docId)

    this.emitProgress({
      jobId,
      docId,
      stage: 'chunk',
      processedPages: pageCount,
      totalPages: pageCount,
      processedChunks: 0,
      totalChunks: null,
      message: 'Découpage en chunks…'
    })

    const totalChars = pages.reduce((s, p) => s + p.text.length, 0)
    const avgChars = pageCount ? totalChars / pageCount : 0
    const lowTextPages = pages.filter((p) => p.text.length < 40)
    const veryLowTextPages = pages.filter((p) => p.text.length < 20)
    const scannedLikely = pageCount ? avgChars < 25 || veryLowTextPages.length / pageCount > 0.85 : false

    let usedOcr = false
    const pagesOcrText = new Map<number, string>()
    const pagesUsedText = new Map<number, string>(pages.map((p) => [p.pageNumber, p.text]))
    const ocrCandidates = pages
      .filter((p) => p.text.length < Math.max(40, avgChars * 0.25))
      .map((p) => p.pageNumber)

    if (cfg.ocr.enabled && ocrCandidates.length > 0 && (scannedLikely || lowTextPages.length >= Math.max(2, Math.ceil(pageCount * 0.12)))) {
      this.emitProgress({
        jobId,
        docId,
        stage: 'ocr',
        processedPages: 0,
        totalPages: pageCount,
        processedChunks: 0,
        totalChunks: null,
        message: 'OCR (PDF scanné)…'
      })

      const toOcr = ocrCandidates
      const rendered = await renderPdfPagesToPng(pdfPath, toOcr, 2.25)
      let done = 0
      for (const r of rendered) {
        if (this.cancelDocIds.has(docId)) throw new Error('Cancelled')
        const raw = await this.ocr.recognizeImage(r.png, cfg.ocr.language)
        const text = normalizeExtractedText(raw)
        pagesOcrText.set(r.pageNumber, text)
        if (text.length > (pagesUsedText.get(r.pageNumber)?.length ?? 0)) {
          pagesUsedText.set(r.pageNumber, text)
          usedOcr = true
        }
        done++
        this.emitProgress({
          jobId,
          docId,
          stage: 'ocr',
          processedPages: done,
          totalPages: toOcr.length,
          processedChunks: 0,
          totalChunks: null,
          message: null
        })
        await new Promise((x) => setTimeout(x, 0))
      }
    }

    const pagesForChunking = pages.map((p) => ({ pageNumber: p.pageNumber, text: pagesUsedText.get(p.pageNumber) ?? p.text }))
    const finalChars = pagesForChunking.reduce((sum, page) => sum + page.text.length, 0)
    const finalTextQuality = pageCount ? Math.min(1, finalChars / pageCount / 800) : 0

    const chunks = chunkPages(pagesForChunking, {
      targetChars: cfg.chunking.targetChars,
      overlapChars: cfg.chunking.overlapChars
    })

    const now = Date.now()
    const txClear = this.db.connection.transaction(() => {
      this.db.connection.prepare('DELETE FROM pages WHERE doc_id=?').run(docId)
      this.db.connection.prepare('DELETE FROM chunks WHERE doc_id=?').run(docId)
    })
    txClear()

    const insertPage = this.db.connection.prepare(
      `INSERT INTO pages(doc_id, page_number, text, text_ocr, text_used, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    const txPages = this.db.connection.transaction(() => {
      for (const p of pages) {
        const ocrText = pagesOcrText.get(p.pageNumber) ?? null
        const used = pagesUsedText.get(p.pageNumber) ?? p.text
        insertPage.run(docId, p.pageNumber, p.text, ocrText, used, now)
      }
    })
    txPages()

    const insertChunk = this.db.connection.prepare(
      `INSERT INTO chunks(doc_id, page_start, page_end, chunk_index, content, content_hash, created_at)
       VALUES (@doc_id, @page_start, @page_end, @chunk_index, @content, @content_hash, @created_at)`
    )

    const insertEmb = this.db.connection.prepare(
      `INSERT INTO chunk_embeddings(chunk_id, model, dim, embedding, created_at)
       VALUES (?, ?, ?, ?, ?)`
    )

    const txInsert = this.db.connection.transaction(() => {
      for (const ch of chunks) {
        insertChunk.run({
          doc_id: docId,
          page_start: ch.pageStart,
          page_end: ch.pageEnd,
          chunk_index: ch.chunkIndex,
          content: ch.content,
          content_hash: ch.contentHash,
          created_at: now
        })
      }
    })
    txInsert()

    const chunkRows = this.db.connection
      .prepare(`SELECT id, content, content_hash as contentHash FROM chunks WHERE doc_id=? ORDER BY chunk_index ASC`)
      .all(docId) as any[]

    this.emitProgress({
      jobId,
      docId,
      stage: 'embed',
      processedPages: pageCount,
      totalPages: pageCount,
      processedChunks: 0,
      totalChunks: chunkRows.length,
      message: 'Génération des embeddings…'
    })

    const batchSize = 16
    let processed = 0
    let docDim: number | null = null

    let embeddingsAvailable = true
    let embeddingsClient: ReturnType<EmbeddingsPythonManager['getClient']> | null = null
    try {
      await this.embeddingsPython.ensureStarted()
      embeddingsClient = this.embeddingsPython.getClient()
    } catch (err) {
      embeddingsAvailable = false
      this.emitProgress({
        jobId,
        docId,
        stage: 'embed',
        processedPages: pageCount,
        totalPages: pageCount,
        processedChunks: 0,
        totalChunks: chunkRows.length,
        message: "Embeddings indisponibles (Python). Index mots-clés uniquement."
      })
      log.warn({ err }, 'embeddings unavailable; skipping embeddings')
    }

    for (let i = 0; i < chunkRows.length; i += batchSize) {
      if (this.cancelDocIds.has(docId)) throw new Error('Cancelled')
      if (this.paused) {
        this.emitProgress({
          jobId,
          docId,
          stage: 'embed',
          processedPages: pageCount,
          totalPages: pageCount,
          processedChunks: processed,
          totalChunks: chunkRows.length,
          message: 'Pause…'
        })
        while (this.paused) {
          await new Promise((r) => setTimeout(r, 250))
        }
      }

      const slice = chunkRows.slice(i, i + batchSize)
      if (!embeddingsAvailable || !embeddingsClient) {
        processed += slice.length
        continue
      }
      const hashes = slice.map((r) => String(r.contentHash))
      const cacheRows = this.db.connection
        .prepare(
          `SELECT content_hash as contentHash, dim, embedding
           FROM embedding_cache
           WHERE model = ? AND content_hash IN (${hashes.map(() => '?').join(',')})`
        )
        .all(cfg.embeddings.model, ...hashes) as any[]
      const cache = new Map<string, { dim: number; embedding: Buffer }>(
        cacheRows.map((r) => [String(r.contentHash), { dim: Number(r.dim), embedding: r.embedding as Buffer }])
      )
      for (const c of cache.values()) {
        docDim ??= c.dim
      }

      const toCompute: { chunkId: number; contentHash: string; content: string }[] = []
      for (const r of slice) {
        const contentHash = String(r.contentHash)
        const chunkId = Number(r.id)
        const cached = cache.get(contentHash)
        if (cached) {
          insertEmb.run(chunkId, cfg.embeddings.model, cached.dim, cached.embedding, Date.now())
        } else {
          toCompute.push({ chunkId, contentHash, content: String(r.content) })
        }
      }

      if (toCompute.length) {
        let res: { model: string; dim: number; vectors: Float32Array[] } | null = null
        try {
          res = await embeddingsClient.embedTexts(toCompute.map((x) => x.content))
        } catch (err) {
          // On retente une fois après relance.
          try {
            await this.embeddingsPython.ensureStarted()
            embeddingsClient = this.embeddingsPython.getClient()
            res = await embeddingsClient.embedTexts(toCompute.map((x) => x.content))
          } catch (err2) {
            embeddingsAvailable = false
            this.emitProgress({
              jobId,
              docId,
              stage: 'embed',
              processedPages: pageCount,
              totalPages: pageCount,
              processedChunks: processed,
              totalChunks: chunkRows.length,
              message: "Embeddings indisponibles (Python). Index mots-cles uniquement."
            })
            log.warn({ err, err2 }, 'embeddings failed mid-indexing; continuing keyword-only')
          }
        }

        if (res) {
          docDim ??= res.dim
          const insCache = this.db.connection.prepare(
            `INSERT OR IGNORE INTO embedding_cache(content_hash, model, dim, embedding, created_at)
             VALUES (?, ?, ?, ?, ?)`
          )
          const tx = this.db.connection.transaction(() => {
            for (let j = 0; j < toCompute.length; j++) {
              const { chunkId, contentHash } = toCompute[j]!
              const vec = res.vectors[j]!
              const buf = Buffer.from(vec.buffer)
              insCache.run(contentHash, cfg.embeddings.model, res.dim, buf, Date.now())
              insertEmb.run(chunkId, cfg.embeddings.model, res.dim, buf, Date.now())
            }
          })
          tx()
        }
      }

      processed += slice.length
      this.emitProgress({
        jobId,
        docId,
        stage: 'embed',
        processedPages: pageCount,
        totalPages: pageCount,
        processedChunks: processed,
        totalChunks: chunkRows.length,
        message: null
      })

      // On rend la main pour garder l'UI fluide.
      await new Promise((r) => setTimeout(r, 0))
    }

    const finalizeTx = this.db.connection.transaction(() => {
      this.db.connection
        .prepare(
          `UPDATE documents
           SET indexing_status='indexed', last_error=NULL, indexed_at=?, embedding_model=?, embedding_dim=?,
               used_ocr=?, text_quality=?
           WHERE id=?`
        )
        .run(
          Date.now(),
          embeddingsAvailable ? cfg.embeddings.model : null,
          embeddingsAvailable ? docDim ?? null : null,
          usedOcr ? 1 : 0,
          finalTextQuality,
          docId
        )
    })
    finalizeTx()

    this.emitProgress({
      jobId,
      docId,
      stage: 'finalize',
      processedPages: pageCount,
      totalPages: pageCount,
      processedChunks: chunkRows.length,
      totalChunks: chunkRows.length,
      message: 'Terminé.'
    })
  }

  dispose() {
    this.embeddingsPython.dispose()
    void this.ocr.dispose()
  }
}
