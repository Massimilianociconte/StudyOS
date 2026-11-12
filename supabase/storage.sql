-- File dei materiali in Supabase Storage (bucket privato `studyos-files`).
-- Va eseguito dopo schema.sql (usa public.studyos_items), come un unico script; si può rieseguire.
-- Percorso di ogni file: `<uid del proprietario>/<id del materiale>` (nessun'altra cartella).
-- Il client tiene nel materiale solo i metadati e `storedFile`; i byte non passano più da
-- studyos_items. Dettagli: docs/superpowers/specs/2026-11-12-attachments-storage-design.md.

-- Bucket privato: 25 MB per file (MAX_FILE_BYTES in src/lib/attachments.ts) e solo i tipi ammessi
-- (FILE_MIME_TYPES, stesso elenco; un test lo controlla). application/octet-stream serve solo ai
-- file incorporati di prima con un tipo fuori elenco: si scaricano, non si aprono mai nella pagina.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('studyos-files', 'studyos-files', false, 26214400, null)
on conflict (id) do nothing;

-- Rieseguendo lo script dopo una revisione, limiti ed elenco si aggiornano (e il bucket resta privato).
update storage.buckets
set
  public = false,
  file_size_limit = 26214400,
  allowed_mime_types = array[
    'application/pdf',
    'image/png',
    'image/jpeg',
    'image/gif',
    'image/webp',
    'image/avif',
    'image/heic',
    'image/heif',
    'image/bmp',
    'text/plain',
    'text/markdown',
    'text/csv',
    'application/rtf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.oasis.opendocument.text',
    'application/vnd.oasis.opendocument.spreadsheet',
    'application/vnd.oasis.opendocument.presentation',
    'application/epub+zip',
    'application/zip',
    'audio/mpeg',
    'audio/mp4',
    'audio/x-m4a',
    'audio/wav',
    'audio/ogg',
    'audio/webm',
    'video/mp4',
    'video/webm',
    'video/quicktime',
    'application/octet-stream'
  ]::text[]
where id = 'studyos-files';

-- Chi può leggere la riga del materiale può scaricarne il file: il proprietario e chi lo riceve con
-- una condivisione (sharing.sql), persona o gruppo. SECURITY INVOKER di proposito: la ricerca in
-- studyos_items passa dalla RLS di chi chiede, quindi la revoca di una condivisione vale subito e non
-- serve conoscere le tabelle delle condivisioni (senza sharing.sql restano solo le proprie righe).
create or replace function public.studyos_can_read_file(p_name text)
returns boolean
language sql
stable
security invoker
set search_path = pg_catalog
as $$
  select case
    when p_name !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[A-Za-z0-9_-]{1,128}$' then false
    else exists (
      select 1
      from public.studyos_items as item
      where item.user_id = split_part(p_name, '/', 1)::uuid
        and item.entity_type = 'attachment'
        and item.entity_id = split_part(p_name, '/', 2)
        and not item.deleted
    )
  end
$$;

revoke all on function public.studyos_can_read_file(text) from public, anon;
grant execute on function public.studyos_can_read_file(text) to authenticated;

-- Policy su storage.objects (la RLS è già attiva in ogni progetto Supabase).
-- Scrivere, sovrascrivere ed eliminare: solo nella propria cartella, un livello solo.
drop policy if exists studyos_files_select on storage.objects;
create policy studyos_files_select on storage.objects
for select to authenticated
using (
  bucket_id = 'studyos-files'
  and (
    (storage.foldername(name))[1] = (select auth.uid()::text)
    or public.studyos_can_read_file(name)
  )
);

drop policy if exists studyos_files_insert on storage.objects;
create policy studyos_files_insert on storage.objects
for insert to authenticated
with check (
  bucket_id = 'studyos-files'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
  and array_length(storage.foldername(name), 1) = 1
);

drop policy if exists studyos_files_update on storage.objects;
create policy studyos_files_update on storage.objects
for update to authenticated
using (
  bucket_id = 'studyos-files'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
)
with check (
  bucket_id = 'studyos-files'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
  and array_length(storage.foldername(name), 1) = 1
);

drop policy if exists studyos_files_delete on storage.objects;
create policy studyos_files_delete on storage.objects
for delete to authenticated
using (
  bucket_id = 'studyos-files'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);
