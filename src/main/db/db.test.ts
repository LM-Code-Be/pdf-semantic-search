import { describe, expect, it } from 'vitest'
import os from 'node:os'
import fs from 'node:fs'
import path from 'node:path'

let canLoadBetterSqlite3 = true
try {
  const mod = await import('better-sqlite3')
  const Database = (mod as any).default ?? (mod as any)
  const db = new Database(':memory:')
  db.close()
} catch {
  canLoadBetterSqlite3 = false
}

describe('Db migrations', () => {
  it.runIf(canLoadBetterSqlite3)('applies init migration and creates tables', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-ss-'))
    const { Db } = await import('./db')
    const db = new Db(tmp, process.cwd())
    db.migrate()
    const tables = db.connection
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`)
      .all()
      .map((r: any) => r.name)
    expect(tables).toContain('documents')
    expect(tables).toContain('chunks')
    expect(tables).toContain('chunk_embeddings')
    db.close()
  })
})
