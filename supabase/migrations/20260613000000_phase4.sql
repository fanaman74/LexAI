-- Phase 4: ranked keyword search with snippets + reprocess reset helper

create or replace function public.keyword_search_documents(
    search_query text,
    filter_user_id uuid,
    filter_case_id uuid default null,
    filter_source_type text default null,
    match_count int default 20
)
returns table (
    document_id uuid,
    original_filename text,
    display_title text,
    source_type text,
    document_date date,
    ai_short_summary text,
    rank real,
    snippet text
)
language sql stable
security definer
set search_path = public
as $$
    select
        d.id,
        d.original_filename,
        d.display_title,
        d.source_type,
        d.document_date,
        d.ai_short_summary,
        ts_rank(d.search_vector, websearch_to_tsquery('english', search_query)) as rank,
        ts_headline('english', coalesce(d.extracted_text, ''),
                    websearch_to_tsquery('english', search_query),
                    'MaxWords=40, MinWords=20, MaxFragments=2') as snippet
    from documents d
    left join case_documents cd on cd.document_id = d.id
    where d.user_id = filter_user_id
      and d.search_vector @@ websearch_to_tsquery('english', search_query)
      and (filter_case_id is null or cd.case_id = filter_case_id)
      and (filter_source_type is null or d.source_type = filter_source_type)
    group by d.id
    order by rank desc
    limit match_count;
$$;

-- Reset a document so the dispatcher re-processes it (used by POST /reprocess)
create or replace function public.reset_document_for_reprocess(doc_id uuid, requesting_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update documents
  set processing_status = 'queued',
      chunking_status = null,
      processing_error = null,
      updated_at = now()
  where id = doc_id and user_id = requesting_user;
end;
$$;
