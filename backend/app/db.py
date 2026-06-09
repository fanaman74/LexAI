import sqlite3
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sha256 TEXT NOT NULL UNIQUE,
  original_name TEXT NOT NULL,
  file_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  content BLOB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','converted','failed','needs_ocr')),
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS file_locations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  root_folder TEXT NOT NULL,
  subfolder_path TEXT NOT NULL DEFAULT '',
  filename TEXT NOT NULL,
  scanned_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (file_id, root_folder, subfolder_path, filename)
);

CREATE TABLE IF NOT EXISTS markdown_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_id INTEGER NOT NULL UNIQUE REFERENCES files(id) ON DELETE CASCADE,
  content_md TEXT NOT NULL,
  converter_used TEXT NOT NULL,
  converted_at TEXT NOT NULL DEFAULT (datetime('now')),
  word_count INTEGER NOT NULL DEFAULT 0
);

CREATE VIRTUAL TABLE IF NOT EXISTS markdown_fts USING fts5(
  content_md, content='markdown_files', content_rowid='id'
);

CREATE TRIGGER IF NOT EXISTS markdown_ai AFTER INSERT ON markdown_files BEGIN
  INSERT INTO markdown_fts(rowid, content_md) VALUES (new.id, new.content_md);
END;
CREATE TRIGGER IF NOT EXISTS markdown_ad AFTER DELETE ON markdown_files BEGIN
  INSERT INTO markdown_fts(markdown_fts, rowid, content_md)
    VALUES ('delete', old.id, old.content_md);
END;
CREATE TRIGGER IF NOT EXISTS markdown_au AFTER UPDATE ON markdown_files BEGIN
  INSERT INTO markdown_fts(markdown_fts, rowid, content_md)
    VALUES ('delete', old.id, old.content_md);
  INSERT INTO markdown_fts(rowid, content_md) VALUES (new.id, new.content_md);
END;

CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS file_tags (
  file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (file_id, tag_id)
);

CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS analyses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_ids TEXT NOT NULL,
  prompt TEXT NOT NULL,
  response TEXT NOT NULL,
  model TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
"""


def get_conn(db_path) -> sqlite3.Connection:
    Path(db_path).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA busy_timeout = 5000")
    return conn


def init_db(conn: sqlite3.Connection) -> None:
    conn.executescript(SCHEMA)
    conn.commit()
