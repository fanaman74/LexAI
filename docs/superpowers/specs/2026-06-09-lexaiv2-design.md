# LexAIv2 — Local Legal File Analysis App — Design

**Date:** 2026-06-09
**Status:** Approved by user

## Purpose

A local web app for a legal office to ingest folders of legal files, store
originals and Markdown conversions in a database with full traceability,
then browse, filter by folder, search, tag, annotate, and run AI analysis.

Single user, single machine (macOS), no authentication — the app binds to
localhost only. Fresh project; independent of the existing LexAI repo and
its Supabase project.

## Requirements

1. Select a folder via a native macOS dialog; all files in it and its
   subfolders are ingested.
2. Each file carries folder-path metadata usable as filters in the UI.
3. Originals are stored in the database.
4. A second table holds the Markdown conversion of each file, linked by ID
   to the original.
5. Supported types: PDF (with OCR for scans), DOCX/DOC, MSG/EML, XLSX/CSV,
   TXT/RTF. Other types are counted and listed as skipped.
6. V1 features: browse + filter + view, full-text search, AI analysis
   (OpenRouter free tier), manual tags and notes.

## Architecture

Single local app, one command to start (`./start.sh` → opens
`http://localhost:8000`).

```
LexAIv2/
├── backend/          FastAPI (Python 3.12)
│   ├── app/          API routes, DB, ingestion, conversion, AI client
│   └── tests/        pytest
├── frontend/         React + Vite + Tailwind (built; served by FastAPI)
├── data/
│   └── lexai.db      SQLite — entire database in one file
└── start.sh
```

- Folder selection: backend triggers a native folder picker via
  `osascript`; the chosen path is scanned server-side (no browser upload).
- Conversion runs in a background thread pool; UI polls a progress
  endpoint.
- External tools (installed once via Homebrew): `tesseract`, `ocrmypdf`.
- AI: OpenRouter (`openai/gpt-oss-120b:free`), key in `.env`
  (`OPENROUTER_API_KEY`). The UI displays a confidentiality warning that
  free-tier requests send document text to a third party.

## Database schema (SQLite)

- **files** — one row per unique file:
  `id` (PK), `sha256` (UNIQUE), `original_name`, `file_type`,
  `size_bytes`, `content` (BLOB — original bytes), `status`
  (`pending | converted | failed | needs_ocr`), `error_message`,
  `created_at`, `updated_at`.
- **file_locations** — `id`, `file_id` (FK), `root_folder`,
  `subfolder_path`, `filename`, `scanned_at`. Same content found in two
  folders ⇒ one `files` row, two locations. Folder filters in the UI are
  built from these paths.
- **markdown_files** — `id`, `file_id` (FK → files.id, UNIQUE),
  `content_md`, `converter_used` (`markitdown | ocr`), `converted_at`,
  `word_count`.
- **markdown_fts** — FTS5 virtual table over `content_md` (kept in sync
  by triggers), powering full-text search with snippets.
- **tags** (`id`, `name` UNIQUE) and **file_tags** (`file_id`, `tag_id`).
- **notes** — `id`, `file_id`, `content`, `created_at`.
- **analyses** — `id`, `file_ids` (JSON array), `prompt`, `response`,
  `model`, `created_at`.

## Ingestion flow

1. "Add folder" → native dialog → server scans recursively.
2. Supported extensions collected; unsupported files counted and listed as
   skipped (nothing silently dropped).
3. Per file: SHA256 → existing hash ⇒ add a `file_locations` row only;
   new hash ⇒ insert `files` row (status `pending`) and queue conversion.
4. Conversion (parallel, background): markitdown → Markdown. PDFs whose
   extracted text is below a small threshold are run through
   `ocrmypdf`/Tesseract, then re-extracted (`converter_used = 'ocr'`).
5. Progress endpoint feeds a live bar ("143/312 converted, 2 failed,
   17 OCR'd"). Re-scanning a folder ingests only new/changed files.

## UI (React SPA, 3 screens)

1. **Library** — file table (name, type, size, folder, status, tags);
   left sidebar filters: folder tree with checkboxes, file type, tags,
   status; search box (FTS5) with snippet previews. Filters and search
   combine (AND).
2. **Document view** — rendered Markdown + metadata panel (original name,
   all locations, hash, dates, converter), tag editor, notes, "Download
   original" (serves the stored BLOB).
3. **AI Analysis** — select files in Library → ask a question or pick a
   preset (Summarize / Extract parties & dates / List obligations &
   deadlines) → Markdown content sent to OpenRouter → response shown and
   saved to `analyses`; history view of past analyses.

## Error handling

- A failing file never aborts a scan: status `failed` + visible error,
  with a per-file Retry button.
- Locked, zero-byte, or password-protected files get clear statuses.
- OpenRouter errors (down, rate-limited) are shown without losing the
  typed prompt.

## Testing

pytest, written test-first (TDD): conversion per file type using small
fixture files, SHA256 dedupe and multi-location linking, FTS search,
OCR-fallback decision logic (mocked OCR), and API endpoint tests.
Frontend logic kept thin; no frontend test suite in v1.

## Out of scope (v1)

Multi-user/auth, cloud sync, embeddings/semantic search, email-attachment
extraction, file watching/auto-ingest, editing Markdown.
