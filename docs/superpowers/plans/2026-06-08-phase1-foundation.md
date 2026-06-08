# LexAI Phase 1 (Foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a working Next.js + Supabase skeleton where an authenticated user can upload legal files (PDF/DOCX/XLSX/MSG/EML) that are stored in a private bucket, hashed (SHA256), duplicate-checked, and recorded as `queued` documents — backed by the full database schema (all 7 tables, RLS, `match_document_chunks`, keyword `search_vector`) with `embedding vector(768)`.

**Architecture:** Next.js App Router (TS) front+back in one app. A dedicated new Supabase cloud project `lexai` holds Postgres+pgvector, Auth, and a private Storage bucket; migrations are applied through the Supabase MCP. The upload API route composes focused `lib/` units (storage, audit, db, hashing) behind narrow interfaces. Extraction/chunking/embeddings/search/AI are stubbed for later phases.

**Tech Stack:** Next.js 15 (App Router), TypeScript, Tailwind CSS, shadcn/ui, `@supabase/supabase-js` + `@supabase/ssr`, Supabase (Postgres 17 + pgvector), Vitest for unit/integration tests.

**Conventions for every task:** exact paths below; TDD where logic exists; commit after each task. The Supabase project ref is referred to as `$LEXAI_REF` — captured in Task 2 and written to `.env.local`.

---

## File Structure

- `app/layout.tsx`, `app/page.tsx`, `app/globals.css` — app shell.
- `app/login/page.tsx`, `app/login/actions.ts` — auth (sign in/up/out).
- `app/documents/page.tsx` — authenticated documents list + upload UI.
- `app/api/documents/upload/route.ts` — upload handler.
- `middleware.ts` — route guard + session refresh.
- `lib/supabase/client.ts` / `server.ts` / `middleware.ts` — Supabase clients.
- `lib/auth/session.ts` — `getUser()` / `requireUser()`.
- `lib/storage/paths.ts` — bucket constant + path builders (pure).
- `lib/storage/storage.ts` — upload + signed URL helpers.
- `lib/audit/audit.ts` — `logAudit()`.
- `lib/files/hash.ts` — `sha256Hex()` (pure).
- `lib/files/source-type.ts` — `detectSourceType()` (pure).
- `lib/types/index.ts` — shared TS types.
- `supabase/migrations/0001_init.sql` — full schema (reference copy; applied via MCP).
- `workers/.gitkeep`, `scripts/.gitkeep` — stubs.
- `.env.example`, `README.md`, `vitest.config.ts`.

---

## Task 1: Scaffold Next.js app

**Files:**
- Create: project files via `create-next-app`, then `.env.example`, `workers/.gitkeep`, `scripts/.gitkeep`.

- [ ] **Step 1: Scaffold**

Run in the repo root (it already contains `docs/` and `.git`):

```bash
npx create-next-app@latest . --ts --tailwind --eslint --app --src-dir=false --import-alias "@/*" --no-turbopack --use-npm --yes
```

Expected: Next.js files created (`app/`, `package.json`, `tsconfig.json`). If it refuses due to non-empty dir, accept overwrite prompts (our `docs/` and `.git` are preserved).

- [ ] **Step 2: Install dependencies**

```bash
npm install @supabase/supabase-js @supabase/ssr
npm install -D vitest @vitejs/plugin-react vite-tsconfig-paths
```

Expected: packages added, no errors.

- [ ] **Step 3: Create stub dirs and env example**

Create `workers/.gitkeep` (empty) and `scripts/.gitkeep` (empty).

Create `.env.example`:

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# AI (Phase 5) — OpenRouter, OpenAI-compatible
OPENROUTER_API_KEY=
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
OPENROUTER_CHAT_MODEL=openai/gpt-oss-120b:free

# Embeddings (Phase 3) — local sentence-transformer
EMBEDDING_MODEL=BAAI/bge-base-en-v1.5
EMBEDDING_DIM=768

APP_BASE_URL=http://localhost:3000
STORAGE_BUCKET_LEGAL_DOCUMENTS=legal-documents
```

- [ ] **Step 4: Verify build tooling**

Run: `npm run build`
Expected: build succeeds (default starter compiles).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: scaffold Next.js app and env example"
```

---

## Task 2: Create the `lexai` Supabase project (MCP)

**Files:** Create: `.env.local` (gitignored).

- [ ] **Step 1: List orgs to get an organization_id**

Use MCP tool `list_organizations`. Note the org id (slug `xfmqfortdjomhadnbryp` seen during planning).

- [ ] **Step 2: Confirm cost**

Use MCP tool `confirm_cost` with `type=project`, the org id, and a plan (`free` unless the user states otherwise). Capture the returned `confirm_cost_id`. **Surface the cost to the user and get an explicit go-ahead before creating.**

- [ ] **Step 3: Create the project**

Use MCP tool `create_project` with `name=lexai`, the `organization_id`, `region=eu-central-1`, and the `confirm_cost_id`. Wait until status is `ACTIVE_HEALTHY` (poll `list_projects` / `get_project`). Record the project ref as `$LEXAI_REF`.

- [ ] **Step 4: Capture keys and URL**

Use MCP `get_project_url` and `get_publishable_keys` (anon) for `$LEXAI_REF`. The service role key is read from the Supabase dashboard by the user (MCP does not expose it). Write `.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=<project url>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon/publishable key>
SUPABASE_SERVICE_ROLE_KEY=<from dashboard>
STORAGE_BUCKET_LEGAL_DOCUMENTS=legal-documents
APP_BASE_URL=http://localhost:3000
```

- [ ] **Step 5: Commit (no secrets)**

`.env.local` is gitignored. Nothing to commit here beyond confirming `.gitignore` lists `.env.local`. If the project ref is useful to record, add it to `README.md` (not the keys).

```bash
git add README.md 2>/dev/null; git commit -m "docs: record lexai supabase project ref" --allow-empty
```

---

## Task 3: Apply database schema migration (MCP)

**Files:**
- Create: `supabase/migrations/0001_init.sql` (reference copy of the SQL applied via MCP).

- [ ] **Step 1: Write the migration file**

Create `supabase/migrations/0001_init.sql` with the full schema below (instruct.md §6–7, §12–13, with `vector(768)`):

```sql
-- Extensions
create extension if not exists vector with schema extensions;
create extension if not exists pgcrypto;

-- Cases
create table cases (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    name text not null,
    description text null,
    status text not null default 'active' check (status in ('active','archived')),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

-- Documents
create table documents (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    original_filename text not null,
    display_title text null,
    file_extension text not null,
    mime_type text null,
    file_size_bytes bigint null,
    storage_bucket text not null,
    storage_path text not null,
    sha256_hash text not null,
    duplicate_of_document_id uuid null references documents(id),
    source_type text not null check (source_type in
        ('pdf','docx','xlsx','msg','eml','email_attachment','other')),
    parent_document_id uuid null references documents(id) on delete set null,
    document_date date null,
    document_datetime timestamptz null,
    author text null,
    sender text null,
    recipients jsonb null,
    cc jsonb null,
    bcc jsonb null,
    email_subject text null,
    email_message_id text null,
    email_thread_id text null,
    extracted_text text null,
    markdown_text text null,
    ai_short_summary text null,
    ai_long_summary text null,
    ai_keywords text[] null,
    ai_people text[] null,
    ai_organisations text[] null,
    ai_dates jsonb null,
    ai_legal_issues text[] null,
    ai_evidence_value text null,
    ai_suggested_tags text[] null,
    ai_timeline_entries jsonb null,
    processing_status text not null default 'uploaded' check (processing_status in
        ('uploaded','queued','processing','processed','failed')),
    processing_error text null,
    processed_at timestamptz null,
    search_vector tsvector null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);
create index documents_user_id_idx on documents(user_id);
create index documents_parent_document_id_idx on documents(parent_document_id);
create index documents_source_type_idx on documents(source_type);
create index documents_processing_status_idx on documents(processing_status);
create index documents_sha256_hash_idx on documents(sha256_hash);
create index documents_document_date_idx on documents(document_date);
create index documents_search_vector_idx on documents using gin(search_vector);

-- Case documents (m2m)
create table case_documents (
    case_id uuid not null references cases(id) on delete cascade,
    document_id uuid not null references documents(id) on delete cascade,
    user_id uuid not null references auth.users(id) on delete cascade,
    added_at timestamptz not null default now(),
    primary key (case_id, document_id)
);
create index case_documents_user_id_idx on case_documents(user_id);
create index case_documents_document_id_idx on case_documents(document_id);

-- Document chunks (768d)
create table document_chunks (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    document_id uuid not null references documents(id) on delete cascade,
    chunk_id text not null unique,
    chunk_index integer not null,
    content text not null,
    content_markdown text null,
    token_count integer null,
    char_count integer null,
    page_start integer null,
    page_end integer null,
    section_title text null,
    sheet_name text null,
    row_start integer null,
    row_end integer null,
    embedding vector(768),
    metadata jsonb not null default '{}',
    created_at timestamptz not null default now(),
    unique(document_id, chunk_index)
);
create index document_chunks_user_id_idx on document_chunks(user_id);
create index document_chunks_document_id_idx on document_chunks(document_id);
create index document_chunks_chunk_id_idx on document_chunks(chunk_id);
create index document_chunks_chunk_index_idx on document_chunks(document_id, chunk_index);

-- Tags
create table document_tags (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    name text not null,
    colour text null,
    created_at timestamptz not null default now(),
    unique(user_id, name)
);
create table document_tag_assignments (
    document_id uuid not null references documents(id) on delete cascade,
    tag_id uuid not null references document_tags(id) on delete cascade,
    user_id uuid not null references auth.users(id) on delete cascade,
    created_at timestamptz not null default now(),
    primary key (document_id, tag_id)
);

-- Audit log
create table audit_log (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    action text not null,
    document_id uuid null references documents(id) on delete set null,
    case_id uuid null references cases(id) on delete set null,
    metadata jsonb not null default '{}',
    created_at timestamptz not null default now()
);

-- RLS
alter table cases enable row level security;
alter table documents enable row level security;
alter table case_documents enable row level security;
alter table document_chunks enable row level security;
alter table document_tags enable row level security;
alter table document_tag_assignments enable row level security;
alter table audit_log enable row level security;

create policy "own_cases" on cases for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own_documents" on documents for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own_case_documents" on case_documents for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own_chunks" on document_chunks for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own_tags" on document_tags for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own_tag_assignments" on document_tag_assignments for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own_audit" on audit_log for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Semantic search function (768d)
create or replace function match_document_chunks (
    query_embedding vector(768),
    match_count int default 50,
    filter_case_id uuid default null,
    filter_user_id uuid default null
)
returns table (
    document_id uuid,
    chunk_id text,
    chunk_index int,
    content text,
    similarity float,
    metadata jsonb
)
language sql stable
as $$
    select dc.document_id, dc.chunk_id, dc.chunk_index, dc.content,
           1 - (dc.embedding <=> query_embedding) as similarity, dc.metadata
    from document_chunks dc
    left join case_documents cd on cd.document_id = dc.document_id
    where dc.embedding is not null
      and (filter_user_id is null or dc.user_id = filter_user_id)
      and (filter_case_id is null or cd.case_id = filter_case_id)
    order by dc.embedding <=> query_embedding
    limit match_count;
$$;
```

- [ ] **Step 2: Apply via MCP**

Use MCP tool `apply_migration` on `$LEXAI_REF` with `name=init` and the SQL above (the file is the reference copy; the MCP call carries the actual SQL).

- [ ] **Step 3: Verify**

Use MCP `list_tables` on `$LEXAI_REF`. Expected: `cases, documents, case_documents, document_chunks, document_tags, document_tag_assignments, audit_log` all present. Run MCP `get_advisors` (type `security`) and confirm RLS is enabled on all 7 (no "rls disabled" advisories for these tables).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0001_init.sql
git commit -m "feat(db): full schema, RLS, and match_document_chunks (768d)"
```

---

## Task 4: Create the private storage bucket (MCP)

**Files:** none (bucket created via MCP/SQL).

- [ ] **Step 1: Create bucket via SQL**

Use MCP `apply_migration` on `$LEXAI_REF`, `name=storage_bucket`:

```sql
insert into storage.buckets (id, name, public)
values ('legal-documents', 'legal-documents', false)
on conflict (id) do nothing;

-- Owner-scoped access: first path segment is the user's uid
create policy "own_files_read" on storage.objects for select
  using (bucket_id = 'legal-documents' and auth.uid()::text = (storage.foldername(name))[1]);
create policy "own_files_write" on storage.objects for insert
  with check (bucket_id = 'legal-documents' and auth.uid()::text = (storage.foldername(name))[1]);
create policy "own_files_delete" on storage.objects for delete
  using (bucket_id = 'legal-documents' and auth.uid()::text = (storage.foldername(name))[1]);
```

- [ ] **Step 2: Verify**

Use MCP `list_tables` (schema `storage`) or query: bucket `legal-documents` exists with `public = false`. Confirm via MCP `execute_sql`: `select id, public from storage.buckets where id='legal-documents';` → `public = false`.

- [ ] **Step 3: Commit**

```bash
mkdir -p supabase/migrations
git add -A && git commit -m "feat(storage): private legal-documents bucket with owner RLS" --allow-empty
```

---

## Task 5: Shared types

**Files:**
- Create: `lib/types/index.ts`

- [ ] **Step 1: Write types**

Create `lib/types/index.ts`:

```ts
export type DocumentSourceType =
  | "pdf" | "docx" | "xlsx" | "msg" | "eml" | "email_attachment" | "other";

export type ProcessingStatus =
  | "uploaded" | "queued" | "processing" | "processed" | "failed";

export type LegalDocument = {
  id: string;
  user_id: string;
  original_filename: string;
  display_title?: string | null;
  source_type: DocumentSourceType;
  parent_document_id?: string | null;
  duplicate_of_document_id?: string | null;
  processing_status: ProcessingStatus;
  ai_short_summary?: string | null;
  ai_keywords?: string[] | null;
  created_at: string;
};

export type DocumentChunk = {
  id: string;
  document_id: string;
  chunk_id: string;
  chunk_index: number;
  content: string;
  content_markdown?: string | null;
  page_start?: number | null;
  page_end?: number | null;
  sheet_name?: string | null;
  row_start?: number | null;
  row_end?: number | null;
  metadata: Record<string, unknown>;
};

export type AuditAction =
  | "upload_document" | "view_document" | "download_original"
  | "run_keyword_search" | "run_semantic_search" | "run_hybrid_search"
  | "run_ai_summary" | "delete_document" | "reprocess_document"
  | "assign_to_case" | "remove_from_case" | "export_case_bundle";
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/types/index.ts
git commit -m "feat(types): shared document and audit types"
```

---

## Task 6: Pure helpers — hashing & source-type (TDD)

**Files:**
- Create: `lib/files/hash.ts`, `lib/files/source-type.ts`
- Test: `tests/files/hash.test.ts`, `tests/files/source-type.test.ts`
- Create: `vitest.config.ts`

- [ ] **Step 1: Configure Vitest**

Create `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: { environment: "node", include: ["tests/**/*.test.ts"] },
});
```

Add to `package.json` scripts: `"test": "vitest run"`.

- [ ] **Step 2: Write failing tests**

Create `tests/files/hash.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { sha256Hex } from "@/lib/files/hash";

describe("sha256Hex", () => {
  it("hashes known input", async () => {
    const bytes = new TextEncoder().encode("hello");
    expect(await sha256Hex(bytes)).toBe(
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
    );
  });
});
```

Create `tests/files/source-type.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { detectSourceType } from "@/lib/files/source-type";

describe("detectSourceType", () => {
  it("maps known extensions", () => {
    expect(detectSourceType("a.pdf")).toBe("pdf");
    expect(detectSourceType("a.DOCX")).toBe("docx");
    expect(detectSourceType("a.xlsx")).toBe("xlsx");
    expect(detectSourceType("a.msg")).toBe("msg");
    expect(detectSourceType("a.eml")).toBe("eml");
  });
  it("falls back to other", () => {
    expect(detectSourceType("a.txt")).toBe("other");
    expect(detectSourceType("noext")).toBe("other");
  });
});
```

- [ ] **Step 3: Run tests, verify they fail**

Run: `npm test`
Expected: FAIL (modules not found).

- [ ] **Step 4: Implement**

Create `lib/files/hash.ts`:

```ts
import { createHash } from "node:crypto";

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  return createHash("sha256").update(bytes).digest("hex");
}
```

Create `lib/files/source-type.ts`:

```ts
import type { DocumentSourceType } from "@/lib/types";

const MAP: Record<string, DocumentSourceType> = {
  pdf: "pdf", docx: "docx", xlsx: "xlsx", msg: "msg", eml: "eml",
};

export function fileExtension(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot === -1 ? "" : filename.slice(dot + 1).toLowerCase();
}

export function detectSourceType(filename: string): DocumentSourceType {
  return MAP[fileExtension(filename)] ?? "other";
}
```

- [ ] **Step 5: Run tests, verify pass**

Run: `npm test`
Expected: PASS (both files).

- [ ] **Step 6: Commit**

```bash
git add lib/files vitest.config.ts package.json tests/files
git commit -m "feat(files): sha256 and source-type helpers with tests"
```

---

## Task 7: Storage path builder (TDD) + storage helpers

**Files:**
- Create: `lib/storage/paths.ts`, `lib/storage/storage.ts`
- Test: `tests/storage/paths.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/storage/paths.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { LEGAL_BUCKET, originalPath } from "@/lib/storage/paths";

describe("storage paths", () => {
  it("builds original path", () => {
    expect(originalPath("u1", "d1", "letter.pdf"))
      .toBe("u1/d1/original/letter.pdf");
  });
  it("exposes bucket constant", () => {
    expect(LEGAL_BUCKET).toBe("legal-documents");
  });
});
```

- [ ] **Step 2: Run test, verify fail**

Run: `npm test -- paths`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement paths (pure)**

Create `lib/storage/paths.ts`:

```ts
export const LEGAL_BUCKET =
  process.env.STORAGE_BUCKET_LEGAL_DOCUMENTS ?? "legal-documents";

export function originalPath(
  userId: string, documentId: string, filename: string
): string {
  return `${userId}/${documentId}/original/${filename}`;
}

export function attachmentPath(
  userId: string, parentDocumentId: string,
  attachmentDocumentId: string, filename: string
): string {
  return `${userId}/${parentDocumentId}/attachments/${attachmentDocumentId}/${filename}`;
}
```

- [ ] **Step 4: Run test, verify pass**

Run: `npm test -- paths`
Expected: PASS.

- [ ] **Step 5: Implement storage helpers (no test — thin Supabase wrapper)**

Create `lib/storage/storage.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { LEGAL_BUCKET } from "@/lib/storage/paths";

export async function uploadOriginal(
  supabase: SupabaseClient, path: string, bytes: Uint8Array, contentType?: string
): Promise<void> {
  const { error } = await supabase.storage
    .from(LEGAL_BUCKET)
    .upload(path, bytes, { contentType, upsert: false });
  if (error) throw error;
}

export async function signedUrl(
  supabase: SupabaseClient, path: string, expiresInSeconds = 300
): Promise<string> {
  const { data, error } = await supabase.storage
    .from(LEGAL_BUCKET)
    .createSignedUrl(path, expiresInSeconds);
  if (error) throw error;
  return data.signedUrl;
}
```

- [ ] **Step 6: Commit**

```bash
git add lib/storage tests/storage
git commit -m "feat(storage): path builders and upload/signed-url helpers"
```

---

## Task 8: Supabase clients + middleware

**Files:**
- Create: `lib/supabase/client.ts`, `lib/supabase/server.ts`, `lib/supabase/middleware.ts`, `middleware.ts`

- [ ] **Step 1: Browser client**

Create `lib/supabase/client.ts`:

```ts
import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
```

- [ ] **Step 2: Server client**

Create `lib/supabase/server.ts`:

```ts
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll(); },
        setAll(toSet) {
          try { toSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)); } catch { /* called from RSC */ }
        },
      },
    }
  );
}
```

- [ ] **Step 3: Middleware session helper**

Create `lib/supabase/middleware.ts`:

```ts
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll(); },
        setAll(toSet) {
          toSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          toSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options));
        },
      },
    }
  );
  const { data: { user } } = await supabase.auth.getUser();
  const path = request.nextUrl.pathname;
  const isProtected = path.startsWith("/documents") || path.startsWith("/dashboard");
  if (!user && isProtected) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }
  return response;
}
```

- [ ] **Step 4: Root middleware**

Create `middleware.ts`:

```ts
import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|login).*)"],
};
```

- [ ] **Step 5: Typecheck & commit**

Run: `npx tsc --noEmit` → no errors.

```bash
git add lib/supabase middleware.ts
git commit -m "feat(auth): supabase browser/server clients and route-guard middleware"
```

---

## Task 9: Auth helpers + login page

**Files:**
- Create: `lib/auth/session.ts`, `app/login/page.tsx`, `app/login/actions.ts`

- [ ] **Step 1: Session helpers**

Create `lib/auth/session.ts`:

```ts
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function getUser() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

export async function requireUser() {
  const user = await getUser();
  if (!user) redirect("/login");
  return user;
}
```

- [ ] **Step 2: Auth actions**

Create `app/login/actions.ts`:

```ts
"use server";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function signIn(formData: FormData) {
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: String(formData.get("email")),
    password: String(formData.get("password")),
  });
  if (error) redirect(`/login?error=${encodeURIComponent(error.message)}`);
  redirect("/documents");
}

export async function signUp(formData: FormData) {
  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email: String(formData.get("email")),
    password: String(formData.get("password")),
  });
  if (error) redirect(`/login?error=${encodeURIComponent(error.message)}`);
  redirect("/documents");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
```

- [ ] **Step 3: Login page**

Create `app/login/page.tsx`:

```tsx
import { signIn, signUp } from "./actions";

export default async function LoginPage(
  { searchParams }: { searchParams: Promise<{ error?: string }> }
) {
  const { error } = await searchParams;
  return (
    <main className="mx-auto max-w-sm p-8">
      <h1 className="mb-4 text-xl font-semibold">LexAI — Sign in</h1>
      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
      <form className="space-y-3">
        <input name="email" type="email" required placeholder="Email"
          className="w-full rounded border p-2" />
        <input name="password" type="password" required placeholder="Password"
          className="w-full rounded border p-2" />
        <div className="flex gap-2">
          <button formAction={signIn}
            className="rounded bg-black px-4 py-2 text-white">Sign in</button>
          <button formAction={signUp}
            className="rounded border px-4 py-2">Sign up</button>
        </div>
      </form>
    </main>
  );
}
```

- [ ] **Step 4: Typecheck & commit**

Run: `npx tsc --noEmit` → no errors.

```bash
git add lib/auth app/login
git commit -m "feat(auth): login/signup page and session helpers"
```

---

## Task 10: Audit helper

**Files:**
- Create: `lib/audit/audit.ts`

- [ ] **Step 1: Implement**

Create `lib/audit/audit.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuditAction } from "@/lib/types";

export async function logAudit(
  supabase: SupabaseClient,
  userId: string,
  action: AuditAction,
  opts: { document_id?: string; case_id?: string; metadata?: Record<string, unknown> } = {}
): Promise<void> {
  const { error } = await supabase.from("audit_log").insert({
    user_id: userId,
    action,
    document_id: opts.document_id ?? null,
    case_id: opts.case_id ?? null,
    metadata: opts.metadata ?? {},
  });
  if (error) console.error("audit_log insert failed", error.message);
}
```

- [ ] **Step 2: Typecheck & commit**

Run: `npx tsc --noEmit` → no errors.

```bash
git add lib/audit
git commit -m "feat(audit): logAudit helper"
```

---

## Task 11: Upload API route

**Files:**
- Create: `app/api/documents/upload/route.ts`

- [ ] **Step 1: Implement the handler**

Create `app/api/documents/upload/route.ts`:

```ts
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sha256Hex } from "@/lib/files/hash";
import { detectSourceType, fileExtension } from "@/lib/files/source-type";
import { LEGAL_BUCKET, originalPath } from "@/lib/storage/paths";
import { uploadOriginal } from "@/lib/storage/storage";
import { logAudit } from "@/lib/audit/audit";

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const form = await request.formData();
  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (files.length === 0)
    return NextResponse.json({ error: "no files" }, { status: 400 });

  const results = [];
  for (const file of files) {
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const hash = await sha256Hex(bytes);

      const { data: dup } = await supabase
        .from("documents")
        .select("id")
        .eq("user_id", user.id)
        .eq("sha256_hash", hash)
        .limit(1)
        .maybeSingle();

      const sourceType = detectSourceType(file.name);
      const { data: doc, error: insErr } = await supabase
        .from("documents")
        .insert({
          user_id: user.id,
          original_filename: file.name,
          file_extension: fileExtension(file.name),
          mime_type: file.type || null,
          file_size_bytes: file.size,
          storage_bucket: LEGAL_BUCKET,
          storage_path: "",
          sha256_hash: hash,
          duplicate_of_document_id: dup?.id ?? null,
          source_type: sourceType,
          processing_status: "uploaded",
        })
        .select("id")
        .single();
      if (insErr || !doc) throw insErr ?? new Error("insert failed");

      const path = originalPath(user.id, doc.id, file.name);
      try {
        await uploadOriginal(supabase, path, bytes, file.type || undefined);
        await supabase.from("documents")
          .update({ storage_path: path, processing_status: "queued" })
          .eq("id", doc.id);
      } catch (storageErr) {
        await supabase.from("documents")
          .update({ processing_error: String(storageErr) })
          .eq("id", doc.id);
        throw storageErr;
      }

      await logAudit(supabase, user.id, "upload_document", {
        document_id: doc.id, metadata: { filename: file.name, is_duplicate: !!dup },
      });

      results.push({
        document_id: doc.id, original_filename: file.name,
        source_type: sourceType, status: "queued", is_duplicate: !!dup,
      });
    } catch (e) {
      results.push({ original_filename: file.name, status: "failed", error: String(e) });
    }
  }
  return NextResponse.json({ results });
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/api/documents/upload/route.ts
git commit -m "feat(upload): hash, dup-detect, store original, queue document"
```

---

## Task 12: Documents page (upload UI)

**Files:**
- Create: `app/documents/page.tsx`, `app/documents/upload-form.tsx`
- Modify: `app/page.tsx`

- [ ] **Step 1: Upload form (client)**

Create `app/documents/upload-form.tsx`:

```tsx
"use client";
import { useState } from "react";

type Result = {
  document_id?: string; original_filename: string;
  status: string; is_duplicate?: boolean; error?: string;
};

export function UploadForm() {
  const [results, setResults] = useState<Result[]>([]);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    const fd = new FormData(e.currentTarget);
    const res = await fetch("/api/documents/upload", { method: "POST", body: fd });
    const json = await res.json();
    setResults(json.results ?? []);
    setBusy(false);
  }

  return (
    <div>
      <form onSubmit={onSubmit} className="mb-4 flex items-center gap-2">
        <input type="file" name="files" multiple required
          accept=".pdf,.docx,.xlsx,.msg,.eml" />
        <button disabled={busy}
          className="rounded bg-black px-4 py-2 text-white disabled:opacity-50">
          {busy ? "Uploading…" : "Upload"}
        </button>
      </form>
      <ul className="space-y-1 text-sm">
        {results.map((r, i) => (
          <li key={i} className="flex gap-2">
            <span>{r.original_filename}</span>
            <span className="text-gray-500">{r.status}</span>
            {r.is_duplicate && <span className="text-amber-600">duplicate</span>}
            {r.error && <span className="text-red-600">{r.error}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 2: Documents page (server)**

Create `app/documents/page.tsx`:

```tsx
import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/app/login/actions";
import { UploadForm } from "./upload-form";

export default async function DocumentsPage() {
  await requireUser();
  const supabase = await createClient();
  const { data: docs } = await supabase
    .from("documents")
    .select("id, original_filename, source_type, processing_status, created_at")
    .order("created_at", { ascending: false })
    .limit(50);

  return (
    <main className="mx-auto max-w-3xl p-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Documents</h1>
        <form action={signOut}><button className="text-sm underline">Sign out</button></form>
      </div>
      <UploadForm />
      <table className="mt-6 w-full text-sm">
        <thead><tr className="text-left text-gray-500">
          <th>File</th><th>Type</th><th>Status</th></tr></thead>
        <tbody>
          {(docs ?? []).map((d) => (
            <tr key={d.id} className="border-t">
              <td className="py-1">{d.original_filename}</td>
              <td>{d.source_type}</td>
              <td>{d.processing_status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
```

- [ ] **Step 3: Home redirect**

Replace `app/page.tsx` with:

```tsx
import { redirect } from "next/navigation";
export default function Home() { redirect("/documents"); }
```

- [ ] **Step 4: Typecheck & build**

Run: `npx tsc --noEmit && npm run build`
Expected: no errors; build succeeds.

- [ ] **Step 5: Commit**

```bash
git add app/documents app/page.tsx
git commit -m "feat(ui): documents page with upload form and list"
```

---

## Task 13: Manual end-to-end verification

**Files:** Modify `README.md` (run instructions).

- [ ] **Step 1: Run the app**

Ensure `.env.local` is populated (Task 2). Run: `npm run dev`. Open `http://localhost:3000` → redirected to `/login`.

- [ ] **Step 2: Verify the flow**

- Sign up a test user → redirected to `/documents`.
- Upload one PDF and one DOCX → both rows appear with status `queued`.
- Re-upload the same PDF bytes → row appears with `duplicate` badge, still recorded.
- Via MCP `execute_sql` on `$LEXAI_REF`: `select original_filename, processing_status, duplicate_of_document_id, storage_path from documents order by created_at desc;` → originals have non-empty `storage_path`, status `queued`, duplicate has `duplicate_of_document_id` set.
- Via MCP `execute_sql`: `select count(*) from storage.objects where bucket_id='legal-documents';` → matches stored originals.
- Confirm no public URL: bucket `public=false` (Task 4 verified).

- [ ] **Step 3: Write README run instructions**

Add a "Getting started" section to `README.md`: prerequisites (Node 26, the `lexai` Supabase project), `cp .env.example .env.local` and fill keys, `npm install`, `npm run dev`, and a note that the service role key comes from the Supabase dashboard.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: phase 1 getting-started and verification notes"
```

---

## Self-Review notes

- **Spec coverage:** scaffold (T1), `lexai` project (T2), full schema+RLS+`match_document_chunks` 768d (T3), private bucket (T4), types (T5), SHA256+source-type (T6), storage paths/helpers (T7), auth clients/middleware/login (T8–T9), audit (T10), upload flow with dup detection & queued status (T11), upload UI/list (T12), E2E verification incl. RLS-by-design & no public URLs (T13). All Phase 1 acceptance criteria (spec §"Acceptance criteria") mapped.
- **Out of scope** (extraction, chunking, embeddings, search, AI, cases UI) intentionally absent — later phases.
- **Type consistency:** `detectSourceType`/`fileExtension` defined in T6 and consumed in T11; `LEGAL_BUCKET`/`originalPath` defined T7, used T11; `logAudit` signature defined T10, used T11; `AuditAction` includes `upload_document` (T5).
- **Note for executor:** service role key is not exposed by the Supabase MCP; the user must paste it from the dashboard into `.env.local` (Task 2 Step 4). Phase 1 upload uses the anon/SSR client under the user's session (RLS-enforced), so the service role key is not strictly required until later phases — flagged so the executor doesn't block.
