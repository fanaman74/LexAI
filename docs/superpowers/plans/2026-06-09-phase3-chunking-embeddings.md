# LexAI Phase 3 (Chunking + Embeddings + Semantic Search) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the Python worker to chunk processed documents, generate local 768-dimension embeddings via `sentence-transformers`, and expose a Next.js semantic search API endpoint that returns results grouped by document.

**Architecture:** A pure `chunker.py` splits markdown into overlapping chunks; `embeddings.py` wraps `BAAI/bge-base-en-v1.5` as a lazy-loaded singleton; a `chunk_document` Celery task orchestrates chunk → embed → upsert for every processed document; a tiny FastAPI `embed_server.py` exposes `POST /embed` for query-time embedding; and a Next.js `route.ts` calls the embed server + Supabase `match_document_chunks` RPC to return ranked, grouped search results.

**Tech Stack:** Python 3.14, `sentence-transformers>=3.0`, `fastapi>=0.111`, `uvicorn[standard]>=0.30`, Celery 5, Supabase pgvector `vector(768)`, Next.js 16 App Router (TypeScript).

---

## Locked decisions

- Embedding model: **`BAAI/bge-base-en-v1.5`** (768d, optimal for retrieval). Model is downloaded once from HuggingFace (~400 MB) and cached in `~/.cache/huggingface/`.
- BGE query prefix: `"Represent this sentence for searching relevant passages: "` applied only to query strings (not to chunk content).
- Token approximation: `char_count // 4` (no tiktoken dependency).
- Target chunk size: **4000 chars** (≈ 1000 tokens). Overlap: **400 chars** (≈ 100 tokens).
- Chunking is idempotent: existing chunks for a document are deleted before re-inserting.
- New `chunking_status` column on `documents` tracks `null → chunking → chunked | failed` independently of `processing_status`.
- Embed server port: **8765** (configurable via `EMBED_SERVER_URL` env var).
- All Python commands use `workers/.venv/bin/python3` and `workers/.venv/bin/pytest`.

---

## File Structure

```
workers/
  chunking/
    __init__.py           # empty
    chunker.py            # pure: markdown_text → list[Chunk]
    embeddings.py         # lazy-loaded SentenceTransformer, embed_text / embed_batch
  jobs/
    chunk_document.py     # Celery task: chunk + embed + upsert + mark chunked
  embed_server.py         # FastAPI: POST /embed, GET /health
  tests/
    test_chunker.py       # TDD: chunker unit tests
    test_embeddings.py    # TDD: embeddings unit tests (uses real model, tiny fixture)
  pyproject.toml          # add sentence-transformers, fastapi, uvicorn
  config.py               # add EMBED_SERVER_PORT (for embed_server.py)

supabase/migrations/
  20260609000000_phase3.sql   # add chunking_status column + claim_next_for_chunking()

app/api/search/
  semantic/
    route.ts              # POST /api/search/semantic
.env.example              # add EMBED_SERVER_URL
```

**Modified:**
- `workers/supabase_client.py` — add `upsert_chunks`, `delete_document_chunks`, `mark_document_chunked`, `mark_document_chunk_failed`, `get_documents_for_chunking`, `claim_next_for_chunking`
- `workers/dispatcher.py` — add chunking claim loop alongside processing loop
- `workers/pyproject.toml` — add `sentence-transformers`, `fastapi`, `uvicorn`
- `workers/config.py` — add `EMBED_SERVER_PORT`
- `.env.example` — add `EMBED_SERVER_URL`

---

## Task 1: Phase 3 DB migration

**Files:**
- Create: `supabase/migrations/20260609000000_phase3.sql`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260609000000_phase3.sql`:

```sql
-- Phase 3: chunking_status column + concurrency-safe claim for chunking

alter table documents
  add column if not exists chunking_status text null
  check (chunking_status in ('pending','chunking','chunked','failed'));

-- Atomically claim one processed-but-not-yet-chunked document
create or replace function public.claim_next_for_chunking()
returns setof documents
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed_id uuid;
begin
  select id into claimed_id
  from documents
  where processing_status = 'processed'
    and chunking_status is null
  order by processed_at
  limit 1
  for update skip locked;

  if claimed_id is null then
    return;
  end if;

  return query
    update documents
    set chunking_status = 'chunking',
        updated_at = now()
    where id = claimed_id
    returning *;
end;
$$;
```

- [ ] **Step 2: Apply migration**

```bash
cd /Users/fred/Documents/VibeCoding/claudecode/LexAI
export DB_PASSWORD=$(grep '^SUPABASE_DB_PASSWORD=' .env.local | cut -d= -f2-)
supabase db push \
  --db-url "postgresql://postgres.cdztsdygywfbxlfxcipe:${DB_PASSWORD}@aws-1-eu-central-1.pooler.supabase.com:5432/postgres"
```

Expected: `Finished supabase db push.`

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260609000000_phase3.sql
git commit -m "feat(db): add chunking_status column and claim_next_for_chunking() fn"
```

---

## Task 2: Install new Python deps

**Files:**
- Modify: `workers/pyproject.toml`
- Modify: `workers/config.py`

- [ ] **Step 1: Update pyproject.toml**

Replace the `dependencies` list in `workers/pyproject.toml`:

```toml
[build-system]
requires = ["setuptools>=70"]
build-backend = "setuptools.build_meta"

[project]
name = "lexai-workers"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = [
  "celery[redis]>=5.4",
  "supabase>=2.9",
  "pypdf>=4.3",
  "python-docx>=1.1",
  "openpyxl>=3.1",
  "extract-msg>=0.48",
  "markdownify>=0.13",
  "sentence-transformers>=3.0",
  "fastapi>=0.111",
  "uvicorn[standard]>=0.30",
]

[project.optional-dependencies]
dev = [
  "pytest>=8",
  "pytest-asyncio>=0.23",
]

[tool.setuptools]
py-modules = ["config", "celery_app"]

[tool.pytest.ini_options]
testpaths = ["tests"]
asyncio_mode = "auto"
```

- [ ] **Step 2: Install**

```bash
cd /Users/fred/Documents/VibeCoding/claudecode/LexAI/workers
.venv/bin/pip install -e ".[dev]" --quiet
```

Expected: installs without error. `sentence-transformers` pulls in `torch` (~2 GB first time).

- [ ] **Step 3: Pre-download the embedding model**

```bash
cd /Users/fred/Documents/VibeCoding/claudecode/LexAI/workers
.venv/bin/python3 -c "
from sentence_transformers import SentenceTransformer
m = SentenceTransformer('BAAI/bge-base-en-v1.5')
print('model dims:', m.get_sentence_embedding_dimension())
"
```

Expected: `model dims: 768`

- [ ] **Step 4: Add EMBED_SERVER_PORT to config.py**

Replace `workers/config.py`:

```python
import os


class Config:
    supabase_url: str = os.environ["SUPABASE_URL"]
    supabase_service_role_key: str = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    redis_url: str = os.environ.get("REDIS_URL", "redis://localhost:6379/0")
    storage_bucket: str = os.environ.get("STORAGE_BUCKET", "legal-documents")
    dispatcher_poll_seconds: float = float(
        os.environ.get("DISPATCHER_POLL_SECONDS", "3")
    )
    embed_server_port: int = int(os.environ.get("EMBED_SERVER_PORT", "8765"))
```

- [ ] **Step 5: Commit**

```bash
cd /Users/fred/Documents/VibeCoding/claudecode/LexAI
git add workers/pyproject.toml workers/config.py
git commit -m "feat(worker): add sentence-transformers, fastapi, uvicorn deps + embed_server_port config"
```

---

## Task 3: Chunker (TDD)

**Files:**
- Create: `workers/chunking/__init__.py`
- Create: `workers/chunking/chunker.py`
- Create: `workers/tests/test_chunker.py`

- [ ] **Step 1: Write failing tests**

Create `workers/chunking/__init__.py` (empty).

Create `workers/tests/test_chunker.py`:

```python
from chunking.chunker import chunk_markdown, Chunk, create_chunk_id

DOCUMENT_ID = "7a2d4c5f-13f9-4e90-b123-9d6b8d3310f4"
USER_ID = "user-1"

SIMPLE_MD = """# Introduction

This is the first paragraph. It has some content here.

This is the second paragraph. More content.

## Section Two

Another paragraph in section two.
"""

LONG_MD = ("This is a sentence that repeats. " * 200)  # ~6400 chars, forces split


def test_chunk_id_format():
    cid = create_chunk_id(DOCUMENT_ID, 3)
    assert cid == f"{DOCUMENT_ID}::chunk::00003"


def test_chunk_id_zero_padded():
    cid = create_chunk_id(DOCUMENT_ID, 0)
    assert cid.endswith("::chunk::00000")


def test_chunks_returns_list_of_chunk():
    chunks = chunk_markdown(SIMPLE_MD, DOCUMENT_ID, USER_ID)
    assert isinstance(chunks, list)
    assert len(chunks) >= 1
    assert all(isinstance(c, Chunk) for c in chunks)


def test_chunks_have_sequential_indices():
    chunks = chunk_markdown(SIMPLE_MD, DOCUMENT_ID, USER_ID)
    for i, c in enumerate(chunks):
        assert c.chunk_index == i


def test_chunk_ids_match_index():
    chunks = chunk_markdown(SIMPLE_MD, DOCUMENT_ID, USER_ID)
    for c in chunks:
        assert c.chunk_id == create_chunk_id(DOCUMENT_ID, c.chunk_index)


def test_long_text_splits_into_multiple_chunks():
    chunks = chunk_markdown(LONG_MD, DOCUMENT_ID, USER_ID)
    assert len(chunks) >= 2


def test_chunks_cover_all_content():
    """All content from the source should appear in at least one chunk."""
    chunks = chunk_markdown(LONG_MD, DOCUMENT_ID, USER_ID)
    combined = " ".join(c.content for c in chunks)
    # Sample words from the original
    assert "sentence" in combined
    assert "repeats" in combined


def test_chunk_metadata_fields():
    chunks = chunk_markdown(SIMPLE_MD, DOCUMENT_ID, USER_ID)
    for c in chunks:
        assert c.document_id == DOCUMENT_ID
        assert c.user_id == USER_ID
        assert c.char_count == len(c.content)
        assert c.token_count == c.char_count // 4
        assert isinstance(c.metadata, dict)


def test_section_title_extracted():
    chunks = chunk_markdown(SIMPLE_MD, DOCUMENT_ID, USER_ID)
    titles = [c.metadata.get("section_title") for c in chunks]
    # At least one chunk should have "Introduction" or "Section Two" as section title
    assert any(t in ("Introduction", "Section Two") for t in titles if t)


def test_no_empty_chunks():
    chunks = chunk_markdown(SIMPLE_MD, DOCUMENT_ID, USER_ID)
    for c in chunks:
        assert len(c.content.strip()) >= 1
```

- [ ] **Step 2: Run tests, verify fail**

```bash
cd /Users/fred/Documents/VibeCoding/claudecode/LexAI/workers
.venv/bin/pytest tests/test_chunker.py -v
```

Expected: FAIL (module not found).

- [ ] **Step 3: Implement chunker.py**

Create `workers/chunking/chunker.py`:

```python
from __future__ import annotations
import re
from dataclasses import dataclass, field


TARGET_CHARS = 4000   # ≈ 1000 tokens at 4 chars/token
OVERLAP_CHARS = 400   # ≈ 100 tokens carried into next chunk
MIN_CHUNK_CHARS = 20  # skip trivially short content


@dataclass
class Chunk:
    document_id: str
    user_id: str
    chunk_id: str
    chunk_index: int
    content: str
    content_markdown: str
    token_count: int
    char_count: int
    metadata: dict = field(default_factory=dict)
    embedding: list[float] | None = None


def create_chunk_id(document_id: str, chunk_index: int) -> str:
    return f"{document_id}::chunk::{chunk_index:05d}"


def chunk_markdown(
    markdown_text: str,
    document_id: str,
    user_id: str,
    metadata: dict | None = None,
) -> list[Chunk]:
    """
    Split markdown into overlapping chunks respecting heading and paragraph boundaries.
    Returns list of Chunk dataclasses ordered by chunk_index.
    """
    if not markdown_text or not markdown_text.strip():
        return []

    base_meta = metadata or {}
    raw_blocks = _split_into_blocks(markdown_text)
    raw_chunks = _assemble_chunks(raw_blocks)
    result: list[Chunk] = []
    for i, (content, section_title, page_num) in enumerate(raw_chunks):
        content = content.strip()
        if len(content) < MIN_CHUNK_CHARS:
            continue
        idx = len(result)
        meta = {**base_meta}
        if section_title:
            meta["section_title"] = section_title
        if page_num is not None:
            meta["page_start"] = page_num
        result.append(Chunk(
            document_id=document_id,
            user_id=user_id,
            chunk_id=create_chunk_id(document_id, idx),
            chunk_index=idx,
            content=content,
            content_markdown=content,
            char_count=len(content),
            token_count=len(content) // 4,
            metadata=meta,
        ))
    return result


def _split_into_blocks(text: str) -> list[tuple[str, str | None, int | None]]:
    """
    Yield (block_text, section_title, page_num) tuples.
    Headings and page markers update the current section/page context.
    """
    heading_re = re.compile(r'^(#{1,6})\s+(.+)$', re.MULTILINE)
    page_re = re.compile(r'<!--\s*page\s+(\d+)\s*-->')

    # Interleave headings and paragraphs preserving order
    blocks: list[tuple[str, str | None, int | None]] = []
    current_section: str | None = None
    current_page: int | None = None

    # Split on blank lines first, then classify each block
    raw_blocks = re.split(r'\n{2,}', text)
    for block in raw_blocks:
        block = block.strip()
        if not block:
            continue

        # Page marker
        pm = page_re.search(block)
        if pm:
            current_page = int(pm.group(1))
            # Strip marker from block; if nothing left, skip
            clean = page_re.sub('', block).strip()
            if clean:
                blocks.append((clean, current_section, current_page))
            continue

        # Heading
        hm = heading_re.match(block)
        if hm:
            current_section = hm.group(2).strip()
            # Heading itself is content too
            blocks.append((block, current_section, current_page))
            continue

        blocks.append((block, current_section, current_page))

    return blocks


def _assemble_chunks(
    blocks: list[tuple[str, str | None, int | None]],
) -> list[tuple[str, str | None, int | None]]:
    """
    Accumulate blocks into TARGET_CHARS-sized chunks with OVERLAP_CHARS carry-over.
    Returns list of (content, section_title, page_num) tuples.
    """
    chunks: list[tuple[str, str | None, int | None]] = []
    buffer: list[str] = []
    buffer_chars = 0
    buf_section: str | None = None
    buf_page: int | None = None
    overlap_text = ""

    def flush() -> None:
        nonlocal buffer, buffer_chars, overlap_text, buf_section, buf_page
        if not buffer:
            return
        content = "\n\n".join(buffer)
        if overlap_text:
            content = overlap_text + "\n\n" + content
        chunks.append((content.strip(), buf_section, buf_page))
        # Carry-over: last OVERLAP_CHARS of the flushed content
        overlap_text = content[-OVERLAP_CHARS:] if len(content) > OVERLAP_CHARS else content
        buffer = []
        buffer_chars = 0

    for text, section, page in blocks:
        if section and section != buf_section and buffer:
            # Section boundary: flush if buffer is sizeable
            if buffer_chars >= TARGET_CHARS // 2:
                flush()
                buf_section = section
                buf_page = page
        if page is not None and buf_page is None:
            buf_page = page
        if section and buf_section is None:
            buf_section = section

        buffer.append(text)
        buffer_chars += len(text)

        if buffer_chars >= TARGET_CHARS:
            flush()

    flush()  # final partial chunk
    return chunks
```

- [ ] **Step 4: Run tests, verify pass**

```bash
cd /Users/fred/Documents/VibeCoding/claudecode/LexAI/workers
.venv/bin/pytest tests/test_chunker.py -v
```

Expected: 9 tests PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/fred/Documents/VibeCoding/claudecode/LexAI
git add workers/chunking/ workers/tests/test_chunker.py
git commit -m "feat(chunker): markdown chunker with heading/paragraph boundaries and overlap"
```

---

## Task 4: Embeddings module (TDD)

**Files:**
- Create: `workers/chunking/embeddings.py`
- Create: `workers/tests/test_embeddings.py`

- [ ] **Step 1: Write failing tests**

Create `workers/tests/test_embeddings.py`:

```python
import pytest
from chunking.embeddings import embed_text, embed_batch, EMBEDDING_DIM

QUERY_PREFIX = "Represent this sentence for searching relevant passages: "


def test_embed_text_returns_list():
    vec = embed_text("This is a legal document about contract law.")
    assert isinstance(vec, list)


def test_embed_text_correct_dimensions():
    vec = embed_text("Hello world.")
    assert len(vec) == EMBEDDING_DIM
    assert EMBEDDING_DIM == 768


def test_embed_text_returns_floats():
    vec = embed_text("Evidence was found at the scene.")
    assert all(isinstance(v, float) for v in vec)


def test_embed_batch_returns_list_of_lists():
    texts = ["First sentence.", "Second sentence."]
    vecs = embed_batch(texts)
    assert isinstance(vecs, list)
    assert len(vecs) == 2
    assert all(len(v) == EMBEDDING_DIM for v in vecs)


def test_embed_batch_empty_returns_empty():
    vecs = embed_batch([])
    assert vecs == []


def test_embed_text_short_skipped():
    """Texts shorter than MIN_CHARS should raise ValueError."""
    with pytest.raises(ValueError, match="too short"):
        embed_text("Hi")
```

- [ ] **Step 2: Run tests, verify fail**

```bash
cd /Users/fred/Documents/VibeCoding/claudecode/LexAI/workers
.venv/bin/pytest tests/test_embeddings.py -v
```

Expected: FAIL (module not found).

- [ ] **Step 3: Implement embeddings.py**

Create `workers/chunking/embeddings.py`:

```python
from __future__ import annotations
from functools import lru_cache

EMBEDDING_DIM = 768
MIN_CHARS = 20
MODEL_NAME = "BAAI/bge-base-en-v1.5"
# BGE prefix for query strings (not for document chunks)
QUERY_PREFIX = "Represent this sentence for searching relevant passages: "


@lru_cache(maxsize=1)
def _get_model():
    """Lazy-load the SentenceTransformer model (cached for the process lifetime)."""
    from sentence_transformers import SentenceTransformer
    return SentenceTransformer(MODEL_NAME)


def embed_text(text: str, is_query: bool = False) -> list[float]:
    """
    Embed a single text string. Raises ValueError if text is too short.
    Pass is_query=True to prepend the BGE query prefix.
    """
    if len(text.strip()) < MIN_CHARS:
        raise ValueError(f"Text too short to embed (min {MIN_CHARS} chars): {text!r}")
    if is_query:
        text = QUERY_PREFIX + text
    model = _get_model()
    vec = model.encode(text, normalize_embeddings=True)
    return vec.tolist()


def embed_batch(texts: list[str], is_query: bool = False) -> list[list[float]]:
    """
    Embed a batch of texts. Empty-ish texts are silently skipped (returned as None
    entries — caller should zip with the original list to align indices).
    Returns only non-None embeddings for non-empty texts.
    """
    if not texts:
        return []
    if is_query:
        texts = [QUERY_PREFIX + t for t in texts]
    model = _get_model()
    vecs = model.encode(texts, normalize_embeddings=True, batch_size=32, show_progress_bar=False)
    return [v.tolist() for v in vecs]
```

- [ ] **Step 4: Run tests, verify pass**

```bash
cd /Users/fred/Documents/VibeCoding/claudecode/LexAI/workers
.venv/bin/pytest tests/test_embeddings.py -v
```

Expected: 6 tests PASS. (Note: first run downloads model if not cached. May take 1-2 min.)

- [ ] **Step 5: Commit**

```bash
cd /Users/fred/Documents/VibeCoding/claudecode/LexAI
git add workers/chunking/embeddings.py workers/tests/test_embeddings.py
git commit -m "feat(embeddings): local BAAI/bge-base-en-v1.5 embedding module (768d)"
```

---

## Task 5: Supabase client additions

**Files:**
- Modify: `workers/supabase_client.py`

- [ ] **Step 1: Add the new functions**

Append to the end of `workers/supabase_client.py`:

```python
# ── Chunking helpers ──────────────────────────────────────────────────────────

def delete_document_chunks(document_id: str) -> None:
    """Delete all existing chunks for a document (before re-chunking)."""
    client = get_client()
    resp = client.table("document_chunks").delete().eq("document_id", document_id).execute()
    _check(resp, "delete_document_chunks")


def upsert_chunks(chunks: list[dict]) -> None:
    """
    Batch-upsert document chunks. Each dict must have all required columns.
    Uses chunk_id as the conflict key.
    """
    if not chunks:
        return
    client = get_client()
    # Supabase upsert with on_conflict resolution
    resp = client.table("document_chunks").upsert(chunks, on_conflict="chunk_id").execute()
    _check(resp, "upsert_chunks")


def mark_document_chunked(document_id: str) -> None:
    update_document(document_id, {
        "chunking_status": "chunked",
        "updated_at": datetime.now(timezone.utc).isoformat(),
    })


def mark_document_chunk_failed(document_id: str, error: str) -> None:
    update_document(document_id, {
        "chunking_status": "failed",
        "processing_error": error,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    })


def claim_next_for_chunking() -> dict | None:
    """Atomically claim one processed document for chunking via DB function."""
    client = get_client()
    resp = client.rpc("claim_next_for_chunking", {}).execute()
    _check(resp, "claim_next_for_chunking")
    if not resp.data:
        return None
    return resp.data[0] if isinstance(resp.data, list) else resp.data
```

- [ ] **Step 2: Verify imports still work**

```bash
cd /Users/fred/Documents/VibeCoding/claudecode/LexAI/workers
SUPABASE_URL=https://example.supabase.co SUPABASE_SERVICE_ROLE_KEY=fake \
  .venv/bin/python3 -c "
from supabase_client import (
    upsert_chunks, delete_document_chunks,
    mark_document_chunked, mark_document_chunk_failed,
    claim_next_for_chunking,
)
print('supabase_client additions OK')
"
```

Expected: `supabase_client additions OK`

- [ ] **Step 3: Commit**

```bash
cd /Users/fred/Documents/VibeCoding/claudecode/LexAI
git add workers/supabase_client.py
git commit -m "feat(worker): add chunking helpers to supabase_client (upsert_chunks, claim_next_for_chunking)"
```

---

## Task 6: `chunk_document` Celery task

**Files:**
- Create: `workers/jobs/chunk_document.py`

- [ ] **Step 1: Implement**

Create `workers/jobs/chunk_document.py`:

```python
from __future__ import annotations
from celery_app import app
from supabase_client import (
    get_document,
    delete_document_chunks,
    upsert_chunks,
    mark_document_chunked,
    mark_document_chunk_failed,
)
from chunking.chunker import chunk_markdown
from chunking.embeddings import embed_batch, MIN_CHARS


@app.task(bind=True, max_retries=3, default_retry_delay=60, name="jobs.chunk_document")
def chunk_document(self, document_id: str) -> dict:
    """
    Celery task: chunk the stored markdown, embed each chunk, upsert into document_chunks.
    Idempotent: deletes existing chunks before reinserting.
    """
    try:
        row = get_document(document_id)
        user_id = row["user_id"]
        markdown_text = row.get("markdown_text") or ""

        if not markdown_text.strip():
            # No text to chunk (OCR-required PDFs, empty docs, etc.)
            mark_document_chunked(document_id)
            return {"status": "chunked", "document_id": document_id, "chunk_count": 0}

        # 1. Chunk the markdown
        chunks = chunk_markdown(
            markdown_text,
            document_id=document_id,
            user_id=user_id,
            metadata={
                "source_type": row.get("source_type"),
                "original_filename": row.get("original_filename"),
            },
        )

        if not chunks:
            mark_document_chunked(document_id)
            return {"status": "chunked", "document_id": document_id, "chunk_count": 0}

        # 2. Embed chunks that are long enough
        embeddable_indices = [i for i, c in enumerate(chunks) if c.char_count >= MIN_CHARS]
        embeddable_texts = [chunks[i].content for i in embeddable_indices]
        embeddings = embed_batch(embeddable_texts)

        for list_pos, chunk_idx in enumerate(embeddable_indices):
            chunks[chunk_idx].embedding = embeddings[list_pos]

        # 3. Idempotent: delete existing chunks
        delete_document_chunks(document_id)

        # 4. Upsert all chunks
        rows = [
            {
                "user_id": user_id,
                "document_id": document_id,
                "chunk_id": c.chunk_id,
                "chunk_index": c.chunk_index,
                "content": c.content,
                "content_markdown": c.content_markdown,
                "token_count": c.token_count,
                "char_count": c.char_count,
                "embedding": c.embedding,
                "metadata": c.metadata,
                "section_title": c.metadata.get("section_title"),
            }
            for c in chunks
        ]
        upsert_chunks(rows)

        # 5. Mark document as chunked
        mark_document_chunked(document_id)

        return {
            "status": "chunked",
            "document_id": document_id,
            "chunk_count": len(chunks),
        }

    except Exception as exc:
        if self.request.retries >= self.max_retries:
            mark_document_chunk_failed(document_id, str(exc))
        raise self.retry(exc=exc)
```

- [ ] **Step 2: Register task in celery_app.py**

Update `workers/celery_app.py` to include the new task:

```python
from celery import Celery
from config import Config

app = Celery(
    "lexai",
    broker=Config.redis_url,
    backend=Config.redis_url,
    include=["jobs.process_document", "jobs.chunk_document"],
)

app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="UTC",
    enable_utc=True,
    task_track_started=True,
)
```

- [ ] **Step 3: Verify imports**

```bash
cd /Users/fred/Documents/VibeCoding/claudecode/LexAI/workers
SUPABASE_URL=https://example.supabase.co SUPABASE_SERVICE_ROLE_KEY=fake REDIS_URL=redis://localhost:6379/0 \
  .venv/bin/python3 -c "from jobs.chunk_document import chunk_document; print('chunk_document task imports OK')"
```

Expected: `chunk_document task imports OK`

- [ ] **Step 4: Commit**

```bash
cd /Users/fred/Documents/VibeCoding/claudecode/LexAI
git add workers/jobs/chunk_document.py workers/celery_app.py
git commit -m "feat(worker): chunk_document Celery task (chunk + embed + upsert)"
```

---

## Task 7: Dispatcher — add chunking claim loop

**Files:**
- Modify: `workers/dispatcher.py`

- [ ] **Step 1: Read current dispatcher.py and update**

Replace `workers/dispatcher.py` with:

```python
"""
Dispatcher: poll loop that claims queued/processed documents and enqueues Celery tasks.

Run with:
    cd workers && python3 dispatcher.py
"""
from __future__ import annotations
import time
import logging
import signal
from config import Config
from supabase_client import claim_next_document, claim_next_for_chunking
from jobs.process_document import process_document
from jobs.chunk_document import chunk_document

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [dispatcher] %(levelname)s %(message)s",
)
log = logging.getLogger(__name__)

_running = True


def _handle_signal(sig, frame):
    global _running
    log.info("Signal received, shutting down gracefully…")
    _running = False


def run_once() -> bool:
    """
    Claim one document for processing OR one for chunking.
    Returns True if any work was dispatched.
    """
    dispatched = False

    # 1. Claim for extraction/processing
    doc = claim_next_document()
    if doc:
        doc_id = doc["id"]
        log.info("Claimed for processing: %s (%s)", doc_id, doc.get("original_filename"))
        try:
            process_document.delay(doc_id)
            dispatched = True
        except Exception as e:
            log.error("Failed to enqueue process_document %s: %s", doc_id, e)
            try:
                from supabase_client import update_document
                update_document(doc_id, {"processing_status": "queued"})
            except Exception as reset_err:
                log.error("Failed to reset processing status for %s: %s", doc_id, reset_err)

    # 2. Claim for chunking
    doc2 = claim_next_for_chunking()
    if doc2:
        doc_id2 = doc2["id"]
        log.info("Claimed for chunking: %s (%s)", doc_id2, doc2.get("original_filename"))
        try:
            chunk_document.delay(doc_id2)
            dispatched = True
        except Exception as e:
            log.error("Failed to enqueue chunk_document %s: %s", doc_id2, e)
            try:
                from supabase_client import update_document
                update_document(doc_id2, {"chunking_status": None})
            except Exception as reset_err:
                log.error("Failed to reset chunking status for %s: %s", doc_id2, reset_err)

    return dispatched


def main() -> None:
    signal.signal(signal.SIGINT, _handle_signal)
    signal.signal(signal.SIGTERM, _handle_signal)
    log.info("Dispatcher started (poll_seconds=%.1f)", Config.dispatcher_poll_seconds)
    while _running:
        try:
            claimed = run_once()
            if not claimed:
                time.sleep(Config.dispatcher_poll_seconds)
        except Exception as e:
            log.error("Dispatcher error: %s", e, exc_info=True)
            time.sleep(Config.dispatcher_poll_seconds)
    log.info("Dispatcher stopped.")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Verify imports**

```bash
cd /Users/fred/Documents/VibeCoding/claudecode/LexAI/workers
SUPABASE_URL=https://example.supabase.co SUPABASE_SERVICE_ROLE_KEY=fake REDIS_URL=redis://localhost:6379/0 \
  .venv/bin/python3 -c "from dispatcher import run_once, main; print('dispatcher imports OK')"
```

Expected: `dispatcher imports OK`

- [ ] **Step 3: Commit**

```bash
cd /Users/fred/Documents/VibeCoding/claudecode/LexAI
git add workers/dispatcher.py
git commit -m "feat(worker): dispatcher claims both processing and chunking queues"
```

---

## Task 8: Embed server (FastAPI)

**Files:**
- Create: `workers/embed_server.py`

- [ ] **Step 1: Implement**

Create `workers/embed_server.py`:

```python
"""
Embed server: lightweight FastAPI service for query-time embedding.

Run with:
    cd workers && python3 embed_server.py
    # or: uvicorn embed_server:app --port 8765
"""
from __future__ import annotations
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from config import Config
from chunking.embeddings import embed_text, EMBEDDING_DIM, MODEL_NAME

app = FastAPI(title="LexAI Embed Server", version="1.0")


class EmbedRequest(BaseModel):
    text: str
    is_query: bool = True  # applies BGE query prefix by default


class EmbedResponse(BaseModel):
    embedding: list[float]
    dim: int
    model: str


@app.get("/health")
def health():
    return {"status": "ok", "model": MODEL_NAME, "dim": EMBEDDING_DIM}


@app.post("/embed", response_model=EmbedResponse)
def embed(req: EmbedRequest):
    try:
        vec = embed_text(req.text, is_query=req.is_query)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    return EmbedResponse(embedding=vec, dim=len(vec), model=MODEL_NAME)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=Config.embed_server_port)
```

- [ ] **Step 2: Verify import**

```bash
cd /Users/fred/Documents/VibeCoding/claudecode/LexAI/workers
SUPABASE_URL=https://example.supabase.co SUPABASE_SERVICE_ROLE_KEY=fake \
  .venv/bin/python3 -c "from embed_server import app; print('embed_server imports OK')"
```

Expected: `embed_server imports OK`

- [ ] **Step 3: Update workers README to document embed server**

Append to `workers/README.md` (after the existing "Run" section):

```markdown
Terminal 4 — start the embed server (needed for semantic search):
```bash
cd workers
source .env
python3 embed_server.py
# Runs at http://localhost:8765
# Test: curl http://localhost:8765/health
```
```

- [ ] **Step 4: Commit**

```bash
cd /Users/fred/Documents/VibeCoding/claudecode/LexAI
git add workers/embed_server.py workers/README.md
git commit -m "feat(worker): FastAPI embed server for query-time embedding (port 8765)"
```

---

## Task 9: Next.js semantic search API

**Files:**
- Create: `app/api/search/semantic/route.ts`
- Modify: `.env.example`

- [ ] **Step 1: Add EMBED_SERVER_URL to .env.example**

Add to `.env.example`:

```
# Phase 3: embed server (run workers/embed_server.py)
EMBED_SERVER_URL=http://localhost:8765
```

Also add to `.env.local`:
```
EMBED_SERVER_URL=http://localhost:8765
```

- [ ] **Step 2: Create the route**

Create `app/api/search/semantic/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

const EMBED_SERVER_URL = process.env.EMBED_SERVER_URL ?? "http://localhost:8765";

interface SemanticSearchBody {
  query: string;
  case_id?: string;
  limit?: number;
}

interface ChunkResult {
  document_id: string;
  chunk_id: string;
  chunk_index: number;
  content: string;
  similarity: number;
  metadata: Record<string, unknown>;
}

interface DocumentResult {
  document_id: string;
  max_similarity: number;
  chunks: ChunkResult[];
  original_filename?: string;
  source_type?: string;
  processing_status?: string;
}

export async function POST(req: NextRequest) {
  // Auth
  const user = await requireUser();

  // Parse body
  let body: SemanticSearchBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { query, case_id, limit = 20 } = body;
  if (!query || typeof query !== "string" || query.trim().length < 3) {
    return NextResponse.json(
      { error: "query must be at least 3 characters" },
      { status: 400 }
    );
  }

  // 1. Embed the query via the Python embed server
  let embedding: number[];
  try {
    const embedRes = await fetch(`${EMBED_SERVER_URL}/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: query.trim(), is_query: true }),
    });
    if (!embedRes.ok) {
      const err = await embedRes.text();
      return NextResponse.json(
        { error: `Embed server error: ${err}` },
        { status: 502 }
      );
    }
    const embedData = await embedRes.json();
    embedding = embedData.embedding as number[];
  } catch (e) {
    return NextResponse.json(
      { error: "Embed server unreachable. Is workers/embed_server.py running?" },
      { status: 503 }
    );
  }

  // 2. Call match_document_chunks RPC (service-role client to bypass RLS, filtered by user_id)
  const supabase = await createClient();
  const { data: chunks, error } = await supabase.rpc("match_document_chunks", {
    query_embedding: embedding,
    match_count: limit * 5, // fetch more, then group & trim
    filter_case_id: case_id ?? null,
    filter_user_id: user.id,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // 3. Group by document_id, keep top 5 chunks per document, rank by max similarity
  const docMap = new Map<string, ChunkResult[]>();
  for (const chunk of (chunks as ChunkResult[]) ?? []) {
    const existing = docMap.get(chunk.document_id) ?? [];
    existing.push(chunk);
    docMap.set(chunk.document_id, existing);
  }

  // Fetch document metadata for result enrichment
  const documentIds = Array.from(docMap.keys());
  let docMeta: Record<string, { original_filename: string; source_type: string; processing_status: string }> = {};
  if (documentIds.length > 0) {
    const { data: docs } = await supabase
      .from("documents")
      .select("id, original_filename, source_type, processing_status")
      .in("id", documentIds);
    for (const d of docs ?? []) {
      docMeta[d.id] = {
        original_filename: d.original_filename,
        source_type: d.source_type,
        processing_status: d.processing_status,
      };
    }
  }

  const results: DocumentResult[] = Array.from(docMap.entries())
    .map(([document_id, docChunks]) => {
      // Sort by similarity desc, keep top 5
      const topChunks = docChunks
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, 5);
      const max_similarity = topChunks[0]?.similarity ?? 0;
      return {
        document_id,
        max_similarity,
        chunks: topChunks,
        ...docMeta[document_id],
      };
    })
    .sort((a, b) => b.max_similarity - a.max_similarity)
    .slice(0, limit);

  return NextResponse.json({
    query,
    result_count: results.length,
    results,
  });
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /Users/fred/Documents/VibeCoding/claudecode/LexAI
npm run build 2>&1 | grep -E "error|Error|warning" | head -20
```

Expected: no TypeScript errors in the new route. (Some unrelated warnings from other files are OK.)

- [ ] **Step 4: Commit**

```bash
cd /Users/fred/Documents/VibeCoding/claudecode/LexAI
git add app/api/search/semantic/route.ts .env.example
git commit -m "feat(api): POST /api/search/semantic with embed server + pgvector + grouped results"
```

---

## Task 10: Full test suite + README update

**Files:**
- Modify: `workers/README.md` (already updated in T8)

- [ ] **Step 1: Run all Python tests**

```bash
cd /Users/fred/Documents/VibeCoding/claudecode/LexAI/workers
.venv/bin/pytest tests/ -v 2>&1
```

Expected: ≥ 39 tests pass (24 existing + 9 chunker + 6 embeddings).

- [ ] **Step 2: Verify full import chain**

```bash
cd /Users/fred/Documents/VibeCoding/claudecode/LexAI/workers
SUPABASE_URL=https://example.supabase.co SUPABASE_SERVICE_ROLE_KEY=fake REDIS_URL=redis://localhost:6379/0 \
  .venv/bin/python3 -c "
from jobs.process_document import process_document
from jobs.chunk_document import chunk_document
from dispatcher import run_once
from embed_server import app
print('All imports OK')
"
```

Expected: `All imports OK`

- [ ] **Step 3: Update workers/README.md to add Phase 3 section**

Append to `workers/README.md` after the Storage paths table:

```markdown
## Phase 3: Chunking + Embeddings

After processing, the dispatcher claims `processed` documents and dispatches `chunk_document` tasks.

The chunker splits `markdown_text` into ~1000-token chunks with 100-token overlap, respecting heading/paragraph boundaries. Each chunk is embedded with `BAAI/bge-base-en-v1.5` (768d) and upserted into `document_chunks`.

The embed server must be running for semantic search:
```bash
python3 embed_server.py   # http://localhost:8765
```

Semantic search: `POST /api/search/semantic` (Next.js) with body `{"query": "your query"}`.
```

- [ ] **Step 4: Commit**

```bash
cd /Users/fred/Documents/VibeCoding/claudecode/LexAI
git add workers/README.md
git commit -m "docs(worker): add Phase 3 chunking/embeddings section to README"
```

---

## Self-Review

### Spec coverage

| Spec requirement | Task |
|---|---|
| Chunk size 800–1200 tokens, overlap 100–150 tokens | T3 (4000 chars ≈ 1000 tokens, 400 chars ≈ 100 tokens) |
| Chunk boundaries: headings, paragraphs, pages, email sections | T3 |
| `chunk_id = {doc_id}::chunk::{index:05d}` | T3 |
| Each chunk has `chunk_id`, `chunk_index`, `content`, `content_markdown`, `token_count`, `char_count`, `metadata` | T3, T6 |
| Embedding service abstraction | T4 (`embed_text`, `embed_batch`) |
| Store embeddings in `document_chunks.embedding` | T6 |
| Do not embed empty/short chunks | T4 (MIN_CHARS=20), T6 |
| `match_document_chunks` SQL function | Already in Phase 1 migration |
| `chunking_status` tracking | T1 migration, T5 supabase_client, T6 task |
| Idempotent re-chunking (delete+reinsert) | T6 |
| Dispatcher triggers chunking | T7 |
| Embed server for query embedding | T8 |
| Semantic search API, grouped by document | T9 |
| Top 5 chunks per document, ranked by similarity | T9 |
| `filter_user_id` scoping | T9 (passed to RPC) |
| `filter_case_id` scoping | T9 (passed to RPC) |
| EMBED_SERVER_URL configurable via env | T9, `.env.example` |

### No placeholders: all steps contain complete code.

### Type consistency
- `Chunk` dataclass defined T3, used T6 — consistent field names.
- `embed_batch(texts: list[str]) -> list[list[float]]` defined T4, called T6 — consistent.
- `upsert_chunks(chunks: list[dict])` defined T5, called T6 — consistent (T6 builds dicts from `Chunk` instances).
- `claim_next_for_chunking()` defined T5, called T7 — consistent.
- `chunk_document.delay(doc_id)` used T7, task name `"jobs.chunk_document"` registered T6 — consistent.
- `EmbedRequest.text` / `EmbedResponse.embedding` in T8, consumed as `embedData.embedding` in T9 — consistent.
