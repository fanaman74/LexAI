# LexAI — Legal AI Document Management System

Secure, AI-powered legal **evidence** management: ingest, process, store, search, and
reconstruct legal documents (PDF/DOCX/XLSX/MSG/EML + email attachments) with full
traceability from original file → document record → markdown → ordered chunks → embeddings
→ search result → reconstruction → original source.

This repository is being built incrementally in 6 phases. See:

- Spec: [`docs/superpowers/specs/2026-06-08-phase1-foundation-design.md`](docs/superpowers/specs/2026-06-08-phase1-foundation-design.md)
- Plan: [`docs/superpowers/plans/2026-06-08-phase1-foundation.md`](docs/superpowers/plans/2026-06-08-phase1-foundation.md)
- Original brief: [`instruct.md`](instruct.md)

## Status

**Phases 1–4 — complete.**

| Phase | Summary |
|-------|---------|
| 1 Foundation | Next.js app, Supabase auth, full DB schema (7 tables, RLS, pgvector), storage bucket, upload flow with SHA256 dedup |
| 2 Worker | Python/Celery extraction worker: PDF/DOCX/XLSX/MSG/EML → Markdown, attachment unpacking, status tracking |
| 3 Chunking & Embeddings | Ordered chunking, bge-base-en-v1.5 768d embeddings via FastAPI embed server (port 8765), pgvector storage |
| 4 Search UI | Keyword (`/api/search/keyword`), semantic (`/api/search/semantic`), hybrid (`/api/search/hybrid`) endpoints; full search UI at `/search` |

Phases 5–6 (AI assistant, audit/export) are not yet implemented.

### Pages

- `/dashboard` — stats overview
- `/documents` — document list, upload
- `/documents/[id]` — document detail, chunks, signed URL
- `/search` — keyword / semantic / hybrid search
- `/cases` — case list, create case
- `/cases/[id]` — case detail, linked documents

### Key API endpoints

- `GET/POST /api/documents` — list documents, (upload handled by `/api/documents/upload`)
- `GET/PATCH/DELETE /api/documents/[id]` — document CRUD
- `GET /api/documents/[id]/chunks` — document chunks
- `GET /api/documents/[id]/signed-url` — generate signed download URL
- `POST /api/documents/[id]/reprocess` — re-queue extraction
- `GET /api/documents/[id]/reconstruct` — reconstruct original from chunks
- `POST /api/search/keyword` — full-text search via `search_vector`
- `POST /api/search/semantic` — vector similarity search via pgvector
- `POST /api/search/hybrid` — combined keyword + semantic (RRF fusion)
- `GET/POST /api/cases` — list / create cases
- `GET/PATCH/DELETE /api/cases/[id]` — case CRUD
- `GET/POST /api/cases/[id]/documents` — list / link documents to a case

## Stack

- Next.js 16 (App Router) · TypeScript · Tailwind CSS
- Supabase (Postgres 17 + pgvector + Auth + Storage), project ref `cdztsdygywfbxlfxcipe`
- Embeddings (Phase 3): local sentence-transformer **bge-base / e5-base, 768d**
- AI (Phase 5): OpenRouter, `openai/gpt-oss-120b:free` (OpenAI-compatible)
- Background worker (Phase 2): Python + Celery + Redis

## Getting started

Prerequisites: Node 26, npm 11, the `lexai` Supabase project.

```bash
cp .env.example .env.local
# Fill in:
#   NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY   (project API settings)
#   SUPABASE_SERVICE_ROLE_KEY                                 (project API settings; server-only)
npm install
npm run dev          # http://localhost:3000  → redirects to /login
npm test             # unit tests (Vitest)
```

The service-role key must come from the Supabase dashboard (Project Settings → API) and
must never be exposed to the browser.

### Database migrations

Schema lives in [`supabase/migrations/`](supabase/migrations) and is applied via the
Supabase CLI (the configured Supabase MCP is read-only):

```bash
supabase db push --db-url "postgresql://postgres.<ref>:<db-password>@aws-1-eu-central-1.pooler.supabase.com:5432/postgres"
```

> Note: email confirmation is enabled on the project. For local testing without SMTP,
> temporarily enable auto-confirm in the dashboard (Authentication → Providers → Email),
> or create users via the admin API.
