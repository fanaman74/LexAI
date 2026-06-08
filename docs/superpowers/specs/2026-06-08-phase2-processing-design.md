# LexAI — Phase 2 (Processing) Design

**Date:** 2026-06-08
**Status:** Draft for approval
**Depends on:** Phase 1 (Foundation) — schema, storage bucket, `queued` documents.

## Context

Phase 1 leaves every uploaded document at `processing_status='queued'` with its original
stored. Phase 2 builds the **Python extraction worker** that turns a queued document into
extracted text + markdown + metadata, extracts email attachments into linked child
documents, and marks the document `processed` (or `failed`, preserving the original).

Chunking, embeddings, semantic search, and AI are **out of scope** — they are Phases 3+.

## Locked decisions

- **Worker:** Python 3 + **Celery** with a **Redis** broker (local Redis in dev).
- **Trigger:** a **DB-poller dispatcher** — a Python loop that atomically claims `queued`
  documents (`update ... set processing_status='processing' where id=? and processing_status='queued'`
  returning the row) and dispatches a Celery `process_document` task. No coupling to the
  Next app.
- **Supabase access:** the worker uses the **service-role key** (bypasses RLS) via the
  `supabase` Python client for Storage + PostgREST. DB writes go through PostgREST.
- **Extraction libs:** `pypdf` (PDF), `python-docx` (DOCX), `openpyxl` (XLSX),
  stdlib `email` (EML), `extract-msg` (MSG).

## Scope

### In scope (instruct.md §4.2 steps 1–9, §9, §22, §13 search_vector)

1. **Worker package** under `workers/`:
   ```
   workers/
     celery_app.py        # Celery instance (Redis broker/backend)
     config.py            # env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, REDIS_URL, bucket
     supabase_client.py   # service-role client + storage download/upload + doc update helpers
     dispatcher.py        # poll loop: claim queued docs -> enqueue process_document
     extractors/
       common.py          # ExtractionResult dataclass + shared helpers (html->md, etc.)
       pdf_extractor.py
       docx_extractor.py
       xlsx_extractor.py
       eml_extractor.py
       msg_extractor.py
       __init__.py        # extract(source_type, path, bytes) router
     jobs/
       process_document.py# the Celery task: orchestrates download->extract->persist
     tests/
       test_*.py          # pytest, with small fixture files
     pyproject.toml       # deps (celery, redis, supabase, pypdf, python-docx, openpyxl, extract-msg, pytest)
     README.md            # how to run (Redis + celery worker + dispatcher)
     .env.example
   ```

2. **ExtractionResult** (returned by every extractor):
   `text: str`, `markdown: str`, `metadata: dict`, and optional `attachments: list[Attachment]`
   (filename, bytes, content_type) for emails. PDF metadata carries `page_count`,
   `requires_ocr`; per-page text is concatenated into `text`/`markdown` (page-level chunk
   boundaries are recreated in Phase 3 from the markdown — Phase 2 stores doc-level text).

3. **Per-type extraction** (instruct.md §9.1–9.5):
   - **PDF:** page-by-page text via `pypdf`; if total extracted text is near-empty, set
     `metadata.requires_ocr=true` and still mark `processed` (OCR deferred to a later phase).
     Markdown = pages joined with `\n\n---\n\n`.
   - **DOCX:** paragraphs, headings (→ `#`/`##`), tables (→ markdown tables), in document order.
   - **XLSX:** per-sheet markdown tables (`## Sheet: <name>`), visible cell values; not one blob.
   - **EML:** parse headers (from/to/cc/subject/date/message-id), prefer text body else
     HTML→markdown; extract attachments.
   - **MSG:** `extract-msg` for sender/recipients/cc/subject/date/body + attachments.

4. **Email → attachments (instruct.md §22):** for EML/MSG, for each attachment create a
   **child document** (`source_type='email_attachment'`, `parent_document_id=<email id>`,
   `processing_status='queued'`), upload its bytes to
   `{user_id}/{parent_id}/attachments/{child_id}/{filename}`, compute its SHA256, run
   duplicate detection. The dispatcher then picks up the queued child and processes it by
   its real file type (the child's `file_extension`/detected type drives extraction).

5. **Persist on the document:** `extracted_text`, `markdown_text`, email fields
   (`sender`, `recipients`, `cc`, `email_subject`, `email_message_id`, `document_datetime`,
   `author` where available), `processing_status='processed'`, `processed_at=now()`, and
   update `search_vector` (instruct.md §13) so keyword search works in later phases.

6. **Error handling (instruct.md §20):** any extractor/IO failure → `processing_status='failed'`,
   `processing_error=<message>`, original file untouched. A `failed` or `queued` document can
   be reprocessed by resetting status to `queued` (the dispatcher re-claims it). MSG parse
   failure marks failed but preserves the original.

7. **Idempotency:** re-processing a document deletes nothing but overwrites the derived
   fields; child attachment documents are created only if not already present for that parent
   (match on parent_id + filename + sha256) to avoid duplicates on reprocess.

### Explicitly out of scope (later phases)

Chunking, embeddings, `document_chunks` writes, semantic/hybrid search, AI summaries/keywords,
OCR, UI, reprocess/notification API endpoints. (Phase 2 only sets statuses and stores
text/markdown/metadata.)

## Components & boundaries

- `extractors/*` are **pure**: `(bytes|path) -> ExtractionResult`. No network, no DB. Unit-tested with fixtures.
- `extractors/__init__.py::extract(source_type, data)` routes to the right extractor.
- `supabase_client.py` isolates all Supabase IO (download original, upload attachment, fetch/update document rows, insert child docs).
- `jobs/process_document.py` orchestrates: load row → download → extract → (attachments) → persist. It is the only place that combines IO + extraction.
- `dispatcher.py` is the only place that claims work and enqueues tasks.

## Data flow

```
dispatcher loop:
  claim: update documents set processing_status='processing'
         where id = (select id from documents where processing_status='queued'
                     order by created_at limit 1 for update skip locked) returning *
  -> process_document.delay(document_id)

process_document(document_id):
  row = get document
  bytes = storage.download(row.storage_path)
  result = extract(row.source_type, bytes)
  if row.source_type in (eml, msg):
     for att in result.attachments:
        child = insert document(source_type=detect(att.filename), parent_document_id=row.id,
                                 sha256, duplicate_of?, status='queued')
        storage.upload(attachmentPath(user, row.id, child.id, att.filename), att.bytes)
  update document: extracted_text, markdown_text, email fields, search_vector,
                   processing_status='processed', processed_at=now()
  on exception: update document set processing_status='failed', processing_error=str(e)
```

Note: the claim uses PostgREST. Because PostgREST can't do `FOR UPDATE SKIP LOCKED`, the
dispatcher claims via a SECURITY DEFINER SQL function `claim_next_document()` added in a
Phase 2 migration (returns one row and flips it to 'processing' atomically), called through
PostgREST RPC. This keeps concurrency-safe claiming in the database.

## Testing

- **Unit (pytest):** each extractor against a tiny committed fixture (a 1-page PDF, a small
  DOCX with a heading + table, a 2-sheet XLSX, an EML with one PDF attachment, an MSG with one
  attachment). Assert text/markdown/metadata shape and (for EML/MSG) attachment extraction.
- **Integration (manual, documented):** upload an EML with an attachment via the Phase 1 UI;
  confirm the email row becomes `processed`, a child `email_attachment` document is created
  with `parent_document_id` set, both originals exist in storage, and `search_vector` is populated.

## Acceptance criteria (instruct.md §28 subset)

1. A queued document is picked up and processed without manual intervention.
2. PDF/DOCX/XLSX/EML/MSG produce stored `extracted_text` and `markdown_text`.
3. Email attachments become child documents linked by `parent_document_id`, with their own
   stored originals, queued for their own processing.
4. `processing_status` transitions `queued → processing → processed`, or `→ failed` with
   `processing_error` set and the original preserved.
5. `search_vector` is populated after processing.
6. Re-processing does not duplicate child attachments or lose originals.

## New migration (Phase 2)

`claim_next_document()` SECURITY DEFINER function for concurrency-safe claiming, plus a
`set_search_vector(document_id)` helper (or inline update) used by the worker.
