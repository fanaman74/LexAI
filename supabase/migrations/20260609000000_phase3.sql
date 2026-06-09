-- Phase 3: chunking_status column + concurrency-safe claim for chunking

alter table documents
  add column if not exists chunking_status text null
  check (chunking_status in ('pending','chunking','chunked','failed'));

-- Atomically claim one processed-but-not-yet-chunked document
create or replace function public.claim_next_for_chunking()
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
  where processing_status = 'processed'
    and chunking_status is null
  order by processed_at
  limit 1
  for update skip locked;

  if claimed_id is null then
    return;
  end if;

  return query
    update documents
    set chunking_status = 'chunking',
        updated_at = now()
    where id = claimed_id
    returning *;
end;
$$;
