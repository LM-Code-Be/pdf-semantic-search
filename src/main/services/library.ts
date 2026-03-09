import fs from 'node:fs'
import path from 'node:path'
import { nanoid } from 'nanoid'
import type { Db } from '../db/db'
import type { PdfDocument } from '@shared/models'

function toFileName(p: string) {
  return path.basename(p)
}

export class LibraryService {
  constructor(private db: Db) {}

  importFiles(paths: string[]) {
    const insert = this.db.connection.prepare(
      `INSERT INTO documents(id, path, file_name, file_size, added_at, page_count, indexing_status, last_error)
       VALUES (@id, @path, @file_name, @file_size, @added_at, NULL, 'not_indexed', NULL)`
    )
    const exists = this.db.connection.prepare(`SELECT 1 FROM documents WHERE path = ? LIMIT 1`)

    let imported = 0
    const docIds: string[] = []
    const now = Date.now()
    const tx = this.db.connection.transaction(() => {
      for (const p of paths) {
        if (!p.toLowerCase().endsWith('.pdf')) continue
        if (exists.get(p)) continue
        const stat = fs.statSync(p)
        const id = nanoid()
        insert.run({
          id,
          path: p,
          file_name: toFileName(p),
          file_size: stat.size,
          added_at: now
        })
        imported++
        docIds.push(id)
      }
    })
    tx()
    return { imported, docIds }
  }

  importFolderRecursive(dirPath: string) {
    const paths: string[] = []
    const walk = (dir: string) => {
      let entries: fs.Dirent[] = []
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true })
      } catch {
        return
      }
      for (const e of entries) {
        const full = path.join(dir, e.name)
        if (e.isDirectory()) walk(full)
        else if (e.isFile() && full.toLowerCase().endsWith('.pdf')) paths.push(full)
      }
    }
    walk(dirPath)
    return this.importFiles(paths)
  }

  listDocuments(): PdfDocument[] {
    const rows = this.db.connection
      .prepare(
        `SELECT id, path, file_name as fileName, file_size as fileSize, added_at as addedAt, page_count as pageCount,
                indexing_status as indexingStatus, last_error as lastError,
                indexed_at as indexedAt, embedding_model as embeddingModel, embedding_dim as embeddingDim,
                used_ocr as usedOcr, text_quality as textQuality
         FROM documents
         ORDER BY added_at DESC`
      )
      .all()
    const docs = rows as any[]

    const colStmt = this.db.connection.prepare(
      `SELECT c.id as id, c.name as name, c.color as color
       FROM document_collections dc
       JOIN collections c ON c.id = dc.collection_id
       WHERE dc.doc_id = ?`
    )
    const tagStmt = this.db.connection.prepare(`SELECT tag FROM document_tags WHERE doc_id=? ORDER BY tag`)

    return docs.map((d) => {
      const collections = colStmt.all(d.id) as any[]
      const tags = (tagStmt.all(d.id) as any[]).map((r) => String(r.tag))
      return {
        ...d,
        usedOcr: Boolean(d.usedOcr),
        collections,
        tags
      } satisfies PdfDocument
    })
  }

  removeDocument(docId: string) {
    const tx = this.db.connection.transaction(() => {
      this.db.connection.prepare('DELETE FROM documents WHERE id = ?').run(docId)
    })
    tx()
  }

  getDocumentPath(docId: string): string | null {
    let row = this.db.connection.prepare('SELECT path FROM documents WHERE id = ?').get(docId) as any
    if (!row && docId) {
      row = this.db.connection.prepare('SELECT path FROM documents WHERE lower(id) = lower(?) LIMIT 1').get(docId) as any
    }
    return row?.path ?? null
  }
}
