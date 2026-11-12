-- Read-only check after running schema.sql in the Supabase SQL Editor.
-- Expected: every *_ready column is true and own_item_policies is 4.
-- files_bucket_ready, file_read_ready and file_policies = 4 only after storage.sql.
select
  to_regclass('public.studyos_items') is not null as table_ready,
  coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.studyos_items')), false) as rls_ready,
  to_regprocedure('public.push_studyos_rows(uuid,text,jsonb)') is not null as rpc_ready,
  coalesce(has_table_privilege('authenticated', to_regclass('public.studyos_items'), 'SELECT')
    and has_table_privilege('authenticated', to_regclass('public.studyos_items'), 'INSERT')
    and has_table_privilege('authenticated', to_regclass('public.studyos_items'), 'UPDATE')
    and has_table_privilege('authenticated', to_regclass('public.studyos_items'), 'DELETE'), false) as authenticated_table_ready,
  coalesce(has_function_privilege('authenticated',
    to_regprocedure('public.push_studyos_rows(uuid,text,jsonb)'), 'EXECUTE'), false) as authenticated_rpc_ready,
  -- «Cancella anche dall'account» (revisione del 12/11/2026): solo account autenticati.
  coalesce(has_function_privilege('authenticated',
    to_regprocedure('public.erase_studyos_account_items()'), 'EXECUTE')
    and not has_function_privilege('anon', to_regprocedure('public.erase_studyos_account_items()'), 'EXECUTE'), false) as erase_rpc_ready,
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'studyos_items'
    and policyname in ('studyos_select_own_items', 'studyos_insert_own_items',
      'studyos_update_own_items', 'studyos_delete_own_items')) as own_item_policies,
  exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime'
    and schemaname = 'public' and tablename = 'studyos_items') as realtime_ready,
  -- File dei materiali (storage.sql): bucket privato da 25 MB con l'elenco dei tipi, 4 policy su
  -- storage.objects (file_policies = 4), funzione di lettura solo per account autenticati.
  -- La lettura del bucket passa da query_to_xml: senza lo schema storage dà false invece di un errore.
  case when to_regclass('storage.buckets') is null then false
    else coalesce((xpath('/row/ready/text()', query_to_xml(
      'select count(*) = 1 and bool_and(not public and file_size_limit = 26214400 and ''application/pdf'' = any(allowed_mime_types) and not (''text/html'' = any(allowed_mime_types))) as ready from storage.buckets where id = ''studyos-files''',
      false, true, '')))[1]::text = 'true', false)
  end as files_bucket_ready,
  (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects'
    and policyname in ('studyos_files_select', 'studyos_files_insert', 'studyos_files_update', 'studyos_files_delete')) as file_policies,
  coalesce(has_function_privilege('authenticated', to_regprocedure('public.studyos_can_read_file(text)'), 'EXECUTE')
    and not has_function_privilege('anon', to_regprocedure('public.studyos_can_read_file(text)'), 'EXECUTE'), false) as file_read_ready,
  -- push_studyos_rows di schema.sql dopo la revisione dei file (fix 1): «cloud» non torna «local».
  coalesce(position('storedFile' in pg_get_functiondef(to_regprocedure('public.push_studyos_rows(uuid,text,jsonb)'))) > 0, false) as stored_file_guard_ready;
