-- Pin search_path on the search function (security hardening)
alter function public.match_document_chunks(vector(768), int, uuid, uuid)
  set search_path = public, extensions;
