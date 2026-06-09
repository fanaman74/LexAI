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
