-- Controllo in sola lettura dopo aver eseguito agent.sql nel SQL Editor (connettore remoto).
-- Atteso: ogni colonna *_ready è true. I privilegi si controllano perché i valori predefiniti
-- del progetto possono riaprirli; i valori mancanti (funzione o tabella assente) contano come
-- "non pronto".
select
  to_regclass('public.studyos_agent_grants') is not null as table_ready,
  coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.studyos_agent_grants')), false)
    and (select count(*) from pg_policies where schemaname = 'public' and tablename = 'studyos_agent_grants') = 1
    and coalesce((select cmd = 'SELECT' and qual like '%auth.uid()%' from pg_policies
      where schemaname = 'public' and tablename = 'studyos_agent_grants'
        and policyname = 'studyos_agent_grants_select_own'), false) as rls_ready,
  to_regprocedure('public.studyos_agent_secret_hash(text)') is not null
    and to_regprocedure('public.studyos_create_agent_grant(text)') is not null
    and to_regprocedure('public.studyos_revoke_agent_grants()') is not null
    and to_regprocedure('public.studyos_agent_user(text)') is not null
    and to_regprocedure('public.studyos_agent_pull(text,timestamptz,integer,integer)') is not null
    and to_regprocedure('public.studyos_agent_push(text,text,jsonb)') is not null as rpc_ready,
  -- Permessi: si creano e si revocano solo con l'accesso fatto.
  coalesce(has_function_privilege('authenticated', to_regprocedure('public.studyos_create_agent_grant(text)'), 'EXECUTE')
    and has_function_privilege('authenticated', to_regprocedure('public.studyos_revoke_agent_grants()'), 'EXECUTE')
    and not has_function_privilege('anon', to_regprocedure('public.studyos_create_agent_grant(text)'), 'EXECUTE')
    and not has_function_privilege('anon', to_regprocedure('public.studyos_revoke_agent_grants()'), 'EXECUTE'), false)
    as grant_rpc_ready,
  -- Pull e push: le chiama l'hub con la chiave publishable e il segreto del permesso.
  coalesce(has_function_privilege('anon', to_regprocedure('public.studyos_agent_pull(text,timestamptz,integer,integer)'), 'EXECUTE')
    and has_function_privilege('anon', to_regprocedure('public.studyos_agent_push(text,text,jsonb)'), 'EXECUTE'), false)
    as hub_rpc_ready,
  -- Il segno del file nello spazio file (`storedFile`) non va all'agente e non si perde con le sue modifiche.
  coalesce(position('storedFile' in pg_get_functiondef(to_regprocedure('public.studyos_agent_pull(text,timestamptz,integer,integer)'))) > 0
    and position('storedFile' in pg_get_functiondef(to_regprocedure('public.studyos_agent_push(text,text,jsonb)'))) > 0, false)
    as stored_file_kept_ready,
  -- Funzioni interne: nessuno le chiama da fuori.
  not coalesce(
    has_function_privilege('anon', to_regprocedure('public.studyos_agent_user(text)'), 'EXECUTE')
    or has_function_privilege('authenticated', to_regprocedure('public.studyos_agent_user(text)'), 'EXECUTE')
    or has_function_privilege('anon', to_regprocedure('public.studyos_agent_secret_hash(text)'), 'EXECUTE')
    or has_function_privilege('authenticated', to_regprocedure('public.studyos_agent_secret_hash(text)'), 'EXECUTE'),
    true) as internal_rpc_private_ready,
  -- La tabella: nessun accesso per anon; chi ha fatto l'accesso legge soltanto (le righe sue, per RLS).
  not coalesce(
    has_any_column_privilege('anon', to_regclass('public.studyos_agent_grants'), 'SELECT')
    or has_table_privilege('anon', to_regclass('public.studyos_agent_grants'), 'INSERT, UPDATE, DELETE')
    or has_table_privilege('authenticated', to_regclass('public.studyos_agent_grants'), 'INSERT, UPDATE, DELETE'),
    true)
    and coalesce(has_table_privilege('authenticated', to_regclass('public.studyos_agent_grants'), 'SELECT'), false)
    as table_privileges_ready,
  -- Permessi attivi (solo conteggio, nessun dato).
  (select count(*) from public.studyos_agent_grants where revoked_at is null) as active_grants;
