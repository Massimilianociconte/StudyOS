-- StudyOS cloud sync schema for Supabase Free or paid projects.
-- Paste this entire file into Dashboard > SQL Editor > New Query, then Run.
-- Re-running preserves studyos_items rows and refreshes functions/policies.
-- Do not paste university.sql for the current PWA: it is an unused optional mirror.

create table if not exists public.studyos_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  entity_type text not null,
  entity_id text not null,
  payload jsonb not null,
  encrypted boolean not null default true,
  deleted boolean not null default false,
  version bigint not null default 1,
  client_id text,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (user_id, entity_type, entity_id)
);

-- Indici ridondanti delle versioni precedenti: coperti dall'indice del cursore (letto anche
-- all'indietro) e dal vincolo unique (user_id, entity_type, entity_id). Rimossi per ridurre
-- il costo di ogni scrittura.
drop index if exists public.studyos_items_user_updated_idx;
drop index if exists public.studyos_items_user_type_idx;

-- Pull incrementale del sync per-entità: where user_id = ? and updated_at >= ? order by updated_at, id
create index if not exists studyos_items_user_cursor_idx
  on public.studyos_items (user_id, updated_at asc, id asc);

create or replace function public.set_studyos_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  new.updated_at = now();
  new.version = old.version + 1;
  return new;
end;
$$;

drop trigger if exists studyos_items_updated_at on public.studyos_items;
create trigger studyos_items_updated_at
before update on public.studyos_items
for each row execute function public.set_studyos_updated_at();

alter table public.studyos_items enable row level security;

revoke all on table public.studyos_items from anon;
grant select, insert, update, delete on table public.studyos_items to authenticated;

drop policy if exists "studyos_select_own_items" on public.studyos_items;
create policy "studyos_select_own_items"
on public.studyos_items
for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "studyos_insert_own_items" on public.studyos_items;
create policy "studyos_insert_own_items"
on public.studyos_items
for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "studyos_update_own_items" on public.studyos_items;
create policy "studyos_update_own_items"
on public.studyos_items
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "studyos_delete_own_items" on public.studyos_items;
create policy "studyos_delete_own_items"
on public.studyos_items
for delete
to authenticated
using ((select auth.uid()) = user_id);

-- Il timestamp dell'entità è quello del client usato dal merge LWW. Per le righe
-- legacy o con data non valida si usa updated_at del server come ripiego.
create or replace function public.studyos_item_stamp(
  p_payload jsonb,
  p_deleted boolean,
  p_fallback timestamptz
)
returns timestamptz
language sql
stable
set search_path = pg_catalog
as $$
  -- Nessun blocco EXCEPTION: ogni chiamata ne aprirebbe una subtransaction (fino a 4 per riga,
  -- 800 per batch), con overflow della cache subxid e rallentamenti per tutto il database.
  -- Il formato ISO viene validato con una regex prima del cast.
  select case
    when stamp ~ '^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(\.\d{1,6})?(Z|[+-]([01]\d|2[0-3]):?[0-5]\d)$'
      then stamp::timestamptz
    else p_fallback
  end
  from (
    select case when p_deleted
      then coalesce(p_payload->>'deletedAt', p_payload->>'updatedAt')
      else p_payload->>'updatedAt'
    end as stamp
  ) as source
$$;

revoke all on function public.studyos_item_stamp(jsonb, boolean, timestamptz) from public;
grant execute on function public.studyos_item_stamp(jsonb, boolean, timestamptz) to authenticated;

-- PostgREST esegue l'intero batch in una transazione. Il controllo LWW avviene
-- nello stesso INSERT/UPDATE che scrive la riga, quindi due dispositivi non
-- possono superarlo con un pull concorrente. RLS resta attiva (SECURITY INVOKER).
create or replace function public.push_studyos_rows(
  p_user_id uuid,
  p_client_id text,
  p_rows jsonb
)
returns table(entity_type text, entity_id text, accepted boolean)
language plpgsql
security invoker
set search_path = public
as $$
#variable_conflict use_column
declare
  v_row jsonb;
  v_type text;
  v_id text;
  v_payload jsonb;
  v_deleted boolean;
  v_applied boolean;
begin
  if auth.uid() is null or auth.uid() <> p_user_id then
    raise exception 'Account di sincronizzazione non corrispondente';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 200 then
    raise exception 'Batch di sincronizzazione non valido';
  end if;

  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_type := v_row->>'entity_type';
    v_id := v_row->>'entity_id';
    v_payload := v_row->'payload';
    v_deleted := coalesce((v_row->>'deleted')::boolean, false);
    if nullif(v_type, '') is null or nullif(v_id, '') is null
       or jsonb_typeof(v_payload) <> 'object'
       or (v_payload->>'id') is distinct from v_id then
      raise exception 'Entità di sincronizzazione non valida';
    end if;

    v_applied := false;
    insert into public.studyos_items as current_row
      (user_id, entity_type, entity_id, payload, deleted, encrypted, client_id)
    values (p_user_id, v_type, v_id, v_payload, v_deleted, false, p_client_id)
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

revoke all on function public.push_studyos_rows(uuid, text, jsonb) from public;
revoke all on function public.push_studyos_rows(uuid, text, jsonb) from anon;
grant execute on function public.push_studyos_rows(uuid, text, jsonb) to authenticated;

-- Realtime: il client usa gli eventi solo come segnale per un pull incrementale.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'studyos_items'
     ) then
    execute 'alter publication supabase_realtime add table public.studyos_items';
  end if;
end $$;

-- Nota migrazione (sync v2, per-entità): la vecchia riga entity_type='snapshot', entity_id='main'
-- non viene più scritta; resta come backup e viene letta una sola volta per migrare i dati.
