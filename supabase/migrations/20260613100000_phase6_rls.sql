-- Phase 6: Enable Row Level Security on all user-owned tables
-- All policies use auth.uid() = user_id — never exposes service role key to browser.
-- Migration is idempotent: drops existing policies before recreating them.

-- ─── documents ────────────────────────────────────────────────────────────────
alter table documents enable row level security;

drop policy if exists "documents_select" on documents;
drop policy if exists "documents_insert" on documents;
drop policy if exists "documents_update" on documents;
drop policy if exists "documents_delete" on documents;

create policy "documents_select" on documents
  for select using (auth.uid() = user_id);

create policy "documents_insert" on documents
  for insert with check (auth.uid() = user_id);

create policy "documents_update" on documents
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "documents_delete" on documents
  for delete using (auth.uid() = user_id);

-- ─── cases ────────────────────────────────────────────────────────────────────
alter table cases enable row level security;

drop policy if exists "cases_select" on cases;
drop policy if exists "cases_insert" on cases;
drop policy if exists "cases_update" on cases;
drop policy if exists "cases_delete" on cases;

create policy "cases_select" on cases
  for select using (auth.uid() = user_id);

create policy "cases_insert" on cases
  for insert with check (auth.uid() = user_id);

create policy "cases_update" on cases
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "cases_delete" on cases
  for delete using (auth.uid() = user_id);

-- ─── case_documents ───────────────────────────────────────────────────────────
alter table case_documents enable row level security;

drop policy if exists "case_documents_select" on case_documents;
drop policy if exists "case_documents_insert" on case_documents;
drop policy if exists "case_documents_update" on case_documents;
drop policy if exists "case_documents_delete" on case_documents;

create policy "case_documents_select" on case_documents
  for select using (auth.uid() = user_id);

create policy "case_documents_insert" on case_documents
  for insert with check (auth.uid() = user_id);

create policy "case_documents_update" on case_documents
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "case_documents_delete" on case_documents
  for delete using (auth.uid() = user_id);

-- ─── document_chunks ──────────────────────────────────────────────────────────
alter table document_chunks enable row level security;

drop policy if exists "document_chunks_select" on document_chunks;
drop policy if exists "document_chunks_insert" on document_chunks;
drop policy if exists "document_chunks_update" on document_chunks;
drop policy if exists "document_chunks_delete" on document_chunks;

create policy "document_chunks_select" on document_chunks
  for select using (auth.uid() = user_id);

create policy "document_chunks_insert" on document_chunks
  for insert with check (auth.uid() = user_id);

create policy "document_chunks_update" on document_chunks
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "document_chunks_delete" on document_chunks
  for delete using (auth.uid() = user_id);

-- ─── document_tags ────────────────────────────────────────────────────────────
alter table document_tags enable row level security;

drop policy if exists "document_tags_select" on document_tags;
drop policy if exists "document_tags_insert" on document_tags;
drop policy if exists "document_tags_update" on document_tags;
drop policy if exists "document_tags_delete" on document_tags;

create policy "document_tags_select" on document_tags
  for select using (auth.uid() = user_id);

create policy "document_tags_insert" on document_tags
  for insert with check (auth.uid() = user_id);

create policy "document_tags_update" on document_tags
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "document_tags_delete" on document_tags
  for delete using (auth.uid() = user_id);

-- ─── document_tag_assignments ─────────────────────────────────────────────────
alter table document_tag_assignments enable row level security;

drop policy if exists "document_tag_assignments_select" on document_tag_assignments;
drop policy if exists "document_tag_assignments_insert" on document_tag_assignments;
drop policy if exists "document_tag_assignments_update" on document_tag_assignments;
drop policy if exists "document_tag_assignments_delete" on document_tag_assignments;

create policy "document_tag_assignments_select" on document_tag_assignments
  for select using (auth.uid() = user_id);

create policy "document_tag_assignments_insert" on document_tag_assignments
  for insert with check (auth.uid() = user_id);

create policy "document_tag_assignments_update" on document_tag_assignments
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "document_tag_assignments_delete" on document_tag_assignments
  for delete using (auth.uid() = user_id);

-- ─── audit_log (append-only: SELECT + INSERT only) ────────────────────────────
alter table audit_log enable row level security;

drop policy if exists "audit_log_select" on audit_log;
drop policy if exists "audit_log_insert" on audit_log;

create policy "audit_log_select" on audit_log
  for select using (auth.uid() = user_id);

create policy "audit_log_insert" on audit_log
  for insert with check (auth.uid() = user_id);
