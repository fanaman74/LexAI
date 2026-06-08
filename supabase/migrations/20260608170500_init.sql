-- LexAI Phase 1 schema (instruct.md §6–7, §12–13) with embedding vector(768)
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
