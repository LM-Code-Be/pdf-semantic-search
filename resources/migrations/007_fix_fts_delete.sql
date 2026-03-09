PRAGMA foreign_keys = ON;

-- Fix FTS5 delete triggers: FTS5 "delete" command should only include indexed columns.
DROP TRIGGER IF EXISTS chunks_ad;
DROP TRIGGER IF EXISTS chunks_au;

CREATE TRIGGER IF NOT EXISTS chunks_ad AFTER DELETE ON chunks BEGIN
  INSERT INTO fts_chunks(fts_chunks, rowid, content) VALUES('delete', old.id, old.content);
END;

CREATE TRIGGER IF NOT EXISTS chunks_au AFTER UPDATE ON chunks BEGIN
  INSERT INTO fts_chunks(fts_chunks, rowid, content) VALUES('delete', old.id, old.content);
  INSERT INTO fts_chunks(rowid, content, doc_id, chunk_id) VALUES (new.id, new.content, new.doc_id, new.id);
END;

