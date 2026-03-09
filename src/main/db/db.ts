import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import { createLogger } from '../logger'

const log = createLogger('db')

export class Db {
  private db: Database.Database
  private migrationsDir: string

  constructor(userDataPath: string, appRootPath: string) {
    const dataDir = path.join(userDataPath, 'data')
    fs.mkdirSync(dataDir, { recursive: true })
    const dbPath = path.join(dataDir, 'app.sqlite')
    this.db = new Database(dbPath)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('foreign_keys = ON')
    this.db.pragma('busy_timeout = 5000')

    this.migrationsDir = path.join(appRootPath, 'resources', 'migrations')
  }

  private ensureFtsTriggers() {
    // On corrige ici les anciens triggers FTS incompatibles.
    try {
      const fts = this.db
        .prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='fts_chunks' LIMIT 1`)
        .get()
      if (!fts) return

      const ad = this.db
        .prepare(`SELECT sql FROM sqlite_master WHERE type='trigger' AND name='chunks_ad' LIMIT 1`)
        .get() as any
      const adSql = (ad?.sql ? String(ad.sql) : '').toLowerCase()
      const needsFix = adSql.includes('insert into fts_chunks') && adSql.includes("values('delete'")
      if (!needsFix) return

      const tx = this.db.transaction(() => {
        this.db.exec(`
          DROP TRIGGER IF EXISTS chunks_ai;
          DROP TRIGGER IF EXISTS chunks_ad;
          DROP TRIGGER IF EXISTS chunks_au;

          CREATE TRIGGER IF NOT EXISTS chunks_ai AFTER INSERT ON chunks BEGIN
            INSERT INTO fts_chunks(rowid, content, doc_id, chunk_id) VALUES (new.id, new.content, new.doc_id, new.id);
          END;

          CREATE TRIGGER IF NOT EXISTS chunks_ad AFTER DELETE ON chunks BEGIN
            DELETE FROM fts_chunks WHERE rowid = old.id;
          END;

          CREATE TRIGGER IF NOT EXISTS chunks_au AFTER UPDATE ON chunks BEGIN
            UPDATE fts_chunks
            SET content = new.content,
                doc_id = new.doc_id,
                chunk_id = new.id
            WHERE rowid = new.id;
          END;
        `)
      })
      tx()
      log.info({ fixup: 'fts-triggers' }, 'applied db fixup')
    } catch (err) {
      log.warn({ err, fixup: 'fts-triggers' }, 'db fixup failed (ignored)')
    }
  }

  migrate() {
    if (!fs.existsSync(this.migrationsDir)) {
      log.warn({ migrationsDir: this.migrationsDir }, 'migrations dir not found; skipping')
      return
    }

    this.db.exec(
      `CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at INTEGER NOT NULL);`
    )

    const applied = new Set<string>(
      this.db.prepare('SELECT version FROM schema_migrations').all().map((r: any) => String(r.version))
    )

    const files = fs
      .readdirSync(this.migrationsDir)
      .filter((f) => /^\d+_.+\.sql$/i.test(f))
      .sort()

    const now = Date.now()
    const insert = this.db.prepare('INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)')

    for (const file of files) {
      if (applied.has(file)) continue
      const sql = fs.readFileSync(path.join(this.migrationsDir, file), 'utf8')
      const tx = this.db.transaction(() => {
        this.db.exec(sql)
        insert.run(file, now)
      })
      tx()
      log.info({ migration: file }, 'applied migration')
    }

    this.ensureFtsTriggers()
  }

  get connection() {
    return this.db
  }

  close() {
    this.db.close()
  }
}
