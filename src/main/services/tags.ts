import type { Db } from '../db/db'

export class TagsService {
  constructor(private db: Db) {}

  listAll(): string[] {
    const rows = this.db.connection.prepare(`SELECT DISTINCT tag FROM document_tags ORDER BY tag ASC`).all() as any[]
    return rows.map((r) => String(r.tag))
  }

  setForDoc(docId: string, tags: string[]) {
    const now = Date.now()
    const del = this.db.connection.prepare(`DELETE FROM document_tags WHERE doc_id=?`)
    const ins = this.db.connection.prepare(`INSERT INTO document_tags(doc_id, tag, created_at) VALUES (?, ?, ?)`)
    const norm = Array.from(
      new Set(
        tags
          .map((t) => t.trim())
          .filter(Boolean)
          .map((t) => t.toLowerCase())
      )
    ).slice(0, 50)

    const tx = this.db.connection.transaction(() => {
      del.run(docId)
      for (const t of norm) ins.run(docId, t, now)
    })
    tx()
  }
}

