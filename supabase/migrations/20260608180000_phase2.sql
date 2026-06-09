-- Phase 2: markdown storage path column + concurrency-safe claim function

alter table documents add column if not exists markdown_storage_path text null;

-- Atomically claim one queued document (FOR UPDATE SKIP LOCKED via PL/pgSQL)
-- Called by the Python dispatcher via PostgREST RPC: POST /rpc/claim_next_document
create or replace function public.claim_next_document()
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
  where processing_status = 'queued'
  order by created_at
  limit 1
  for update skip locked;

  if claimed_id is null then
    return;
  end if;

  return query
    update documents
    set processing_status = 'processing',
        updated_at = now()
    where id = claimed_id
    returning *;
end;
$$;

-- Update search_vector for a document after processing
create or replace function public.update_document_search_vector(doc_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update documents
  set search_vector = to_tsvector(
    'english',
    coalesce(original_filename, '') || ' ' ||
    coalesce(display_title, '') || ' ' ||
    coalesce(extracted_text, '') || ' ' ||
    coalesce(array_to_string(ai_keywords, ' '), '')
  ),
  updated_at = now()
  where id = doc_id;
end;
$$;
