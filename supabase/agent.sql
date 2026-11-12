-- Connettore remoto degli agenti: ChatGPT lavora sui dati cloud anche con StudyOS chiuso.
-- Da eseguire nel SQL Editor dopo schema.sql. Rieseguibile.
--
-- Con «Consenti» l'app (con l'accesso fatto) crea un permesso e riceve un segreto casuale;
-- nel database resta solo il suo hash SHA-256. L'hub del connettore conserva il segreto e
-- con la chiave publishable chiama solo le due funzioni qui sotto: leggono e scrivono le
-- righe di studyos_items di quell'account, con la stessa regola LWW di push_studyos_rows.
-- Il segreto non apre nient'altro: né sessioni, né altre tabelle, né altri account.
-- Dalla 1.8.0 ogni scrittura del connettore finisce nel registro studyos_agent_audit (prima e
-- dopo), leggibile e ripristinabile dall'app e dal connettore: rieseguire questo file.

create table if not exists public.studyos_agent_grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  secret_hash text not null unique,
  label text not null default '',
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

create index if not exists studyos_agent_grants_user_idx on public.studyos_agent_grants (user_id);

alter table public.studyos_agent_grants enable row level security;

-- La persona vede i propri permessi; si creano e si revocano solo con le funzioni.
drop policy if exists "studyos_agent_grants_select_own" on public.studyos_agent_grants;
create policy "studyos_agent_grants_select_own" on public.studyos_agent_grants
  for select to authenticated using (user_id = auth.uid());

revoke all on public.studyos_agent_grants from anon, authenticated;
grant select on public.studyos_agent_grants to authenticated;

create or replace function public.studyos_agent_secret_hash(p_secret text)
returns text
language sql
immutable
set search_path = public
as $$
  select encode(sha256(convert_to(coalesce(p_secret, ''), 'UTF8')), 'hex')
$$;

revoke all on function public.studyos_agent_secret_hash(text) from public, anon, authenticated;

create or replace function public.studyos_create_agent_grant(p_label text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_secret text;
begin
  if auth.uid() is null then
    raise exception 'Accedi con il tuo account per collegare un assistente.' using errcode = '28000';
  end if;
  if (select count(*) from public.studyos_agent_grants where user_id = auth.uid() and revoked_at is null) >= 20 then
    raise exception 'Hai già 20 assistenti collegati: revocane qualcuno in Impostazioni → Agenti.' using errcode = '54000';
  end if;
  -- 244 bit casuali da due uuid v4, senza estensioni.
  v_secret := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into public.studyos_agent_grants (user_id, secret_hash, label)
  values (auth.uid(), public.studyos_agent_secret_hash(v_secret), left(coalesce(p_label, ''), 80));
  return v_secret;
end;
$$;

revoke all on function public.studyos_create_agent_grant(text) from public, anon;
grant execute on function public.studyos_create_agent_grant(text) to authenticated;

-- Revoca tutti i permessi della persona: «Revoca l'accesso agli assistenti» nell'app.
create or replace function public.studyos_revoke_agent_grants()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if auth.uid() is null then
    raise exception 'Accedi con il tuo account.' using errcode = '28000';
  end if;
  update public.studyos_agent_grants set revoked_at = now()
  where user_id = auth.uid() and revoked_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.studyos_revoke_agent_grants() from public, anon;
grant execute on function public.studyos_revoke_agent_grants() to authenticated;

-- Account del segreto, solo se il permesso è attivo. Interna: nessun grant.
create or replace function public.studyos_agent_user(p_secret text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid;
begin
  if p_secret is null or length(p_secret) <> 64 then
    return null;
  end if;
  update public.studyos_agent_grants set last_used_at = now()
  where secret_hash = public.studyos_agent_secret_hash(p_secret) and revoked_at is null
  returning user_id into v_user;
  return v_user;
end;
$$;

revoke all on function public.studyos_agent_user(text) from public, anon, authenticated;

-- Righe dell'account dopo `p_since` (updated_at del server), in ordine come il pull dell'app.
-- Senza i file incorporati: gli strumenti degli agenti non li leggono. Senza `storedFile` (file
-- nello spazio file, storage.sql): una copia vecchia dell'agente non lo riporta indietro.
create or replace function public.studyos_agent_pull(
  p_secret text,
  p_since timestamptz,
  p_offset integer,
  p_limit integer
)
returns table(entity_type text, entity_id text, payload jsonb, deleted boolean, updated_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_user uuid := public.studyos_agent_user(p_secret);
begin
  if v_user is null then
    raise exception 'Collegamento dell''assistente non valido o revocato.' using errcode = '28000';
  end if;
  return query
    select i.entity_type, i.entity_id,
      case when jsonb_typeof(i.payload) = 'object'
        then i.payload - 'dataUrl' - 'cover' - 'avatarDataUrl' - 'storedFile'
        else i.payload
      end,
      i.deleted, i.updated_at
    from public.studyos_items as i
    where i.user_id = v_user
      and i.entity_type <> 'snapshot'
      and (p_since is null or i.updated_at >= p_since)
    order by i.updated_at asc, i.id asc
    offset greatest(coalesce(p_offset, 0), 0)
    limit least(greatest(coalesce(p_limit, 500), 1), 1000);
end;
$$;

revoke all on function public.studyos_agent_pull(text, timestamptz, integer, integer) from public;
grant execute on function public.studyos_agent_pull(text, timestamptz, integer, integer) to anon, authenticated;

-- Registro del connettore remoto (revisione 1.8.0). Ogni riga che studyos_agent_push cambia
-- lascia una voce con l'immagine prima e dopo: la scrive la funzione stessa, quindi l'hub non può
-- saltarla. Le immagini sono senza file incorporati (copertine, file, foto); solo un'eliminazione
-- tiene a parte i file della riga eliminata (before_files), per poterla ripristinare intera.
-- La persona legge le proprie voci dall'app (RLS); nessun client le scrive o le cancella.
-- Conservazione: 90 giorni e al massimo 2000 voci per account, potate dentro le funzioni che scrivono.
create table if not exists public.studyos_agent_audit (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- Permesso del connettore che ha scritto; null = ripristino fatto dall'app.
  grant_id uuid references public.studyos_agent_grants (id) on delete set null,
  grant_label text not null default '',
  tool text not null default '',
  entity_type text not null,
  entity_id text not null,
  action text not null check (action in ('create', 'update', 'delete')),
  before jsonb,
  after jsonb,
  before_files jsonb,
  -- Timbro LWW della riga subito dopo la scrittura: se la riga ha ancora questo timbro, non è
  -- cambiata da allora e la voce si può ripristinare.
  after_stamp timestamptz,
  -- Voce annullata da questa (ripristino) e quando questa è stata annullata.
  restore_of uuid,
  restored_at timestamptz,
  -- clock_timestamp: voci della stessa chiamata in ordine di scrittura.
  created_at timestamptz not null default clock_timestamp()
);

create index if not exists studyos_agent_audit_user_idx
  on public.studyos_agent_audit (user_id, created_at desc, id desc);

alter table public.studyos_agent_audit enable row level security;

drop policy if exists "studyos_agent_audit_select_own" on public.studyos_agent_audit;
create policy "studyos_agent_audit_select_own" on public.studyos_agent_audit
  for select to authenticated using (user_id = (select auth.uid()));

revoke all on public.studyos_agent_audit from anon, authenticated;
grant select on public.studyos_agent_audit to authenticated;

-- Permesso attivo del segreto (riga intera: id, account, etichetta). Interna: nessun grant.
create or replace function public.studyos_agent_grant_of(p_secret text)
returns public.studyos_agent_grants
language plpgsql
security definer
set search_path = public
as $$
declare
  v_grant public.studyos_agent_grants;
begin
  if p_secret is null or length(p_secret) <> 64 then
    return null;
  end if;
  update public.studyos_agent_grants set last_used_at = now()
  where secret_hash = public.studyos_agent_secret_hash(p_secret) and revoked_at is null
  returning * into v_grant;
  return v_grant;
end;
$$;

revoke all on function public.studyos_agent_grant_of(text) from public, anon, authenticated;

-- Immagine per il registro: il payload senza file incorporati.
create or replace function public.studyos_agent_audit_image(p_payload jsonb)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select case when jsonb_typeof(p_payload) = 'object'
    then p_payload - 'dataUrl' - 'cover' - 'avatarDataUrl'
    else p_payload
  end
$$;

revoke all on function public.studyos_agent_audit_image(jsonb) from public, anon, authenticated;

-- Solo i file incorporati di un payload (null se non ne ha).
create or replace function public.studyos_agent_audit_files(p_payload jsonb)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select nullif(jsonb_strip_nulls(jsonb_build_object(
    'dataUrl', p_payload->'dataUrl',
    'cover', p_payload->'cover',
    'avatarDataUrl', p_payload->'avatarDataUrl'
  )), '{}'::jsonb)
$$;

revoke all on function public.studyos_agent_audit_files(jsonb) from public, anon, authenticated;

-- Conservazione: via le voci oltre 90 giorni e oltre le 2000 più recenti dell'account. Usa solo
-- l'indice (user_id, created_at desc, id desc): al massimo 2001 voci lette.
create or replace function public.studyos_agent_audit_prune(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_at timestamptz;
  v_id uuid;
begin
  delete from public.studyos_agent_audit as a
  where a.user_id = p_user and a.created_at < now() - interval '90 days';
  select a.created_at, a.id into v_at, v_id
  from public.studyos_agent_audit as a
  where a.user_id = p_user
  order by a.created_at desc, a.id desc
  offset 2000 limit 1;
  if found then
    delete from public.studyos_agent_audit as a
    where a.user_id = p_user and (a.created_at, a.id) <= (v_at, v_id);
  end if;
end;
$$;

revoke all on function public.studyos_agent_audit_prune(uuid) from public, anon, authenticated;

-- Stessa scrittura condizionale di push_studyos_rows, per l'account del segreto. I file
-- incorporati e `storedFile` tolti dal pull tornano dalla riga attuale se il payload non li porta.
-- Dalla 1.8.0 scrive anche il registro (con p_tool, lo strumento che ha chiesto la modifica).
-- La versione a tre argomenti si toglie: con p_tool predefinito un hub di prima la chiama ancora
-- uguale (PostgREST usa i valori predefiniti), e due versioni renderebbero ambigua la chiamata.
drop function if exists public.studyos_agent_push(text, text, jsonb);

create or replace function public.studyos_agent_push(
  p_secret text,
  p_client_id text,
  p_rows jsonb,
  p_tool text default ''
)
returns table(entity_type text, entity_id text, accepted boolean)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_grant public.studyos_agent_grants := public.studyos_agent_grant_of(p_secret);
  v_user uuid := v_grant.user_id;
  v_tool text := left(coalesce(p_tool, ''), 80);
  v_row jsonb;
  v_type text;
  v_id text;
  v_payload jsonb;
  v_deleted boolean;
  v_current jsonb;
  v_current_deleted boolean;
  v_key text;
  v_applied boolean;
  v_stamp timestamptz;
  v_action text;
  v_logged integer := 0;
begin
  if v_user is null then
    raise exception 'Collegamento dell''assistente non valido o revocato.' using errcode = '28000';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 200 then
    raise exception 'Batch di sincronizzazione non valido';
  end if;

  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_type := v_row->>'entity_type';
    v_id := v_row->>'entity_id';
    v_payload := v_row->'payload';
    v_deleted := coalesce((v_row->>'deleted')::boolean, false);
    if nullif(v_type, '') is null or nullif(v_id, '') is null or v_type = 'snapshot'
       or jsonb_typeof(v_payload) <> 'object'
       or (v_payload->>'id') is distinct from v_id then
      raise exception 'Entità di sincronizzazione non valida';
    end if;

    -- La riga attuale, bloccata fino alla fine: l'immagine "prima" del registro è quella sovrascritta.
    v_current := null;
    v_current_deleted := null;
    select i.payload, i.deleted into v_current, v_current_deleted
    from public.studyos_items as i
    where i.user_id = v_user and i.entity_type = v_type and i.entity_id = v_id
    for update;
    if not v_deleted and jsonb_typeof(v_current) = 'object' then
      foreach v_key in array array['dataUrl', 'cover', 'avatarDataUrl', 'storedFile'] loop
        if not (v_payload ? v_key) and (v_current ? v_key) then
          v_payload := v_payload || jsonb_build_object(v_key, v_current->v_key);
        end if;
      end loop;
    end if;

    v_applied := false;
    v_stamp := null;
    insert into public.studyos_items as current_row
      (user_id, entity_type, entity_id, payload, deleted, encrypted, client_id)
    values (v_user, v_type, v_id, v_payload, v_deleted, false, left(coalesce(p_client_id, ''), 80))
    on conflict (user_id, entity_type, entity_id) do update set
      payload = excluded.payload,
      deleted = excluded.deleted,
      encrypted = false,
      client_id = excluded.client_id
    where public.studyos_item_stamp(excluded.payload, excluded.deleted, excluded.updated_at)
        > public.studyos_item_stamp(current_row.payload, current_row.deleted, current_row.updated_at)
       or (
         public.studyos_item_stamp(excluded.payload, excluded.deleted, excluded.updated_at)
           = public.studyos_item_stamp(current_row.payload, current_row.deleted, current_row.updated_at)
         and excluded.payload = current_row.payload
         and excluded.deleted = current_row.deleted
       )
    returning true, public.studyos_item_stamp(current_row.payload, current_row.deleted, current_row.updated_at)
      into v_applied, v_stamp;

    -- Registro: solo ciò che cambia davvero (non la stessa riga riscritta, non un'eliminazione di
    -- ciò che non c'era o era già eliminato).
    if coalesce(v_applied, false)
       and (v_current is null or v_current is distinct from v_payload or v_current_deleted is distinct from v_deleted)
       and not (v_deleted and (v_current is null or v_current_deleted)) then
      v_action := case
        when v_deleted then 'delete'
        when v_current is null or v_current_deleted then 'create'
        else 'update'
      end;
      insert into public.studyos_agent_audit
        (user_id, grant_id, grant_label, tool, entity_type, entity_id, action, before, after, before_files, after_stamp)
      values (
        v_user, v_grant.id, coalesce(v_grant.label, ''), v_tool, v_type, v_id, v_action,
        case when v_action = 'create' then null else public.studyos_agent_audit_image(v_current) end,
        case when v_deleted then v_payload else public.studyos_agent_audit_image(v_payload) end,
        case when v_action = 'delete' then public.studyos_agent_audit_files(v_current) end,
        v_stamp
      );
      v_logged := v_logged + 1;
    end if;

    entity_type := v_type;
    entity_id := v_id;
    accepted := coalesce(v_applied, false);
    return next;
  end loop;

  if v_logged > 0 then
    perform public.studyos_agent_audit_prune(v_user);
  end if;
end;
$$;

revoke all on function public.studyos_agent_push(text, text, jsonb, text) from public;
grant execute on function public.studyos_agent_push(text, text, jsonb, text) to anon, authenticated;

-- Voci del registro di un account, la più recente prima, con i filtri dello strumento
-- studyos_list_audit. can_restore = la riga ha ancora il timbro di quella scrittura e la voce non è
-- già stata annullata. total = voci che rispettano i filtri. Interna: nessun grant.
create or replace function public.studyos_agent_audit_rows(
  p_user uuid,
  p_limit integer,
  p_offset integer,
  p_entity_id text,
  p_tool text,
  p_since timestamptz,
  p_until timestamptz
)
returns table(
  id uuid,
  created_at timestamptz,
  grant_label text,
  from_app boolean,
  tool text,
  entity_type text,
  entity_id text,
  action text,
  before jsonb,
  after jsonb,
  restore_of uuid,
  restored_at timestamptz,
  can_restore boolean,
  total bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select a.id, a.created_at, a.grant_label, a.grant_id is null and a.restore_of is not null, a.tool,
    a.entity_type, a.entity_id, a.action, a.before, a.after, a.restore_of, a.restored_at,
    a.restored_at is null and a.after_stamp is not null and exists (
      select 1 from public.studyos_items as i
      where i.user_id = a.user_id and i.entity_type = a.entity_type and i.entity_id = a.entity_id
        and i.deleted = (a.action = 'delete')
        and public.studyos_item_stamp(i.payload, i.deleted, i.updated_at) = a.after_stamp
    ),
    count(*) over ()
  from public.studyos_agent_audit as a
  where a.user_id = p_user
    and (nullif(p_entity_id, '') is null or a.entity_id = p_entity_id)
    and (nullif(p_tool, '') is null or a.tool = p_tool)
    and (p_since is null or a.created_at >= p_since)
    and (p_until is null or a.created_at < p_until)
  order by a.created_at desc, a.id desc
  offset greatest(coalesce(p_offset, 0), 0)
  limit least(greatest(coalesce(p_limit, 20), 1), 100)
$$;

revoke all on function public.studyos_agent_audit_rows(uuid, integer, integer, text, text, timestamptz, timestamptz) from public, anon, authenticated;

-- Registro per il connettore remoto (studyos_list_audit): col segreto, come pull e push.
create or replace function public.studyos_agent_audit_list(
  p_secret text,
  p_limit integer default 20,
  p_offset integer default 0,
  p_entity_id text default null,
  p_tool text default null,
  p_since timestamptz default null,
  p_until timestamptz default null
)
returns table(
  id uuid,
  created_at timestamptz,
  grant_label text,
  from_app boolean,
  tool text,
  entity_type text,
  entity_id text,
  action text,
  before jsonb,
  after jsonb,
  restore_of uuid,
  restored_at timestamptz,
  can_restore boolean,
  total bigint
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_grant public.studyos_agent_grants := public.studyos_agent_grant_of(p_secret);
begin
  if v_grant.user_id is null then
    raise exception 'Collegamento dell''assistente non valido o revocato.' using errcode = '28000';
  end if;
  return query
    select * from public.studyos_agent_audit_rows(v_grant.user_id, p_limit, p_offset, p_entity_id, p_tool, p_since, p_until);
end;
$$;

revoke all on function public.studyos_agent_audit_list(text, integer, integer, text, text, timestamptz, timestamptz) from public;
grant execute on function public.studyos_agent_audit_list(text, integer, integer, text, text, timestamptz, timestamptz) to anon, authenticated;

-- Registro per l'app (Impostazioni → Agenti → «Modifiche del connettore»): solo le voci di chi ha
-- fatto l'accesso.
create or replace function public.studyos_agent_audit_own(
  p_limit integer default 30,
  p_offset integer default 0,
  p_entity_id text default null,
  p_tool text default null,
  p_since timestamptz default null,
  p_until timestamptz default null
)
returns table(
  id uuid,
  created_at timestamptz,
  grant_label text,
  from_app boolean,
  tool text,
  entity_type text,
  entity_id text,
  action text,
  before jsonb,
  after jsonb,
  restore_of uuid,
  restored_at timestamptz,
  can_restore boolean,
  total bigint
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if auth.uid() is null then
    raise exception 'Accedi con il tuo account.' using errcode = '28000';
  end if;
  return query
    select * from public.studyos_agent_audit_rows(auth.uid(), p_limit, p_offset, p_entity_id, p_tool, p_since, p_until);
end;
$$;

revoke all on function public.studyos_agent_audit_own(integer, integer, text, text, timestamptz, timestamptz) from public, anon;
grant execute on function public.studyos_agent_audit_own(integer, integer, text, text, timestamptz, timestamptz) to authenticated;

-- Ripristino di una voce: rimette l'immagine "prima" come nuova scrittura con un timbro nuovo
-- (oltre quello attuale), solo se la riga non è cambiata da quella voce; altrimenti "conflict"
-- con la riga attuale e nessuna scrittura. Una creazione si annulla eliminando, un'eliminazione
-- rimettendo l'elemento (file compresi). Il ripristino lascia a sua volta una voce (restore_of) e
-- segna quella annullata (restored_at). Interna: nessun grant.
create or replace function public.studyos_agent_restore_apply(
  p_user uuid,
  p_audit_id uuid,
  p_grant_id uuid,
  p_label text,
  p_client_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry public.studyos_agent_audit;
  v_item public.studyos_items;
  v_stamp timestamptz;
  v_iso text;
  v_new jsonb;
  v_new_deleted boolean;
  v_action text;
  v_key text;
  v_new_id uuid;
begin
  select * into v_entry from public.studyos_agent_audit as a
  where a.id = p_audit_id and a.user_id = p_user
  for update;
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;
  if v_entry.restored_at is not null then
    return jsonb_build_object('status', 'already_restored', 'entityType', v_entry.entity_type,
      'entityId', v_entry.entity_id, 'restoredAt', v_entry.restored_at);
  end if;

  select * into v_item from public.studyos_items as i
  where i.user_id = p_user and i.entity_type = v_entry.entity_type and i.entity_id = v_entry.entity_id
  for update;
  if not found then
    return jsonb_build_object('status', 'conflict', 'entityType', v_entry.entity_type,
      'entityId', v_entry.entity_id, 'current', null, 'currentDeleted', true);
  end if;
  v_stamp := public.studyos_item_stamp(v_item.payload, v_item.deleted, v_item.updated_at);
  if v_entry.after_stamp is null
     or v_stamp is distinct from v_entry.after_stamp
     or v_item.deleted is distinct from (v_entry.action = 'delete') then
    return jsonb_build_object('status', 'conflict', 'entityType', v_entry.entity_type,
      'entityId', v_entry.entity_id,
      'current', case when v_item.deleted then null else public.studyos_agent_audit_image(v_item.payload) end,
      'currentDeleted', v_item.deleted);
  end if;
  if v_entry.action <> 'create' and jsonb_typeof(v_entry.before) is distinct from 'object' then
    return jsonb_build_object('status', 'conflict', 'entityType', v_entry.entity_type,
      'entityId', v_entry.entity_id, 'current', null, 'currentDeleted', v_item.deleted);
  end if;

  -- Timbro nuovo: adesso, e comunque oltre quello attuale (anche se un orologio avanti l'ha messo nel futuro).
  v_iso := to_char(
    greatest(clock_timestamp(), v_stamp + interval '1 millisecond') at time zone 'utc',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  );
  if v_entry.action = 'create' then
    v_new := jsonb_build_object('id', v_entry.entity_id, 'deletedAt', v_iso);
    v_new_deleted := true;
    v_action := 'delete';
  else
    v_new := (v_entry.before - 'deletedAt') || coalesce(v_entry.before_files, '{}'::jsonb)
      || jsonb_build_object('updatedAt', v_iso);
    if not v_item.deleted then
      foreach v_key in array array['dataUrl', 'cover', 'avatarDataUrl'] loop
        if not (v_new ? v_key) and (v_item.payload ? v_key) then
          v_new := v_new || jsonb_build_object(v_key, v_item.payload->v_key);
        end if;
      end loop;
    end if;
    v_new_deleted := false;
    v_action := case when v_entry.action = 'delete' then 'create' else 'update' end;
  end if;

  update public.studyos_items
  set payload = v_new, deleted = v_new_deleted, encrypted = false, client_id = p_client_id
  where id = v_item.id;

  insert into public.studyos_agent_audit
    (user_id, grant_id, grant_label, tool, entity_type, entity_id, action, before, after, before_files, after_stamp, restore_of)
  values (
    p_user, p_grant_id, coalesce(p_label, ''), 'studyos_restore_change', v_entry.entity_type, v_entry.entity_id, v_action,
    case when v_item.deleted then null else public.studyos_agent_audit_image(v_item.payload) end,
    case when v_new_deleted then v_new else public.studyos_agent_audit_image(v_new) end,
    case when v_action = 'delete' then public.studyos_agent_audit_files(v_item.payload) end,
    public.studyos_item_stamp(v_new, v_new_deleted, now()),
    v_entry.id
  )
  returning id into v_new_id;
  update public.studyos_agent_audit set restored_at = clock_timestamp() where id = v_entry.id;
  perform public.studyos_agent_audit_prune(p_user);

  return jsonb_build_object('status', 'restored', 'auditId', v_new_id, 'entityType', v_entry.entity_type,
    'entityId', v_entry.entity_id, 'action', v_action,
    'item', case when v_new_deleted then null else public.studyos_agent_audit_image(v_new) end);
end;
$$;

revoke all on function public.studyos_agent_restore_apply(uuid, uuid, uuid, text, text) from public, anon, authenticated;

-- Ripristino dal connettore remoto (studyos_restore_change), col segreto. La riga scritta ha il
-- client_id del connettore, come le sue altre scritture.
create or replace function public.studyos_agent_restore(p_secret text, p_audit_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_grant public.studyos_agent_grants := public.studyos_agent_grant_of(p_secret);
begin
  if v_grant.user_id is null then
    raise exception 'Collegamento dell''assistente non valido o revocato.' using errcode = '28000';
  end if;
  return public.studyos_agent_restore_apply(v_grant.user_id, p_audit_id, v_grant.id, v_grant.label, 'agent-remote');
end;
$$;

revoke all on function public.studyos_agent_restore(text, uuid) from public;
grant execute on function public.studyos_agent_restore(text, uuid) to anon, authenticated;

-- Ripristino dall'app («Ripristina» in «Modifiche del connettore»), per chi ha fatto l'accesso.
-- client_id vuoto: anche il dispositivo che ripristina riceve la riga al pull successivo.
create or replace function public.studyos_agent_restore_own(p_audit_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Accedi con il tuo account.' using errcode = '28000';
  end if;
  return public.studyos_agent_restore_apply(auth.uid(), p_audit_id, null, '', null);
end;
$$;

revoke all on function public.studyos_agent_restore_own(uuid) from public, anon;
grant execute on function public.studyos_agent_restore_own(uuid) to authenticated;
