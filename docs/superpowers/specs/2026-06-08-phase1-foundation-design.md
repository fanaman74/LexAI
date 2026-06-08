# LexAI — Phase 1 (Foundation) Design

**Date:** 2026-06-08
**Status:** Approved for planning
**Source spec:** `instruct.md` (Legal AI Document Management System)

## Context

LexAI is a secure, AI-powered legal **evidence** management system that ingests, processes,
stores, searches, and reconstructs legal documents (PDF/DOCX/XLSX/MSG/EML + email attachments).
Core invariants: never lose the original file, every document has a stable `document_id`, every
chunk a stable `chunk_id`, full reconstruction from ordered chunks, parent/child email→attachment
links, RLS isolation, audit trail, private storage with signed URLs only, AI outputs strictly
secondary to source.

The full build is decomposed into **6 sequential specs**, each with its own plan/implementation:

| Spec | Phase | Delivers |
|------|-------|----------|
| **1 (this doc)** | Foundation | Next.js app, Supabase auth, full DB migrations (schema+RLS+SQL fns), private storage, upload→stored original + SHA256 + duplicate detection + `queued` document record |
| 2 | Processing | Python Celery/Redis worker, extractors, attachment→child docs, markdown/text stored, status transitions |
| 3 | Chunk+Embed | Stable chunk IDs, local 768d embeddings, `match_document_chunks`, grouped search API |
| 4 | UI | Documents list, detail (traceability), search, reconstruction viewer, cases |
| 5 | AI assistant | OpenRouter summaries/keywords, ask-document / ask-case RAG with chunk citations |
| 6 | Security+Audit | Audit logging everywhere, signed URLs, case-bundle export, RLS hardening |

## Locked architectural decisions (cross-cutting, all phases)

- **Frontend/backend:** Next.js (App Router) + TypeScript + Tailwind + shadcn/ui. API via route handlers / server actions.
- **Database:** dedicated new Supabase cloud project `lexai`, Postgres 17 + `pgvector`. Migrations applied via the Supabase MCP (with a cost-confirmation step before project creation).
- **Background processing:** Python worker with **Celery + Redis** (Phase 2+).
- **Extraction:** Python (pypdf, python-docx, openpyxl, extract-msg, mail parser) (Phase 2+).
- **Embeddings:** local free **bge-base / e5-base sentence-transformer, 768 dimensions**. → `embedding vector(768)`.
- **Chat/AI:** OpenRouter, model `openai/gpt-oss-120b:free`, OpenAI-compatible API (Phase 5). Provider kept behind an interface.

### Deviation from instruct.md

- `document_chunks.embedding` is `vector(768)` (not 1536).
- `match_document_chunks(query_embedding vector(768), ...)` accordingly.
- Everything else in instruct.md §6 schema is implemented verbatim.

## Phase 1 scope

### In scope

1. **Repo scaffold** per instruct.md §25: `app/`, `components/{documents,search,cases,ui}`, `lib/{supabase,auth,storage,audit,types}`, `workers/` (stub dirs only), `supabase/migrations/`, `scripts/`, `tests/`, `.env.example`, `README.md`.
2. **Database migrations** — one ordered migration set, applied to the new `lexai` project:
   - Extensions: `vector` (schema extensions), `pgcrypto`.
   - Tables (instruct.md §6.2–6.7, verbatim except 768d): `cases`, `documents`, `case_documents`, `document_chunks` (`vector(768)`), `document_tags`, `document_tag_assignments`, `audit_log`. All indexes as specified. **No** unique index on `sha256_hash`.
   - Keyword search: `documents.search_vector tsvector` + GIN index (instruct.md §13).
   - SQL function `match_document_chunks(vector(768), int, uuid, uuid)` (instruct.md §12, 768d).
   - **RLS enabled** on all 7 user-owned tables with `auth.uid() = user_id` policies (instruct.md §7), including `case_documents`, `document_tags`, `document_tag_assignments`.
   - Vector ivfflat index **deferred** until data volume exists (documented, not created).
3. **Auth:** Supabase Auth. Email/password sign-in + sign-up. Middleware protects all app routes; unauthenticated → `/login`. Browser client uses anon key; server client uses service role **server-side only**.
4. **Storage:** private bucket `legal-documents`. Path `{user_id}/{document_id}/original/{original_filename}`. No public URLs; signed URLs only (helper stubbed, full use in later phases).
5. **Upload flow** (`POST /api/documents/upload`):
   - Accept single + multiple files (PDF/DOCX/XLSX/MSG/EML).
   - Compute **SHA256** of bytes.
   - **Duplicate detection:** query existing docs with same `sha256_hash` for same `user_id`; if found set `duplicate_of_document_id` (do **not** block or delete).
   - Insert `documents` row (status `uploaded`), upload original to storage at the path above, update status → `queued`.
   - Detect `source_type` from extension/MIME.
   - Return the document record(s); duplicate flag surfaced to UI.
6. **Minimal UI:** login/signup page, an authenticated shell, and a `/documents` page with an upload control showing per-file upload + status (`uploaded`/`queued`). Enough to exercise the flow end-to-end. Rich pages come in Phase 4.
7. **Types:** `lib/types` with `DocumentSourceType`, `ProcessingStatus`, `LegalDocument`, `DocumentChunk` (instruct.md §26).
8. **`.env.example`** per instruct.md §24 plus `OPENROUTER_API_KEY`, `OPENROUTER_CHAT_MODEL=openai/gpt-oss-120b:free`, and embeddings vars (`EMBEDDING_MODEL`, `EMBEDDING_DIM=768`).

### Explicitly out of scope (later phases)

Text/metadata extraction, markdown conversion, chunking, embeddings, semantic/keyword/hybrid search execution, AI summaries/RAG, cases UI/management, audit-log writes beyond `upload_document`, signed-URL preview UI, export. Worker dirs are created as stubs only.

## Components & boundaries

- `lib/supabase/server.ts` / `client.ts` / `middleware.ts` — typed Supabase clients; service role isolated to server.
- `lib/auth/` — session helpers, route guards.
- `lib/storage/` — bucket name, path builder, upload + signed-URL helpers.
- `lib/audit/` — `logAudit(action, {document_id?, case_id?, metadata?})` writing to `audit_log`. Phase 1 calls it for `upload_document`.
- `lib/types/` — shared TS types (single source of truth, mirrors DB).
- `app/api/documents/upload/route.ts` — the upload handler (hash → dup-check → store → record).
- `supabase/migrations/0001_init.sql` — the full ordered schema.

Each unit has a single purpose and a narrow interface; the upload handler composes storage + audit + db without embedding their internals.

## Data flow (upload)

```
client picks files → POST /api/documents/upload (auth required)
  → read bytes → sha256
  → select documents where sha256_hash=? and user_id=auth.uid()  (dup?)
  → insert documents row (status=uploaded, duplicate_of_document_id?)
  → storage.upload(legal-documents, {uid}/{docid}/original/{name})
  → update documents.status = queued
  → audit_log insert (upload_document)
  → return [{document_id, original_filename, status, is_duplicate}]
```

## Error handling

- Hash/storage/db failures return structured JSON errors; partial uploads in a multi-file batch are reported per-file (one failure does not fail the batch).
- If storage upload fails after the row insert, the row is left at `uploaded` with `processing_error` set (original missing) and surfaced — never silently dropped. **Never delete files.**
- Auth failures → 401; RLS guarantees cross-user isolation as defence in depth.

## Testing

- Migration applies cleanly to the new project (`list_tables` / advisors check via MCP).
- Unit: SHA256 helper, storage path builder, `source_type` detection, duplicate-detection query.
- Integration: authenticated upload of each supported type creates a `queued` record with stored original; re-uploading identical bytes sets `duplicate_of_document_id` and still creates a record.
- RLS: user A cannot read user B's documents.

## Acceptance criteria (Phase 1 subset of instruct.md §28)

1. User can authenticate.
2. User can upload PDF/DOCX/XLSX/MSG/EML (single + multiple).
3. Original stored in private `legal-documents` bucket at the spec path.
4. Each document has a stable `document_id` (uuid PK).
5. SHA256 computed and stored; duplicates detected (set `duplicate_of_document_id`) but preserved.
6. Document record created with `processing_status='queued'`.
7. Full schema (all 7 tables + indexes + RLS + `match_document_chunks` + `search_vector`) migrated to the `lexai` project, with `embedding vector(768)`.
8. RLS isolates users.
9. No public URLs exist.
