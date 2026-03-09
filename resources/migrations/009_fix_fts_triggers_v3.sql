PRAGMA foreign_keys = ON;

-- Correct FTS5 synchronization for contentful tables: use DELETE/UPDATE directly on the virtual table.
DROP TRIGGER IF EXISTS chunks_ai;
DROP TRIGGER IF EXISTS chunks_ad;
DROP TRIGGER IF EXISTS chunks_au;

CREATE TRIGGER chunks_ai AFTER INSERT ON chunks BEGIN
  INSERT INTO fts_chunks(rowid, content, doc_id, chunk_id) VALUES (new.id, new.content, new.doc_id, new.id);
END;

CREATE TRIGGER chunks_ad AFTER DELETE ON chunks BEGIN
  DELETE FROM fts_chunks WHERE rowid = old.id;
END;

CREATE TRIGGER chunks_au AFTER UPDATE ON chunks BEGIN
  UPDATE fts_chunks
  SET content = new.content,
      doc_id = new.doc_id,
      chunk_id = new.id
  WHERE rowid = new.id;
END;

