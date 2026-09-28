-- StudyOS University Data Layer (opzionale, solo mirror cloud).
-- Il dataset BARB resta local-first (seed + IndexedDB). Queste tabelle servono
-- SOLO se in futuro si vuole condividere snapshot verificati tra dispositivi.
-- Non toccano public.studyos_items.
-- Non eseguire per il deploy corrente della PWA: la tabella non è usata.

create table if not exists public.university_sync_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null default 'unimi-barb',
  scope text not null default 'all',
  report jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.university_sync_reports enable row level security;

revoke all on table public.university_sync_reports from anon;
grant select, insert on table public.university_sync_reports to authenticated;

drop policy if exists "university_reports_select_own" on public.university_sync_reports;
create policy "university_reports_select_own"
on public.university_sync_reports for select to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "university_reports_insert_own" on public.university_sync_reports;
create policy "university_reports_insert_own"
on public.university_sync_reports for insert to authenticated
with check ((select auth.uid()) = user_id);
