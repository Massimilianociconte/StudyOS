-- Read-only check after running schema.sql in the Supabase SQL Editor.
-- Expected: every *_ready column is true and own_item_policies is 4.
-- files_bucket_ready, file_read_ready and file_policies = 4 only after storage.sql.
--
-- Protezione dei dati (revisione B4 del 12/11/2026, vedi docs/security-data.md). Da eseguire dopo
-- tutti gli altri script, e di nuovo dopo ogni script nuovo: i controlli valgono per ogni tabella di
-- public (tranne quelle di un'estensione) e ogni funzione SECURITY DEFINER di public, anche quelle
-- aggiunte in futuro.
-- - tables_rls_ready: ogni tabella ha la RLS attiva, nessun ruolo dei client (anon, authenticated) ne
--   è proprietario, ha BYPASSRLS o ha TRUNCATE (che ignora la RLS); una vista è leggibile dai client
--   solo con security_invoker, una vista materializzata mai.
-- - anon_closed_ready: anon (la chiave publishable senza accesso) non ha privilegi su quelle tabelle
--   e nessuna policy (nemmeno sui file di studyos-files) vale per anon o per public.
-- - definer_functions_ready: ogni funzione SECURITY DEFINER fissa il search_path e anon non la può
--   eseguire, tranne gli otto ingressi protetti da un segreto (connettore remoto, push_gone) o senza dati
--   (studyos_keepalive).
-- - security_issues: vuota (null) quando le tre colonne sopra sono true; altrimenti dice quali oggetti
--   sistemare (solo nomi, mai dati).
-- - emails_hidden_ready (dopo groups.sql, sharing.sql e people.sql): nessuna email visibile agli altri
--   nelle righe dei membri, degli inviti di gruppo e delle condivisioni.
-- - erase_all_ready: «Cancella anche dall'account» toglie anche cronologia, condivisioni mandate,
--   registro e permessi del connettore remoto, il profilo online e i resoconti BARB.
with
client_role (name) as (values ('anon'), ('authenticated')),
rel as (
  select c.oid as rel_oid, c.relname, c.relkind, c.relrowsecurity, c.relowner, c.reloptions
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind in ('r', 'p', 'v', 'm', 'f')
    -- Ogni tabella di public, non solo studyos_* (fix 1 della revisione B4): tranne quelle di un'estensione.
    and not exists (
      select 1 from pg_depend d
      where d.classid = 'pg_class'::regclass and d.objid = c.oid and d.deptype = 'e'
    )
),
definer as (
  select p.oid as fn_oid, p.oid::regprocedure::text as fn_name,
    exists (
      select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) as cfg (setting)
      where cfg.setting like 'search_path=%'
    ) as pinned
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosecdef
    -- Le funzioni di un'estensione installata in public non sono nostre.
    and not exists (
      select 1 from pg_depend d
      where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e'
    )
),
-- Ingressi SECURITY DEFINER che anon deve poter chiamare: l'hub del connettore remoto e il Worker
-- delle push usano la chiave publishable e mandano un segreto che la funzione controlla; il battito
-- (keepalive.sql) scrive solo l'ora dell'ultimo battito.
anon_entry (fn_oid) as (
  select fn::oid from (values
    (to_regprocedure('public.studyos_agent_pull(text,timestamptz,integer,integer)')),
    (to_regprocedure('public.studyos_agent_push(text,text,jsonb,text,uuid)')),
    (to_regprocedure('public.studyos_agent_audit_list(text,integer,integer,text,text,timestamptz,timestamptz,uuid)')),
    (to_regprocedure('public.studyos_agent_restore(text,uuid)')),
    (to_regprocedure('public.studyos_agent_restore_call(text,uuid)')),
    (to_regprocedure('public.studyos_agent_group_snapshot(text)')),
    (to_regprocedure('public.push_gone(text,text[])')),
    (to_regprocedure('public.studyos_keepalive(text)'))
  ) as allowed (fn)
  where fn is not null
),
issue (area, what) as (
  select 'rls', relname || ': RLS spenta' from rel
  where relkind in ('r', 'p') and not relrowsecurity
  union all
  select 'rls', relname || ': proprietario ' || pg_get_userbyid(relowner) from rel
  where pg_get_userbyid(relowner) in ('anon', 'authenticated')
  union all
  -- Ruolo dei client che salta la RLS: le policy non varrebbero per lui.
  select 'rls', r.rolname || ': BYPASSRLS' from pg_roles r
  where r.rolname in (select name from client_role) and r.rolbypassrls
  union all
  select 'rls', rel.relname || ': TRUNCATE per ' || client_role.name from rel, client_role
  where rel.relkind in ('r', 'p') and has_table_privilege(client_role.name, rel.rel_oid, 'TRUNCATE')
  union all
  select 'rls', relname || ': vista senza security_invoker' from rel
  where relkind = 'v'
    and not exists (
      select 1 from unnest(coalesce(reloptions, '{}'::text[])) as opt (setting)
      where opt.setting ~* '^security_invoker=(true|on|yes|1)$'
    )
    and (has_any_column_privilege('anon', rel_oid, 'SELECT') or has_any_column_privilege('authenticated', rel_oid, 'SELECT'))
  union all
  select 'rls', relname || ': leggibile senza RLS' from rel
  where relkind in ('m', 'f')
    and (has_any_column_privilege('anon', rel_oid, 'SELECT') or has_any_column_privilege('authenticated', rel_oid, 'SELECT'))
  union all
  select 'anon', relname || ': privilegi per anon' from rel
  where has_any_column_privilege('anon', rel_oid, 'SELECT, INSERT, UPDATE, REFERENCES')
     or has_table_privilege('anon', rel_oid, 'DELETE, TRUNCATE, TRIGGER')
  union all
  select 'anon', pol.tablename || ': policy ' || pol.policyname || ' per anon o public' from pg_policies pol
  where pol.roles && array['anon', 'public']::name[]
    and (
      (pol.schemaname = 'public' and pol.tablename in (select relname from rel))
      or (pol.schemaname = 'storage' and coalesce(pol.qual, '') || coalesce(pol.with_check, '') like '%studyos-files%')
    )
  union all
  select 'definer', fn_name || ': search_path non fissato' from definer
  where not pinned
  union all
  select 'definer', fn_name || ': eseguibile da anon' from definer
  where has_function_privilege('anon', fn_oid, 'EXECUTE')
    and fn_oid not in (select fn_oid from anon_entry)
)
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
  coalesce(position('storedFile' in pg_get_functiondef(to_regprocedure('public.push_studyos_rows(uuid,text,jsonb)'))) > 0, false) as stored_file_guard_ready,
  -- ─── Protezione dei dati (revisione B4) ───
  not exists (select 1 from issue where area = 'rls') as tables_rls_ready,
  not exists (select 1 from issue where area = 'anon') as anon_closed_ready,
  not exists (select 1 from issue where area = 'definer') as definer_functions_ready,
  (select string_agg(what, '; ' order by area, what) from issue) as security_issues,
  -- Email visibili agli altri: nessuna nei membri dei gruppi (trigger attivo, righe vuote) e nelle
  -- condivisioni (righe vuote, accept_share_invite non la scrive). Tabelle assenti: niente da mostrare.
  -- Le righe si contano con query_to_xml: senza groups.sql o sharing.sql dà true invece di un errore.
  case when to_regclass('public.studyos_group_members') is null then true
    else exists (
        select 1 from pg_trigger t
        where t.tgrelid = to_regclass('public.studyos_group_members')
          and t.tgname = 'studyos_group_members_no_email' and t.tgenabled <> 'D'
      )
      and coalesce((xpath('/row/n/text()', query_to_xml(
        'select count(*) as n from public.studyos_group_members where email is not null',
        false, true, '')))[1]::text = '0', false)
      -- Vecchi inviti per email: ogni membro del gruppo li legge (people.sql toglie l'indirizzo).
      and coalesce((xpath('/row/n/text()', query_to_xml(
        'select count(*) as n from public.studyos_group_invites where recipient_email is not null',
        false, true, '')))[1]::text = '0', false)
  end
  and case when to_regclass('public.studyos_shares') is null then true
    else coalesce((xpath('/row/n/text()', query_to_xml(
        'select count(*) as n from public.studyos_shares where grantee_email is not null',
        false, true, '')))[1]::text = '0', false)
      and coalesce(pg_get_functiondef(to_regprocedure('public.accept_share_invite(uuid,text,text,jsonb)'))
        not like '%studyos_account_email%', false)
  end as emails_hidden_ready,
  -- «Cancella anche dall'account» copre anche le tabelle fuori da studyos_items (vedi schema.sql).
  coalesce((
    select p.prosecdef
      and pg_get_functiondef(p.oid) like '%delete from public.studyos_item_revisions where owner_id = auth.uid()%'
      and pg_get_functiondef(p.oid) like '%delete from public.studyos_shares where owner_id = auth.uid()%'
      and pg_get_functiondef(p.oid) like '%delete from public.studyos_share_invites where owner_id = auth.uid()%'
      and pg_get_functiondef(p.oid) like '%delete from public.studyos_agent_audit where user_id = auth.uid()%'
      and pg_get_functiondef(p.oid) like '%delete from public.studyos_agent_grants where user_id = auth.uid()%'
      and pg_get_functiondef(p.oid) like '%update public.studyos_profiles set display_name = '''', handle = null%'
      and pg_get_functiondef(p.oid) like '%delete from public.studyos_push_reminders where user_id = auth.uid()%'
      and pg_get_functiondef(p.oid) like '%delete from public.university_sync_reports where user_id = auth.uid()%'
    from pg_proc p
    where p.oid = to_regprocedure('public.erase_studyos_account_items()')
  ), false) as erase_all_ready;
