# Vector Pipeline & Search Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the SQLite/fastembed stack with Supabase+pgvector, add a robust token-aware chunking pipeline with processing-status tracking, email-attachment child documents, hybrid search, and a dedicated Search page in the frontend.

**Architecture:** PostgreSQL (Supabase) replaces SQLite as the primary store; `documents` + `document_chunks` tables replace `files` + `chunks` + `markdown_files`; a `pipeline.py` orchestrator drives each file through `uploaded → extracting → chunking → embedding → completed/failed`; the frontend gets a standalone `/search` page (keyword + semantic + hybrid) and the Library becomes a pure document-management view.

**Tech Stack:** Python/FastAPI · Supabase (PostgreSQL + pgvector) · psycopg[binary] · tiktoken · fastembed or OpenRouter · React/TypeScript/Tailwind

---

## Scope overview — 8 tasks

| # | Task | Produces |
|---|------|----------|
| 1 | Supabase schema + env | SQL migration, updated db.py, .env.example |
| 2 | Token-aware chunking | new chunking.py, tests |
| 3 | Text extraction + page/section metadata | updated convert.py |
| 4 | Pipeline orchestrator | pipeline.py, updated store.py, ingest.py |
| 5 | Email attachment child-documents | convert.py additions, pipeline.py hook |
| 6 | Embeddings → pgvector | updated embeddings.py, vectors.py, indexer.py (auto) |
| 7 | Hybrid search backend | semantic.py rewrite, search.py hybrid endpoint |
| 8 | Search page (frontend) | Search.tsx, updated Library.tsx, Sidebar.tsx, api.ts |

---

## Task 1: Supabase schema + environment

**Files:**
- Create: `backend/migrations/001_initial.sql`
- Modify: `backend/app/db.py`
- Modify: `backend/requirements.txt`
- Modify: `.env.example`

### Why Supabase?
pgvector enables native `<=>` cosine distance queries — no numpy brute-force at scale. Supabase adds hosted PostgreSQL with built-in REST and realtime if needed later. All existing tables migrate; nothing is thrown away except the SQLite file.

- [ ] **Step 1: Add dependencies**

```
# backend/requirements.txt — add these lines
psycopg[binary]
pgvector
tiktoken
supabase
```

Run: `cd backend && source .venv/bin/activate && pip install psycopg[binary] pgvector tiktoken supabase`
Expected: installs without error.

- [ ] **Step 2: Write migration SQL**

Create `backend/migrations/001_initial.sql`:

```sql
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
  storage_path        TEXT,           -- relative path under data/files/
  extracted_text      TEXT,           -- full extracted markdown
  summary             TEXT,
  keywords            JSONB,          -- ["kw1","kw2",...]
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

-- Full-text search on extracted content
CREATE INDEX IF NOT EXISTS idx_documents_fts
  ON documents USING gin(to_tsvector('english', COALESCE(extracted_text, '')));

-- ── document_chunks ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS document_chunks (
  id             BIGSERIAL PRIMARY KEY,
  document_id    BIGINT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  chunk_index    INTEGER NOT NULL,
  chunk_text     TEXT NOT NULL,
  embedding      vector(384),         -- dimension matches BAAI/bge-small-en-v1.5
  token_count    INTEGER,
  page_number    INTEGER,
  section_title  TEXT,
  metadata       JSONB,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (document_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS idx_chunks_document ON document_chunks(document_id);
-- Cosine similarity index (IVFFlat — good up to ~100k chunks)
CREATE INDEX IF NOT EXISTS idx_chunks_embedding
  ON document_chunks USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- Full-text index on chunk text
CREATE INDEX IF NOT EXISTS idx_chunks_fts
  ON document_chunks USING gin(to_tsvector('english', chunk_text));

-- ── document_locations (unchanged concept) ───────────────────────────────────
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
```

- [ ] **Step 3: Update .env.example**

```
# .env.example
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your-service-role-key    # Settings → API → service_role

OPENROUTER_API_KEY=
CHAT_MODEL=google/gemini-2.5-flash
EMBEDDING_PROVIDER=local          # local | openrouter
LOCAL_EMBEDDING_MODEL=BAAI/bge-small-en-v1.5
EMBEDDING_MODEL=openai/text-embedding-3-small

# Storage: files saved here on disk (relative to project root)
FILES_DIR=data/files
```

- [ ] **Step 4: Rewrite backend/app/db.py**

```python
# backend/app/db.py
import os
from contextlib import contextmanager

import psycopg
from psycopg.rows import dict_row


def _dsn() -> str:
    url = os.environ.get("SUPABASE_URL", "")
    key = os.environ.get("SUPABASE_SERVICE_KEY", "")
    if not url or not key:
        raise RuntimeError(
            "SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in .env")
    # Convert Supabase REST URL → PostgreSQL DSN
    # e.g. https://xyz.supabase.co → postgresql://postgres:KEY@db.xyz.supabase.co:5432/postgres
    host = url.replace("https://", "db.") + ":5432"
    return f"postgresql://postgres:{key}@{host}/postgres?sslmode=require"


def get_conn():
    """Return a psycopg connection with dict_row factory."""
    return psycopg.connect(_dsn(), row_factory=dict_row)


@contextmanager
def conn_ctx():
    conn = get_conn()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def run_migration(sql_path: str) -> None:
    """Execute a .sql migration file idempotently."""
    with open(sql_path) as f:
        sql = f.read()
    with conn_ctx() as conn:
        conn.execute(sql)
```

- [ ] **Step 5: Update deps.py**

```python
# backend/app/deps.py
from fastapi import Request
import psycopg
from psycopg.rows import dict_row
from .db import get_conn


def get_db(request: Request):
    conn = get_conn()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
```

- [ ] **Step 6: Run migration against Supabase**

```bash
# In backend/ with .venv activated
python - <<'EOF'
from app.db import run_migration
run_migration("migrations/001_initial.sql")
print("Migration complete")
EOF
```

Expected: `Migration complete` with no errors.

- [ ] **Step 7: Commit**

```bash
git add backend/migrations/001_initial.sql backend/app/db.py backend/app/deps.py backend/requirements.txt .env.example
git commit -m "feat: add Supabase+pgvector schema and db layer"
```

---

## Task 2: Token-aware semantic chunking

**Files:**
- Modify: `backend/app/chunking.py`
- Modify: `backend/tests/test_chunking.py`

Token-aware chunking uses `tiktoken` to measure real token counts instead of characters. Semantic boundaries (markdown headings `#`, `##`, page breaks `---`) are respected as split points, so chunks never straddle a section boundary needlessly.

- [ ] **Step 1: Write failing tests**

```python
# backend/tests/test_chunking.py
import pytest
from app.chunking import chunk_document, ChunkResult

SAMPLE_MD = """# Introduction

This is the introduction paragraph. It has a few sentences about the case.

## Background Facts

The plaintiff entered into a contract on 1 January 2024.
The contract was for the supply of legal services.

## Key Obligations

Payment was due within 30 days of invoice date.
Interest accrues at 8% per annum on late payment.

---

# Conclusion

The matter requires urgent attention before the court date.
"""


def test_chunk_count():
    results = chunk_document(SAMPLE_MD)
    assert len(results) >= 2


def test_chunk_has_required_fields():
    results = chunk_document(SAMPLE_MD)
    r = results[0]
    assert isinstance(r, ChunkResult)
    assert r.chunk_index == 0
    assert r.chunk_text
    assert r.token_count > 0
    assert isinstance(r.section_title, (str, type(None)))


def test_chunk_respects_max_tokens():
    results = chunk_document(SAMPLE_MD, max_tokens=100, overlap_tokens=20)
    for r in results:
        assert r.token_count <= 130  # allow slight overflow at word boundaries


def test_section_title_captured():
    results = chunk_document(SAMPLE_MD)
    titles = [r.section_title for r in results if r.section_title]
    assert any("Introduction" in (t or "") for t in titles)


def test_overlap_carries_context():
    long_md = "\n\n".join([f"Paragraph {i}: " + "word " * 60 for i in range(10)])
    results = chunk_document(long_md, max_tokens=120, overlap_tokens=30)
    if len(results) >= 2:
        # Second chunk should start with some text from near end of first chunk
        end_of_first = results[0].chunk_text.split()[-5:]
        start_of_second = results[1].chunk_text.split()[:20]
        overlap_found = any(w in start_of_second for w in end_of_first)
        assert overlap_found
```

Run: `cd backend && pytest tests/test_chunking.py -v`
Expected: FAIL (ChunkResult and chunk_document not imported).

- [ ] **Step 2: Implement chunking.py**

```python
# backend/app/chunking.py
import re
from dataclasses import dataclass, field

import tiktoken

TOKENIZER = tiktoken.get_encoding("cl100k_base")


@dataclass
class ChunkResult:
    chunk_index: int
    chunk_text: str
    token_count: int
    section_title: str | None = None
    page_number: int | None = None
    metadata: dict = field(default_factory=dict)


def _count(text: str) -> int:
    return len(TOKENIZER.encode(text))


def _split_into_sections(md: str) -> list[tuple[str | None, str]]:
    """Split markdown by heading lines. Returns [(heading_text, body_text)]."""
    sections: list[tuple[str | None, str]] = []
    current_heading: str | None = None
    current_lines: list[str] = []
    for line in md.splitlines(keepends=True):
        heading_match = re.match(r"^#{1,3}\s+(.+)", line)
        if heading_match:
            if current_lines:
                sections.append((current_heading, "".join(current_lines).strip()))
            current_heading = heading_match.group(1).strip()
            current_lines = []
        else:
            current_lines.append(line)
    if current_lines:
        sections.append((current_heading, "".join(current_lines).strip()))
    return [(h, b) for h, b in sections if b]


def chunk_document(
    md: str,
    max_tokens: int = 1000,
    overlap_tokens: int = 150,
    page_number: int | None = None,
) -> list[ChunkResult]:
    """
    Chunk markdown text into token-bounded segments.
    Respects section headings and paragraph boundaries.
    Carries overlap_tokens of context between consecutive chunks.
    """
    sections = _split_into_sections(md)
    results: list[ChunkResult] = []
    chunk_index = 0
    overlap_buffer = ""

    for section_title, body in sections:
        # Split section body into paragraphs
        paragraphs = [p.strip() for p in re.split(r"\n{2,}", body) if p.strip()]

        current_text = overlap_buffer
        for para in paragraphs:
            candidate = f"{current_text}\n\n{para}".strip() if current_text else para
            if _count(candidate) > max_tokens and current_text:
                # Flush current chunk
                results.append(ChunkResult(
                    chunk_index=chunk_index,
                    chunk_text=current_text,
                    token_count=_count(current_text),
                    section_title=section_title,
                    page_number=page_number,
                ))
                chunk_index += 1
                # Carry overlap: last overlap_tokens tokens worth of text
                tokens = TOKENIZER.encode(current_text)
                overlap_text = TOKENIZER.decode(tokens[-overlap_tokens:]) if len(tokens) > overlap_tokens else current_text
                current_text = f"{overlap_text}\n\n{para}".strip()
            else:
                current_text = candidate

        if current_text:
            overlap_buffer_tokens = TOKENIZER.encode(current_text)
            # Flush remaining text in section as its own chunk(s)
            while _count(current_text) > max_tokens:
                tokens = TOKENIZER.encode(current_text)
                piece = TOKENIZER.decode(tokens[:max_tokens])
                results.append(ChunkResult(
                    chunk_index=chunk_index,
                    chunk_text=piece,
                    token_count=_count(piece),
                    section_title=section_title,
                    page_number=page_number,
                ))
                chunk_index += 1
                current_text = TOKENIZER.decode(tokens[max_tokens - overlap_tokens:])
            overlap_buffer = TOKENIZER.decode(
                TOKENIZER.encode(current_text)[-overlap_tokens:]
            ) if _count(current_text) > overlap_tokens else current_text
        else:
            overlap_buffer = ""

    # Flush final buffer
    if overlap_buffer.strip():
        # If this text wasn't already emitted as a chunk
        last_text = overlap_buffer.strip()
        if not results or results[-1].chunk_text != last_text:
            results.append(ChunkResult(
                chunk_index=chunk_index,
                chunk_text=last_text,
                token_count=_count(last_text),
                section_title=None,
                page_number=page_number,
            ))

    # Final pass: ensure chunk_index is sequential
    for i, r in enumerate(results):
        r.chunk_index = i

    return results
```

- [ ] **Step 3: Run tests**

Run: `cd backend && pytest tests/test_chunking.py -v`
Expected: All 5 tests PASS.

- [ ] **Step 4: Commit**

```bash
git add backend/app/chunking.py backend/tests/test_chunking.py
git commit -m "feat: token-aware semantic chunking with section metadata"
```

---

## Task 3: Text extraction with page and section metadata

**Files:**
- Modify: `backend/app/convert.py`

The key addition: `convert_to_markdown` now returns a richer result that includes per-page text (for PDFs) and email metadata, so the pipeline can chunk per-page and preserve `page_number`.

- [ ] **Step 1: Update convert.py**

Replace the `convert_to_markdown` return type with a dataclass and add `_convert_pdf_paged`:

```python
# backend/app/convert.py  — FULL FILE REPLACEMENT
import email as email_lib
import subprocess
import tempfile
from dataclasses import dataclass, field
from email import policy
from pathlib import Path
from typing import Optional

import extract_msg
from markitdown import MarkItDown

SUPPORTED_EXTENSIONS = {".pdf", ".docx", ".doc", ".msg", ".eml",
                        ".xlsx", ".csv", ".txt", ".rtf"}
OCR_MIN_CHARS = 100


class ConversionError(Exception):
    pass


@dataclass
class ConversionResult:
    full_text: str                            # full markdown
    converter_used: str
    pages: list[str] = field(default_factory=list)   # per-page text (PDFs)
    attachments: list["AttachmentData"] = field(default_factory=list)
    email_metadata: dict = field(default_factory=dict)  # sender, subject, etc.


@dataclass
class AttachmentData:
    filename: str
    content: bytes
    mime_type: str = ""


def convert_to_markdown(filename: str, content: bytes) -> ConversionResult:
    """Extract text from file. Raises ConversionError on failure."""
    ext = Path(filename).suffix.lower()
    if ext not in SUPPORTED_EXTENSIONS:
        raise ConversionError(f"unsupported file type: {ext or '(none)'}")
    try:
        if ext == ".txt":
            text = content.decode("utf-8", errors="replace")
            return ConversionResult(full_text=text, converter_used="text")
        if ext == ".eml":
            return _convert_eml(content)
        if ext == ".msg":
            return _convert_msg(content)
        if ext in (".doc", ".rtf"):
            text = _convert_textutil(content, ext)
            return ConversionResult(full_text=text, converter_used="textutil")
        if ext == ".pdf":
            return _convert_pdf(content)
        text = _run_markitdown(content, ext)
        return ConversionResult(full_text=text, converter_used="markitdown")
    except ConversionError:
        raise
    except Exception as exc:
        raise ConversionError(str(exc)) from exc


def _run_markitdown(content: bytes, ext: str) -> str:
    with tempfile.NamedTemporaryFile(suffix=ext, delete=True) as f:
        f.write(content)
        f.flush()
        result = MarkItDown().convert(f.name)
    return result.text_content


def _convert_pdf(content: bytes) -> ConversionResult:
    # Try pdfplumber for per-page extraction first
    try:
        import pdfplumber
        pages: list[str] = []
        with pdfplumber.open(__import__("io").BytesIO(content)) as pdf:
            for page in pdf.pages:
                pages.append(page.extract_text() or "")
        full = "\n\n---\n\n".join(
            f"<!-- page {i+1} -->\n{p}" for i, p in enumerate(pages) if p.strip()
        )
        if len(full.strip()) >= OCR_MIN_CHARS:
            return ConversionResult(full_text=full, converter_used="pdfplumber", pages=pages)
    except Exception:
        pass
    # Fallback: markitdown
    md = _run_markitdown(content, ".pdf")
    if len(md.strip()) >= OCR_MIN_CHARS:
        return ConversionResult(full_text=md, converter_used="markitdown")
    # OCR fallback
    ocr_text = _ocr_pdf(content)
    return ConversionResult(full_text=ocr_text, converter_used="ocr")


def _ocr_pdf(content: bytes) -> str:
    with tempfile.TemporaryDirectory() as tmp:
        src = Path(tmp) / "in.pdf"
        dst = Path(tmp) / "out.pdf"
        src.write_bytes(content)
        try:
            proc = subprocess.run(
                ["ocrmypdf", "--force-ocr", "--quiet", str(src), str(dst)],
                capture_output=True, text=True, timeout=600)
        except FileNotFoundError as exc:
            raise ConversionError(
                "ocrmypdf not installed (brew install ocrmypdf tesseract)") from exc
        if proc.returncode != 0:
            raise ConversionError(f"OCR failed: {proc.stderr.strip()[:500]}")
        return _run_markitdown(dst.read_bytes(), ".pdf")


def _convert_eml(content: bytes) -> ConversionResult:
    msg = email_lib.message_from_bytes(content, policy=policy.default)
    meta = {
        "sender": str(msg.get("from", "")),
        "recipients": str(msg.get("to", "")),
        "subject": str(msg.get("subject", "")),
        "date": str(msg.get("date", "")),
        "message_id": str(msg.get("message-id", "")),
    }
    body_parts: list[str] = []
    attachments: list[AttachmentData] = []
    for part in msg.walk():
        ct = part.get_content_type()
        cd = str(part.get("Content-Disposition", ""))
        if "attachment" in cd:
            fname = part.get_filename() or "attachment"
            payload = part.get_payload(decode=True)
            if payload:
                attachments.append(AttachmentData(
                    filename=fname, content=payload, mime_type=ct))
        elif ct == "text/plain":
            body_parts.append(part.get_content() or "")
        elif ct == "text/html" and not body_parts:
            # Fallback: strip tags
            import re
            html = part.get_content() or ""
            body_parts.append(re.sub(r"<[^>]+>", " ", html))

    header = (
        f"**From:** {meta['sender']}  \n"
        f"**To:** {meta['recipients']}  \n"
        f"**Subject:** {meta['subject']}  \n"
        f"**Date:** {meta['date']}  \n\n"
    )
    full_text = header + "\n\n".join(body_parts)
    return ConversionResult(
        full_text=full_text, converter_used="eml",
        attachments=attachments, email_metadata=meta)


def _convert_msg(content: bytes) -> ConversionResult:
    with tempfile.NamedTemporaryFile(suffix=".msg", delete=False) as f:
        f.write(content)
        tmp_path = f.name
    try:
        m = extract_msg.Message(tmp_path)
        meta = {
            "sender": m.sender or "",
            "recipients": ", ".join(str(r) for r in (m.recipients or [])),
            "subject": m.subject or "",
            "date": str(m.date or ""),
        }
        header = (
            f"**From:** {meta['sender']}  \n"
            f"**To:** {meta['recipients']}  \n"
            f"**Subject:** {meta['subject']}  \n"
            f"**Date:** {meta['date']}  \n\n"
        )
        body = m.body or ""
        attachments: list[AttachmentData] = []
        for att in (m.attachments or []):
            if hasattr(att, "data") and att.data:
                fname = getattr(att, "longFilename", None) or getattr(att, "shortFilename", "attachment")
                attachments.append(AttachmentData(filename=fname, content=att.data))
        return ConversionResult(
            full_text=header + body, converter_used="msg",
            attachments=attachments, email_metadata=meta)
    finally:
        Path(tmp_path).unlink(missing_ok=True)


def _convert_textutil(content: bytes, ext: str) -> str:
    with tempfile.NamedTemporaryFile(suffix=ext, delete=True) as f:
        f.write(content)
        f.flush()
        proc = subprocess.run(
            ["textutil", "-convert", "txt", "-stdout", f.name],
            capture_output=True, timeout=120)
    if proc.returncode != 0:
        raise ConversionError(f"textutil failed: {proc.stderr.decode()[:200]}")
    return proc.stdout.decode("utf-8", errors="replace")
```

Add `pdfplumber` to requirements.txt:
```
pdfplumber
```

Run: `pip install pdfplumber`

- [ ] **Step 2: Commit**

```bash
git add backend/app/convert.py backend/requirements.txt
git commit -m "feat: convert.py returns ConversionResult with page list and attachments"
```

---

## Task 4: Processing pipeline + store.py for Supabase

**Files:**
- Create: `backend/app/pipeline.py`
- Modify: `backend/app/store.py`
- Modify: `backend/app/ingest.py`

This is the core processing orchestrator. It drives a document through each status stage, persisting status at every step so failures are recoverable.

- [ ] **Step 1: Rewrite store.py**

```python
# backend/app/store.py
import hashlib
import json
import os
from pathlib import Path

import psycopg

FILES_DIR = Path(os.environ.get("FILES_DIR", "data/files"))


def _files_dir() -> Path:
    d = FILES_DIR
    d.mkdir(parents=True, exist_ok=True)
    return d


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def save_file_to_disk(content: bytes, doc_id: int, filename: str) -> str:
    """Save file bytes to disk. Returns relative storage path."""
    dest = _files_dir() / str(doc_id) / filename
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(content)
    return str(dest.relative_to(Path(".")))


def upsert_document(
    conn: psycopg.Connection,
    original_filename: str,
    content: bytes,
    parent_document_id: int | None = None,
    mime_type: str | None = None,
) -> tuple[int, bool]:
    """Insert document if hash is new. Returns (doc_id, created)."""
    digest = sha256_hex(content)
    row = conn.execute(
        "SELECT id FROM documents WHERE file_hash=%s", (digest,)).fetchone()
    if row:
        return row["id"], False
    file_type = Path(original_filename).suffix.lower().lstrip(".") or "unknown"
    row = conn.execute(
        "INSERT INTO documents "
        "(parent_document_id, original_filename, file_type, mime_type, file_size, file_hash)"
        " VALUES (%s,%s,%s,%s,%s,%s) RETURNING id",
        (parent_document_id, original_filename, file_type, mime_type,
         len(content), digest)).fetchone()
    conn.commit()
    doc_id = row["id"]
    storage_path = save_file_to_disk(content, doc_id, original_filename)
    conn.execute(
        "UPDATE documents SET storage_path=%s WHERE id=%s",
        (storage_path, doc_id))
    conn.commit()
    return doc_id, True


def add_location(
    conn: psycopg.Connection, doc_id: int,
    root_folder: str, subfolder_path: str, filename: str,
) -> None:
    conn.execute(
        "DELETE FROM document_locations"
        " WHERE root_folder=%s AND subfolder_path=%s AND filename=%s AND document_id<>%s",
        (root_folder, subfolder_path, filename, doc_id))
    conn.execute(
        "INSERT INTO document_locations (document_id, root_folder, subfolder_path, filename)"
        " VALUES (%s,%s,%s,%s) ON CONFLICT DO NOTHING",
        (doc_id, root_folder, subfolder_path, filename))
    conn.commit()


def set_status(
    conn: psycopg.Connection, doc_id: int,
    status: str, error: str | None = None,
) -> None:
    if status == "completed":
        conn.execute(
            "UPDATE documents SET processing_status=%s, processing_error=%s,"
            " processed_at=NOW() WHERE id=%s",
            (status, error, doc_id))
    else:
        conn.execute(
            "UPDATE documents SET processing_status=%s, processing_error=%s WHERE id=%s",
            (status, error, doc_id))
    conn.commit()


def save_extracted_text(
    conn: psycopg.Connection, doc_id: int,
    text: str, keywords: list[str] | None = None, summary: str | None = None,
) -> None:
    conn.execute(
        "UPDATE documents SET extracted_text=%s, keywords=%s, summary=%s WHERE id=%s",
        (text, json.dumps(keywords or []), summary, doc_id))
    conn.commit()


def save_chunks(
    conn: psycopg.Connection,
    doc_id: int,
    chunks: list[dict],  # each: {chunk_index, chunk_text, token_count, page_number, section_title, metadata}
) -> None:
    conn.execute("DELETE FROM document_chunks WHERE document_id=%s", (doc_id,))
    if not chunks:
        return
    conn.executemany(
        "INSERT INTO document_chunks"
        " (document_id, chunk_index, chunk_text, token_count, page_number, section_title, metadata)"
        " VALUES (%(document_id)s, %(chunk_index)s, %(chunk_text)s,"
        "         %(token_count)s, %(page_number)s, %(section_title)s, %(metadata)s)",
        [{"document_id": doc_id, **c,
          "metadata": json.dumps(c.get("metadata") or {})} for c in chunks])
    conn.commit()


def save_embeddings(
    conn: psycopg.Connection,
    chunk_updates: list[tuple[list[float], int]],  # (vector, chunk_id)
) -> None:
    from pgvector.psycopg import register_vector
    register_vector(conn)
    import numpy as np
    for vec, chunk_id in chunk_updates:
        conn.execute(
            "UPDATE document_chunks SET embedding=%s WHERE id=%s",
            (np.array(vec, dtype=np.float32), chunk_id))
    conn.commit()
```

- [ ] **Step 2: Create pipeline.py**

```python
# backend/app/pipeline.py
"""
Full document processing pipeline.
Drives a document through: uploaded → extracting → chunking → embedding → completed/failed
"""
import json
import logging

import psycopg

from . import ai, embeddings, store
from .chunking import chunk_document
from .convert import ConversionResult, convert_to_markdown, ConversionError
from .db import get_conn

logger = logging.getLogger(__name__)


def process_document(doc_id: int, filename: str, content: bytes) -> None:
    """
    Full pipeline for one document. Designed to run in a background thread.
    Idempotent: re-running replaces extracted text + chunks + embeddings.
    """
    conn = get_conn()
    try:
        _run_pipeline(conn, doc_id, filename, content, parent_id=None)
    except Exception as exc:
        logger.exception("pipeline failed for doc %s", doc_id)
        try:
            store.set_status(conn, doc_id, "failed", str(exc)[:500])
        except Exception:
            pass
    finally:
        conn.close()


def _run_pipeline(
    conn: psycopg.Connection,
    doc_id: int,
    filename: str,
    content: bytes,
    parent_id: int | None,
) -> None:
    # ── 1. Extract ────────────────────────────────────────────────────────────
    store.set_status(conn, doc_id, "extracting")
    try:
        result: ConversionResult = convert_to_markdown(filename, content)
    except ConversionError as exc:
        store.set_status(conn, doc_id, "failed", str(exc))
        return

    # ── 2. Summarise (best-effort) ────────────────────────────────────────────
    keywords: list[str] = []
    summary: str | None = None
    try:
        keywords, summary = ai.summarise_document(result.full_text)
    except Exception:
        pass

    store.save_extracted_text(conn, doc_id, result.full_text, keywords, summary)

    # ── 3. Process email attachments as child documents ───────────────────────
    for att in result.attachments:
        try:
            child_id, created = store.upsert_document(
                conn, att.filename, att.content,
                parent_document_id=doc_id, mime_type=att.mime_type)
            if created:
                _run_pipeline(conn, child_id, att.filename, att.content,
                              parent_id=doc_id)
        except Exception as exc:
            logger.warning("attachment %s failed: %s", att.filename, exc)

    # ── 4. Chunk ──────────────────────────────────────────────────────────────
    store.set_status(conn, doc_id, "chunking")
    chunk_results = []

    if result.pages:
        # PDF: chunk per page so page_number is accurate
        for page_num, page_text in enumerate(result.pages, start=1):
            if not page_text.strip():
                continue
            for cr in chunk_document(page_text, page_number=page_num):
                cr.page_number = page_num
                chunk_results.append(cr)
        # Re-index chunk_index across all pages
        for i, cr in enumerate(chunk_results):
            cr.chunk_index = i
    else:
        chunk_results = chunk_document(result.full_text)

    store.save_chunks(conn, doc_id, [
        {
            "chunk_index": cr.chunk_index,
            "chunk_text": cr.chunk_text,
            "token_count": cr.token_count,
            "page_number": cr.page_number,
            "section_title": cr.section_title,
            "metadata": {
                "converter": result.converter_used,
                **({"email": result.email_metadata} if result.email_metadata else {}),
                **({"parent_document_id": parent_id} if parent_id else {}),
            },
        }
        for cr in chunk_results
    ])

    # ── 5. Embed ──────────────────────────────────────────────────────────────
    store.set_status(conn, doc_id, "embedding")
    chunk_rows = conn.execute(
        "SELECT id, chunk_text FROM document_chunks WHERE document_id=%s ORDER BY chunk_index",
        (doc_id,)).fetchall()

    BATCH = 64
    updates: list[tuple[list[float], int]] = []
    for i in range(0, len(chunk_rows), BATCH):
        batch = chunk_rows[i:i + BATCH]
        try:
            vecs = embeddings.embed_texts([r["chunk_text"] for r in batch])
            updates.extend((vec, r["id"]) for r, vec in zip(batch, vecs))
        except embeddings.EmbeddingError as exc:
            store.set_status(conn, doc_id, "failed",
                             f"embedding batch {i//BATCH} failed: {exc}")
            return

    store.save_embeddings(conn, updates)
    store.set_status(conn, doc_id, "completed")
```

- [ ] **Step 3: Update ingest.py to use pipeline**

```python
# backend/app/ingest.py  — replace _process_one method body

def _process_one(self, path: Path):
    from .pipeline import _run_pipeline as pipeline_run
    conn = get_conn()
    try:
        content = path.read_bytes()
        doc_id, created = store.upsert_document(conn, path.name, content)
        subfolder = str(path.parent.relative_to(self.root))
        store.add_location(conn, doc_id, str(self.root),
                           "" if subfolder == "." else subfolder, path.name)
        if self.case_id is not None:
            try:
                conn.execute(
                    "INSERT INTO case_documents (case_id, document_id) VALUES (%s,%s)"
                    " ON CONFLICT DO NOTHING",
                    (self.case_id, doc_id))
                conn.commit()
            except Exception:
                pass
        self._bump(**{"new" if created else "existing": 1})

        status_row = conn.execute(
            "SELECT processing_status FROM documents WHERE id=%s",
            (doc_id,)).fetchone()
        current_status = status_row["processing_status"] if status_row else "uploaded"

        if current_status in ("uploaded", "failed", "extracting"):
            try:
                pipeline_run(conn, doc_id, path.name, content, parent_id=None)
                self._bump(converted=1)
            except Exception as exc:
                store.set_status(conn, doc_id, "failed", str(exc))
                self._bump(failed=1)
    except Exception:
        self._bump(failed=1)
    finally:
        self._bump(done=1)
        conn.close()
```

Also update `ingest.py` imports: replace `from .db import get_conn, init_db` with `from .db import get_conn`. Remove `init_db` call (Supabase schema is already set up via migration).

- [ ] **Step 4: Commit**

```bash
git add backend/app/store.py backend/app/pipeline.py backend/app/ingest.py
git commit -m "feat: pipeline orchestrator with status tracking and attachment handling"
```

---

## Task 5: Reprocessing endpoint

**Files:**
- Modify: `backend/app/routers/files.py`

- [ ] **Step 1: Add POST /api/documents/{id}/reprocess**

Add to `backend/app/routers/files.py`:

```python
@router.post("/documents/{doc_id}/reprocess")
def reprocess_document(doc_id: int, db=Depends(get_db)):
    row = db.execute(
        "SELECT id, original_filename, storage_path FROM documents WHERE id=%s",
        (doc_id,)).fetchone()
    if row is None:
        raise HTTPException(404, "document not found")
    storage_path = row["storage_path"]
    if not storage_path or not Path(storage_path).exists():
        raise HTTPException(400, "original file not found on disk")
    content = Path(storage_path).read_bytes()
    # Delete old chunks + embeddings (ON DELETE CASCADE handles document_chunks)
    db.execute("DELETE FROM document_chunks WHERE document_id=%s", (doc_id,))
    db.execute(
        "UPDATE documents SET processing_status='uploaded', processing_error=NULL,"
        " extracted_text=NULL, processed_at=NULL WHERE id=%s", (doc_id,))
    db.commit()
    import threading
    from ..pipeline import process_document
    threading.Thread(
        target=process_document,
        args=(doc_id, row["original_filename"], content),
        daemon=True).start()
    return {"started": True, "document_id": doc_id}
```

- [ ] **Step 2: Commit**

```bash
git add backend/app/routers/files.py
git commit -m "feat: POST /api/documents/{id}/reprocess endpoint"
```

---

## Task 6: Hybrid search backend

**Files:**
- Modify: `backend/app/routers/semantic.py`
- Modify: `backend/app/embeddings.py` (ensure pgvector-compatible output)

Hybrid search = vector similarity + PostgreSQL full-text search, combined with `COALESCE` rank weighting. Results include neighboring chunks for legal context.

- [ ] **Step 1: Rewrite semantic.py**

```python
# backend/app/routers/semantic.py
import json
import os

from fastapi import APIRouter, Depends, HTTPException, Query
from pgvector.psycopg import register_vector
import numpy as np

from .. import embeddings
from ..deps import get_db

router = APIRouter(prefix="/api")

SNIPPET_CHARS = 400
TOP_K = 12
NEIGHBOR_DISTANCE = 1  # chunks before/after to fetch


@router.get("/search")
def hybrid_search(
    q: str,
    file_type: str | None = None,
    case_id: int | None = None,
    parent_document_id: int | None = None,
    limit: int = Query(default=20, le=100),
    db=Depends(get_db),
):
    """
    Hybrid search: vector similarity + full-text search.
    Returns matching chunks with neighboring context and document metadata.
    """
    if not q.strip():
        raise HTTPException(400, "empty query")

    register_vector(db)

    # ── Vector component ──────────────────────────────────────────────────────
    try:
        query_vec = embeddings.embed_texts([q.strip()])[0]
    except embeddings.EmbeddingError as exc:
        raise HTTPException(400, str(exc))
    query_arr = np.array(query_vec, dtype=np.float32)

    # Base filter conditions
    filters = []
    params: dict = {"query_vec": query_arr, "limit": limit}
    if file_type:
        filters.append("d.file_type = %(file_type)s")
        params["file_type"] = file_type
    if case_id is not None:
        filters.append("EXISTS (SELECT 1 FROM case_documents cd WHERE cd.document_id=d.id AND cd.case_id=%(case_id)s)")
        params["case_id"] = case_id
    if parent_document_id is not None:
        filters.append("d.parent_document_id = %(parent_document_id)s")
        params["parent_document_id"] = parent_document_id

    where = ("AND " + " AND ".join(filters)) if filters else ""

    # Vector similarity
    vec_sql = f"""
        SELECT dc.id AS chunk_id, dc.document_id, dc.chunk_index,
               dc.chunk_text, dc.page_number, dc.section_title, dc.metadata,
               dc.token_count,
               1 - (dc.embedding <=> %(query_vec)s) AS vec_score,
               0::float AS fts_score
        FROM document_chunks dc
        JOIN documents d ON d.id = dc.document_id
        WHERE dc.embedding IS NOT NULL
          AND d.processing_status = 'completed'
          {where}
        ORDER BY dc.embedding <=> %(query_vec)s
        LIMIT %(limit)s
    """

    # Full-text component
    params["tsquery"] = " | ".join(q.strip().split())
    fts_sql = f"""
        SELECT dc.id AS chunk_id, dc.document_id, dc.chunk_index,
               dc.chunk_text, dc.page_number, dc.section_title, dc.metadata,
               dc.token_count,
               0::float AS vec_score,
               ts_rank_cd(to_tsvector('english', dc.chunk_text),
                          to_tsquery('english', %(tsquery)s)) AS fts_score
        FROM document_chunks dc
        JOIN documents d ON d.id = dc.document_id
        WHERE to_tsvector('english', dc.chunk_text) @@ to_tsquery('english', %(tsquery)s)
          AND d.processing_status = 'completed'
          {where}
        ORDER BY fts_score DESC
        LIMIT %(limit)s
    """

    vec_rows = db.execute(vec_sql, params).fetchall()
    try:
        fts_rows = db.execute(fts_sql, params).fetchall()
    except Exception:
        fts_rows = []  # malformed tsquery from user

    # ── Merge + score ─────────────────────────────────────────────────────────
    # RRF (Reciprocal Rank Fusion): score = 1/(rank+60)
    merged: dict[int, dict] = {}
    for rank, row in enumerate(vec_rows):
        cid = row["chunk_id"]
        merged[cid] = dict(row)
        merged[cid]["rrf"] = 1.0 / (rank + 60)
    for rank, row in enumerate(fts_rows):
        cid = row["chunk_id"]
        if cid in merged:
            merged[cid]["rrf"] += 1.0 / (rank + 60)
            merged[cid]["fts_score"] = row["fts_score"]
        else:
            merged[cid] = dict(row)
            merged[cid]["rrf"] = 1.0 / (rank + 60)

    top_chunks = sorted(merged.values(), key=lambda x: x["rrf"], reverse=True)[:limit]

    # ── Fetch document metadata + neighbors ───────────────────────────────────
    doc_ids = list({c["document_id"] for c in top_chunks})
    doc_rows = db.execute(
        "SELECT id, original_filename, file_type, processing_status,"
        " summary, keywords, parent_document_id, storage_path"
        " FROM documents WHERE id = ANY(%s)",
        (doc_ids,)).fetchall()
    docs_by_id = {r["id"]: dict(r) for r in doc_rows}

    results = []
    for chunk in top_chunks:
        doc = docs_by_id.get(chunk["document_id"], {})

        # Fetch neighboring chunks for legal context
        neighbors = db.execute(
            "SELECT chunk_index, chunk_text, page_number FROM document_chunks"
            " WHERE document_id=%s AND chunk_index BETWEEN %s AND %s"
            " ORDER BY chunk_index",
            (chunk["document_id"],
             chunk["chunk_index"] - NEIGHBOR_DISTANCE,
             chunk["chunk_index"] + NEIGHBOR_DISTANCE)).fetchall()

        keywords = doc.get("keywords") or "[]"
        if isinstance(keywords, str):
            try:
                keywords = json.loads(keywords)
            except Exception:
                keywords = []

        metadata = chunk.get("metadata") or {}
        if isinstance(metadata, str):
            try:
                metadata = json.loads(metadata)
            except Exception:
                metadata = {}

        results.append({
            "chunk_id": chunk["chunk_id"],
            "document_id": chunk["document_id"],
            "original_filename": doc.get("original_filename", ""),
            "file_type": doc.get("file_type", ""),
            "parent_document_id": doc.get("parent_document_id"),
            "page_number": chunk.get("page_number"),
            "section_title": chunk.get("section_title"),
            "chunk_text": chunk["chunk_text"][:SNIPPET_CHARS],
            "vec_score": round(float(chunk.get("vec_score") or 0), 4),
            "fts_score": round(float(chunk.get("fts_score") or 0), 4),
            "rrf_score": round(chunk["rrf"], 6),
            "neighbors": [
                {"chunk_index": n["chunk_index"],
                 "chunk_text": n["chunk_text"][:SNIPPET_CHARS],
                 "page_number": n["page_number"]}
                for n in neighbors
                if n["chunk_index"] != chunk["chunk_index"]
            ],
            "doc_summary": doc.get("summary"),
            "doc_keywords": keywords,
            "email_metadata": metadata.get("email"),
        })

    return {"results": results, "query": q}
```

Also add `pgvector` to requirements.txt if not already added in Task 1.

- [ ] **Step 2: Commit**

```bash
git add backend/app/routers/semantic.py
git commit -m "feat: hybrid search with pgvector + FTS + RRF, neighboring chunks"
```

---

## Task 7: Update remaining routers for Supabase

**Files:**
- Modify: `backend/app/routers/files.py`
- Modify: `backend/app/routers/cases.py`
- Modify: `backend/app/routers/chats.py`
- Modify: `backend/app/routers/scan.py`

All routers use `?` SQLite placeholders. These must become `%s` (psycopg format). Column names change: `files` → `documents`, `markdown_files.content_md` → `documents.extracted_text`, etc. This task is the largest rename sweep.

- [ ] **Step 1: Update files.py**

Key changes — replace the `LIST_COLUMNS` query and all `files`/`markdown_files` references:

```python
# backend/app/routers/files.py — key constants and GET /documents

LIST_COLUMNS = """
  d.id, d.original_filename AS original_name, d.file_type,
  d.file_size AS size_bytes, d.processing_status AS status,
  d.processing_error AS error_message, d.created_at,
  d.summary, d.keywords, d.parent_document_id,
  (d.extracted_text IS NOT NULL) AS has_markdown,
  COALESCE(
    (SELECT json_agg(json_build_object(
       'root_folder', l.root_folder,
       'subfolder_path', l.subfolder_path,
       'filename', l.filename))
     FROM document_locations l WHERE l.document_id = d.id),
    '[]'::json) AS locations,
  COALESCE(
    (SELECT json_agg(t.name)
     FROM document_tags dt JOIN tags t ON t.id = dt.tag_id
     WHERE dt.document_id = d.id),
    '[]'::json) AS tags
"""

@router.get("/documents")
def list_documents(
    folder: str | None = None, file_type: str | None = None,
    status: str | None = None, tag: str | None = None,
    case_id: int | None = None, q: str | None = None,
    db=Depends(get_db)
):
    where, params = [], []
    if folder:
        where.append(
            "EXISTS (SELECT 1 FROM document_locations l WHERE l.document_id=d.id"
            " AND (l.root_folder || '/' || l.subfolder_path) LIKE %s)")
        params.append(folder.rstrip("/") + "%")
    if file_type:
        types = file_type.split(",")
        where.append(f"d.file_type = ANY(%s)")
        params.append(types)
    if status:
        statuses = status.split(",")
        where.append(f"d.processing_status = ANY(%s)")
        params.append(statuses)
    if tag:
        where.append(
            "EXISTS (SELECT 1 FROM document_tags dt JOIN tags t ON t.id=dt.tag_id"
            " WHERE dt.document_id=d.id AND t.name=%s)")
        params.append(tag)
    if case_id is not None:
        where.append(
            "EXISTS (SELECT 1 FROM case_documents cd"
            " WHERE cd.document_id=d.id AND cd.case_id=%s)")
        params.append(case_id)
    if q:
        where.append(
            "to_tsvector('english', COALESCE(d.extracted_text,''))"
            " @@ plainto_tsquery('english', %s)")
        params.append(q)
    # Exclude child documents (attachments) from the main list unless requested
    where.append("d.parent_document_id IS NULL")
    sql = f"SELECT {LIST_COLUMNS} FROM documents d"
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY d.created_at DESC, d.id DESC LIMIT 500"
    rows = db.execute(sql, params).fetchall()
    return {"files": [_row_to_file(r) for r in rows]}
```

Keep `GET /api/files` as an alias pointing to `list_documents` for backwards compat with the frontend.

- [ ] **Step 2: Update cases.py**

Replace `files` / `file_ids` references with `documents` / `document_ids`, table `case_files` → `case_documents`:

```python
# In cases.py: replace all occurrences
# "case_files" → "case_documents"
# "file_id" → "document_id"  
# "files f" → "documents d"
# All ? → %s
```

Run: `grep -n "case_files\|file_id\|files f\|\?" backend/app/routers/cases.py`
Then make all replacements.

- [ ] **Step 3: Update chats.py**

```python
# In chats.py:
# - Replace ? with %s throughout
# - Replace "file_ids" JSON column with "document_ids"
# - Keep same API shape (frontend sends file_ids, map to document_ids)
```

- [ ] **Step 4: Update scan.py**

```python
# In scan.py:
# - Replace ? with %s
# - Replace "files" table references with "documents"
# - JOBS dict key stays the same
```

- [ ] **Step 5: Keep /api/files for backwards compat**

Add alias route at the end of `files.py`:

```python
# Keep old /api/files endpoint working
router.add_api_route("/files", list_documents, methods=["GET"])
```

- [ ] **Step 6: Commit**

```bash
git add backend/app/routers/
git commit -m "feat: update all routers for Supabase/PostgreSQL (? → %s, tables renamed)"
```

---

## Task 8: Search page (frontend)

**Files:**
- Create: `frontend/src/pages/Search.tsx`
- Modify: `frontend/src/pages/Library.tsx` (remove search bar + semantic results)
- Modify: `frontend/src/components/Sidebar.tsx` (add Search nav item)
- Modify: `frontend/src/App.tsx` (add /search route)
- Modify: `frontend/src/api.ts` (add SearchResult type + search API function)

- [ ] **Step 1: Add types to api.ts**

```typescript
// Add to frontend/src/api.ts

export interface SearchChunk {
  chunk_id: number;
  document_id: number;
  original_filename: string;
  file_type: string;
  parent_document_id: number | null;
  page_number: number | null;
  section_title: string | null;
  chunk_text: string;
  vec_score: number;
  fts_score: number;
  rrf_score: number;
  neighbors: { chunk_index: number; chunk_text: string; page_number: number | null }[];
  doc_summary: string | null;
  doc_keywords: string[];
  email_metadata: { sender?: string; subject?: string; date?: string } | null;
}

export interface SearchResponse {
  results: SearchChunk[];
  query: string;
}
```

- [ ] **Step 2: Create Search.tsx**

```tsx
// frontend/src/pages/Search.tsx
import { useState, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api";
import type { SearchChunk, SearchResponse } from "../api";

const FILE_TYPE_BADGE: Record<string, string> = {
  pdf:  "bg-red-900/50 text-red-400",
  docx: "bg-blue-900/50 text-blue-400",
  doc:  "bg-blue-900/50 text-blue-400",
  xlsx: "bg-green-900/50 text-green-400",
  csv:  "bg-green-900/50 text-green-400",
  msg:  "bg-purple-900/50 text-purple-400",
  eml:  "bg-purple-900/50 text-purple-400",
  txt:  "bg-zinc-700/60 text-zinc-300",
};

export default function Search() {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchChunk[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [selected, setSelected] = useState<number[]>([]);
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);

  async function runSearch() {
    if (!q.trim()) return;
    setSearching(true); setError(""); setResults(null);
    try {
      const res = await api<SearchResponse>(`/api/search?q=${encodeURIComponent(q.trim())}`);
      setResults(res.results);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSearching(false);
    }
  }

  function toggleExpand(chunkId: number) {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(chunkId) ? next.delete(chunkId) : next.add(chunkId);
      return next;
    });
  }

  function toggleSelect(docId: number) {
    setSelected(s => s.includes(docId) ? s.filter(x => x !== docId) : [...s, docId]);
  }

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-5">
      <h1 className="text-xl font-bold text-zinc-100">Search</h1>

      {/* Search bar */}
      <div className="flex gap-2">
        <input
          ref={inputRef}
          value={q}
          onChange={e => setQ(e.target.value)}
          onKeyDown={e => e.key === "Enter" && runSearch()}
          placeholder="Search across all documents — keyword or natural language…"
          className="flex-1 border border-zinc-700 rounded-xl px-4 py-2.5 bg-zinc-900 text-white placeholder-zinc-500 focus:outline-none focus:border-amber-500 text-sm"
        />
        <button onClick={runSearch} disabled={searching || !q.trim()}
          className="bg-amber-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-black rounded-xl px-5 py-2.5 text-sm font-semibold transition-colors shrink-0">
          {searching ? "Searching…" : "Search"}
        </button>
      </div>

      {/* Action bar when files selected */}
      {selected.length > 0 && (
        <div className="flex items-center gap-3 bg-zinc-800 rounded-xl px-4 py-2.5 text-sm">
          <span className="text-zinc-400">{selected.length} document{selected.length > 1 ? "s" : ""} selected</span>
          <button onClick={() => navigate(`/chat?ids=${selected.join(",")}`)}
            className="bg-emerald-600 text-white rounded-lg px-3 py-1 hover:bg-emerald-700">
            💬 Chat
          </button>
          <button onClick={() => navigate(`/review?ids=${selected.join(",")}`)}
            className="bg-violet-600 text-white rounded-lg px-3 py-1 hover:bg-violet-700">
            ⚖️ Review
          </button>
          <button onClick={() => setSelected([])} className="text-zinc-500 hover:text-white ml-auto">Clear</button>
        </div>
      )}

      {error && (
        <p className="text-red-400 bg-red-950/50 border border-red-800/50 rounded-lg px-3 py-2 text-sm">{error}</p>
      )}

      {/* Results */}
      {results !== null && (
        <div className="space-y-3">
          <p className="text-xs text-zinc-500">
            {results.length} result{results.length !== 1 ? "s" : ""} for "{q}"
            <span className="ml-2 text-zinc-600">· hybrid vector + keyword search</span>
          </p>
          {results.length === 0 && (
            <p className="text-zinc-500 text-sm bg-zinc-900 rounded-xl p-6 text-center">
              No matching passages found. Try broader keywords or a different phrase.
            </p>
          )}
          {results.map(r => {
            const badge = FILE_TYPE_BADGE[r.file_type] ?? "bg-zinc-800 text-zinc-400";
            const isExpanded = expanded.has(r.chunk_id);
            const isSelected = selected.includes(r.document_id);
            return (
              <div key={r.chunk_id}
                className={`bg-zinc-900 border rounded-xl p-4 transition-colors ${
                  isSelected ? "border-amber-500/50" : "border-zinc-800"}`}>
                {/* Top row */}
                <div className="flex items-center gap-2.5 mb-2.5">
                  <input type="checkbox" checked={isSelected}
                    onChange={() => toggleSelect(r.document_id)} className="shrink-0" />
                  <span className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-bold uppercase ${badge}`}>
                    {r.file_type}
                  </span>
                  <Link to={`/files/${r.document_id}`}
                    className="text-amber-400 font-medium hover:underline flex-1 truncate text-sm">
                    {r.original_filename}
                  </Link>
                  {r.parent_document_id && (
                    <span className="text-xs text-purple-400 bg-purple-900/30 rounded-full px-2 py-0.5 shrink-0">
                      attachment
                    </span>
                  )}
                  {r.page_number && (
                    <span className="text-xs text-zinc-500 shrink-0">p.{r.page_number}</span>
                  )}
                  {r.section_title && (
                    <span className="text-xs text-zinc-600 shrink-0 max-w-[160px] truncate"
                      title={r.section_title}>
                      § {r.section_title}
                    </span>
                  )}
                  <span className="text-xs font-mono text-zinc-600 shrink-0">
                    {(r.rrf_score * 100).toFixed(1)}%
                  </span>
                </div>

                {/* Email metadata */}
                {r.email_metadata && (
                  <div className="text-xs text-zinc-500 mb-2 space-x-3">
                    {r.email_metadata.sender && <span>From: {r.email_metadata.sender}</span>}
                    {r.email_metadata.subject && <span>· {r.email_metadata.subject}</span>}
                    {r.email_metadata.date && <span>· {r.email_metadata.date}</span>}
                  </div>
                )}

                {/* Matched chunk text */}
                <p className="text-sm text-zinc-300 leading-relaxed font-mono text-xs bg-zinc-950 rounded-lg px-3 py-2.5">
                  …{r.chunk_text}…
                </p>

                {/* Keywords */}
                {r.doc_keywords?.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {r.doc_keywords.map(kw => (
                      <span key={kw} className="bg-blue-500/15 text-blue-400 text-xs rounded-full px-2 py-0.5">
                        {kw}
                      </span>
                    ))}
                  </div>
                )}

                {/* Neighbors toggle */}
                {r.neighbors.length > 0 && (
                  <div className="mt-2.5">
                    <button onClick={() => toggleExpand(r.chunk_id)}
                      className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors">
                      {isExpanded ? "▾ Hide context" : `▸ Show ${r.neighbors.length} neighboring chunk${r.neighbors.length > 1 ? "s" : ""}`}
                    </button>
                    {isExpanded && (
                      <div className="mt-2 space-y-2 pl-3 border-l-2 border-zinc-700">
                        {r.neighbors.map((n, i) => (
                          <div key={i}>
                            {n.page_number && (
                              <span className="text-xs text-zinc-600 mr-2">p.{n.page_number}</span>
                            )}
                            <p className="text-xs text-zinc-500 font-mono leading-relaxed">{n.chunk_text}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Actions */}
                <div className="flex gap-2 mt-3">
                  <Link to={`/files/${r.document_id}`}
                    className="text-xs text-zinc-400 hover:text-amber-400 border border-zinc-700 hover:border-amber-500/50 rounded-lg px-3 py-1 transition-colors">
                    Open document
                  </Link>
                  <Link to={`/chat?ids=${r.document_id}`}
                    className="text-xs text-white bg-emerald-700 hover:bg-emerald-600 rounded-lg px-3 py-1 transition-colors">
                    💬 Chat
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {results === null && !searching && (
        <div className="text-center py-16 text-zinc-600 text-sm">
          <p className="text-3xl mb-3">🔍</p>
          <p>Search across all documents using keywords or natural language.</p>
          <p className="mt-1 text-zinc-700">Results include the matched passage, surrounding context, and source citation.</p>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Add Search route to App.tsx**

```tsx
// In frontend/src/App.tsx, add inside <Routes>:
import Search from "./pages/Search";
// ...
<Route path="/search" element={<Search />} />
```

- [ ] **Step 4: Add Search to Sidebar.tsx nav**

In the `navItems` array in `Sidebar.tsx`, add after the Library item:

```tsx
{
  to: "/search",
  label: "Search",
  end: true,
  icon: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}
      strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  ),
},
```

- [ ] **Step 5: Remove search from Library.tsx**

In `Library.tsx`:
- Remove the `mode`, `semantic`, `searching`, `q` state variables (or keep `q` for keyword-only filter)
- Remove the search bar JSX block (the `{/* Search bar */}` section)
- Remove the `{/* Semantic results */}` block
- Remove the `runSemantic` function
- Remove the `mode === "keyword" ||` condition from the file table render

Keep the keyword filter `q` state as a simple text input in the filter panel (not a dedicated search feature), or remove entirely and redirect users to `/search`.

- [ ] **Step 6: Build and verify**

```bash
cd /Users/fred/Documents/VibeCoding/claudecode/LexAIv2/frontend && npm run build
```

Expected: build succeeds with no TypeScript errors.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/Search.tsx frontend/src/App.tsx frontend/src/components/Sidebar.tsx frontend/src/pages/Library.tsx frontend/src/api.ts
git commit -m "feat: Search page with hybrid results, neighboring chunks, source citations"
```

---

## Environment variables required

```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your-service-role-key
OPENROUTER_API_KEY=sk-or-...
CHAT_MODEL=google/gemini-2.5-flash
EMBEDDING_PROVIDER=local          # or openrouter
LOCAL_EMBEDDING_MODEL=BAAI/bge-small-en-v1.5
EMBEDDING_MODEL=openai/text-embedding-3-small
FILES_DIR=data/files
```

## How to test upload processing

```bash
# Start the server
cd backend && source .venv/bin/activate
uvicorn app.main:app --reload --port 8000

# Test a file upload via the existing FolderUpload page, or directly:
curl -X POST http://localhost:8000/api/scan \
  -H "Content-Type: application/json" \
  -d '{"path": "/path/to/test/folder"}'

# Poll status
curl http://localhost:8000/api/scan/{job_id}

# Check document in Supabase dashboard → Table Editor → documents
# Verify processing_status = "completed"
```

## How to test semantic search

```bash
# In browser: navigate to /search
# Type: "payment obligations breach of contract"
# Expected: results from converted documents with vec_score + fts_score

# Or via API:
curl "http://localhost:8000/api/search?q=payment+obligations"
# Expected: JSON with results[], each having chunk_text, vec_score, neighbors
```

## Limitations and follow-up improvements

1. **IVFFlat index** requires `>= 1000` rows in `document_chunks` to be effective; HNSW index (`vector_hnsw_ops`) is better for smaller datasets — swap `ivfflat` for `hnsw` in the migration if needed.
2. **Embedding dimension** is hard-coded at `384` (bge-small). If you switch to a larger model, you must `ALTER TABLE document_chunks ALTER COLUMN embedding TYPE vector(N)` and re-embed.
3. **tsquery** malformed inputs (user types `AND OR`) will throw; add a try/except wrapper around the FTS branch (already done in the hybrid search code).
4. **File storage** writes to local disk (`data/files/`). For production, swap `save_file_to_disk` in `store.py` for Supabase Storage upload.
5. **Auto-indexing after conversion** is built into the pipeline; the manual "⚡ Index" button in Library can be removed or kept as a re-index trigger.
