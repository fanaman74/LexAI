# LexAI Workers

Python Celery extraction worker for LexAI. Processes queued documents: downloads the
original from Supabase Storage, extracts text + markdown (PDF/DOCX/XLSX/EML/MSG),
stores a `.md` artifact back to storage, and marks the document `processed`.

## Prerequisites

- Python 3.11+
- Redis running locally (`redis-server` — installed via brew or docker)
- Supabase `lexai` project credentials

## Setup

```bash
cd workers
cp .env.example .env
# Fill in SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (from project dashboard)
pip install -e ".[dev]"
```

## Run

Terminal 1 — start Redis (if not running as a service):
```bash
redis-server
```

Terminal 2 — start the Celery worker:
```bash
cd workers
source .env  # or: export $(cat .env | xargs)
celery -A celery_app worker --loglevel=info
```

Terminal 3 — start the dispatcher:
```bash
cd workers
source .env
python3 dispatcher.py
```

Terminal 4 — start the embed server (needed for semantic search):
```bash
cd workers
source .env
python3 embed_server.py
# Runs at http://localhost:8765
# Test: curl http://localhost:8765/health
```

Upload a file via the Next.js app at http://localhost:3000. The dispatcher will
claim it within `DISPATCHER_POLL_SECONDS` (default 3s) and Celery will process it.

## Run tests

```bash
cd workers
python3 -m pytest tests/ -v
```

Expected: ≥ 24 tests passing (common, PDF, DOCX, XLSX, EML, MSG extractors).

## Storage paths

| Type | Path |
|------|------|
| Original | `{user_id}/{document_id}/original/{filename}` |
| Markdown artifact | `{user_id}/{document_id}/markdown/{filename}.md` |
| Attachment original | `{user_id}/{parent_id}/attachments/{child_id}/{filename}` |

Both original and markdown artifact are private (signed URLs only).

## Phase 3: Chunking + Embeddings + Semantic Search

After a document is marked `processed`, the dispatcher automatically claims it for chunking via `claim_next_for_chunking()` and dispatches a `chunk_document` Celery task.

The chunker splits `markdown_text` into ~1000-token chunks (4000 chars) with ~100-token (400 char) overlap, respecting markdown headings and paragraph boundaries. Each chunk is embedded using `BAAI/bge-base-en-v1.5` (768d) and stored in `document_chunks` with the embedding vector.

### Semantic search

The embed server must be running to serve query embeddings:

```bash
cd workers
source .env
python3 embed_server.py   # http://localhost:8765
# Health check: curl http://localhost:8765/health
```

Search endpoint: `POST /api/search/semantic` (Next.js)

Request body:
```json
{
  "query": "contract dispute damages",
  "case_id": "optional-uuid",
  "limit": 20
}
```

Response: ranked documents with their most relevant chunks and similarity scores.
