-- Connettore remoto degli agenti: ChatGPT lavora sui dati cloud anche con StudyOS chiuso.
-- Da eseguire nel SQL Editor dopo schema.sql. Rieseguibile.
--
-- Con «Consenti» l'app (con l'accesso fatto) crea un permesso e riceve un segreto casuale;
-- nel database resta solo il suo hash SHA-256. L'hub del connettore conserva il segreto e
-- con la chiave publishable chiama solo le due funzioni qui sotto: leggono e scrivono le
-- righe di studyos_items di quell'account, con la stessa regola LWW di push_studyos_rows.
-- Il segreto non apre nient'altro: né sessioni, né altre tabelle, né altri account.

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
-- Senza i file incorporati: gli strumenti degli agenti non li leggono.
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
        then i.payload - 'dataUrl' - 'cover' - 'avatarDataUrl'
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

-- Stessa scrittura condizionale di push_studyos_rows, per l'account del segreto. I file
-- incorporati tolti dal pull tornano dalla riga attuale se il payload non li porta.
create or replace function public.studyos_agent_push(
  p_secret text,
  p_client_id text,
  p_rows jsonb
)
returns table(entity_type text, entity_id text, accepted boolean)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_user uuid := public.studyos_agent_user(p_secret);
  v_row jsonb;
  v_type text;
  v_id text;
  v_payload jsonb;
  v_deleted boolean;
  v_current jsonb;
  v_key text;
  v_applied boolean;
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

    if not v_deleted then
      select i.payload into v_current from public.studyos_items as i
      where i.user_id = v_user and i.entity_type = v_type and i.entity_id = v_id;
      if jsonb_typeof(v_current) = 'object' then
        foreach v_key in array array['dataUrl', 'cover', 'avatarDataUrl'] loop
          if not (v_payload ? v_key) and (v_current ? v_key) then
            v_payload := v_payload || jsonb_build_object(v_key, v_current->v_key);
          end if;
        end loop;
      end if;
    end if;

    v_applied := false;
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
    returning true into v_applied;

    entity_type := v_type;
    entity_id := v_id;
    accepted := coalesce(v_applied, false);
    return next;
  end loop;
end;
$$;

revoke all on function public.studyos_agent_push(text, text, jsonb) from public;
grant execute on function public.studyos_agent_push(text, text, jsonb) to anon, authenticated;
