PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS search_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  query TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_search_history_created ON search_history(created_at DESC);

CREATE TABLE IF NOT EXISTS favorite_chunks (
  chunk_id INTEGER PRIMARY KEY REFERENCES chunks(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
);

