-- Enable pgvector
CREATE EXTENSION IF NOT EXISTS vector;

-- ── documents (replaces files + markdown_files) ──────────────────────────────
CREATE TABLE IF NOT EXISTS documents (
  id                  BIGSERIAL PRIMARY KEY,
  parent_document_id  BIGINT REFERENCES documents(id) ON DELETE CASCADE,
  original_filename   TEXT NOT NULL,
  file_type           TEXT NOT NULL,
  mime_type           TEXT,
  file_size           BIGINT NOT NULL,
  file_hash           TEXT NOT NULL UNIQUE,
  storage_path        TEXT,
  extracted_text      TEXT,
  summary             TEXT,
  keywords            JSONB,
  processing_status   TEXT NOT NULL DEFAULT 'uploaded'
    CHECK (processing_status IN
      ('uploaded','extracting','chunking','embedding','completed','failed')),
  processing_error    TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at        TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_documents_hash ON documents(file_hash);
CREATE INDEX IF NOT EXISTS idx_documents_parent ON documents(parent_document_id);
CREATE INDEX IF NOT EXISTS idx_documents_status ON documents(processing_status);
CREATE INDEX IF NOT EXISTS idx_documents_fts
  ON documents USING gin(to_tsvector('english', COALESCE(extracted_text, '')));

-- ── document_chunks ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS document_chunks (
  id             BIGSERIAL PRIMARY KEY,
  document_id    BIGINT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  chunk_index    INTEGER NOT NULL,
  chunk_text     TEXT NOT NULL,
  embedding      vector(384),
  token_count    INTEGER,
  page_number    INTEGER,
  section_title  TEXT,
  metadata       JSONB,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (document_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS idx_chunks_document ON document_chunks(document_id);
CREATE INDEX IF NOT EXISTS idx_chunks_fts
  ON document_chunks USING gin(to_tsvector('english', chunk_text));

-- ── document_locations ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS document_locations (
  id              BIGSERIAL PRIMARY KEY,
  document_id     BIGINT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  root_folder     TEXT NOT NULL,
  subfolder_path  TEXT NOT NULL DEFAULT '',
  filename        TEXT NOT NULL,
  scanned_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (document_id, root_folder, subfolder_path, filename)
);

-- ── tags ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tags (
  id    BIGSERIAL PRIMARY KEY,
  name  TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS document_tags (
  document_id  BIGINT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  tag_id       BIGINT NOT NULL REFERENCES tags(id)      ON DELETE CASCADE,
  PRIMARY KEY (document_id, tag_id)
);

-- ── notes ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notes (
  id           BIGSERIAL PRIMARY KEY,
  document_id  BIGINT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  content      TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── cases ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cases (
  id           BIGSERIAL PRIMARY KEY,
  name         TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS case_documents (
  case_id      BIGINT NOT NULL REFERENCES cases(id)     ON DELETE CASCADE,
  document_id  BIGINT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  added_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (case_id, document_id)
);

-- ── chats ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS chats (
  id           BIGSERIAL PRIMARY KEY,
  document_ids JSONB NOT NULL,
  title        TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id         BIGSERIAL PRIMARY KEY,
  chat_id    BIGINT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  role       TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content    TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── analyses ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS analyses (
  id           BIGSERIAL PRIMARY KEY,
  document_ids JSONB NOT NULL,
  prompt       TEXT NOT NULL,
  response     TEXT NOT NULL,
  model        TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
