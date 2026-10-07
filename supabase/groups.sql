-- Gruppi di studio condivisi (migrazione opzionale).
--
-- Esecuzione manuale nel progetto Supabase (come supabase/schema.sql), DOPO
-- schema.sql. Senza questa migrazione l'app funziona comunque: i gruppi restano
-- locali e gli inviti viaggiano via codice/link copiabile (vedi docs/groups-sync.md).
-- Con la migrazione: inviti nominali tra account, bacheca e attività condivise,
-- recapito immediato via realtime.
--
-- Gli id sono text (stesso spazio degli id locali) per non dover rimappare nulla.

-- ─── Tabelle ────────────────────────────────────────────────────────────────

create table if not exists public.studyos_groups (
  id text primary key,
  name text not null,
  description text not null default '',
  owner_id text not null,
  owner_display_name text not null default '',
  invite_code text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.studyos_group_members (
  group_id text not null references public.studyos_groups (id) on delete cascade,
  user_id text not null,
  email text,
  display_name text not null default '',
  role text not null default 'member' check (role in ('owner', 'admin', 'member')),
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

create table if not exists public.studyos_group_invites (
  id text primary key,
  group_id text not null references public.studyos_groups (id) on delete cascade,
  group_name text not null default '',
  group_description text,
  from_user_id text not null,
  from_display_name text not null default '',
  recipient_email text,
  code text not null,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists studyos_group_invites_recipient_idx
  on public.studyos_group_invites (recipient_email, status);
create index if not exists studyos_group_invites_code_idx
  on public.studyos_group_invites (code);

create table if not exists public.studyos_group_resources (
  id text primary key,
  group_id text not null references public.studyos_groups (id) on delete cascade,
  kind text not null default 'note' check (kind in ('link', 'note', 'file', 'task')),
  title text not null default '',
  url text,
  body text,
  pinned boolean not null default false,
  added_by_user_id text not null default '',
  added_by_display_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists studyos_group_resources_group_idx
  on public.studyos_group_resources (group_id, pinned);

create table if not exists public.studyos_group_activity (
  id text primary key,
  group_id text not null references public.studyos_groups (id) on delete cascade,
  actor_display_name text not null default '',
  text text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists studyos_group_activity_group_idx
  on public.studyos_group_activity (group_id, created_at desc);

-- Autore delle voci di attività: lo compila il server (default), il client non può fingersi altri.
alter table public.studyos_group_activity
  add column if not exists actor_user_id text default (auth.uid()::text);

-- Un codice identifica un solo gruppo: senza vincolo l'unione con codice sarebbe ambigua e un
-- gruppo potrebbe copiare il codice di un altro per intercettare chi si unisce.
create unique index if not exists studyos_groups_invite_code_key
  on public.studyos_groups (upper(invite_code));

-- ─── RLS ────────────────────────────────────────────────────────────────────

alter table public.studyos_groups enable row level security;
alter table public.studyos_group_members enable row level security;
alter table public.studyos_group_invites enable row level security;
alter table public.studyos_group_resources enable row level security;
alter table public.studyos_group_activity enable row level security;

-- Privilegi a livello tabella (RLS filtra poi le righe, come in schema.sql).
revoke all on table public.studyos_groups from anon;
revoke all on table public.studyos_group_members from anon;
revoke all on table public.studyos_group_invites from anon;
revoke all on table public.studyos_group_resources from anon;
revoke all on table public.studyos_group_activity from anon;
grant select, insert, update, delete on table public.studyos_groups to authenticated;
grant select, insert, update, delete on table public.studyos_group_members to authenticated;
grant select, insert, update, delete on table public.studyos_group_invites to authenticated;
grant select, insert, update, delete on table public.studyos_group_resources to authenticated;
grant select, insert, update, delete on table public.studyos_group_activity to authenticated;

-- helper: appartengo al gruppo? (DEFINER per non rientrare nelle policy: sola lettura)
create or replace function public.studyos_is_group_member(p_group_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.studyos_group_members
    where group_id = p_group_id and user_id = auth.uid()::text
  );
$$;

-- helper: mio ruolo nel gruppo (null se non membro)
create or replace function public.studyos_group_role(p_group_id text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.studyos_group_members
  where group_id = p_group_id and user_id = auth.uid()::text
$$;

-- Gruppi: lettura membri, scrittura proprietario, creazione autenticata.
drop policy if exists studyos_groups_select on public.studyos_groups;
create policy studyos_groups_select on public.studyos_groups for select to authenticated
  using (owner_id = auth.uid()::text or public.studyos_is_group_member(id));
drop policy if exists studyos_groups_insert on public.studyos_groups;
create policy studyos_groups_insert on public.studyos_groups for insert to authenticated
  with check (owner_id = auth.uid()::text);
drop policy if exists studyos_groups_update on public.studyos_groups;
create policy studyos_groups_update on public.studyos_groups for update to authenticated
  using (owner_id = auth.uid()::text)
  with check (owner_id = auth.uid()::text);
drop policy if exists studyos_groups_delete on public.studyos_groups;
create policy studyos_groups_delete on public.studyos_groups for delete to authenticated
  using (owner_id = auth.uid()::text);

-- Membri: lettura tra membri; ingresso solo via RPC (accept/join) o il proprietario che si
-- registra alla creazione; ruoli cambiati dal proprietario; uscita volontaria o rimozione.
drop policy if exists studyos_group_members_select on public.studyos_group_members;
-- La propria riga è sempre leggibile: l'upsert (INSERT … ON CONFLICT DO UPDATE) esige che anche
-- la riga nuova passi la policy di lettura, e il proprietario che si registra non è ancora membro.
create policy studyos_group_members_select on public.studyos_group_members for select to authenticated
  using (user_id = auth.uid()::text or public.studyos_is_group_member(group_id));
drop policy if exists studyos_group_members_owner_insert on public.studyos_group_members;
create policy studyos_group_members_owner_insert on public.studyos_group_members for insert to authenticated
  with check (
    user_id = auth.uid()::text
    and role = 'owner'
    and exists (select 1 from public.studyos_groups where id = group_id and owner_id = auth.uid()::text)
  );
-- Il proprietario promuove/retrocede gli altri (admin/membro) ma non cede né perde la proprietà
-- da qui: owner_id del gruppo e ruolo devono restare allineati.
drop policy if exists studyos_group_members_owner_update on public.studyos_group_members;
create policy studyos_group_members_owner_update on public.studyos_group_members for update to authenticated
  using (public.studyos_group_role(group_id) = 'owner')
  with check (
    public.studyos_group_role(group_id) = 'owner'
    and (
      (user_id = auth.uid()::text and role = 'owner')
      or (user_id <> auth.uid()::text and role in ('admin', 'member'))
    )
  );
drop policy if exists studyos_group_members_delete on public.studyos_group_members;
create policy studyos_group_members_delete on public.studyos_group_members for delete to authenticated
  using (
    (public.studyos_group_role(group_id) = 'owner' and user_id <> auth.uid()::text)
    or (user_id = auth.uid()::text and role <> 'owner')
  );

-- Inviti: il destinatario legge i propri; i membri vedono gli inviti del gruppo;
-- la creazione è riservata a proprietario/amministratore.
drop policy if exists studyos_group_invites_select on public.studyos_group_invites;
create policy studyos_group_invites_select on public.studyos_group_invites for select to authenticated
  using (
    (recipient_email is not null and lower(recipient_email) = lower(auth.jwt() ->> 'email'))
    or public.studyos_is_group_member(group_id)
    or from_user_id = auth.uid()::text
  );
drop policy if exists studyos_group_invites_insert on public.studyos_group_invites;
create policy studyos_group_invites_insert on public.studyos_group_invites for insert to authenticated
  with check (
    public.studyos_group_role(group_id) in ('owner', 'admin')
    and from_user_id = auth.uid()::text
    and status = 'pending'
  );
drop policy if exists studyos_group_invites_delete on public.studyos_group_invites;
create policy studyos_group_invites_delete on public.studyos_group_invites for delete to authenticated
  using (public.studyos_group_role(group_id) in ('owner', 'admin'));

-- Risorse: lettura membri; si pubblica solo a proprio nome; ogni membro può fissare/sfissare,
-- il contenuto lo cambiano autore o owner/admin (trigger sotto); cancellazione autore o owner/admin.
drop policy if exists studyos_group_resources_select on public.studyos_group_resources;
create policy studyos_group_resources_select on public.studyos_group_resources for select to authenticated
  using (public.studyos_is_group_member(group_id));
drop policy if exists studyos_group_resources_write on public.studyos_group_resources;
create policy studyos_group_resources_write on public.studyos_group_resources for insert to authenticated
  with check (public.studyos_is_group_member(group_id) and added_by_user_id = auth.uid()::text);
drop policy if exists studyos_group_resources_update on public.studyos_group_resources;
create policy studyos_group_resources_update on public.studyos_group_resources for update to authenticated
  using (public.studyos_is_group_member(group_id))
  with check (public.studyos_is_group_member(group_id));
drop policy if exists studyos_group_resources_delete on public.studyos_group_resources;
create policy studyos_group_resources_delete on public.studyos_group_resources for delete to authenticated
  using (
    added_by_user_id = auth.uid()::text
    or public.studyos_group_role(group_id) in ('owner', 'admin')
  );

-- Attività: append-only per i membri, lettura membri.
drop policy if exists studyos_group_activity_select on public.studyos_group_activity;
create policy studyos_group_activity_select on public.studyos_group_activity for select to authenticated
  using (public.studyos_is_group_member(group_id));
drop policy if exists studyos_group_activity_insert on public.studyos_group_activity;
create policy studyos_group_activity_insert on public.studyos_group_activity for insert to authenticated
  with check (public.studyos_is_group_member(group_id) and actor_user_id = auth.uid()::text);

-- Senza questo controllo un membro potrebbe intestarsi la risorsa di un altro (update di
-- added_by_user_id) e poi cancellarla, o riscriverne il contenuto.
create or replace function public.studyos_group_resources_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.group_id is distinct from old.group_id
     or new.added_by_user_id is distinct from old.added_by_user_id then
    raise exception 'Gruppo e autore di una risorsa non sono modificabili';
  end if;
  new.added_by_display_name := old.added_by_display_name;
  new.created_at := old.created_at;
  if (new.kind, new.title, new.url, new.body) is distinct from (old.kind, old.title, old.url, old.body)
     and old.added_by_user_id <> auth.uid()::text
     and coalesce(public.studyos_group_role(old.group_id), '') not in ('owner', 'admin') then
    raise exception 'Solo l''autore o un amministratore può modificare il contenuto';
  end if;
  return new;
end;
$$;

drop trigger if exists studyos_group_resources_guard on public.studyos_group_resources;
create trigger studyos_group_resources_guard
  before update on public.studyos_group_resources
  for each row execute function public.studyos_group_resources_guard();

-- ─── RPC (SECURITY DEFINER: verifiche atomiche lato server) ─────────────────

-- Nome visibile di chi entra: quello scelto nel profilo, altrimenti la parte locale dell'email.
create or replace function public.studyos_member_name(p_display_name text, p_email text)
returns text
language sql
immutable
as $$
  select left(coalesce(nullif(btrim(p_display_name), ''), nullif(split_part(p_email, '@', 1), ''), 'Studente'), 80)
$$;

-- La versione precedente (senza nome) dava al nuovo membro il nome di chi aveva invitato.
drop function if exists public.accept_group_invite(text);
drop function if exists public.join_group_by_code(text);

-- Accetta un invito nominale: solo il destinatario; aggiunge il membro e storicizza.
create or replace function public.accept_group_invite(p_invite_id text, p_display_name text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite public.studyos_group_invites%rowtype;
  v_email text := lower(auth.jwt() ->> 'email');
  v_name text := public.studyos_member_name(p_display_name, lower(auth.jwt() ->> 'email'));
begin
  if auth.uid() is null then
    raise exception 'Accesso richiesto';
  end if;
  select * into v_invite from public.studyos_group_invites where id = p_invite_id;
  if not found then
    raise exception 'Invito non trovato';
  end if;
  if v_invite.status <> 'pending' then
    raise exception 'Invito già gestito';
  end if;
  if v_invite.recipient_email is null or lower(v_invite.recipient_email) <> v_email then
    raise exception 'Invito destinato a un altro account';
  end if;
  insert into public.studyos_group_members (group_id, user_id, email, display_name, role)
  values (v_invite.group_id, auth.uid()::text, v_email, v_name, 'member')
  on conflict (group_id, user_id) do nothing;
  update public.studyos_group_invites
    set status = 'accepted', updated_at = now()
    where id = p_invite_id;
  insert into public.studyos_group_activity (id, group_id, actor_display_name, text)
  values ('activity-' || p_invite_id, v_invite.group_id, v_name, 'è entrato nel gruppo')
  on conflict (id) do nothing;
end;
$$;

revoke all on function public.accept_group_invite(text, text) from public;
grant execute on function public.accept_group_invite(text, text) to authenticated;

-- Rifiuta un invito nominale: solo il destinatario.
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
  select * into v_invite from public.studyos_group_invites where id = p_invite_id;
  if not found then
    raise exception 'Invito non trovato';
  end if;
  if v_invite.status <> 'pending' then
    raise exception 'Invito già gestito';
  end if;
  if v_invite.recipient_email is null or lower(v_invite.recipient_email) <> lower(auth.jwt() ->> 'email') then
    raise exception 'Invito destinato a un altro account';
  end if;
  update public.studyos_group_invites
    set status = 'declined', updated_at = now()
    where id = p_invite_id;
end;
$$;

revoke all on function public.decline_group_invite(text) from public;
grant execute on function public.decline_group_invite(text) to authenticated;

-- Unione con codice: valida il codice e aggiunge il membro, restituisce il gruppo.
create or replace function public.join_group_by_code(p_code text, p_display_name text default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group public.studyos_groups%rowtype;
  v_email text := lower(auth.jwt() ->> 'email');
  v_name text := public.studyos_member_name(p_display_name, lower(auth.jwt() ->> 'email'));
begin
  if auth.uid() is null then
    raise exception 'Accesso richiesto';
  end if;
  select * into v_group from public.studyos_groups
    where upper(invite_code) = upper(p_code);
  if not found then
    raise exception 'Codice non valido';
  end if;
  insert into public.studyos_group_members (group_id, user_id, email, display_name, role)
  values (v_group.id, auth.uid()::text, v_email, v_name, 'member')
  on conflict (group_id, user_id) do nothing;
  insert into public.studyos_group_activity (id, group_id, actor_display_name, text)
  values (
    'activity-join-' || v_group.id || '-' || replace(auth.uid()::text, '-', ''),
    v_group.id,
    v_name,
    'è entrato nel gruppo'
  )
  on conflict (id) do nothing;
  return v_group.id;
end;
$$;

revoke all on function public.join_group_by_code(text, text) from public;
grant execute on function public.join_group_by_code(text, text) to authenticated;

-- ─── Realtime ───────────────────────────────────────────────────────────────

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'studyos_groups'
    ) then
      execute 'alter publication supabase_realtime add table public.studyos_groups';
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'studyos_group_invites'
    ) then
      execute 'alter publication supabase_realtime add table public.studyos_group_invites';
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'studyos_group_resources'
    ) then
      execute 'alter publication supabase_realtime add table public.studyos_group_resources';
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'studyos_group_activity'
    ) then
      execute 'alter publication supabase_realtime add table public.studyos_group_activity';
    end if;
  end if;
end $$;
