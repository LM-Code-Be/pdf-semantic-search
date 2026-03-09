const fs = require('node:fs')
const path = require('node:path')
const Database = require('better-sqlite3')

function applyMigrations(db) {
  const migDir = path.join(process.cwd(), 'resources', 'migrations')
  for (const f of fs.readdirSync(migDir).filter((x) => x.endsWith('.sql')).sort()) {
    db.exec(fs.readFileSync(path.join(migDir, f), 'utf8'))
  }
}

function main() {
  const db = new Database(':memory:')
  db.pragma('foreign_keys=ON')
  applyMigrations(db)

  function runCase(name, triggerSql) {
    db.exec('DROP TRIGGER IF EXISTS chunks_ai; DROP TRIGGER IF EXISTS chunks_ad; DROP TRIGGER IF EXISTS chunks_au;')
    db.exec('DELETE FROM fts_chunks; DELETE FROM chunks; DELETE FROM documents;')
    db.exec(triggerSql)

    db.prepare(
      'INSERT INTO documents(id,path,file_name,file_size,added_at,indexing_status,last_error) VALUES (?,?,?,?,?,?,?)'
    ).run('d1', '/tmp/a.pdf', 'a.pdf', 1, Date.now(), 'indexed', null)
    db.prepare(
      'INSERT INTO chunks(doc_id,page_start,page_end,chunk_index,content,content_hash,created_at) VALUES (?,?,?,?,?,?,?)'
    ).run('d1', 1, 1, 0, 'hello world', 'h', Date.now())

    try {
      db.prepare('DELETE FROM chunks WHERE doc_id=?').run('d1')
      console.log(`\n${name}: DELETE ok`)
    } catch (e) {
      console.error(`\n${name}: DELETE failed:`, e.message)
    }
  }

  runCase(
    'fts-insert-delete-command',
    `CREATE TRIGGER chunks_ai AFTER INSERT ON chunks BEGIN
        INSERT INTO fts_chunks(rowid, content, doc_id, chunk_id) VALUES (new.id, new.content, new.doc_id, new.id);
      END;
      CREATE TRIGGER chunks_ad AFTER DELETE ON chunks BEGIN
        INSERT INTO fts_chunks(fts_chunks, rowid) VALUES('delete', old.id);
      END;
      CREATE TRIGGER chunks_au AFTER UPDATE ON chunks BEGIN
        INSERT INTO fts_chunks(fts_chunks, rowid) VALUES('delete', old.id);
        INSERT INTO fts_chunks(rowid, content, doc_id, chunk_id) VALUES (new.id, new.content, new.doc_id, new.id);
      END;`
  )

  runCase(
    'fts-direct-delete',
    `CREATE TRIGGER chunks_ai AFTER INSERT ON chunks BEGIN
        INSERT INTO fts_chunks(rowid, content, doc_id, chunk_id) VALUES (new.id, new.content, new.doc_id, new.id);
      END;
      CREATE TRIGGER chunks_ad AFTER DELETE ON chunks BEGIN
        DELETE FROM fts_chunks WHERE rowid = old.id;
      END;
      CREATE TRIGGER chunks_au AFTER UPDATE ON chunks BEGIN
        UPDATE fts_chunks SET content = new.content, doc_id = new.doc_id, chunk_id = new.id WHERE rowid = new.id;
      END;`
  )

  db.close()
}

main()
