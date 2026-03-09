PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS pages (
  doc_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  page_number INTEGER NOT NULL,
  text TEXT NOT NULL,
  text_ocr TEXT,
  text_used TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (doc_id, page_number)
);

CREATE INDEX IF NOT EXISTS idx_pages_doc ON pages(doc_id);

