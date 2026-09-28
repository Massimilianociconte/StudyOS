-- Read-only check after running schema.sql in the Supabase SQL Editor.
-- Expected: every *_ready column is true and own_item_policies is 4.
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
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'studyos_items'
    and policyname in ('studyos_select_own_items', 'studyos_insert_own_items',
      'studyos_update_own_items', 'studyos_delete_own_items')) as own_item_policies,
  exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime'
    and schemaname = 'public' and tablename = 'studyos_items') as realtime_ready;
