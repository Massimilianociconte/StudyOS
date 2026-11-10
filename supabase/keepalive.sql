-- Battito del database per il piano Free di Supabase.
--
-- Un progetto Free va in pausa dopo una settimana senza attività reale del database:
-- le richieste HTTP che non eseguono query possono non bastare. I cron (Cloudflare Worker
-- `worker/keepalive.ts` e GitHub Actions `supabase-keepalive.yml`) chiamano questa
-- funzione, che aggiorna una sola riga: una vera scrittura in Postgres a ogni giro.
--
-- Da eseguire una volta nel SQL Editor del progetto, dopo schema.sql. Si può rieseguire.
-- Espone solo l'orario dell'ultimo battito: nessun dato degli utenti.

create table if not exists public.studyos_keepalive (
  id smallint primary key default 1 check (id = 1),
  pinged_at timestamptz not null default now(),
  source text not null default 'unknown'
);

alter table public.studyos_keepalive enable row level security;
revoke all on table public.studyos_keepalive from anon, authenticated;

create or replace function public.studyos_keepalive(p_source text default 'cron')
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  with previous as (
    select pinged_at, source from public.studyos_keepalive where id = 1
  ),
  beat as (
    insert into public.studyos_keepalive as k (id, pinged_at, source)
    values (1, now(), left(coalesce(nullif(trim(p_source), ''), 'cron'), 32))
    on conflict (id) do update set pinged_at = excluded.pinged_at, source = excluded.source
    returning k.pinged_at
  )
  select jsonb_build_object(
    'pinged_at', (select pinged_at from beat),
    'previous_at', (select pinged_at from previous),
    'previous_source', (select source from previous)
  );
$$;

revoke all on function public.studyos_keepalive(text) from public;
grant execute on function public.studyos_keepalive(text) to anon, authenticated;
