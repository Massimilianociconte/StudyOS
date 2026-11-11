-- StudyOS: ricerca persone, inviti all'account e notifiche push (migrazione opzionale).
--
-- Da eseguire nel SQL Editor DOPO schema.sql, groups.sql e sharing.sql, come un unico script.
-- Rieseguibile: tabelle e righe restano, funzioni, policy e trigger si aggiornano; la migrazione
-- degli inviti per email gira una volta sola.
--
-- Conferma email spenta (11/11/2026): un indirizzo non prova più chi lo usa. Gli inviti nominali
-- valgono solo per l'account destinatario (recipient_user_id) e non se ne creano più per email.
-- Le policy e le funzioni di groups.sql e sharing.sql toccate qui sono identiche in quei due file:
-- rieseguire uno qualsiasi dei tre non riapre l'accettazione per email.
--
-- Notifiche push: servono pg_net e due segreti in Vault (studyos_push_secret, studyos_push_url).
-- Senza, nessuna notifica parte e tutto il resto funziona. Vedi supabase/README.md.

do $$
begin
  if to_regclass('public.studyos_items') is null then
    raise exception 'Esegui prima supabase/schema.sql';
  end if;
  if to_regclass('public.studyos_group_invites') is null then
    raise exception 'Esegui prima supabase/groups.sql';
  end if;
  if to_regclass('public.studyos_share_invites') is null then
    raise exception 'Esegui prima supabase/sharing.sql';
  end if;
end $$;

-- pg_net: richieste HTTP asincrone, spedite solo dopo il commit. Se l'estensione non si può
-- attivare lo script prosegue senza notifiche push; people-verify.sql lo segnala.
do $$
begin
  create extension if not exists pg_net with schema extensions;
exception when others then
  raise notice 'pg_net non disponibile, notifiche push spente: %', sqlerrm;
end $$;

-- ─── Tabelle ────────────────────────────────────────────────────────────────

-- Profilo online: nome visibile, @nome facoltativo e "Gli altri possono trovarmi". Una riga mancante
-- vale "trovabile, senza nome né @nome". Nessuna lettura pubblica: la ricerca passa da find_person.
create table if not exists public.studyos_profiles (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  display_name text not null default '',
  handle text,
  discoverable boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.studyos_profiles drop constraint if exists studyos_profiles_display_name_check;
alter table public.studyos_profiles add constraint studyos_profiles_display_name_check
  check (char_length(display_name) <= 60);
alter table public.studyos_profiles drop constraint if exists studyos_profiles_handle_check;
alter table public.studyos_profiles add constraint studyos_profiles_handle_check
  check (handle ~ '^[a-z0-9_.]{3,24}$');
create unique index if not exists studyos_profiles_handle_key on public.studyos_profiles (handle);

-- Registro delle ricerche (find_person e is_handle_available) per i limiti: 30 al minuto per account,
-- 60 al minuto per indirizzo IP. Le righe più vecchie di un'ora si cancellano a ogni ricerca.
create table if not exists public.studyos_person_lookups (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  ip text,
  at timestamptz not null default now()
);
create index if not exists studyos_person_lookups_user_idx on public.studyos_person_lookups (user_id, at);
create index if not exists studyos_person_lookups_ip_idx on public.studyos_person_lookups (ip, at) where ip is not null;
create index if not exists studyos_person_lookups_at_idx on public.studyos_person_lookups (at);

-- Iscrizioni Web Push, una per browser. Il client fa upsert su endpoint.
create table if not exists public.studyos_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

alter table public.studyos_push_subscriptions drop constraint if exists studyos_push_subscriptions_values_check;
alter table public.studyos_push_subscriptions add constraint studyos_push_subscriptions_values_check
  check (
    endpoint ~ '^https://' and char_length(endpoint) <= 2048
    and p256dh ~ '^[A-Za-z0-9_-]{80,100}={0,2}$'
    and auth ~ '^[A-Za-z0-9_-]{16,32}={0,2}$'
  );
create index if not exists studyos_push_subscriptions_user_idx
  on public.studyos_push_subscriptions (user_id, last_seen_at desc);

-- Registro delle notifiche push mandate per conto di chi agisce (studyos_push_notify): al massimo 30
-- all'ora per account. Nessuna policy: lo toccano solo le funzioni DEFINER.
create table if not exists public.studyos_push_sends (
  user_id uuid not null,
  at timestamptz not null default now()
);
create index if not exists studyos_push_sends_user_idx on public.studyos_push_sends (user_id, at);

-- Interventi una tantum già eseguiti (per ora la migrazione degli inviti per email).
create table if not exists public.studyos_migrations (
  name text primary key,
  done_at timestamptz not null default now()
);

-- Destinatario di un invito nominale: l'id dell'account (testo, come from_user_id). Gli inviti per
-- sola email restano solo come storico: non si creano né si accettano più.
alter table public.studyos_group_invites add column if not exists recipient_user_id text;
create index if not exists studyos_group_invites_recipient_user_idx
  on public.studyos_group_invites (recipient_user_id, status);
-- Un solo invito in attesa per persona e gruppo, anche con due richieste contemporanee.
create unique index if not exists studyos_group_invites_pending_person_key
  on public.studyos_group_invites (group_id, recipient_user_id)
  where status = 'pending' and recipient_user_id is not null;

-- Destinatario di un invito all'account (invite_person_to_share in people.sql). Gli inviti per sola
-- email restano solo come storico: non si creano né si accettano più.
alter table public.studyos_share_invites
  add column if not exists recipient_user_id uuid references auth.users (id) on delete cascade;
create index if not exists studyos_share_invites_recipient_user_idx
  on public.studyos_share_invites (recipient_user_id, status);

-- ─── RLS e privilegi delle nuove tabelle ────────────────────────────────────

alter table public.studyos_profiles enable row level security;
alter table public.studyos_person_lookups enable row level security;
alter table public.studyos_push_subscriptions enable row level security;
alter table public.studyos_push_sends enable row level security;
alter table public.studyos_migrations enable row level security;

-- I privilegi predefiniti del progetto danno tutto ad anon e authenticated: si tolgono e si concede
-- solo il necessario. Registro e migrazioni non hanno policy: li toccano solo le funzioni DEFINER.
revoke all on table public.studyos_profiles from anon, authenticated;
revoke all on table public.studyos_person_lookups from anon, authenticated;
revoke all on table public.studyos_push_subscriptions from anon, authenticated;
revoke all on table public.studyos_push_sends from public, anon, authenticated;
revoke all on table public.studyos_migrations from anon, authenticated;
grant select, insert, update on table public.studyos_profiles to authenticated;
grant select, insert, update, delete on table public.studyos_push_subscriptions to authenticated;

drop policy if exists studyos_profiles_select on public.studyos_profiles;
create policy studyos_profiles_select on public.studyos_profiles for select to authenticated
  using (user_id = (select auth.uid()));
drop policy if exists studyos_profiles_insert on public.studyos_profiles;
create policy studyos_profiles_insert on public.studyos_profiles for insert to authenticated
  with check (user_id = (select auth.uid()));
drop policy if exists studyos_profiles_update on public.studyos_profiles;
create policy studyos_profiles_update on public.studyos_profiles for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists studyos_push_subscriptions_select on public.studyos_push_subscriptions;
create policy studyos_push_subscriptions_select on public.studyos_push_subscriptions for select to authenticated
  using (user_id = (select auth.uid()));
drop policy if exists studyos_push_subscriptions_insert on public.studyos_push_subscriptions;
create policy studyos_push_subscriptions_insert on public.studyos_push_subscriptions for insert to authenticated
  with check (user_id = (select auth.uid()));
drop policy if exists studyos_push_subscriptions_update on public.studyos_push_subscriptions;
create policy studyos_push_subscriptions_update on public.studyos_push_subscriptions for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
drop policy if exists studyos_push_subscriptions_delete on public.studyos_push_subscriptions;
create policy studyos_push_subscriptions_delete on public.studyos_push_subscriptions for delete to authenticated
  using (user_id = (select auth.uid()));

-- Proprietario e data di creazione di un profilo non cambiano; updated_at lo scrive il server.
create or replace function public.studyos_profiles_touch()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  new.user_id := old.user_id;
  new.created_at := old.created_at;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists studyos_profiles_touch on public.studyos_profiles;
create trigger studyos_profiles_touch
before update on public.studyos_profiles
for each row execute function public.studyos_profiles_touch();

-- Un browser ha un solo endpoint: se un altro account lo registra (stesso dispositivo, account
-- cambiato), la riga del precedente sparisce e le sue notifiche non arrivano più lì. Conoscere
-- l'endpoint vuol dire avere quel browser: nessun altro lo legge.
create or replace function public.studyos_push_subscriptions_claim()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.studyos_push_subscriptions
  where endpoint = new.endpoint and user_id is distinct from new.user_id;
  return new;
end;
$$;

drop trigger if exists studyos_push_subscriptions_claim on public.studyos_push_subscriptions;
create trigger studyos_push_subscriptions_claim
before insert on public.studyos_push_subscriptions
for each row execute function public.studyos_push_subscriptions_claim();

-- Al massimo 10 iscrizioni per account: le più vecchie (ultimo uso) si cancellano.
create or replace function public.studyos_push_subscriptions_cap()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.studyos_push_subscriptions
  where id in (
    select s.id from public.studyos_push_subscriptions s
    where s.user_id = new.user_id
    order by s.last_seen_at desc, s.created_at desc, s.id
    offset 10
  );
  return null;
end;
$$;

drop trigger if exists studyos_push_subscriptions_cap on public.studyos_push_subscriptions;
create trigger studyos_push_subscriptions_cap
after insert on public.studyos_push_subscriptions
for each row execute function public.studyos_push_subscriptions_cap();

-- ─── Funzioni di appoggio (interne) ─────────────────────────────────────────

-- Testo → uuid, null se non è un uuid (gli id dei gruppi e dei membri sono testo).
create or replace function public.studyos_uuid(p_value text)
returns uuid
language sql
immutable
set search_path = pg_catalog
as $$
  select case
    when p_value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then p_value::uuid
  end
$$;

-- IP di chi chiama, dalle intestazioni che PostgREST espone in request.headers:
-- cf-connecting-ip, altrimenti il primo valore di x-forwarded-for. Null fuori da una richiesta API.
create or replace function public.studyos_request_ip()
returns text
language sql
stable
set search_path = pg_catalog
as $$
  select left(nullif(btrim(coalesce(
    nullif(btrim(request.headers ->> 'cf-connecting-ip'), ''),
    split_part(coalesce(request.headers ->> 'x-forwarded-for', ''), ',', 1)
  )), ''), 64)
  from (
    select case
      when coalesce(current_setting('request.headers', true), '') like '{%'
        then current_setting('request.headers', true)::jsonb
      else '{}'::jsonb
    end as headers
  ) as request
$$;

-- Account esistente e trovabile (una riga di profilo mancante vale "trovabile").
create or replace function public.studyos_person_discoverable(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from auth.users u where u.id = p_user and u.deleted_at is null)
    and coalesce((select p.discoverable from public.studyos_profiles p where p.user_id = p_user), true)
$$;

-- Limiti delle ricerche: registra la ricerca o risponde "Troppe ricerche". Una ricerca rifiutata
-- non si registra (l'errore annulla tutto), quindi dopo un minuto si riparte.
create or replace function public.studyos_person_lookup_guard()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ip text := public.studyos_request_ip();
begin
  if auth.uid() is null then
    raise exception 'Accesso richiesto';
  end if;
  delete from public.studyos_person_lookups l where l.at < now() - interval '1 hour';
  if (
    select count(*) from public.studyos_person_lookups l
    where l.user_id = auth.uid() and l.at > now() - interval '1 minute'
  ) >= 30 or (
    v_ip is not null and (
      select count(*) from public.studyos_person_lookups l
      where l.ip = v_ip and l.at > now() - interval '1 minute'
    ) >= 60
  ) then
    raise exception 'Troppe ricerche, riprova tra un minuto';
  end if;
  insert into public.studyos_person_lookups (user_id, ip) values (auth.uid(), v_ip);
end;
$$;

-- Nomi delle sezioni nelle notifiche: specchio di SHARE_SCOPE_LABEL in src/lib/labels.ts.
create or replace function public.studyos_scope_label(p_scope text)
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select case p_scope
    when 'calendar' then 'Calendario'
    when 'barb_exams' then 'Appelli ufficiali'
    when 'tasks' then 'Attività'
    when 'study' then 'Studio'
    when 'progress' then 'Progressi'
    when 'materials' then 'Materiali'
    when 'goals' then 'Obiettivi'
    else 'Dati'
  end
$$;

-- Chi riceve una condivisione: la persona, oppure i membri del gruppo (al massimo 50, mai il
-- proprietario).
create or replace function public.studyos_share_audience(p_owner uuid, p_user uuid, p_group text)
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_user is not null then array[p_user]
    when p_group is null then '{}'::uuid[]
    else array(
      select public.studyos_uuid(m.user_id)
      from public.studyos_group_members m
      where m.group_id = p_group and m.user_id is distinct from p_owner::text
      order by m.joined_at, m.user_id
      limit 50
    )
  end
$$;

-- ─── Ricerca ────────────────────────────────────────────────────────────────

-- Una persona per email esatta (senza maiuscole) o @nome esatto. Mai sé stessi, mai l'email nel
-- risultato. Inesistente e non trovabile danno la stessa risposta: nessuna riga.
create or replace function public.find_person(p_query text)
returns table (person_id uuid, display_name text, handle text)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_query text := lower(btrim(coalesce(p_query, '')));
  v_id uuid;
begin
  perform public.studyos_person_lookup_guard();
  if char_length(v_query) > 320 then
    return;
  end if;
  if v_query ~ '^@?[a-z0-9_.]{3,24}$' then
    select p.user_id into v_id from public.studyos_profiles p where p.handle = ltrim(v_query, '@');
  elsif v_query ~ '^[^@[:space:]]+@[^@[:space:]]+$' then
    select u.id into v_id from auth.users u
    where lower(u.email) = v_query and u.deleted_at is null
    limit 1;
  else
    return;
  end if;
  if v_id is null or v_id = auth.uid() or not public.studyos_person_discoverable(v_id) then
    return;
  end if;
  return query
    select v_id, coalesce(p.display_name, ''), p.handle
    from (select 1) as one
    left join public.studyos_profiles p on p.user_id = v_id;
end;
$$;

-- @nome libero (o già mio). Conta nei limiti delle ricerche: senza, servirebbe a sondare i nomi.
create or replace function public.is_handle_available(p_handle text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_handle text := ltrim(lower(btrim(coalesce(p_handle, ''))), '@');
begin
  perform public.studyos_person_lookup_guard();
  if v_handle !~ '^[a-z0-9_.]{3,24}$' then
    return false;
  end if;
  return not exists (
    select 1 from public.studyos_profiles p
    where p.handle = v_handle and p.user_id <> auth.uid()
  );
end;
$$;

-- ─── Inviti di gruppo all'account ───────────────────────────────────────────
-- Policy e funzioni identiche a groups.sql (rieseguire l'uno o l'altro dà lo stesso risultato).

-- Inviti: il destinatario (per account, mai per email) legge i propri; i membri vedono gli inviti
-- del gruppo; chi invita vede quelli che ha mandato.
drop policy if exists studyos_group_invites_select on public.studyos_group_invites;
create policy studyos_group_invites_select on public.studyos_group_invites for select to authenticated
  using (
    recipient_user_id = auth.uid()::text
    or public.studyos_is_group_member(group_id)
    or from_user_id = auth.uid()::text
  );
-- Inserimento diretto (proprietario o amministratore) solo per gli inviti con codice, senza
-- destinatario. L'invito a una persona passa da invite_person_to_group (people.sql), che controlla
-- che sia trovabile e non già nel gruppo.
drop policy if exists studyos_group_invites_insert on public.studyos_group_invites;
create policy studyos_group_invites_insert on public.studyos_group_invites for insert to authenticated
  with check (
    public.studyos_group_role(group_id) in ('owner', 'admin')
    and from_user_id = auth.uid()::text
    and status = 'pending'
    and recipient_email is null
    and recipient_user_id is null
  );

-- Accetta un invito nominale: solo l'account destinatario (recipient_user_id). Con la conferma email
-- spenta l'indirizzo non prova chi lo usa e non conta più. Prima si chiude l'invito, poi entra il
-- membro: il trigger delle notifiche (people.sql) trova così chi aveva invitato.
create or replace function public.accept_group_invite(p_invite_id text, p_display_name text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite public.studyos_group_invites%rowtype;
  v_name text := public.studyos_member_name(p_display_name, lower(auth.jwt() ->> 'email'));
begin
  if auth.uid() is null then
    raise exception 'Accesso richiesto';
  end if;
  select * into v_invite from public.studyos_group_invites where id = p_invite_id for update;
  if not found then
    raise exception 'Invito non trovato';
  end if;
  -- is distinct from: un invito senza destinatario (null) non si accetta mai da qui.
  if v_invite.recipient_user_id is distinct from auth.uid()::text then
    raise exception 'Invito destinato a un altro account';
  end if;
  if v_invite.status <> 'pending' then
    raise exception 'Invito già gestito';
  end if;
  update public.studyos_group_invites
    set status = 'accepted', updated_at = now()
    where id = p_invite_id;
  insert into public.studyos_group_members (group_id, user_id, email, display_name, role)
  values (v_invite.group_id, auth.uid()::text, null, v_name, 'member')
  on conflict (group_id, user_id) do nothing;
  insert into public.studyos_group_activity (id, group_id, actor_display_name, text)
  values ('activity-' || p_invite_id, v_invite.group_id, v_name, 'è entrato nel gruppo')
  on conflict (id) do nothing;
end;
$$;

-- Rifiuta un invito nominale: solo l'account destinatario, come accept_group_invite.
create or replace function public.decline_group_invite(p_invite_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite public.studyos_group_invites%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Accesso richiesto';
  end if;
  select * into v_invite from public.studyos_group_invites where id = p_invite_id for update;
  if not found then
    raise exception 'Invito non trovato';
  end if;
  if v_invite.recipient_user_id is distinct from auth.uid()::text then
    raise exception 'Invito destinato a un altro account';
  end if;
  if v_invite.status <> 'pending' then
    raise exception 'Invito già gestito';
  end if;
  update public.studyos_group_invites
    set status = 'declined', updated_at = now()
    where id = p_invite_id;
end;
$$;

-- Invita una persona trovata con find_person: proprietario o amministratore, persona trovabile, non
-- già nel gruppo, un solo invito in attesa. Codice = codice del gruppo, come gli inviti del client.
create or replace function public.invite_person_to_group(
  p_group_id text,
  p_person_id uuid,
  p_display_name text default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group public.studyos_groups%rowtype;
  v_from text;
  v_id text := 'groupInvite_' || replace(gen_random_uuid()::text, '-', '');
begin
  if auth.uid() is null then
    raise exception 'Accesso richiesto';
  end if;
  if coalesce(public.studyos_group_role(p_group_id), '') not in ('owner', 'admin') then
    raise exception 'Solo proprietario e amministratori possono invitare';
  end if;
  select * into v_group from public.studyos_groups where id = p_group_id;
  if p_person_id is null or not public.studyos_person_discoverable(p_person_id) then
    raise exception 'Nessuna persona trovata';
  end if;
  if exists (
    select 1 from public.studyos_group_members m
    where m.group_id = p_group_id and m.user_id = p_person_id::text
  ) then
    raise exception 'È già nel gruppo';
  end if;
  if exists (
    select 1 from public.studyos_group_invites i
    where i.group_id = p_group_id and i.recipient_user_id = p_person_id::text and i.status = 'pending'
  ) then
    raise exception 'Ha già un invito';
  end if;
  select left(coalesce(nullif(btrim(p_display_name), ''), nullif(btrim(m.display_name), ''), 'Studente'), 80)
  into v_from
  from public.studyos_group_members m
  where m.group_id = p_group_id and m.user_id = auth.uid()::text;
  begin
    insert into public.studyos_group_invites
      (id, group_id, group_name, group_description, from_user_id, from_display_name,
       recipient_email, recipient_user_id, code, status)
    values (
      v_id, p_group_id, v_group.name, nullif(v_group.description, ''), auth.uid()::text, v_from,
      null, p_person_id::text, upper(v_group.invite_code), 'pending'
    );
  exception when unique_violation then
    raise exception 'Ha già un invito';
  end;
  return v_id;
end;
$$;

-- ─── Inviti di condivisione all'account ─────────────────────────────────────
-- Policy e funzioni identiche a sharing.sql.

drop policy if exists studyos_share_invites_select on public.studyos_share_invites;
create policy studyos_share_invites_select on public.studyos_share_invites
for select to authenticated
using (
  owner_id = (select auth.uid())
  or (status = 'pending' and recipient_user_id = (select auth.uid()))
);

grant select (recipient_user_id) on table public.studyos_share_invites to authenticated;

-- Invito via link (token). Gli inviti per email non si creano più: con la conferma email spenta un
-- indirizzo non prova chi lo usa. Per un account c'è invite_person_to_share (people.sql).
-- p_recipient_email resta nella firma per i client vecchi: se non è vuoto la richiesta è rifiutata.
create or replace function public.create_share_invite(
  p_owner_name text,
  p_offers jsonb,
  p_requests jsonb default '[]'::jsonb,
  p_recipient_email text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Accesso richiesto';
  end if;
  if nullif(btrim(coalesce(p_recipient_email, '')), '') is not null then
    raise exception 'Gli inviti per email non ci sono più: cerca la persona';
  end if;
  perform public.studyos_validate_share_items(p_offers, true);
  perform public.studyos_validate_share_items(coalesce(p_requests, '[]'::jsonb), false);
  if (
    select count(*) from public.studyos_share_invites
    where owner_id = auth.uid() and status = 'pending' and expires_at > now()
  ) >= 50 then
    raise exception 'Troppi inviti in attesa: annullane qualcuno';
  end if;
  insert into public.studyos_share_invites (owner_id, owner_name, offers, requests, token_hash)
  values (
    auth.uid(),
    public.studyos_share_name(p_owner_name),
    p_offers,
    coalesce(p_requests, '[]'::jsonb),
    sha256(convert_to(v_token, 'UTF8'))
  )
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'token', v_token);
end;
$$;

-- Anteprima di un invito via link. Un vecchio invito per sola email che la migrazione non ha legato
-- a un account risulta scaduto; for_other_account vale per gli inviti legati a un altro account.
create or replace function public.preview_share_invite(p_token text)
returns table (
  invite_id uuid,
  owner_name text,
  offers jsonb,
  requests jsonb,
  expires_at timestamptz,
  status text,
  for_other_account boolean,
  is_own boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    i.id,
    i.owner_name,
    i.offers,
    i.requests,
    i.expires_at,
    case
      when i.status = 'pending'
        and (i.expires_at <= now() or (i.recipient_user_id is null and i.recipient_email is not null))
        then 'expired'
      else i.status
    end,
    i.recipient_user_id is not null and i.recipient_user_id is distinct from auth.uid(),
    i.owner_id = auth.uid()
  from public.studyos_share_invites i
  where auth.uid() is not null
    and p_token ~ '^[0-9a-f]{64}$'
    and i.token_hash = sha256(convert_to(p_token, 'UTF8'))
$$;

-- Verifica l'invito per chi lo apre. Invito all'account (recipient_user_id): vale solo per quell'account
-- e il token da solo non basta. Vecchio invito per sola email non legato a un account: non si accetta
-- più. Invito via link: serve il token.
create or replace function public.studyos_claim_share_invite(p_invite_id uuid, p_token text)
returns public.studyos_share_invites
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite public.studyos_share_invites%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Accesso richiesto';
  end if;
  select * into v_invite from public.studyos_share_invites where id = p_invite_id for update;
  if not found then
    raise exception 'Invito non trovato';
  end if;
  if v_invite.owner_id = auth.uid() then
    raise exception 'È un tuo invito: mandalo a un''altra persona';
  end if;
  if v_invite.status <> 'pending' then
    raise exception 'Invito già usato';
  end if;
  if v_invite.expires_at <= now() then
    raise exception 'Invito scaduto: chiedine uno nuovo';
  end if;
  if v_invite.recipient_user_id is not null then
    if v_invite.recipient_user_id is distinct from auth.uid() then
      raise exception 'Invito destinato a un altro account';
    end if;
  elsif v_invite.recipient_email is not null then
    raise exception 'Invito scaduto: chiedine uno nuovo';
  elsif p_token is null or v_invite.token_hash <> sha256(convert_to(p_token, 'UTF8')) then
    raise exception 'Link di invito non valido';
  end if;
  return v_invite;
end;
$$;

-- Invita una persona trovata con find_person a vedere o modificare i propri dati. Nessun token nella
-- risposta: accetta solo l'account destinatario. Un nuovo invito alla stessa persona, mentre il
-- precedente è ancora in attesa, ne aggiorna il contenuto (niente doppioni né notifiche ripetute).
create or replace function public.invite_person_to_share(
  p_person_id uuid,
  p_owner_name text,
  p_offers jsonb,
  p_requests jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Accesso richiesto';
  end if;
  if p_person_id = auth.uid() then
    raise exception 'Non puoi invitare te stesso';
  end if;
  if p_person_id is null or not public.studyos_person_discoverable(p_person_id) then
    raise exception 'Nessuna persona trovata';
  end if;
  perform public.studyos_validate_share_items(p_offers, true);
  perform public.studyos_validate_share_items(coalesce(p_requests, '[]'::jsonb), false);
  select i.id into v_id
  from public.studyos_share_invites i
  where i.owner_id = auth.uid() and i.recipient_user_id = p_person_id
    and i.status = 'pending' and i.expires_at > now()
  order by i.created_at desc
  limit 1
  for update;
  if found then
    update public.studyos_share_invites
    set owner_name = public.studyos_share_name(p_owner_name),
        offers = p_offers,
        requests = coalesce(p_requests, '[]'::jsonb),
        expires_at = now() + interval '14 days'
    where id = v_id;
    return jsonb_build_object('id', v_id);
  end if;
  if (
    select count(*) from public.studyos_share_invites
    where owner_id = auth.uid() and status = 'pending' and expires_at > now()
  ) >= 50 then
    raise exception 'Troppi inviti in attesa: annullane qualcuno';
  end if;
  -- token_hash è obbligatorio e unico: un token casuale che nessuno riceve.
  insert into public.studyos_share_invites (owner_id, owner_name, offers, requests, recipient_user_id, token_hash)
  values (
    auth.uid(),
    public.studyos_share_name(p_owner_name),
    p_offers,
    coalesce(p_requests, '[]'::jsonb),
    p_person_id,
    sha256(convert_to(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 'UTF8'))
  )
  returning id into v_id;
  return jsonb_build_object('id', v_id);
end;
$$;

-- ─── Migrazione una tantum: inviti pendenti per sola email → account ────────
-- Gira una volta sola (segno in studyos_migrations): un account registrato dopo con quell'indirizzo
-- non riceve inviti vecchi. Gli inviti legati qui restano da accettare; gli altri non sono più
-- accettabili. Nessuna notifica push: si aggiornano righe esistenti, i trigger guardano gli insert.
do $$
begin
  if exists (select 1 from public.studyos_migrations where name = 'people_email_invites') then
    return;
  end if;

  update public.studyos_group_invites i
  set recipient_user_id = pick.user_id, updated_at = now()
  from (
    select distinct on (gi.group_id, u.id) gi.id, u.id::text as user_id
    from public.studyos_group_invites gi
    join auth.users u on lower(u.email) = lower(gi.recipient_email) and u.deleted_at is null
    where gi.status = 'pending' and gi.recipient_user_id is null and gi.recipient_email is not null
      and not exists (
        select 1 from public.studyos_group_invites other
        where other.group_id = gi.group_id and other.recipient_user_id = u.id::text and other.status = 'pending'
      )
      and not exists (
        select 1 from public.studyos_group_members m
        where m.group_id = gi.group_id and m.user_id = u.id::text
      )
    order by gi.group_id, u.id, gi.created_at desc
  ) as pick
  where i.id = pick.id;

  update public.studyos_share_invites i
  set recipient_user_id = u.id
  from auth.users u
  where i.status = 'pending' and i.recipient_user_id is null and i.recipient_email is not null
    and lower(u.email) = lower(i.recipient_email) and u.deleted_at is null and u.id <> i.owner_id;

  insert into public.studyos_migrations (name) values ('people_email_invites');
end $$;

-- ─── Notifiche push ─────────────────────────────────────────────────────────

-- Manda una notifica agli account indicati, tranne chi compie l'azione (auth.uid()) e senza
-- doppioni: raccoglie le loro iscrizioni e chiama il Worker (POST studyos_push_url, intestazione
-- x-studyos-push-secret) con pg_net, al massimo 40 iscrizioni per richiesta: il Worker sul piano
-- Free ha 50 sottorichieste, una serve a push_gone. Testi tagliati ai limiti del Worker (titolo 120,
-- corpo 240, tag 200 caratteri; url solo tra i tre ammessi), altrimenti risponderebbe 400. pg_net
-- spedisce solo dopo il commit. Senza pg_net, senza segreti o con qualsiasi errore non fa nulla: mai
-- un errore che blocca la scrittura che l'ha chiamata. Non eseguibile dai client.
create or replace function public.studyos_push_notify(
  p_user_ids uuid[],
  p_kind text,
  p_title text,
  p_body text,
  p_url text,
  p_tag text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_users uuid[];
  v_secret text;
  v_url text;
  v_notification jsonb;
  v_batch jsonb;
begin
  begin
    v_users := array(
      select distinct t.u from unnest(coalesce(p_user_ids, '{}'::uuid[])) as t (u)
      where t.u is not null and t.u is distinct from auth.uid()
    );
    if cardinality(v_users) = 0 or coalesce(p_kind, '') not in ('invite', 'accepted', 'permission') then
      return;
    end if;
    if not exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'net' and p.proname = 'http_post'
    ) or to_regclass('vault.decrypted_secrets') is null then
      return;
    end if;
    select s.decrypted_secret into v_secret from vault.decrypted_secrets s
    where s.name = 'studyos_push_secret' order by s.created_at desc limit 1;
    select s.decrypted_secret into v_url from vault.decrypted_secrets s
    where s.name = 'studyos_push_url' order by s.created_at desc limit 1;
    if coalesce(v_secret, '') = '' or coalesce(v_url, '') !~ '^https?://' then
      return;
    end if;
    -- Limite di 30 notifiche all'ora per chi agisce, contro gli inviti ripetuti (invita, annulla,
    -- invita di nuovo) usati per riempire di notifiche un'altra persona. Oltre il limite non parte nulla.
    if auth.uid() is not null then
      delete from public.studyos_push_sends x where x.at < now() - interval '1 hour';
      if (select count(*) from public.studyos_push_sends x where x.user_id = auth.uid()) >= 30 then
        return;
      end if;
      insert into public.studyos_push_sends (user_id) values (auth.uid());
    end if;
    v_notification := jsonb_build_object(
      'kind', p_kind,
      'title', left(coalesce(p_title, ''), 120),
      'body', left(coalesce(p_body, ''), 240),
      'url', case when p_url in ('?apri=notifiche', '?apri=condivisione', '?apri=gruppi') then p_url else '?apri=notifiche' end,
      'tag', left(coalesce(nullif(p_tag, ''), p_kind), 200)
    );
    for v_batch in
      select jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth) order by s.rn)
      from (
        select sub.endpoint, sub.p256dh, sub.auth,
          row_number() over (order by sub.user_id, sub.created_at, sub.id) as rn
        from public.studyos_push_subscriptions sub
        where sub.user_id = any (v_users)
      ) as s
      group by (s.rn - 1) / 40
      order by (s.rn - 1) / 40
    loop
      perform net.http_post(
        url := v_url,
        body := jsonb_build_object('notification', v_notification, 'subscriptions', v_batch),
        params := '{}'::jsonb,
        headers := jsonb_build_object('content-type', 'application/json', 'x-studyos-push-secret', v_secret),
        timeout_milliseconds := 15000
      );
    end loop;
  exception when others then
    raise warning 'studyos_push_notify: %', sqlerrm;
  end;
end;
$$;

-- Il Worker comunica gli endpoint che rispondono 404/410: se il segreto coincide con Vault, quelle
-- iscrizioni si cancellano. Chiamabile con la chiave publishable (anon): il segreto è la protezione.
create or replace function public.push_gone(p_secret text, p_endpoints text[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_secret text;
  v_count integer;
begin
  if to_regclass('vault.decrypted_secrets') is not null then
    select s.decrypted_secret into v_secret from vault.decrypted_secrets s
    where s.name = 'studyos_push_secret' order by s.created_at desc limit 1;
  end if;
  -- Confronto tra hash: il tempo non dipende da quanti caratteri iniziali coincidono.
  if coalesce(v_secret, '') = '' or p_secret is null
     or sha256(convert_to(p_secret, 'UTF8')) <> sha256(convert_to(v_secret, 'UTF8')) then
    raise exception 'Non autorizzato';
  end if;
  if p_endpoints is null or cardinality(p_endpoints) = 0 then
    return 0;
  end if;
  if cardinality(p_endpoints) > 500 then
    raise exception 'Troppi indirizzi';
  end if;
  delete from public.studyos_push_subscriptions where endpoint = any (p_endpoints);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Invito di gruppo a una persona → il destinatario.
create or replace function public.studyos_push_group_invite()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    perform public.studyos_push_notify(
      array[public.studyos_uuid(new.recipient_user_id)],
      'invite',
      'Invito a un gruppo',
      left(coalesce(nullif(btrim(new.from_display_name), ''), 'Qualcuno'), 60)
        || ' ti invita nel gruppo ' || left(coalesce(nullif(btrim(new.group_name), ''), 'senza nome'), 80),
      '?apri=notifiche',
      'group-invite:' || new.id
    );
  exception when others then
    raise warning 'studyos_push_group_invite: %', sqlerrm;
  end;
  return null;
end;
$$;

drop trigger if exists studyos_group_invites_push on public.studyos_group_invites;
create trigger studyos_group_invites_push
after insert on public.studyos_group_invites
for each row when (new.recipient_user_id is not null)
execute function public.studyos_push_group_invite();

-- Invito di condivisione a una persona → il destinatario, con le sezioni offerte.
create or replace function public.studyos_push_share_invite()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    perform public.studyos_push_notify(
      array[new.recipient_user_id],
      'invite',
      'Invito a condividere',
      left(coalesce(nullif(btrim(new.owner_name), ''), 'Qualcuno'), 60) || ' vuole condividere con te: '
        || coalesce((
          select string_agg(public.studyos_scope_label(o.value ->> 'scope'), ', ' order by o.ordinality)
          from jsonb_array_elements(new.offers) with ordinality as o (value, ordinality)
        ), 'i suoi dati'),
      '?apri=notifiche',
      'share-invite:' || new.id
    );
  exception when others then
    raise warning 'studyos_push_share_invite: %', sqlerrm;
  end;
  return null;
end;
$$;

drop trigger if exists studyos_share_invites_push on public.studyos_share_invites;
create trigger studyos_share_invites_push
after insert on public.studyos_share_invites
for each row when (new.recipient_user_id is not null)
execute function public.studyos_push_share_invite();

-- Invito di condivisione accettato (con link, QR o all'account) → chi ha invitato.
create or replace function public.studyos_push_share_accepted()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
begin
  begin
    select s.grantee_name into v_name
    from public.studyos_shares s
    where s.owner_id = new.owner_id and s.grantee_user_id = new.accepted_by
    order by s.updated_at desc
    limit 1;
    v_name := coalesce(
      nullif(btrim(v_name), ''),
      (select nullif(btrim(p.display_name), '') from public.studyos_profiles p where p.user_id = new.accepted_by),
      'Una persona'
    );
    perform public.studyos_push_notify(
      array[new.owner_id],
      'accepted',
      'Invito accettato',
      left(v_name, 60) || ' ha accettato il tuo invito',
      '?apri=condivisione',
      'share-accepted:' || new.id
    );
  exception when others then
    raise warning 'studyos_push_share_accepted: %', sqlerrm;
  end;
  return null;
end;
$$;

drop trigger if exists studyos_share_invites_accepted_push on public.studyos_share_invites;
create trigger studyos_share_invites_accepted_push
after update of status on public.studyos_share_invites
for each row when (old.status is distinct from new.status and new.status = 'accepted')
execute function public.studyos_push_share_accepted();

-- Qualcuno entra in un gruppo (invito accettato, codice o QR) → proprietario, amministratori e chi
-- aveva mandato l'invito accettato in questa stessa transazione (updated_at = now()), una volta a
-- testa. Il membro che entra non riceve nulla.
create or replace function public.studyos_push_group_join()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group_name text;
  v_users uuid[];
begin
  begin
    select g.name into v_group_name from public.studyos_groups g where g.id = new.group_id;
    v_users := array(
      select public.studyos_uuid(g.owner_id) from public.studyos_groups g where g.id = new.group_id
      union
      select public.studyos_uuid(m.user_id) from public.studyos_group_members m
      where m.group_id = new.group_id and m.role = 'admin'
      union
      select public.studyos_uuid(i.from_user_id) from public.studyos_group_invites i
      where i.group_id = new.group_id and i.recipient_user_id = new.user_id
        and i.status = 'accepted' and i.updated_at = now()
    );
    v_users := array_remove(v_users, public.studyos_uuid(new.user_id));
    perform public.studyos_push_notify(
      v_users,
      'accepted',
      'Nuovo membro',
      left(coalesce(nullif(btrim(new.display_name), ''), 'Una persona'), 60)
        || ' ora fa parte del gruppo ' || left(coalesce(nullif(btrim(v_group_name), ''), 'senza nome'), 80),
      '?apri=gruppi',
      'group-join:' || md5(new.group_id) || ':' || new.user_id
    );
  exception when others then
    raise warning 'studyos_push_group_join: %', sqlerrm;
  end;
  return null;
end;
$$;

drop trigger if exists studyos_group_members_push on public.studyos_group_members;
create trigger studyos_group_members_push
after insert on public.studyos_group_members
for each row when (new.role <> 'owner')
execute function public.studyos_push_group_join();

-- Permesso cambiato ("Può vedere" ↔ "Può modificare") → chi riceve. Trigger per istruzione: un
-- aggiornamento di più sezioni verso la stessa persona o lo stesso gruppo dà una sola notifica.
create or replace function public.studyos_push_share_permission()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  begin
    for r in
      select n.owner_id, n.grantee_user_id, n.grantee_group_id, n.permission,
        left(coalesce(nullif(btrim(max(n.owner_name)), ''), 'Qualcuno'), 60) as owner_name,
        left(coalesce(nullif(btrim(max(n.grantee_name)), ''), 'senza nome'), 80) as grantee_name,
        string_agg(public.studyos_scope_label(n.scope), ', ' order by n.scope) as scopes,
        (array_agg(n.id order by n.scope))[1] as share_id
      from new_rows n
      join old_rows o on o.id = n.id
      where o.permission is distinct from n.permission
      group by n.owner_id, n.grantee_user_id, n.grantee_group_id, n.permission
    loop
      perform public.studyos_push_notify(
        public.studyos_share_audience(r.owner_id, r.grantee_user_id, r.grantee_group_id),
        'permission',
        'Permessi cambiati',
        r.owner_name
          || case when r.grantee_group_id is null then ' ora ti permette '
             else ' ora permette al gruppo ' || r.grantee_name || ' ' end
          || case when r.permission = 'edit' then 'di modificare: ' else 'solo di vedere: ' end
          || r.scopes,
        '?apri=condivisione',
        'share-permission:' || r.share_id
      );
    end loop;
  exception when others then
    raise warning 'studyos_push_share_permission: %', sqlerrm;
  end;
  return null;
end;
$$;

drop trigger if exists studyos_shares_permission_push on public.studyos_shares;
create trigger studyos_shares_permission_push
after update on public.studyos_shares
referencing old table as old_rows new table as new_rows
for each statement execute function public.studyos_push_share_permission();

-- Accesso tolto (revoca del proprietario, uscita da un gruppo, account eliminato) → chi riceveva.
-- Chi esce da sé è chi agisce e non riceve nulla.
create or replace function public.studyos_push_share_removed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  begin
    for r in
      select o.owner_id, o.grantee_user_id, o.grantee_group_id,
        left(coalesce(nullif(btrim(max(o.owner_name)), ''), 'Qualcuno'), 60) as owner_name,
        left(coalesce(nullif(btrim(max(o.grantee_name)), ''), 'senza nome'), 80) as grantee_name,
        string_agg(public.studyos_scope_label(o.scope), ', ' order by o.scope) as scopes,
        (array_agg(o.id order by o.scope))[1] as share_id
      from old_rows o
      group by o.owner_id, o.grantee_user_id, o.grantee_group_id
    loop
      perform public.studyos_push_notify(
        public.studyos_share_audience(r.owner_id, r.grantee_user_id, r.grantee_group_id),
        'permission',
        'Accesso tolto',
        r.owner_name
          || case when r.grantee_group_id is null then ' ha smesso di condividere con te: '
             else ' ha smesso di condividere con il gruppo ' || r.grantee_name || ': ' end
          || r.scopes,
        '?apri=condivisione',
        'share-permission:' || r.share_id
      );
    end loop;
  exception when others then
    raise warning 'studyos_push_share_removed: %', sqlerrm;
  end;
  return null;
end;
$$;

drop trigger if exists studyos_shares_removed_push on public.studyos_shares;
create trigger studyos_shares_removed_push
after delete on public.studyos_shares
referencing old table as old_rows
for each statement execute function public.studyos_push_share_removed();

-- ─── Privilegi delle funzioni ───────────────────────────────────────────────
-- "revoke ... from public" non toglie i privilegi predefiniti dati ad anon e authenticated: si
-- tolgono in modo esplicito. Le funzioni interne le chiamano solo funzioni e trigger DEFINER.

revoke all on function public.find_person(text) from public, anon;
revoke all on function public.is_handle_available(text) from public, anon;
revoke all on function public.invite_person_to_group(text, uuid, text) from public, anon;
revoke all on function public.invite_person_to_share(uuid, text, jsonb, jsonb) from public, anon;
revoke all on function public.push_gone(text, text[]) from public;
grant execute on function public.find_person(text) to authenticated;
grant execute on function public.is_handle_available(text) to authenticated;
grant execute on function public.invite_person_to_group(text, uuid, text) to authenticated;
grant execute on function public.invite_person_to_share(uuid, text, jsonb, jsonb) to authenticated;
grant execute on function public.push_gone(text, text[]) to anon, authenticated;

revoke all on function public.studyos_push_notify(uuid[], text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.studyos_person_lookup_guard() from public, anon, authenticated;
revoke all on function public.studyos_person_discoverable(uuid) from public, anon, authenticated;
revoke all on function public.studyos_request_ip() from public, anon, authenticated;
revoke all on function public.studyos_uuid(text) from public, anon, authenticated;
revoke all on function public.studyos_scope_label(text) from public, anon, authenticated;
revoke all on function public.studyos_share_audience(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.studyos_profiles_touch() from public, anon, authenticated;
revoke all on function public.studyos_push_subscriptions_claim() from public, anon, authenticated;
revoke all on function public.studyos_push_subscriptions_cap() from public, anon, authenticated;
revoke all on function public.studyos_push_group_invite() from public, anon, authenticated;
revoke all on function public.studyos_push_share_invite() from public, anon, authenticated;
revoke all on function public.studyos_push_share_accepted() from public, anon, authenticated;
revoke all on function public.studyos_push_group_join() from public, anon, authenticated;
revoke all on function public.studyos_push_share_permission() from public, anon, authenticated;
revoke all on function public.studyos_push_share_removed() from public, anon, authenticated;
