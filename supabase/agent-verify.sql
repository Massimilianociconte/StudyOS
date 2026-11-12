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
    and to_regprocedure('public.studyos_agent_push(text,text,jsonb,text,uuid)') is not null as rpc_ready,
  -- Permessi: si creano e si revocano solo con l'accesso fatto.
  coalesce(has_function_privilege('authenticated', to_regprocedure('public.studyos_create_agent_grant(text)'), 'EXECUTE')
    and has_function_privilege('authenticated', to_regprocedure('public.studyos_revoke_agent_grants()'), 'EXECUTE')
    and not has_function_privilege('anon', to_regprocedure('public.studyos_create_agent_grant(text)'), 'EXECUTE')
    and not has_function_privilege('anon', to_regprocedure('public.studyos_revoke_agent_grants()'), 'EXECUTE'), false)
    as grant_rpc_ready,
  -- Pull e push: le chiama l'hub con la chiave publishable e il segreto del permesso.
  coalesce(has_function_privilege('anon', to_regprocedure('public.studyos_agent_pull(text,timestamptz,integer,integer)'), 'EXECUTE')
    and has_function_privilege('anon', to_regprocedure('public.studyos_agent_push(text,text,jsonb,text,uuid)'), 'EXECUTE'), false)
    as hub_rpc_ready,
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
  -- Registro del connettore (1.8.0): tabella con call_id e RLS di sola lettura per chi ne è
  -- proprietario, e nessuna vecchia push a tre o quattro argomenti rimasta (renderebbe ambigua la
  -- chiamata dell'hub).
  to_regclass('public.studyos_agent_audit') is not null
    and exists (select 1 from pg_attribute where attrelid = to_regclass('public.studyos_agent_audit')
      and attname = 'call_id' and not attisdropped)
    and to_regprocedure('public.studyos_agent_push(text,text,jsonb)') is null
    and to_regprocedure('public.studyos_agent_push(text,text,jsonb,text)') is null
    and coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.studyos_agent_audit')), false)
    and (select count(*) from pg_policies where schemaname = 'public' and tablename = 'studyos_agent_audit') = 1
    and coalesce((select cmd = 'SELECT' and qual like '%auth.uid()%' from pg_policies
      where schemaname = 'public' and tablename = 'studyos_agent_audit'
        and policyname = 'studyos_agent_audit_select_own'), false)
    and not coalesce(
      has_any_column_privilege('anon', to_regclass('public.studyos_agent_audit'), 'SELECT')
      or has_table_privilege('anon', to_regclass('public.studyos_agent_audit'), 'INSERT, UPDATE, DELETE')
      or has_table_privilege('authenticated', to_regclass('public.studyos_agent_audit'), 'INSERT, UPDATE, DELETE'),
      true)
    and coalesce(has_table_privilege('authenticated', to_regclass('public.studyos_agent_audit'), 'SELECT'), false)
    as audit_table_ready,
  -- Registro e ripristino (una voce o un'intera chiamata): l'hub col segreto, l'app con l'accesso
  -- fatto (mai anon). Nessuna versione della prima revisione rimasta.
  coalesce(has_function_privilege('anon', to_regprocedure('public.studyos_agent_audit_list(text,integer,integer,text,text,timestamptz,timestamptz,uuid)'), 'EXECUTE')
    and has_function_privilege('anon', to_regprocedure('public.studyos_agent_restore(text,uuid)'), 'EXECUTE')
    and has_function_privilege('anon', to_regprocedure('public.studyos_agent_restore_call(text,uuid)'), 'EXECUTE')
    and has_function_privilege('authenticated', to_regprocedure('public.studyos_agent_audit_own(integer,integer,text,text,timestamptz,timestamptz,uuid)'), 'EXECUTE')
    and has_function_privilege('authenticated', to_regprocedure('public.studyos_agent_restore_own(uuid)'), 'EXECUTE')
    and has_function_privilege('authenticated', to_regprocedure('public.studyos_agent_restore_call_own(uuid)'), 'EXECUTE')
    and not has_function_privilege('anon', to_regprocedure('public.studyos_agent_audit_own(integer,integer,text,text,timestamptz,timestamptz,uuid)'), 'EXECUTE')
    and not has_function_privilege('anon', to_regprocedure('public.studyos_agent_restore_own(uuid)'), 'EXECUTE')
    and not has_function_privilege('anon', to_regprocedure('public.studyos_agent_restore_call_own(uuid)'), 'EXECUTE'), false)
    and to_regprocedure('public.studyos_agent_audit_list(text,integer,integer,text,text,timestamptz,timestamptz)') is null
    and to_regprocedure('public.studyos_agent_audit_own(integer,integer,text,text,timestamptz,timestamptz)') is null
    as audit_rpc_ready,
  -- Funzioni interne del registro: nessuno le chiama da fuori (se mancano, non pronto).
  to_regprocedure('public.studyos_agent_grant_of(text)') is not null
    and to_regprocedure('public.studyos_agent_audit_image(jsonb)') is not null
    and to_regprocedure('public.studyos_agent_audit_files(jsonb)') is not null
    and to_regprocedure('public.studyos_agent_audit_prune(uuid)') is not null
    and to_regprocedure('public.studyos_agent_audit_rows(uuid,integer,integer,text,text,timestamptz,timestamptz,uuid)') is not null
    and to_regprocedure('public.studyos_agent_call_ids(uuid,uuid)') is not null
    and to_regprocedure('public.studyos_agent_restore_set(uuid,uuid[],uuid,text,text)') is not null
    and to_regprocedure('public.studyos_agent_restore_apply(uuid,uuid,uuid,text,text)') is null
    and not exists (
      select 1
      from unnest(array[
        'public.studyos_agent_grant_of(text)',
        'public.studyos_agent_audit_image(jsonb)',
        'public.studyos_agent_audit_files(jsonb)',
        'public.studyos_agent_audit_prune(uuid)',
        'public.studyos_agent_audit_rows(uuid,integer,integer,text,text,timestamptz,timestamptz,uuid)',
        'public.studyos_agent_call_ids(uuid,uuid)',
        'public.studyos_agent_restore_set(uuid,uuid[],uuid,text,text)'
      ]) as fn(signature)
      cross join unnest(array['anon', 'authenticated']) as role(name)
      where has_function_privilege(role.name, to_regprocedure(fn.signature), 'EXECUTE')
    ) as audit_internal_private_ready,
  -- Permessi attivi e voci del registro (solo conteggi, nessun dato).
  (select count(*) from public.studyos_agent_grants where revoked_at is null) as active_grants,
  (select count(*) from public.studyos_agent_audit) as audit_entries;
