PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS collections (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT,
  created_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_collections_name ON collections(name);

CREATE TABLE IF NOT EXISTS document_collections (
  doc_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (doc_id, collection_id)
);

CREATE INDEX IF NOT EXISTS idx_doc_collections_collection ON document_collections(collection_id);

CREATE TABLE IF NOT EXISTS document_tags (
  doc_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (doc_id, tag)
);

CREATE INDEX IF NOT EXISTS idx_doc_tags_tag ON document_tags(tag);

