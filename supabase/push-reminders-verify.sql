-- Controllo in sola lettura dopo aver eseguito push-reminders.sql nel SQL Editor.
-- Atteso: ogni colonna *_ready è true. pg_net_ready, vault_ready e cron_ready diventano true solo
-- con pg_net e pg_cron attivi e i due segreti in Vault (studyos_push_secret, studyos_push_url): senza,
-- i promemoria arrivano solo con l'app aperta e il resto funziona. I valori mancanti (funzione o
-- tabella assente) contano come "non pronto".
select
  to_regclass('public.studyos_push_reminders') is not null
    and (select count(*) from information_schema.columns where table_schema = 'public'
      and table_name = 'studyos_push_reminders'
      and column_name in ('user_id', 'id', 'fire_at', 'title', 'body', 'url', 'tag', 'sent_at', 'skipped', 'updated_at')) = 10
    and exists (select 1 from pg_constraint where conname = 'studyos_push_reminders_values_check')
    as table_ready,
  coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.studyos_push_reminders')), false) as rls_ready,
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'studyos_push_reminders') = 4
    and not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'studyos_push_reminders'
      and (coalesce(qual, '') || coalesce(with_check, '')) not like '%auth.uid()%') as policies_ready,
  -- Solo chi ha l'account legge e scrive le proprie righe; anon niente.
  coalesce(has_table_privilege('authenticated', to_regclass('public.studyos_push_reminders'), 'SELECT')
    and has_table_privilege('authenticated', to_regclass('public.studyos_push_reminders'), 'INSERT')
    and has_table_privilege('authenticated', to_regclass('public.studyos_push_reminders'), 'UPDATE')
    and has_table_privilege('authenticated', to_regclass('public.studyos_push_reminders'), 'DELETE')
    and not has_any_column_privilege('anon', to_regclass('public.studyos_push_reminders'), 'SELECT')
    and not has_any_column_privilege('anon', to_regclass('public.studyos_push_reminders'), 'INSERT'), false) as grants_ready,
  coalesce((select count(*) = 1 from pg_trigger where not tgisinternal
    and tgrelid = to_regclass('public.studyos_push_reminders') and tgname = 'studyos_push_reminders_guard'), false)
    and coalesce(pg_get_functiondef(to_regprocedure('public.studyos_push_reminders_guard()')) like '%interval ''14 days''%', false)
    and coalesce(pg_get_functiondef(to_regprocedure('public.studyos_push_reminders_guard()')) like '%>= 300%', false)
    as guard_ready,
  -- La funzione del job: DEFINER con search_path fisso, mai eseguibile dai client, non blocca mai.
  coalesce((select p.prosecdef and exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')
    from pg_proc p where p.oid = to_regprocedure('public.studyos_push_due_reminders()')), false)
    and not coalesce(has_function_privilege('anon', to_regprocedure('public.studyos_push_due_reminders()'), 'EXECUTE')
      or has_function_privilege('authenticated', to_regprocedure('public.studyos_push_due_reminders()'), 'EXECUTE'), true)
    and coalesce(pg_get_functiondef(to_regprocedure('public.studyos_push_due_reminders()')) like '%exception when others%', false)
    as due_function_ready,
  -- «Cancella anche dall'account» (schema.sql) toglie anche queste righe.
  coalesce(pg_get_functiondef(to_regprocedure('public.erase_studyos_account_items()')) like '%studyos_push_reminders%', false)
    as erase_ready,
  exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'net' and p.proname = 'http_post') as pg_net_ready,
  case when to_regclass('vault.decrypted_secrets') is null then false
    else (xpath('/row/n/text()', query_to_xml(
      'select count(distinct name) as n from vault.decrypted_secrets
        where name in (''studyos_push_secret'', ''studyos_push_url'') and coalesce(decrypted_secret, '''') <> ''''',
      false, true, '')))[1]::text = '2'
  end as vault_ready,
  -- Lettura dinamica: senza lo schema cron la query resta valida e risponde false.
  case when to_regclass('cron.job') is null then false
    else (xpath('/row/n/text()', query_to_xml(
      'select count(*) as n from cron.job
        where jobname = ''studyos-push-reminders'' and schedule = ''* * * * *'' and active
          and command like ''%studyos_push_due_reminders()%''',
      false, true, '')))[1]::text = '1'
  end as cron_ready;
