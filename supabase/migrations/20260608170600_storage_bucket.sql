-- Private storage bucket for original legal files + owner-scoped RLS
insert into storage.buckets (id, name, public)
values ('legal-documents', 'legal-documents', false)
on conflict (id) do nothing;

-- First path segment is the owner's uid: {user_id}/{document_id}/original/{filename}
create policy "own_files_read" on storage.objects for select
  using (bucket_id = 'legal-documents' and auth.uid()::text = (storage.foldername(name))[1]);
create policy "own_files_write" on storage.objects for insert
  with check (bucket_id = 'legal-documents' and auth.uid()::text = (storage.foldername(name))[1]);
create policy "own_files_delete" on storage.objects for delete
  using (bucket_id = 'legal-documents' and auth.uid()::text = (storage.foldername(name))[1]);
