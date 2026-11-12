-- Controllo in sola lettura dopo aver eseguito sharing.sql nel SQL Editor.
-- Atteso: ogni colonna *_ready è true, shared_item_policies vale 3 e own_item_policies vale 4.
-- token_hidden_ready, claim_private_ready, anon_rpc_closed_ready e anon_tables_closed_ready
-- controllano i privilegi che i valori predefiniti del progetto possono riaprire; light_history_ready
-- che la cronologia tenga copertine, file e sourceUid solo nelle eliminazioni.
select
  to_regclass('public.studyos_shares') is not null
    and to_regclass('public.studyos_share_invites') is not null
    and to_regclass('public.studyos_item_revisions') is not null as tables_ready,
  coalesce((select bool_and(relrowsecurity) from pg_class where oid in (
    to_regclass('public.studyos_shares'), to_regclass('public.studyos_share_invites'),
    to_regclass('public.studyos_item_revisions'))), false) as rls_ready,
  to_regprocedure('public.push_shared_rows(uuid,text,jsonb)') is not null
    and to_regprocedure('public.accept_share_invite(uuid,text,text,jsonb)') is not null
    and to_regprocedure('public.create_share_invite(text,jsonb,jsonb,text)') is not null
    and to_regprocedure('public.preview_share_invite(text)') is not null
    and to_regprocedure('public.decline_share_invite(uuid,text)') is not null
    and to_regprocedure('public.shared_subject_labels()') is not null as rpc_ready,
  coalesce(has_function_privilege('authenticated',
    to_regprocedure('public.push_shared_rows(uuid,text,jsonb)'), 'EXECUTE'), false) as authenticated_rpc_ready,
  not coalesce(has_column_privilege('authenticated', to_regclass('public.studyos_share_invites'), 'token_hash', 'SELECT'), true)
    as token_hidden_ready,
  -- Privilegi fragili: i valori mancanti (funzione o tabella assente) contano come "non pronto".
  not coalesce(has_function_privilege('authenticated',
    to_regprocedure('public.studyos_claim_share_invite(uuid,text)'), 'EXECUTE'), true) as claim_private_ready,
  not coalesce(
    has_function_privilege('anon', to_regprocedure('public.create_share_invite(text,jsonb,jsonb,text)'), 'EXECUTE')
    or has_function_privilege('anon', to_regprocedure('public.preview_share_invite(text)'), 'EXECUTE')
    or has_function_privilege('anon', to_regprocedure('public.accept_share_invite(uuid,text,text,jsonb)'), 'EXECUTE')
    or has_function_privilege('anon', to_regprocedure('public.decline_share_invite(uuid,text)'), 'EXECUTE')
    or has_function_privilege('anon', to_regprocedure('public.push_shared_rows(uuid,text,jsonb)'), 'EXECUTE')
    or has_function_privilege('anon', to_regprocedure('public.shared_subject_labels()'), 'EXECUTE'),
    true) as anon_rpc_closed_ready,
  not coalesce(
    has_any_column_privilege('anon', to_regclass('public.studyos_shares'), 'SELECT')
    or has_any_column_privilege('anon', to_regclass('public.studyos_share_invites'), 'SELECT')
    or has_any_column_privilege('anon', to_regclass('public.studyos_item_revisions'), 'SELECT'),
    true) as anon_tables_closed_ready,
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'studyos_items'
    and policyname in ('studyos_select_shared_items', 'studyos_insert_shared_items', 'studyos_update_shared_items'))
    as shared_item_policies,
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'studyos_items'
    and policyname in ('studyos_select_own_items', 'studyos_insert_own_items',
      'studyos_update_own_items', 'studyos_delete_own_items')) as own_item_policies,
  -- Trigger della condivisione sulle loro tabelle, più quello di schema.sql che riscrive updated_at e
  -- version in ogni modifica (anche di chi riceve).
  coalesce((select count(distinct t.tgname) = 6 from pg_trigger t where not t.tgisinternal and (
    (t.tgrelid = to_regclass('public.studyos_items') and t.tgname in (
      'studyos_items_revision', 'studyos_items_guard', 'studyos_items_recipient_values', 'studyos_items_updated_at'))
    or (t.tgrelid = to_regclass('public.studyos_shares') and t.tgname = 'studyos_shares_guard')
    or (t.tgrelid = to_regclass('public.studyos_group_members') and t.tgname = 'studyos_group_member_left'))), false)
    as triggers_ready,
  -- Valori scritti da chi riceve (chiavi protette, colori e link sicuri): funzione e trigger.
  to_regprocedure('public.studyos_recipient_payload(text,jsonb,jsonb)') is not null
    and exists (select 1 from pg_trigger where tgname = 'studyos_items_recipient_values') as recipient_values_ready,
  -- Cronologia leggera: copertine, file e sourceUid restano solo nelle eliminazioni. Anche il trigger
  -- deve essere quello nuovo: con il vecchio i dati sembrano a posto finché nessuno modifica nulla.
  to_regprocedure('public.studyos_without_protected(jsonb)') is not null
    and coalesce(pg_get_functiondef(to_regprocedure('public.studyos_items_revision()')) like '%studyos_without_protected%', false)
    and not exists (
      select 1 from public.studyos_item_revisions as revision, jsonb_object_keys(
        case when jsonb_typeof(revision.payload) = 'object' then revision.payload else '{}'::jsonb end
      ) as field (key)
      where revision.change <> 'delete' and field.key ~ '^(cover|dataUrl|storedFile|sourceUid|[A-Za-z]*DataUrl|__proto__)$'
    ) as light_history_ready,
  exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime'
    and schemaname = 'public' and tablename = 'studyos_shares') as realtime_ready,
  -- Appelli condivisi dei gruppi (group-exams.sql): tabelle con RLS, funzioni, privilegi, realtime, connettore.
  to_regclass('public.studyos_group_exam_sessions') is not null
    and to_regclass('public.studyos_group_catalog_overrides') is not null
    and to_regclass('public.studyos_group_history') is not null
    and coalesce((select bool_and(relrowsecurity) from pg_class where oid in (
      to_regclass('public.studyos_group_exam_sessions'), to_regclass('public.studyos_group_catalog_overrides'),
      to_regclass('public.studyos_group_history'))), false) as group_exams_tables_ready,
  to_regprocedure('public.save_group_exam_session(text,text,integer,jsonb)') is not null
    and to_regprocedure('public.delete_group_exam_session(text,integer)') is not null
    and to_regprocedure('public.save_group_catalog_override(text,text,integer,text,text,text,jsonb)') is not null
    and to_regprocedure('public.delete_group_catalog_override(text,integer)') is not null
    and to_regprocedure('public.restore_group_record(bigint,integer)') is not null
    -- Tutte e cinque le funzioni le può eseguire chi ha fatto l'accesso.
    and coalesce((select bool_and(coalesce(has_function_privilege('authenticated', f, 'EXECUTE'), false))
      from unnest(array[
        to_regprocedure('public.save_group_exam_session(text,text,integer,jsonb)'),
        to_regprocedure('public.delete_group_exam_session(text,integer)'),
        to_regprocedure('public.save_group_catalog_override(text,text,integer,text,text,text,jsonb)'),
        to_regprocedure('public.delete_group_catalog_override(text,integer)'),
        to_regprocedure('public.restore_group_record(bigint,integer)')]) as f), false) as group_exams_rpc_ready,
  -- Si scrive solo con le funzioni: niente anon su nulla, nessuna scrittura diretta (INSERT, UPDATE, DELETE,
  -- TRUNCATE) per chi ha fatto l'accesso, funzioni interne chiuse a tutti.
  coalesce((select bool_and(not coalesce(has_function_privilege('anon', f, 'EXECUTE'), true))
      from unnest(array[
        to_regprocedure('public.save_group_exam_session(text,text,integer,jsonb)'),
        to_regprocedure('public.delete_group_exam_session(text,integer)'),
        to_regprocedure('public.save_group_catalog_override(text,text,integer,text,text,text,jsonb)'),
        to_regprocedure('public.delete_group_catalog_override(text,integer)'),
        to_regprocedure('public.restore_group_record(bigint,integer)')]) as f), false)
    and coalesce((select bool_and(
        not coalesce(has_table_privilege('authenticated', t, 'INSERT, UPDATE, DELETE, TRUNCATE'), true)
        and not coalesce(has_table_privilege('anon', t, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE'), true))
      from unnest(array[
        to_regclass('public.studyos_group_exam_sessions'),
        to_regclass('public.studyos_group_catalog_overrides'),
        to_regclass('public.studyos_group_history')]) as t), false)
    and coalesce((select bool_and(
        f is not null
        and not coalesce(has_function_privilege('authenticated', f, 'EXECUTE'), true)
        and not coalesce(has_function_privilege('anon', f, 'EXECUTE'), true))
      from unnest(array[
        to_regprocedure('public.studyos_group_member_name(text)'),
        to_regprocedure('public.studyos_group_write_gate(text)'),
        to_regprocedure('public.studyos_group_history_write(text,text,text,text,integer,jsonb,jsonb,text[],text)'),
        to_regprocedure('public.studyos_group_activity_write(text,text,text)'),
        to_regprocedure('public.studyos_exam_session_twin(text,jsonb,text)'),
        to_regprocedure('public.studyos_hide_emails(text,boolean)'),
        to_regprocedure('public.studyos_email_normalize(text)'),
        to_regprocedure('public.studyos_fields_only_unimi(jsonb)')]) as f), false)
    as group_exams_closed_ready,
  exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = 'studyos_group_exam_sessions')
    and exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = 'studyos_group_catalog_overrides') as group_exams_realtime_ready,
  -- Il connettore remoto: la funzione dello snapshot e quella che riconosce il segreto (agent.sql).
  to_regprocedure('public.studyos_agent_group_snapshot(text)') is not null
    and to_regprocedure('public.studyos_agent_user(text)') is not null as group_exams_agent_ready,
  -- La guardia sulle righe dei membri (groups.sql: l'account e il gruppo di una riga non cambiano) e la forma degli id dei gruppi.
  exists (select 1 from pg_trigger where tgrelid = to_regclass('public.studyos_group_members')
      and tgname = 'studyos_group_members_pin_identity' and not tgisinternal and tgenabled <> 'D')
    and exists (select 1 from pg_constraint where conrelid = to_regclass('public.studyos_groups')
      and conname = 'studyos_groups_id_shape') as group_exams_members_pinned_ready;
