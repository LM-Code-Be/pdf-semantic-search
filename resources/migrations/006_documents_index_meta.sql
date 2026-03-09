PRAGMA foreign_keys = ON;

ALTER TABLE documents ADD COLUMN indexed_at INTEGER;
ALTER TABLE documents ADD COLUMN embedding_model TEXT;
ALTER TABLE documents ADD COLUMN embedding_dim INTEGER;
ALTER TABLE documents ADD COLUMN used_ocr INTEGER NOT NULL DEFAULT 0;
ALTER TABLE documents ADD COLUMN text_quality REAL;

