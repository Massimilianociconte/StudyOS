-- Controllo in sola lettura dopo aver eseguito people.sql nel SQL Editor.
-- Atteso: ogni colonna *_ready è true. pg_net_ready e vault_ready diventano true solo con pg_net
-- attivo e i due segreti in Vault (studyos_push_secret, studyos_push_url): senza, le notifiche
-- push restano spente e il resto funziona. I privilegi si controllano perché i valori predefiniti
-- del progetto possono riaprirli; i valori mancanti (funzione o tabella assente) contano come
-- "non pronto".
select
  to_regclass('public.studyos_profiles') is not null
    and to_regclass('public.studyos_person_lookups') is not null
    and to_regclass('public.studyos_push_sends') is not null
    and to_regclass('public.studyos_push_subscriptions') is not null
    and to_regclass('public.studyos_migrations') is not null
    and exists (select 1 from information_schema.columns where table_schema = 'public'
      and table_name = 'studyos_group_invites' and column_name = 'recipient_user_id' and data_type = 'text')
    and exists (select 1 from information_schema.columns where table_schema = 'public'
      and table_name = 'studyos_share_invites' and column_name = 'recipient_user_id' and data_type = 'uuid')
    as tables_ready,
  (select count(*) from pg_class where relrowsecurity and oid in (
    to_regclass('public.studyos_profiles'), to_regclass('public.studyos_person_lookups'),
    to_regclass('public.studyos_push_subscriptions'), to_regclass('public.studyos_migrations'),
    to_regclass('public.studyos_push_sends'))) = 5 as rls_ready,
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'studyos_profiles') = 3
    and (select count(*) from pg_policies where schemaname = 'public' and tablename = 'studyos_push_subscriptions') = 4
    and not exists (select 1 from pg_policies where schemaname = 'public'
      and tablename in ('studyos_person_lookups', 'studyos_migrations', 'studyos_push_sends')) as policies_ready,
  to_regprocedure('public.find_person(text)') is not null
    and to_regprocedure('public.is_handle_available(text)') is not null
    and to_regprocedure('public.invite_person_to_group(text,uuid,text)') is not null
    and to_regprocedure('public.invite_person_to_share(uuid,text,jsonb,jsonb)') is not null
    and to_regprocedure('public.push_gone(text,text[])') is not null
    and to_regprocedure('public.studyos_push_notify(uuid[],text,text,text,text,text)') is not null as rpc_ready,
  coalesce(has_function_privilege('authenticated', to_regprocedure('public.find_person(text)'), 'EXECUTE')
    and has_function_privilege('authenticated', to_regprocedure('public.is_handle_available(text)'), 'EXECUTE')
    and has_function_privilege('authenticated', to_regprocedure('public.invite_person_to_group(text,uuid,text)'), 'EXECUTE')
    and has_function_privilege('authenticated', to_regprocedure('public.invite_person_to_share(uuid,text,jsonb,jsonb)'), 'EXECUTE'),
    false) as authenticated_rpc_ready,
  -- Chiuse ad anon tutte le RPC nuove tranne push_gone (la chiama il Worker con la chiave publishable).
  not coalesce(
    has_function_privilege('anon', to_regprocedure('public.find_person(text)'), 'EXECUTE')
    or has_function_privilege('anon', to_regprocedure('public.is_handle_available(text)'), 'EXECUTE')
    or has_function_privilege('anon', to_regprocedure('public.invite_person_to_group(text,uuid,text)'), 'EXECUTE')
    or has_function_privilege('anon', to_regprocedure('public.invite_person_to_share(uuid,text,jsonb,jsonb)'), 'EXECUTE')
    or has_function_privilege('anon', to_regprocedure('public.studyos_push_notify(uuid[],text,text,text,text,text)'), 'EXECUTE')
    or has_function_privilege('anon', to_regprocedure('public.studyos_person_lookup_guard()'), 'EXECUTE'),
    true) as anon_rpc_closed_ready,
  coalesce(has_function_privilege('anon', to_regprocedure('public.push_gone(text,text[])'), 'EXECUTE')
    and has_function_privilege('authenticated', to_regprocedure('public.push_gone(text,text[])'), 'EXECUTE'), false)
    as push_gone_ready,
  not coalesce(
    has_function_privilege('authenticated', to_regprocedure('public.studyos_push_notify(uuid[],text,text,text,text,text)'), 'EXECUTE')
    or has_function_privilege('authenticated', to_regprocedure('public.studyos_person_lookup_guard()'), 'EXECUTE')
    or has_function_privilege('authenticated', to_regprocedure('public.studyos_person_discoverable(uuid)'), 'EXECUTE'),
    true) as internal_rpc_private_ready,
  not coalesce(
    has_any_column_privilege('anon', to_regclass('public.studyos_profiles'), 'SELECT')
    or has_any_column_privilege('anon', to_regclass('public.studyos_push_subscriptions'), 'SELECT')
    or has_any_column_privilege('anon', to_regclass('public.studyos_person_lookups'), 'SELECT')
    or has_any_column_privilege('authenticated', to_regclass('public.studyos_person_lookups'), 'SELECT')
    or has_any_column_privilege('authenticated', to_regclass('public.studyos_migrations'), 'SELECT')
    or has_any_column_privilege('anon', to_regclass('public.studyos_push_sends'), 'SELECT')
    or has_any_column_privilege('authenticated', to_regclass('public.studyos_push_sends'), 'SELECT'),
    true) as tables_closed_ready,
  coalesce(has_column_privilege('authenticated', to_regclass('public.studyos_share_invites'), 'recipient_user_id', 'SELECT'), false)
    and not coalesce(has_column_privilege('authenticated', to_regclass('public.studyos_share_invites'), 'token_hash', 'SELECT'), true)
    as share_columns_ready,
  -- Inserimento diretto degli inviti di gruppo: solo senza destinatario (inviti con codice).
  coalesce((select with_check like '%(recipient_email IS NULL)%' and with_check like '%(recipient_user_id IS NULL)%'
    from pg_policies where schemaname = 'public' and tablename = 'studyos_group_invites'
      and policyname = 'studyos_group_invites_insert'), false) as group_invite_insert_ready,
  -- Accettazione solo per account: policy di lettura e funzioni non guardano più l'email.
  coalesce((select qual like '%recipient_user_id%' and qual not like '%recipient_email%' from pg_policies
      where schemaname = 'public' and tablename = 'studyos_group_invites' and policyname = 'studyos_group_invites_select'), false)
    and coalesce((select qual like '%recipient_user_id%' and qual not like '%recipient_email%' from pg_policies
      where schemaname = 'public' and tablename = 'studyos_share_invites' and policyname = 'studyos_share_invites_select'), false)
    and coalesce(pg_get_functiondef(to_regprocedure('public.accept_group_invite(text,text)'))
      like '%v_invite.recipient_user_id is distinct from auth.uid()::text%', false)
    and coalesce(pg_get_functiondef(to_regprocedure('public.accept_group_invite(text,text)')) not like '%recipient_email%', false)
    and coalesce(pg_get_functiondef(to_regprocedure('public.decline_group_invite(text)'))
      like '%v_invite.recipient_user_id is distinct from auth.uid()::text%', false)
    and coalesce(pg_get_functiondef(to_regprocedure('public.decline_group_invite(text)')) not like '%recipient_email%', false)
    and coalesce(pg_get_functiondef(to_regprocedure('public.studyos_claim_share_invite(uuid,text)'))
      like '%v_invite.recipient_user_id is distinct from auth.uid()%', false)
    and coalesce(pg_get_functiondef(to_regprocedure('public.create_share_invite(text,jsonb,jsonb,text)'))
      like '%Gli inviti per email non ci sono più%', false) as email_acceptance_closed_ready,
  coalesce((select count(distinct t.tgname) = 9 from pg_trigger t where not t.tgisinternal and (
    (t.tgrelid = to_regclass('public.studyos_profiles') and t.tgname = 'studyos_profiles_touch')
    or (t.tgrelid = to_regclass('public.studyos_push_subscriptions')
      and t.tgname in ('studyos_push_subscriptions_claim', 'studyos_push_subscriptions_cap'))
    or (t.tgrelid = to_regclass('public.studyos_group_invites') and t.tgname = 'studyos_group_invites_push')
    or (t.tgrelid = to_regclass('public.studyos_share_invites')
      and t.tgname in ('studyos_share_invites_push', 'studyos_share_invites_accepted_push'))
    or (t.tgrelid = to_regclass('public.studyos_group_members') and t.tgname = 'studyos_group_members_push')
    or (t.tgrelid = to_regclass('public.studyos_shares')
      and t.tgname in ('studyos_shares_permission_push', 'studyos_shares_removed_push')))), false) as triggers_ready,
  -- Le notifiche non bloccano mai la scrittura che le chiama.
  coalesce(pg_get_functiondef(to_regprocedure('public.studyos_push_notify(uuid[],text,text,text,text,text)'))
    like '%exception when others%', false) as push_safe_ready,
  exists (select 1 from public.studyos_migrations where name = 'people_email_invites') as migration_ready,
  -- Revisione del 12/11/2026 (sera). Nome di chi entra in un gruppo mai dall'email (groups.sql).
  coalesce(pg_get_functiondef(to_regprocedure('public.studyos_member_name(text,text)')) not like '%split_part%', false)
    as member_name_private_ready,
  -- Limite per IP solo con cf-connecting-ip: x-forwarded-for lo sceglie il client.
  coalesce(pg_get_functiondef(to_regprocedure('public.studyos_request_ip()')) not like '%x-forwarded-for%', false)
    as request_ip_ready,
  -- Nessun invito con un destinatario porta il codice del gruppo.
  coalesce(pg_get_functiondef(to_regprocedure('public.invite_person_to_group(text,uuid,text)')) not like '%invite_code%', false)
    and not exists (select 1 from public.studyos_group_invites i
      where i.code <> '' and (i.recipient_user_id is not null or i.recipient_email is not null)) as invite_code_hidden_ready,
  -- Un vecchio invito per email in attesa resta legato solo a chi aveva confermato quell'indirizzo
  -- prima dell'11/11/2026, quando la conferma email era obbligatoria.
  not exists (select 1 from public.studyos_group_invites i
    where i.status = 'pending' and i.recipient_email is not null and i.recipient_user_id is not null
      and not exists (select 1 from auth.users u
        where u.id::text = i.recipient_user_id and lower(u.email) = lower(i.recipient_email)
          and u.deleted_at is null and u.email_confirmed_at < timestamptz '2026-11-11 00:00:00+01'))
  and not exists (select 1 from public.studyos_share_invites i
    where i.status = 'pending' and i.recipient_email is not null and i.recipient_user_id is not null
      and not exists (select 1 from auth.users u
        where u.id = i.recipient_user_id and lower(u.email) = lower(i.recipient_email)
          and u.deleted_at is null and u.email_confirmed_at < timestamptz '2026-11-11 00:00:00+01'))
    as legacy_invites_safe_ready,
  -- Revisione B4: la pulizia una tantum dei nomi presi dalla parte dell'email prima della @ è stata
  -- fatta (segno names_from_email di people.sql). Dopo non si controllano più i nomi: chi sceglie apposta
  -- un nome uguale a quella parte lo tiene, e rieseguire people.sql non lo cambia.
  exists (select 1 from public.studyos_migrations where name = 'names_from_email')
    and to_regprocedure('public.studyos_name_without_email(uuid,text)') is not null as email_names_ready,
  -- Revisione del 12/11/2026 (promemoria con l'app chiusa): sessione e testo privato per iscrizione,
  -- sessione scritta dal server, account di ogni iscrizione nelle push (filtro del service worker).
  (select count(*) from information_schema.columns where table_schema = 'public'
    and table_name = 'studyos_push_subscriptions' and column_name in ('session_id', 'private')) = 2
    and exists (select 1 from pg_trigger where not tgisinternal
      and tgrelid = to_regclass('public.studyos_push_subscriptions') and tgname = 'studyos_push_subscriptions_session')
    and coalesce(pg_get_functiondef(to_regprocedure('public.studyos_push_notify(uuid[],text,text,text,text,text)'))
      like '%''account'', s.user_id%', false) as push_devices_ready,
  -- Facoltativo: false se il progetto non permette trigger su auth.sessions; allora le iscrizioni
  -- delle sessioni finite si tolgono alla prima notifica respinta (push_gone).
  exists (select 1 from pg_trigger where not tgisinternal
    and tgrelid = to_regclass('auth.sessions') and tgname = 'studyos_push_session_ended') as session_cleanup_ready,
  exists (select 1 from pg_extension where extname = 'pg_net')
    and exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'net' and p.proname = 'http_post') as pg_net_ready,
  -- Lettura dinamica: senza lo schema vault la query resta valida e risponde false.
  case when to_regclass('vault.decrypted_secrets') is null then false
    else (xpath('/row/n/text()', query_to_xml(
      'select count(distinct name) as n from vault.decrypted_secrets
        where name in (''studyos_push_secret'', ''studyos_push_url'') and coalesce(decrypted_secret, '''') <> ''''',
      false, true, '')))[1]::text = '2'
  end as vault_ready;
