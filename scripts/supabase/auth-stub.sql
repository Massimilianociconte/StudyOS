-- Stub minimo di Supabase per provare gli script su un Postgres usa e getta (mai sul progetto reale).
-- auth.uid() legge request.jwt.claim.sub; quattro utenti di prova.
do $$ begin if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if; end $$;
do $$ begin if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if; end $$;
do $$ begin if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if; end $$;
create schema auth;
create table auth.users (id uuid primary key, email text, email_confirmed_at timestamptz, deleted_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
  )::uuid
$$;
create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;
create function auth.role() returns text language sql stable as $$ select 'authenticated' $$;
grant usage on schema auth to authenticated, anon;
grant execute on all functions in schema auth to authenticated, anon;
grant usage on schema public to authenticated, anon;
insert into auth.users (id, email, email_confirmed_at) values
  ('11111111-1111-1111-1111-111111111111', 'owner@test.local', now()),
  ('22222222-2222-2222-2222-222222222222', 'bea@test.local', now()),
  ('504b3482-7f1b-4add-bfbc-7b3effbf21d7', 'a@test.local', now()),
  ('fc0191e0-6663-4a43-b060-131e397f02cc', 'b@test.local', now());
