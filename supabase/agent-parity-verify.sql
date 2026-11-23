-- Controllo in sola lettura dopo aver eseguito agent-parity.sql (connettore remoto alla pari, 1.12.0).
-- Atteso: ogni colonna *_ready è true. Dopo, riesegui anche verify.sql (security_issues vuota).
with
anon_rpc (sig) as (values
  ('public.studyos_agent_save_group_exam_session(text,text,text,integer,jsonb)'),
  ('public.studyos_agent_delete_group_exam_session(text,text,integer)'),
  ('public.studyos_agent_save_catalog_override(text,text,text,integer,text,text,text,jsonb)'),
  ('public.studyos_agent_delete_catalog_override(text,text,integer)'),
  ('public.studyos_agent_restore_group_record(text,bigint,integer)'),
  ('public.studyos_agent_group_history(text,text,text,text,bigint,integer)'),
  ('public.studyos_agent_groups(text)'),
  ('public.studyos_agent_add_group_resource(text,jsonb)'),
  ('public.studyos_agent_delete_group_resource(text,text)'),
  ('public.studyos_agent_log_group_activity(text,jsonb)'),
  ('public.studyos_agent_sharing(text,integer,text[])'),
  ('public.studyos_agent_request_create(text,text,jsonb,text,text)'),
  ('public.studyos_agent_request_status(text,uuid)'),
  ('public.studyos_agent_timer_get(text)'),
  ('public.studyos_agent_timer_put(text,jsonb)')
),
app_rpc (sig) as (values
  ('public.studyos_agent_request_decide(uuid,boolean)'),
  ('public.studyos_agent_request_finish(uuid,jsonb)'),
  ('public.studyos_timer_put(jsonb)')
),
internal_rpc (sig) as (values
  ('public.studyos_agent_act_as(text)'),
  ('public.studyos_agent_session_json(text,text)'),
  ('public.studyos_agent_override_json(text,text)'),
  ('public.studyos_agent_group_outcome(jsonb,uuid)'),
  ('public.studyos_agent_deferred_tool(text)'),
  ('public.studyos_agent_request_push(uuid,uuid,text)'),
  ('public.studyos_timer_write(uuid,jsonb)')
),
tables (name) as (values ('studyos_agent_requests'), ('studyos_timer_states'))
select
  -- Tutte le funzioni ci sono.
  (select bool_and(to_regprocedure(sig) is not null) from (
    select sig from anon_rpc union all select sig from app_rpc union all select sig from internal_rpc) as every)
    as functions_ready,
  -- L'hub (chiave publishable + segreto) chiama solo i suoi ingressi; l'app solo i suoi, con l'accesso fatto.
  (select bool_and(coalesce(has_function_privilege('anon', to_regprocedure(sig), 'EXECUTE'), false)) from anon_rpc)
    and (select bool_and(coalesce(has_function_privilege('authenticated', to_regprocedure(sig), 'EXECUTE')
      and not has_function_privilege('anon', to_regprocedure(sig), 'EXECUTE'), false)) from app_rpc)
    as entry_rpc_ready,
  -- L'identità del permesso (studyos_agent_act_as) e gli aiuti interni non si chiamano da fuori.
  (select bool_and(not coalesce(has_function_privilege('anon', to_regprocedure(sig), 'EXECUTE')
      or has_function_privilege('authenticated', to_regprocedure(sig), 'EXECUTE'), true)) from internal_rpc)
    as internal_rpc_private_ready,
  -- Ogni funzione definer fissa il search_path.
  (select bool_and(exists (
      select 1 from pg_proc p, unnest(coalesce(p.proconfig, '{}'::text[])) as cfg (setting)
      where p.oid = to_regprocedure(sig) and cfg.setting like 'search_path=%'))
    from (select sig from anon_rpc union all select sig from app_rpc union all select sig from internal_rpc) as every)
    as search_path_ready,
  -- Le scritture dei gruppi passano dalle funzioni dell'app: rilettura in un'istruzione dopo la scrittura.
  coalesce(position('v_result := public.save_group_exam_session' in
      pg_get_functiondef(to_regprocedure('public.studyos_agent_save_group_exam_session(text,text,text,integer,jsonb)'))) > 0
    and position('studyos_agent_act_as' in
      pg_get_functiondef(to_regprocedure('public.studyos_agent_restore_group_record(text,bigint,integer)'))) > 0
    and (select provolatile = 'v' from pg_proc where oid = to_regprocedure('public.studyos_agent_group_outcome(jsonb,uuid)')), false)
    as group_writes_ready,
  -- Letture con il filtro delle policy: membri senza email, gruppi senza codice di invito, dati condivisi
  -- con studyos_item_access.
  coalesce(position('- ''email''' in pg_get_functiondef(to_regprocedure('public.studyos_agent_groups(text)'))) > 0
    and position('- ''invite_code''' in pg_get_functiondef(to_regprocedure('public.studyos_agent_groups(text)'))) > 0
    and position('studyos_item_access' in pg_get_functiondef(to_regprocedure('public.studyos_agent_sharing(text,integer,text[])'))) > 0
    -- Nessun indirizzo email di destinatari o inviti verso l'hub.
    and position('_email' in pg_get_functiondef(to_regprocedure('public.studyos_agent_sharing(text,integer,text[])'))) = 0
    and position('studyos_is_group_member' in pg_get_functiondef(to_regprocedure('public.studyos_agent_group_history(text,text,text,text,bigint,integer)'))) > 0, false)
    as reads_ready,
  -- Tabelle nuove: RLS attiva, una policy di sola lettura delle proprie righe, nessun privilegio per anon,
  -- per authenticated solo SELECT.
  (select bool_and(
      coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.' || name)), false)
      and (select count(*) from pg_policies where schemaname = 'public' and tablename = name) = 1
      and exists (select 1 from pg_policies where schemaname = 'public' and tablename = name
        and cmd = 'SELECT' and qual like '%auth.uid()%' and roles = array['authenticated']::name[])
      and not has_any_column_privilege('anon', to_regclass('public.' || name), 'SELECT, INSERT, UPDATE, REFERENCES')
      and not has_table_privilege('anon', to_regclass('public.' || name), 'DELETE, TRUNCATE, TRIGGER')
      and has_table_privilege('authenticated', to_regclass('public.' || name), 'SELECT')
      and not has_table_privilege('authenticated', to_regclass('public.' || name), 'INSERT, UPDATE, DELETE, TRUNCATE'))
    from tables) as tables_ready,
  -- Solo gli strumenti di condivisione diventano richieste da confermare nell'app.
  coalesce(public.studyos_agent_deferred_tool('studyos_share_with')
    and public.studyos_agent_deferred_tool('studyos_delete_shared_item')
    and not public.studyos_agent_deferred_tool('studyos_create_task'), false) as deferred_tools_ready;
