-- Pezzi di Supabase che auth-stub.sql non ha, per provare tutti gli 8 script su un Postgres usa e getta
-- (scripts/supabase/upgrade-from-published.sh). Mai sul progetto reale o sullo stack locale.
-- Niente pg_net, Vault e pg_cron: come il progetto prima di accendere le notifiche.

-- Sessioni di Supabase Auth (people.sql vi aggancia la pulizia delle iscrizioni push).
create table if not exists auth.sessions (
  id uuid primary key,
  user_id uuid references auth.users (id) on delete cascade,
  created_at timestamptz default now()
);

-- Schema storage minimo (storage.sql: bucket privato e policy sugli oggetti).
create schema if not exists storage;
create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  owner uuid,
  public boolean default false,
  avif_autodetection boolean default false,
  file_size_limit bigint,
  allowed_mime_types text[],
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text,
  owner uuid,
  owner_id text,
  metadata jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (bucket_id, name)
);
alter table storage.objects enable row level security;
create or replace function storage.foldername(name text) returns text[] language plpgsql as $$
declare _parts text[];
begin
  select string_to_array(name, '/') into _parts;
  return _parts[1:array_length(_parts, 1) - 1];
end
$$;
create or replace function storage.filename(name text) returns text language plpgsql as $$
declare _parts text[];
begin
  select string_to_array(name, '/') into _parts;
  return _parts[array_length(_parts, 1)];
end
$$;
grant usage on schema storage to authenticated, anon;
grant select, insert, update, delete on storage.objects to authenticated;
grant select on storage.buckets to authenticated;
grant execute on all functions in schema storage to authenticated, anon;

-- Pubblicazione di Realtime (sharing.sql e group-exams.sql vi aggiungono le loro tabelle).
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;
