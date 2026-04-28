-- StudyOS cloud sync schema for Supabase.
-- Run this in the Supabase SQL editor after creating the project.

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

create index if not exists studyos_items_user_updated_idx
  on public.studyos_items (user_id, updated_at desc);

create index if not exists studyos_items_user_type_idx
  on public.studyos_items (user_id, entity_type);

create or replace function public.set_studyos_updated_at()
returns trigger
language plpgsql
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
