import { nanoid } from 'nanoid'
import type { Db } from '../db/db'

export type CollectionRow = { id: string; name: string; color: string | null; createdAt: number }

export class CollectionsService {
  constructor(private db: Db) {}

  list(): CollectionRow[] {
    return this.db.connection
      .prepare(`SELECT id, name, color, created_at as createdAt FROM collections ORDER BY name ASC`)
      .all() as any
  }

  create(name: string, color: string | null) {
    const now = Date.now()
    this.db.connection
      .prepare(`INSERT INTO collections(id, name, color, created_at) VALUES (?, ?, ?, ?)`)
      .run(nanoid(), name.trim(), color, now)
  }

  rename(id: string, name: string) {
    this.db.connection.prepare(`UPDATE collections SET name=? WHERE id=?`).run(name.trim(), id)
  }

  setColor(id: string, color: string | null) {
    this.db.connection.prepare(`UPDATE collections SET color=? WHERE id=?`).run(color, id)
  }

  delete(id: string) {
    this.db.connection.prepare(`DELETE FROM collections WHERE id=?`).run(id)
  }

  setForDoc(docId: string, collectionIds: string[]) {
    const now = Date.now()
    const del = this.db.connection.prepare(`DELETE FROM document_collections WHERE doc_id=?`)
    const ins = this.db.connection.prepare(
      `INSERT INTO document_collections(doc_id, collection_id, created_at) VALUES (?, ?, ?)`
    )
    const tx = this.db.connection.transaction(() => {
      del.run(docId)
      for (const cid of collectionIds) ins.run(docId, cid, now)
    })
    tx()
  }
}
