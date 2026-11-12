-- StudyOS: condivisione granulare tra account (migrazione opzionale).
--
-- Da eseguire nel SQL Editor DOPO schema.sql e groups.sql. Rieseguibile: tabelle e righe
-- esistenti restano, funzioni, policy e trigger si aggiornano.
--
-- Una sola copia dei dati: chi riceve una condivisione legge (e con "edit" scrive) le righe
-- originali del proprietario in studyos_items. Le policy del proprietario restano identiche;
-- quelle nuove si aggiungono e consultano studyos_shares. Vedi docs/groups-sync.md.
--
-- Dalla revisione dell'11/11/2026 (conferma email spenta) un invito nominale vale solo per
-- l'account destinatario (recipient_user_id, inviti creati da people.sql) e create_share_invite
-- non crea più inviti per email. Le stesse funzioni e policy sono in people.sql: rieseguire
-- questo file non riapre l'accettazione per email. Dopo questo file riesegui people.sql.

do $$
begin
  if to_regclass('public.studyos_items') is null then
    raise exception 'Esegui prima supabase/schema.sql';
  end if;
  if to_regclass('public.studyos_groups') is null or to_regclass('public.studyos_group_members') is null then
    raise exception 'Esegui prima supabase/groups.sql';
  end if;
end $$;

-- ─── Tabelle ────────────────────────────────────────────────────────────────

create table if not exists public.studyos_shares (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  owner_name text not null default '',
  scope text not null,
  subject_ids text[] not null default '{}',
  permission text not null default 'view',
  grantee_user_id uuid references auth.users (id) on delete cascade,
  grantee_group_id text references public.studyos_groups (id) on delete cascade,
  grantee_name text not null default '',
  grantee_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.studyos_shares drop constraint if exists studyos_shares_scope_check;
alter table public.studyos_shares add constraint studyos_shares_scope_check
  check (scope in ('calendar', 'barb_exams', 'tasks', 'study', 'progress', 'materials', 'goals'));
alter table public.studyos_shares drop constraint if exists studyos_shares_permission_check;
alter table public.studyos_shares add constraint studyos_shares_permission_check
  check (permission in ('view', 'edit') and (scope <> 'barb_exams' or permission = 'view'));
alter table public.studyos_shares drop constraint if exists studyos_shares_subjects_check;
alter table public.studyos_shares add constraint studyos_shares_subjects_check
  check (cardinality(subject_ids) <= 50 and (scope <> 'goals' or cardinality(subject_ids) = 0));
alter table public.studyos_shares drop constraint if exists studyos_shares_target_check;
alter table public.studyos_shares add constraint studyos_shares_target_check
  check (num_nonnulls(grantee_user_id, grantee_group_id) = 1 and grantee_user_id is distinct from owner_id);
alter table public.studyos_shares drop constraint if exists studyos_shares_names_check;
alter table public.studyos_shares add constraint studyos_shares_names_check
  check (char_length(owner_name) <= 120 and char_length(grantee_name) <= 120);

-- Utenti e gruppi hanno spazi di id diversi (l'id di un gruppo lo sceglie il client): il prefisso
-- evita che un gruppo con id uguale a un uuid utente collida con una condivisione diretta.
-- Stessa espressione negli ON CONFLICT di accept_share_invite.
create unique index if not exists studyos_shares_grantee_key
  on public.studyos_shares (owner_id, scope, (coalesce('u:' || grantee_user_id::text, 'g:' || grantee_group_id)));
drop index if exists public.studyos_shares_target_key;
create index if not exists studyos_shares_grantee_user_idx
  on public.studyos_shares (grantee_user_id) where grantee_user_id is not null;
create index if not exists studyos_shares_grantee_group_idx
  on public.studyos_shares (grantee_group_id) where grantee_group_id is not null;
create index if not exists studyos_shares_owner_idx on public.studyos_shares (owner_id);

create table if not exists public.studyos_share_invites (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  owner_name text not null default '',
  offers jsonb not null default '[]'::jsonb,
  requests jsonb not null default '[]'::jsonb,
  recipient_email text,
  token_hash bytea not null,
  status text not null default 'pending',
  accepted_by uuid references auth.users (id) on delete set null,
  expires_at timestamptz not null default now() + interval '14 days',
  created_at timestamptz not null default now()
);

alter table public.studyos_share_invites drop constraint if exists studyos_share_invites_status_check;
alter table public.studyos_share_invites add constraint studyos_share_invites_status_check
  check (status in ('pending', 'accepted', 'declined'));
create unique index if not exists studyos_share_invites_token_key on public.studyos_share_invites (token_hash);
create index if not exists studyos_share_invites_owner_idx on public.studyos_share_invites (owner_id, status);
create index if not exists studyos_share_invites_recipient_idx
  on public.studyos_share_invites (recipient_email, status) where recipient_email is not null;

-- Destinatario di un invito all'account (invite_person_to_share in people.sql). Gli inviti per sola
-- email restano solo come storico: non si creano né si accettano più.
alter table public.studyos_share_invites
  add column if not exists recipient_user_id uuid references auth.users (id) on delete cascade;
create index if not exists studyos_share_invites_recipient_user_idx
  on public.studyos_share_invites (recipient_user_id, status);

create table if not exists public.studyos_item_revisions (
  id bigint generated always as identity primary key,
  owner_id uuid not null references auth.users (id) on delete cascade,
  entity_type text not null,
  entity_id text not null,
  payload jsonb not null,
  deleted boolean not null default false,
  change text not null,
  changed_by uuid,
  changed_at timestamptz not null default now()
);

alter table public.studyos_item_revisions drop constraint if exists studyos_item_revisions_change_check;
alter table public.studyos_item_revisions add constraint studyos_item_revisions_change_check
  check (change in ('create', 'update', 'delete'));
create index if not exists studyos_item_revisions_owner_idx
  on public.studyos_item_revisions (owner_id, changed_at desc);

-- ─── Funzioni di copertura e permesso ───────────────────────────────────────

-- Specchio esatto di scopeCovers in src/lib/sharing.ts (stessi casi in tests/sharing.test.mjs).
create or replace function public.studyos_scope_types(p_scope text)
returns text[]
language sql
immutable
set search_path = pg_catalog
as $$
  select case p_scope
    when 'calendar' then array['calendarEvent']
    when 'barb_exams' then array['calendarEvent']
    when 'tasks' then array['task']
    when 'study' then array['studySession', 'studyTopic']
    when 'progress' then array['exam']
    when 'materials' then array['attachment', 'note']
    when 'goals' then array['goal']
    else array[]::text[]
  end
$$;

create or replace function public.studyos_scope_covers(
  p_scope text,
  p_entity_type text,
  p_payload jsonb,
  p_subject_ids text[]
)
returns boolean
language sql
immutable
set search_path = pg_catalog
as $$
  select p_entity_type = any (public.studyos_scope_types(p_scope))
    and case p_scope
      when 'barb_exams' then starts_with(coalesce(p_payload->>'sourceUid', ''), 'barb-exam-')
      -- I progressi sono gli esami ancora da sostenere: il libretto (voti) non si condivide.
      when 'progress' then (p_payload->>'grade') is null and coalesce(p_payload->>'passFail', 'false') <> 'true'
      else true
    end
    and (
      coalesce(cardinality(p_subject_ids), 0) = 0
      or (
        case when p_entity_type in ('attachment', 'note')
          then case when p_payload->>'linkedEntityType' = 'subject' then p_payload->>'linkedEntityId' end
          else p_payload->>'subjectId'
        end
      ) = any (p_subject_ids)
    )
$$;

-- Condivisioni ricevute da p_owner: dirette o tramite un gruppo di cui si è membri.
create or replace function public.studyos_received_shares(p_owner uuid)
returns setof public.studyos_shares
language sql
stable
security definer
set search_path = public
as $$
  select s.*
  from public.studyos_shares s
  where s.owner_id = p_owner
    and (
      s.grantee_user_id = auth.uid()
      or (
        s.grantee_group_id is not null
        and exists (
          select 1 from public.studyos_group_members m
          where m.group_id = s.grantee_group_id and m.user_id = auth.uid()::text
        )
      )
    )
$$;

-- null = nessun accesso, 'view' o 'edit' (edit vince) sulla riga indicata.
create or replace function public.studyos_item_access(p_owner uuid, p_entity_type text, p_payload jsonb)
returns text
language sql
stable
security definer
set search_path = public
cost 1000
as $$
  select case
    when bool_or(s.permission = 'edit') then 'edit'
    when count(*) > 0 then 'view'
  end
  from public.studyos_received_shares(p_owner) s
  where public.studyos_scope_covers(s.scope, p_entity_type, p_payload, s.subject_ids)
$$;

-- Accesso al tipo, ignorando i filtri: serve ai tombstone (payload ridotto a id e deletedAt).
create or replace function public.studyos_type_access(p_owner uuid, p_entity_type text)
returns text
language sql
stable
security definer
set search_path = public
cost 1000
as $$
  select case
    when bool_or(s.permission = 'edit') then 'edit'
    when count(*) > 0 then 'view'
  end
  from public.studyos_received_shares(p_owner) s
  where p_entity_type = any (public.studyos_scope_types(s.scope))
$$;

-- Persona nota: gruppo in comune o condivisione in una delle due direzioni.
create or replace function public.studyos_knows_user(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null and p_user is not null and p_user <> auth.uid() and (
    exists (
      select 1
      from public.studyos_group_members mine
      join public.studyos_group_members theirs on theirs.group_id = mine.group_id
      where mine.user_id = auth.uid()::text and theirs.user_id = p_user::text
    )
    or exists (
      select 1 from public.studyos_shares s
      where (s.owner_id = auth.uid() and s.grantee_user_id = p_user)
         or (s.owner_id = p_user and s.grantee_user_id = auth.uid())
    )
  )
$$;

-- Email verificata dell'account che chiama (null se manca o non è confermata). È la fonte per gli
-- inviti nominali: il claim email del JWT può mancare e non dice se l'email è confermata, e un
-- confronto con null non fallirebbe mai in modo chiuso.
create or replace function public.studyos_account_email()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select lower(u.email)
  from auth.users u
  where u.id = auth.uid() and u.email_confirmed_at is not null
$$;

revoke all on function public.studyos_received_shares(uuid) from public;
revoke all on function public.studyos_item_access(uuid, text, jsonb) from public;
revoke all on function public.studyos_type_access(uuid, text) from public;
revoke all on function public.studyos_knows_user(uuid) from public;
revoke all on function public.studyos_account_email() from public;
grant execute on function public.studyos_scope_types(text) to authenticated;
grant execute on function public.studyos_scope_covers(text, text, jsonb, text[]) to authenticated;
grant execute on function public.studyos_received_shares(uuid) to authenticated;
grant execute on function public.studyos_item_access(uuid, text, jsonb) to authenticated;
grant execute on function public.studyos_type_access(uuid, text) to authenticated;
grant execute on function public.studyos_knows_user(uuid) to authenticated;
grant execute on function public.studyos_account_email() to authenticated;

-- ─── RLS aggiuntiva su studyos_items ────────────────────────────────────────
-- Le quattro policy "own" di schema.sql restano invariate. In ogni espressione il confronto col
-- proprietario viene prima: la sync personale non chiama mai le funzioni di condivisione.

drop policy if exists studyos_select_shared_items on public.studyos_items;
create policy studyos_select_shared_items on public.studyos_items
for select to authenticated
using (
  user_id <> (select auth.uid())
  and case
    -- Il tombstone minimo (solo id e deletedAt) segue l'accesso al tipo; con altri campi nel payload
    -- (la sync personale non normalizza) vale lo stesso filtro delle righe vive.
    when deleted and jsonb_typeof(payload) = 'object' and (payload - 'id' - 'deletedAt') = '{}'::jsonb
      then public.studyos_type_access(user_id, entity_type) is not null
    else public.studyos_item_access(user_id, entity_type, payload) is not null
  end
);

drop policy if exists studyos_insert_shared_items on public.studyos_items;
create policy studyos_insert_shared_items on public.studyos_items
for insert to authenticated
with check (
  user_id <> (select auth.uid())
  and deleted = false
  and public.studyos_item_access(user_id, entity_type, payload) = 'edit'
);

drop policy if exists studyos_update_shared_items on public.studyos_items;
create policy studyos_update_shared_items on public.studyos_items
for update to authenticated
using (
  user_id <> (select auth.uid())
  and deleted = false
  and public.studyos_item_access(user_id, entity_type, payload) = 'edit'
)
with check (
  user_id <> (select auth.uid())
  and case
    when deleted then public.studyos_type_access(user_id, entity_type) = 'edit'
      and (payload - 'id' - 'deletedAt') = '{}'::jsonb
    else public.studyos_item_access(user_id, entity_type, payload) = 'edit'
  end
);

-- Proprietario, tipo e id di una riga non cambiano mai (nemmeno con un update diretto).
create or replace function public.studyos_items_guard()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if new.user_id <> old.user_id or new.entity_type <> old.entity_type or new.entity_id <> old.entity_id then
    raise exception 'Proprietario, tipo e id di un elemento non si possono cambiare';
  end if;
  return new;
end;
$$;

drop trigger if exists studyos_items_guard on public.studyos_items;
create trigger studyos_items_guard
before update on public.studyos_items
for each row execute function public.studyos_items_guard();

-- Valori che chi riceve scrive nelle righe del proprietario. Le viste del proprietario mostrano quelle
-- righe come dati propri (colori negli stili, copertine come immagini, link, file, appelli ufficiali):
-- - chiavi protette (copertine, file incorporati, UID di import): in una modifica restano quelle
--   salvate, anche se mancano; in una creazione si tolgono;
-- - colore solo esadecimale, link e indirizzo esterno solo http(s), tag in lista e senza aggiungere
--   o togliere il segno di appello ufficiale ("appello-importato").
-- - link di un evento (la pagina ufficiale di un appello importato): li scrive solo il proprietario.
--   In una modifica restano quelli salvati, in una creazione l'evento nasce senza (lista vuota).
--   Nessun editor di chi riceve li cambia (modulo dell'evento, dettaglio, agente).
-- - tipi dei campi: le viste del proprietario leggono titoli, date e liste senza controlli (un titolo
--   oggetto, un inizio numerico o una checklist di testo le manderebbero in errore). In una modifica
--   un campo già salvato non cambia tipo (null da e verso un valore va bene). Per i tipi condivisibili
--   (src/types.ts) i testi obbligatori e le liste ci devono essere e avere il loro tipo (in una
--   modifica, quando cambiano); i testi facoltativi possono mancare o essere null. Gli altri campi
--   (numeri, sì/no, chiavi sconosciute) seguono solo la regola del tipo che non cambia.
-- Un valore uguale a quello salvato passa sempre: è del proprietario (es. il colore di riserva o un
-- link mailto che la sua app salva), e chi modifica rimanda l'elemento intero.
-- Restituisce il payload da salvare, o null se la riga va rifiutata.
drop function if exists public.studyos_recipient_payload(jsonb, jsonb);
create or replace function public.studyos_recipient_payload(p_type text, p_new jsonb, p_current jsonb)
returns jsonb
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare
  v_old jsonb := case when jsonb_typeof(p_current) = 'object' then p_current else '{}'::jsonb end;
  v_create boolean := jsonb_typeof(p_current) is distinct from 'object';
  v_links jsonb;
  v_result jsonb;
  v_text text[];
  v_optional text[];
  v_lists text[];
  v_hex constant text := '^#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$';
  v_web constant text := '^[hH][tT][tT][pP][sS]?://[^[:space:][:cntrl:]]+$';
  -- Come NEVER_KEYS in src/agent/shared.ts, tranne il cronometro (lo chiude un cambio di stato).
  v_protected constant text := '^(cover|dataUrl|storedFile|sourceUid|[A-Za-z]*DataUrl|__proto__)$';
begin
  if jsonb_typeof(p_new) is distinct from 'object' then
    return null;
  end if;
  -- Un campo già salvato non cambia tipo; null da e verso un valore va bene.
  if not v_create and exists (
    select 1
    from jsonb_each(p_new) as field
    where field.key !~ v_protected
      and jsonb_typeof(field.value) <> 'null'
      and coalesce(jsonb_typeof(v_old->field.key), 'null') <> 'null'
      and jsonb_typeof(field.value) <> jsonb_typeof(v_old->field.key)
  ) then
    return null;
  end if;
  if coalesce(p_new->'color', 'null'::jsonb) <> 'null'::jsonb
     and (p_new->'color') is distinct from (v_old->'color')
     and not (jsonb_typeof(p_new->'color') = 'string' and (p_new->>'color') ~ v_hex) then
    return null;
  end if;
  if coalesce(p_new->'externalUrl', 'null'::jsonb) <> 'null'::jsonb
     and (p_new->'externalUrl') is distinct from (v_old->'externalUrl')
     and not (jsonb_typeof(p_new->'externalUrl') = 'string' and (p_new->>'externalUrl') ~ v_web) then
    return null;
  end if;
  -- Ogni link è http(s) o è già tra quelli salvati.
  if coalesce(p_new->'links', 'null'::jsonb) <> 'null'::jsonb
     and (p_new->'links') is distinct from (v_old->'links')
     and (
       jsonb_typeof(p_new->'links') <> 'array'
       or exists (
         select 1
         from jsonb_array_elements(p_new->'links') as link (value)
         where not coalesce(jsonb_typeof(link.value) = 'string' and (link.value #>> '{}') ~ v_web, false)
           and not coalesce(jsonb_typeof(v_old->'links') = 'array' and (v_old->'links') @> jsonb_build_array(link.value), false)
       )
     ) then
    return null;
  end if;
  if (p_new->'tags') is distinct from (v_old->'tags')
     and (
       (coalesce(p_new->'tags', 'null'::jsonb) <> 'null'::jsonb and jsonb_typeof(p_new->'tags') <> 'array')
       or coalesce(jsonb_typeof(p_new->'tags') = 'array' and (p_new->'tags') ? 'appello-importato', false)
         <> coalesce(jsonb_typeof(v_old->'tags') = 'array' and (v_old->'tags') ? 'appello-importato', false)
     ) then
    return null;
  end if;
  if p_type = 'calendarEvent' then
    if jsonb_typeof(p_current) = 'object' then
      -- Mai tolti: le viste del proprietario scorrono event.links.
      v_links := case when jsonb_typeof(v_old->'links') = 'array' then v_old->'links' else '[]'::jsonb end;
    elsif coalesce(p_new->'links', 'null'::jsonb) not in ('null'::jsonb, '[]'::jsonb) then
      return null;
    else
      v_links := '[]'::jsonb;
    end if;
  end if;
  v_result := (
    select coalesce(jsonb_object_agg(field.key, field.value), '{}'::jsonb)
    from jsonb_each(p_new) as field
    where field.key !~ v_protected
  ) || (
    select coalesce(jsonb_object_agg(field.key, field.value), '{}'::jsonb)
    from jsonb_each(v_old) as field
    where field.key ~ v_protected
  );
  if v_links is not null then
    v_result := v_result || jsonb_build_object('links', v_links);
  end if;
  -- Campi per tipo, da src/types.ts (colore, link esterno e chiavi protette hanno le regole sopra).
  v_text := array['id', 'createdAt', 'updatedAt'] || case p_type
    when 'calendarEvent' then array['title', 'description', 'category', 'priority', 'start', 'end', 'status', 'notes']
    when 'task' then array['title', 'description', 'priority', 'status', 'notes', 'energy']
    when 'studySession' then array['title', 'template', 'start', 'status', 'notes']
    when 'studyTopic' then array['subjectId', 'title', 'firstStudiedAt', 'nextReviewDate', 'notes']
    when 'exam' then array['subjectId', 'date', 'status']
    when 'attachment' then array['name', 'mimeType', 'addedAt', 'description']
    when 'note' then array['title', 'body']
    when 'goal' then array['title', 'description', 'category', 'startDate', 'metric', 'status', 'notes']
    else array[]::text[]
  end;
  v_optional := case p_type
    when 'calendarEvent' then array['subjectId', 'goalId', 'recurrence', 'recurrenceUntil']
    when 'task' then array['subjectId', 'dueDate', 'completedAt', 'timerStartedAt', 'timerLastReminderAt']
    when 'studySession' then array['subjectId', 'end']
    when 'studyTopic' then array['lastReviewedAt']
    when 'attachment' then array['linkedEntityType', 'linkedEntityId']
    when 'note' then array['linkedEntityType', 'linkedEntityId']
    when 'goal' then array['deadline']
    else array[]::text[]
  end;
  v_lists := array['tags'] || case p_type
    when 'calendarEvent' then array['checklist', 'attachmentIds', 'links']
    when 'task' then array['subtasks', 'attachmentIds']
    when 'studySession' then array['topics', 'attachmentIds']
    when 'studyTopic' then array['attachmentIds', 'questions']
    when 'exam' then array['program', 'frequentQuestions']
    when 'goal' then array['linkedTaskIds', 'linkedSessionIds']
    else array[]::text[]
  end;
  if exists (
    select 1 from unnest(v_text) as field (key)
    where (v_create or (v_result->field.key) is distinct from (v_old->field.key))
      and coalesce(jsonb_typeof(v_result->field.key), 'missing') <> 'string'
  ) or exists (
    select 1 from unnest(v_optional) as field (key)
    where (v_result->field.key) is distinct from (v_old->field.key)
      and coalesce(jsonb_typeof(v_result->field.key), 'null') not in ('string', 'null')
  ) or exists (
    select 1 from unnest(v_lists) as field (key)
    where (v_create or (v_result->field.key) is distinct from (v_old->field.key))
      and coalesce(jsonb_typeof(v_result->field.key), 'missing') <> 'array'
  ) then
    return null;
  end if;
  return v_result;
end;
$$;

revoke all on function public.studyos_recipient_payload(text, jsonb, jsonb) from public;
grant execute on function public.studyos_recipient_payload(text, jsonb, jsonb) to authenticated;

-- Stessa regola per ogni scrittura di chi riceve, anche diretta sulla tabella (le policy "shared" la
-- consentono): le chiavi protette tornano quelle salvate, un valore non sicuro fa fallire la scrittura.
-- push_shared_rows manda qui solo righe già controllate: le altre tornano "denied" senza errori.
-- Uno stamp nel futuro (orologio avanti o scelto apposta) si salva come adesso, tombstone compresi:
-- altrimenti ogni modifica successiva del proprietario perderebbe il confronto LWW.
-- Le colonne della riga le sceglie il server, mai chi riceve (vedi sotto).
create or replace function public.studyos_items_recipient_values()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
declare
  v_current jsonb;
  v_payload jsonb;
  v_writer text;
begin
  -- La sync del proprietario e le scritture senza utente (SQL Editor) non passano di qui.
  if auth.uid() is null or auth.uid() = new.user_id then
    return new;
  end if;
  -- updated_at è il cursore del pull del proprietario e di chi riceve: uno nel futuro fermerebbe la
  -- sua sync tra dispositivi. In una creazione le colonne hanno i valori di una riga nuova (come
  -- push_studyos_rows: version 1, encrypted false); in una modifica restano quelle salvate.
  -- updated_at e version di una modifica li riscrive studyos_items_updated_at (schema.sql), che parte
  -- dopo questo trigger: i trigger BEFORE partono in ordine di nome.
  if tg_op = 'INSERT' then
    new.id := gen_random_uuid();
    new.created_at := now();
    new.updated_at := now();
    new.version := 1;
    new.encrypted := false;
  else
    new.id := old.id;
    new.created_at := old.created_at;
    new.encrypted := old.encrypted;
  end if;
  -- client_id con l'id di chi scrive: mai uguale a quello di un dispositivo del proprietario o di
  -- un'altra persona (il loro pull e il loro Realtime salterebbero la modifica come propria).
  v_writer := 'r:' || auth.uid()::text || ':';
  new.client_id := v_writer || left(
    case when starts_with(coalesce(new.client_id, ''), v_writer)
      then substr(new.client_id, char_length(v_writer) + 1)
      else coalesce(new.client_id, '')
    end,
    64
  );
  if jsonb_typeof(new.payload) = 'object'
     and public.studyos_item_stamp(new.payload, new.deleted, now()) > now() then
    -- Un timbro nel futuro scende all'ora del server, ma mai sotto «timbro salvato + 1 ms»: con
    -- l'orologio del proprietario avanti la versione salvata è nel futuro, e una modifica accettata
    -- (push_shared_rows) riportata a now() risultava più vecchia sui suoi dispositivi, che la
    -- ricoprivano con la loro copia. Solo verso il basso (least): la stessa scrittura ripetuta dopo
    -- una risposta persa tiene il suo timbro. Stesso formato del client: ISO UTC con millisecondi.
    new.payload := jsonb_set(
      new.payload,
      case when new.deleted then '{deletedAt}' else '{updatedAt}' end::text[],
      to_jsonb(to_char(
        least(
          public.studyos_item_stamp(new.payload, new.deleted, now()),
          greatest(
            now(),
            case when tg_op = 'UPDATE' then
              public.studyos_item_stamp(old.payload, old.deleted, old.updated_at) + interval '1 millisecond'
            end
          )
        ) at time zone 'utc',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      ))
    );
  end if;
  -- I tombstone hanno già la forma { id, deletedAt } (policy e push_shared_rows).
  if new.deleted then
    return new;
  end if;
  if tg_op = 'UPDATE' then
    if not old.deleted then
      v_current := old.payload;
    end if;
  end if;
  v_payload := public.studyos_recipient_payload(new.entity_type, new.payload, v_current);
  if v_payload is null or (v_payload->>'id') is distinct from new.entity_id then
    raise exception 'Valori non consentiti in un elemento di un''altra persona';
  end if;
  new.payload := v_payload;
  return new;
end;
$$;

revoke all on function public.studyos_items_recipient_values() from public;

drop trigger if exists studyos_items_recipient_values on public.studyos_items;
create trigger studyos_items_recipient_values
before insert or update on public.studyos_items
for each row execute function public.studyos_items_recipient_values();

-- Payload senza le chiavi protette (copertine, file incorporati, sourceUid): stessa espressione di
-- v_protected in studyos_recipient_payload e di PROTECTED_KEY in src/lib/sharing.ts.
create or replace function public.studyos_without_protected(p_payload jsonb)
returns jsonb
language sql
immutable
set search_path = pg_catalog
as $$
  select case when jsonb_typeof(p_payload) = 'object' then (
    select coalesce(jsonb_object_agg(field.key, field.value), '{}'::jsonb)
    from jsonb_each(p_payload) as field
    where field.key !~ '^(cover|dataUrl|storedFile|sourceUid|[A-Za-z]*DataUrl|__proto__)$'
  ) else p_payload end
$$;

revoke all on function public.studyos_without_protected(jsonb) from public, anon, authenticated;

-- Cronologia delle modifiche fatte da altri: creazione (riga nuova), modifica ed eliminazione
-- (riga precedente). Il proprietario la legge e ripristina con la sync normale.
-- Le chiavi protette restano solo nelle eliminazioni: chi riceve non le può cambiare, quindi in una
-- modifica sono ancora quelle della riga e il ripristino le riprende dalla copia del proprietario.
-- Così la cronologia non ripete a ogni modifica i file incorporati (fino a 600 KiB ciascuno).
create or replace function public.studyos_items_revision()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_change text;
begin
  if tg_op = 'INSERT' then
    if v_actor is null or v_actor = new.user_id then
      return null;
    end if;
    insert into public.studyos_item_revisions (owner_id, entity_type, entity_id, payload, deleted, change, changed_by)
    values (new.user_id, new.entity_type, new.entity_id, public.studyos_without_protected(new.payload), new.deleted, 'create', v_actor);
  else
    if v_actor is null or v_actor = old.user_id then
      return null;
    end if;
    v_change := case when new.deleted and not old.deleted then 'delete' else 'update' end;
    insert into public.studyos_item_revisions (owner_id, entity_type, entity_id, payload, deleted, change, changed_by)
    values (
      old.user_id, old.entity_type, old.entity_id,
      case when v_change = 'delete' then old.payload else public.studyos_without_protected(old.payload) end,
      old.deleted, v_change, v_actor
    );
  end if;
  delete from public.studyos_item_revisions
  where owner_id = coalesce(new.user_id, old.user_id) and changed_at < now() - interval '90 days';
  return null;
end;
$$;

revoke all on function public.studyos_items_revision() from public;

drop trigger if exists studyos_items_revision on public.studyos_items;
create trigger studyos_items_revision
after insert or update on public.studyos_items
for each row execute function public.studyos_items_revision();

-- Revisioni salvate prima di questa regola: via le chiavi protette da creazioni e modifiche (una
-- volta sola: rieseguendo lo script non trova più nulla da cambiare; su un progetto nuovo non c'è
-- nessuna revisione e non fa nulla).
update public.studyos_item_revisions as revision
set payload = public.studyos_without_protected(revision.payload)
where revision.change <> 'delete'
  and jsonb_typeof(revision.payload) = 'object'
  and exists (
    select 1 from jsonb_object_keys(revision.payload) as field (key)
    where field.key ~ '^(cover|dataUrl|storedFile|sourceUid|[A-Za-z]*DataUrl|__proto__)$'
  );

-- ─── RLS delle nuove tabelle ────────────────────────────────────────────────

alter table public.studyos_shares enable row level security;
alter table public.studyos_share_invites enable row level security;
alter table public.studyos_item_revisions enable row level security;

revoke all on table public.studyos_shares from anon;
revoke all on table public.studyos_share_invites from anon;
revoke all on table public.studyos_item_revisions from anon;
revoke all on table public.studyos_share_invites from authenticated;
revoke all on table public.studyos_item_revisions from authenticated;
-- Toglie anche i privilegi predefiniti (TRUNCATE, TRIGGER, REFERENCES) prima di concedere i quattro necessari.
revoke all on table public.studyos_shares from authenticated;
grant select, insert, update, delete on table public.studyos_shares to authenticated;
-- token_hash resta fuori dalle colonne leggibili.
grant select (id, owner_id, owner_name, offers, requests, recipient_email, recipient_user_id, status, accepted_by, expires_at, created_at)
  on table public.studyos_share_invites to authenticated;
grant delete on table public.studyos_share_invites to authenticated;
grant select, delete on table public.studyos_item_revisions to authenticated;

drop policy if exists studyos_shares_select on public.studyos_shares;
create policy studyos_shares_select on public.studyos_shares
for select to authenticated
using (
  owner_id = (select auth.uid())
  or grantee_user_id = (select auth.uid())
  or (grantee_group_id is not null and public.studyos_is_group_member(grantee_group_id))
);

drop policy if exists studyos_shares_insert on public.studyos_shares;
create policy studyos_shares_insert on public.studyos_shares
for insert to authenticated
with check (
  owner_id = (select auth.uid())
  and grantee_email is null
  and case
    when grantee_group_id is not null then public.studyos_is_group_member(grantee_group_id)
    else public.studyos_knows_user(grantee_user_id)
  end
);

drop policy if exists studyos_shares_update on public.studyos_shares;
create policy studyos_shares_update on public.studyos_shares
for update to authenticated
using (owner_id = (select auth.uid()))
with check (owner_id = (select auth.uid()));

drop policy if exists studyos_shares_delete on public.studyos_shares;
create policy studyos_shares_delete on public.studyos_shares
for delete to authenticated
using (owner_id = (select auth.uid()) or grantee_user_id = (select auth.uid()));

-- Il proprietario cambia permesso, materie e nomi; destinatario e sezione restano quelli.
create or replace function public.studyos_shares_guard()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if new.owner_id <> old.owner_id or new.scope <> old.scope
     or new.grantee_user_id is distinct from old.grantee_user_id
     or new.grantee_group_id is distinct from old.grantee_group_id then
    raise exception 'Destinatario e sezione di una condivisione non si possono cambiare';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists studyos_shares_guard on public.studyos_shares;
create trigger studyos_shares_guard
before update on public.studyos_shares
for each row execute function public.studyos_shares_guard();

-- Chi esce da un gruppo (o ne viene rimosso) smette di condividere con quel gruppo.
create or replace function public.studyos_group_member_left()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.studyos_shares
  where grantee_group_id = old.group_id and owner_id::text = old.user_id;
  return old;
end;
$$;

revoke all on function public.studyos_group_member_left() from public;

drop trigger if exists studyos_group_member_left on public.studyos_group_members;
create trigger studyos_group_member_left
after delete on public.studyos_group_members
for each row execute function public.studyos_group_member_left();

drop policy if exists studyos_share_invites_select on public.studyos_share_invites;
create policy studyos_share_invites_select on public.studyos_share_invites
for select to authenticated
using (
  owner_id = (select auth.uid())
  or (status = 'pending' and recipient_user_id = (select auth.uid()))
);

drop policy if exists studyos_share_invites_delete on public.studyos_share_invites;
create policy studyos_share_invites_delete on public.studyos_share_invites
for delete to authenticated
using (owner_id = (select auth.uid()));

drop policy if exists studyos_item_revisions_select on public.studyos_item_revisions;
create policy studyos_item_revisions_select on public.studyos_item_revisions
for select to authenticated
using (owner_id = (select auth.uid()));

drop policy if exists studyos_item_revisions_delete on public.studyos_item_revisions;
create policy studyos_item_revisions_delete on public.studyos_item_revisions
for delete to authenticated
using (owner_id = (select auth.uid()));

-- ─── RPC ────────────────────────────────────────────────────────────────────

create or replace function public.studyos_validate_share_items(p_items jsonb, p_require boolean)
returns void
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare
  v_item jsonb;
  v_scope text;
  v_permission text;
  v_subjects jsonb;
  v_names jsonb;
  v_seen text[] := '{}';
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'Sezioni non valide';
  end if;
  if p_require and jsonb_array_length(p_items) = 0 then
    raise exception 'Scegli almeno una sezione';
  end if;
  if jsonb_array_length(p_items) > 7 then
    raise exception 'Troppe sezioni';
  end if;
  for v_item in select value from jsonb_array_elements(p_items) loop
    v_scope := v_item->>'scope';
    v_permission := coalesce(v_item->>'permission', 'view');
    v_subjects := coalesce(v_item->'subject_ids', '[]'::jsonb);
    v_names := coalesce(v_item->'subject_names', '[]'::jsonb);
    if v_scope is null or v_scope not in ('calendar', 'barb_exams', 'tasks', 'study', 'progress', 'materials', 'goals') then
      raise exception 'Sezione non valida: %', coalesce(v_scope, '');
    end if;
    if v_scope = any (v_seen) then
      raise exception 'Sezione ripetuta: %', v_scope;
    end if;
    v_seen := v_seen || v_scope;
    if v_permission not in ('view', 'edit') then
      raise exception 'Permesso non valido';
    end if;
    if v_scope = 'barb_exams' and v_permission <> 'view' then
      raise exception 'Gli appelli BARB si condividono solo in lettura';
    end if;
    if jsonb_typeof(v_subjects) <> 'array' or jsonb_array_length(v_subjects) > 50
       or exists (select 1 from jsonb_array_elements(v_subjects) e where jsonb_typeof(e) <> 'string' or char_length(e #>> '{}') > 120) then
      raise exception 'Materie non valide';
    end if;
    if jsonb_typeof(v_names) <> 'array' or jsonb_array_length(v_names) > 50
       or exists (select 1 from jsonb_array_elements(v_names) e where jsonb_typeof(e) <> 'string' or char_length(e #>> '{}') > 120) then
      raise exception 'Nomi delle materie non validi';
    end if;
    if v_scope = 'goals' and jsonb_array_length(v_subjects) > 0 then
      raise exception 'Gli obiettivi non hanno materie';
    end if;
  end loop;
end;
$$;

-- Nome mostrato a chi riceve: mai l'email (l'anteprima di un invito non la deve rivelare).
drop function if exists public.studyos_share_name(text, text);
create or replace function public.studyos_share_name(p_display_name text)
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select left(coalesce(nullif(btrim(p_display_name), ''), 'Studente'), 80)
$$;

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

create or replace function public.accept_share_invite(
  p_invite_id uuid,
  p_token text default null,
  p_display_name text default null,
  p_reciprocal jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite public.studyos_share_invites%rowtype;
  v_email text := public.studyos_account_email();
  v_name text := public.studyos_share_name(p_display_name);
  v_item jsonb;
  v_request jsonb;
  v_granted integer := 0;
  v_back integer := 0;
begin
  v_invite := public.studyos_claim_share_invite(p_invite_id, p_token);
  perform public.studyos_validate_share_items(coalesce(p_reciprocal, '[]'::jsonb), false);

  for v_item in select value from jsonb_array_elements(v_invite.offers) loop
    insert into public.studyos_shares
      (owner_id, owner_name, scope, subject_ids, permission, grantee_user_id, grantee_name, grantee_email)
    values (
      v_invite.owner_id,
      v_invite.owner_name,
      v_item->>'scope',
      array(select jsonb_array_elements_text(coalesce(v_item->'subject_ids', '[]'::jsonb))),
      coalesce(v_item->>'permission', 'view'),
      auth.uid(),
      v_name,
      case when v_invite.recipient_user_id is not null then null else v_email end
    )
    on conflict (owner_id, scope, (coalesce('u:' || grantee_user_id::text, 'g:' || grantee_group_id))) do update set
      permission = excluded.permission,
      subject_ids = excluded.subject_ids,
      owner_name = excluded.owner_name,
      grantee_name = excluded.grantee_name,
      grantee_email = excluded.grantee_email;
    v_granted := v_granted + 1;
  end loop;

  -- Condivisione inversa: solo sezioni richieste, mai con un permesso più ampio di quello chiesto.
  for v_item in select value from jsonb_array_elements(coalesce(p_reciprocal, '[]'::jsonb)) loop
    v_request := null;
    select value into v_request from jsonb_array_elements(v_invite.requests)
    where value->>'scope' = v_item->>'scope';
    if v_request is null then
      raise exception 'Sezione non richiesta: %', v_item->>'scope';
    end if;
    if coalesce(v_item->>'permission', 'view') = 'edit' and coalesce(v_request->>'permission', 'view') <> 'edit' then
      raise exception 'Permesso più ampio di quello richiesto';
    end if;
    insert into public.studyos_shares
      (owner_id, owner_name, scope, subject_ids, permission, grantee_user_id, grantee_name)
    values (
      auth.uid(),
      v_name,
      v_item->>'scope',
      array(select jsonb_array_elements_text(coalesce(v_item->'subject_ids', '[]'::jsonb))),
      coalesce(v_item->>'permission', 'view'),
      v_invite.owner_id,
      v_invite.owner_name
    )
    on conflict (owner_id, scope, (coalesce('u:' || grantee_user_id::text, 'g:' || grantee_group_id))) do update set
      permission = excluded.permission,
      subject_ids = excluded.subject_ids,
      owner_name = excluded.owner_name,
      grantee_name = excluded.grantee_name;
    v_back := v_back + 1;
  end loop;

  update public.studyos_share_invites
  set status = 'accepted', accepted_by = auth.uid()
  where id = v_invite.id;

  return jsonb_build_object(
    'owner_id', v_invite.owner_id,
    'owner_name', v_invite.owner_name,
    'granted', v_granted,
    'shared_back', v_back
  );
end;
$$;

create or replace function public.decline_share_invite(p_invite_id uuid, p_token text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite public.studyos_share_invites%rowtype;
begin
  v_invite := public.studyos_claim_share_invite(p_invite_id, p_token);
  update public.studyos_share_invites set status = 'declined' where id = v_invite.id;
end;
$$;

-- Etichette delle materie dei proprietari che condividono con me: mai note, docente o voto.
-- Con soli filtri per materia si vedono solo le materie scelte.
create or replace function public.shared_subject_labels()
returns table (owner_id uuid, subject_id text, name text, color text, icon text)
language sql
stable
security definer
set search_path = public
as $$
  -- Si parte dalle condivisioni ricevute (dirette o tramite gruppo, escluse le proprie) e si
  -- leggono solo le materie di quei proprietari: l'accesso a studyos_items passa dall'indice
  -- che inizia con user_id, senza scorrere le materie di tutti.
  with mine as (
    select s.owner_id as src_owner, s.subject_ids as src_subjects
    from public.studyos_shares s
    where s.scope <> 'goals' and s.owner_id <> auth.uid() and s.grantee_user_id = auth.uid()
    union all
    select s.owner_id, s.subject_ids
    from public.studyos_shares s
    join public.studyos_group_members m on m.group_id = s.grantee_group_id
    where s.scope <> 'goals' and s.owner_id <> auth.uid() and m.user_id = auth.uid()::text
  )
  select
    i.user_id,
    i.entity_id,
    left(coalesce(i.payload->>'name', ''), 120),
    left(coalesce(i.payload->>'color', ''), 40),
    left(coalesce(i.payload->>'icon', ''), 40)
  from (select distinct mine.src_owner from mine) o
  join public.studyos_items i on i.user_id = o.src_owner and i.entity_type = 'subject'
  where i.deleted = false
    and exists (
      select 1 from mine
      where mine.src_owner = i.user_id
        and (cardinality(mine.src_subjects) = 0 or i.entity_id = any (mine.src_subjects))
    )
$$;

-- Scritture di chi riceve sulle righe del proprietario, con la regola LWW di push_studyos_rows.
-- Ogni riga viene controllata prima di scrivere: una riga non consentita torna "denied" e non
-- fa fallire il batch. RLS resta attiva (SECURITY INVOKER) come garanzia finale.
-- Scrittura di chi riceve più recente della riga salvata. Il timbro salvato conta al massimo fino
-- all'ora del server in cui è stato scritto (`updated_at`): con l'orologio del proprietario avanti
-- la sua versione aveva un timbro nel futuro e ogni modifica di chi riceve, fatta dopo, perdeva
-- come "stale" finché l'ora vera non lo superava.
create or replace function public.studyos_recipient_newer(
  p_payload jsonb,
  p_deleted boolean,
  p_current jsonb,
  p_current_deleted boolean,
  p_current_updated timestamptz
)
returns boolean
language sql
stable
set search_path = pg_catalog
as $$
  select public.studyos_item_stamp(p_payload, p_deleted, now())
    > least(public.studyos_item_stamp(p_current, p_current_deleted, p_current_updated), p_current_updated)
$$;

-- Payload accettato con un timbro che supera quello salvato: se il suo è più vecchio (caso sopra)
-- diventa «timbro salvato + 1 ms», così anche i dispositivi del proprietario la vedono più recente
-- della loro copia e non la ricoprono.
create or replace function public.studyos_recipient_stamped(
  p_payload jsonb,
  p_deleted boolean,
  p_current jsonb,
  p_current_deleted boolean,
  p_current_updated timestamptz
)
returns jsonb
language sql
stable
set search_path = pg_catalog
as $$
  select case
    when public.studyos_item_stamp(p_payload, p_deleted, now())
      > public.studyos_item_stamp(p_current, p_current_deleted, p_current_updated)
      then p_payload
    else jsonb_set(
      p_payload,
      case when p_deleted then '{deletedAt}' else '{updatedAt}' end::text[],
      to_jsonb(to_char(
        (public.studyos_item_stamp(p_current, p_current_deleted, p_current_updated) + interval '1 millisecond')
          at time zone 'utc',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      ))
    )
  end
$$;

revoke all on function public.studyos_recipient_newer(jsonb, boolean, jsonb, boolean, timestamptz) from public;
revoke all on function public.studyos_recipient_stamped(jsonb, boolean, jsonb, boolean, timestamptz) from public;
grant execute on function public.studyos_recipient_newer(jsonb, boolean, jsonb, boolean, timestamptz) to authenticated;
grant execute on function public.studyos_recipient_stamped(jsonb, boolean, jsonb, boolean, timestamptz) to authenticated;

create or replace function public.push_shared_rows(p_owner_id uuid, p_client_id text, p_rows jsonb)
returns table (entity_type text, entity_id text, accepted boolean, reason text)
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
  v_exists boolean;
  v_applied boolean;
  v_reason text;
  v_current public.studyos_items%rowtype;
begin
  if auth.uid() is null or p_owner_id is null or p_owner_id = auth.uid() then
    raise exception 'Proprietario non valido';
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
    v_reason := null;
    select * into v_current from public.studyos_items i
    where i.user_id = p_owner_id and i.entity_type = v_type and i.entity_id = v_id;
    v_exists := found;
    if not v_deleted then
      -- Chiavi protette dalla riga salvata, colori e link sicuri, tipi dei campi; null = riga rifiutata.
      v_payload := public.studyos_recipient_payload(v_type, v_payload, case when v_exists and not v_current.deleted then v_current.payload end);
    end if;

    if v_deleted then
      v_payload := jsonb_build_object('id', v_id, 'deletedAt', coalesce(v_payload->>'deletedAt', v_payload->>'updatedAt'));
      if (not v_exists or v_current.deleted)
         and public.studyos_type_access(p_owner_id, v_type) = 'edit' then
        -- Già eliminato o mai esistito: per chi può modificare quel tipo l'eliminazione è già fatta
        -- (risposta persa, secondo dispositivo). Non "denied", che diceva «permesso tolto».
        v_reason := 'gone';
      elsif not v_exists or v_current.deleted
         or public.studyos_item_access(p_owner_id, v_type, v_current.payload) is distinct from 'edit' then
        v_reason := 'denied';
      else
        update public.studyos_items as current_row
        set payload = public.studyos_recipient_stamped(v_payload, true, current_row.payload, current_row.deleted, current_row.updated_at),
          deleted = true, encrypted = false, client_id = p_client_id
        where current_row.user_id = p_owner_id and current_row.entity_type = v_type and current_row.entity_id = v_id
          and public.studyos_recipient_newer(v_payload, true, current_row.payload, current_row.deleted, current_row.updated_at)
        returning true into v_applied;
        if not coalesce(v_applied, false) then
          v_reason := 'stale';
        end if;
      end if;
    elsif v_exists and v_current.deleted
       and public.studyos_type_access(p_owner_id, v_type) = 'edit' then
      -- Modifica di un elemento che il proprietario ha eliminato nel frattempo.
      v_reason := 'gone';
    elsif v_payload is null
       or public.studyos_item_access(p_owner_id, v_type, v_payload) is distinct from 'edit'
       or (v_exists and (v_current.deleted
         or public.studyos_item_access(p_owner_id, v_type, v_current.payload) is distinct from 'edit')) then
      v_reason := 'denied';
    elsif v_exists then
      update public.studyos_items as current_row
      set payload = case
          when public.studyos_item_stamp(v_payload, false, now())
              = public.studyos_item_stamp(current_row.payload, current_row.deleted, current_row.updated_at)
            and v_payload = current_row.payload
            then v_payload
          else public.studyos_recipient_stamped(v_payload, false, current_row.payload, current_row.deleted, current_row.updated_at)
        end,
        deleted = false, encrypted = false, client_id = p_client_id
      where current_row.user_id = p_owner_id and current_row.entity_type = v_type and current_row.entity_id = v_id
        and (
          public.studyos_recipient_newer(v_payload, false, current_row.payload, current_row.deleted, current_row.updated_at)
          or (
            public.studyos_item_stamp(v_payload, false, now())
              = public.studyos_item_stamp(current_row.payload, current_row.deleted, current_row.updated_at)
            and v_payload = current_row.payload
          )
        )
      returning true into v_applied;
      if not coalesce(v_applied, false) then
        v_reason := 'stale';
      end if;
    else
      insert into public.studyos_items (user_id, entity_type, entity_id, payload, deleted, encrypted, client_id)
      values (p_owner_id, v_type, v_id, v_payload, false, false, p_client_id)
      on conflict (user_id, entity_type, entity_id) do nothing
      returning true into v_applied;
      if not coalesce(v_applied, false) then
        -- La riga esiste già. Se per chi scrive è visibile (RLS) è un inserimento concorrente: "stale";
        -- altrimenti non si rivela che esiste: "denied".
        perform 1 from public.studyos_items i
        where i.user_id = p_owner_id and i.entity_type = v_type and i.entity_id = v_id;
        v_reason := case when found then 'stale' else 'denied' end;
      end if;
    end if;

    entity_type := v_type;
    entity_id := v_id;
    accepted := coalesce(v_applied, false);
    reason := v_reason;
    return next;
  end loop;
end;
$$;

revoke all on function public.studyos_validate_share_items(jsonb, boolean) from public;
revoke all on function public.studyos_share_name(text) from public;
revoke all on function public.create_share_invite(text, jsonb, jsonb, text) from public;
revoke all on function public.preview_share_invite(text) from public;
revoke all on function public.studyos_claim_share_invite(uuid, text) from public;
revoke all on function public.accept_share_invite(uuid, text, text, jsonb) from public;
revoke all on function public.decline_share_invite(uuid, text) from public;
revoke all on function public.shared_subject_labels() from public;
revoke all on function public.push_shared_rows(uuid, text, jsonb) from public;
grant execute on function public.studyos_validate_share_items(jsonb, boolean) to authenticated;
grant execute on function public.studyos_share_name(text) to authenticated;
grant execute on function public.create_share_invite(text, jsonb, jsonb, text) to authenticated;
grant execute on function public.preview_share_invite(text) to authenticated;
grant execute on function public.accept_share_invite(uuid, text, text, jsonb) to authenticated;
grant execute on function public.decline_share_invite(uuid, text) to authenticated;
grant execute on function public.shared_subject_labels() to authenticated;
grant execute on function public.push_shared_rows(uuid, text, jsonb) to authenticated;

-- Su alcuni progetti i privilegi predefiniti danno EXECUTE anche ad anon e authenticated, e
-- "revoke ... from public" non li toglie: si tolgono in modo esplicito (come per push_studyos_rows
-- in schema.sql). studyos_claim_share_invite resta chiamabile solo dalle RPC DEFINER.
revoke all on function public.studyos_scope_types(text) from public, anon;
revoke all on function public.studyos_scope_covers(text, text, jsonb, text[]) from public, anon;
revoke all on function public.studyos_received_shares(uuid) from anon;
revoke all on function public.studyos_item_access(uuid, text, jsonb) from anon;
revoke all on function public.studyos_type_access(uuid, text) from anon;
revoke all on function public.studyos_knows_user(uuid) from anon;
revoke all on function public.studyos_account_email() from anon;
revoke all on function public.studyos_recipient_payload(text, jsonb, jsonb) from anon;
revoke all on function public.studyos_validate_share_items(jsonb, boolean) from anon;
revoke all on function public.studyos_share_name(text) from anon;
revoke all on function public.create_share_invite(text, jsonb, jsonb, text) from anon;
revoke all on function public.preview_share_invite(text) from anon;
revoke all on function public.accept_share_invite(uuid, text, text, jsonb) from anon;
revoke all on function public.decline_share_invite(uuid, text) from anon;
revoke all on function public.shared_subject_labels() from anon;
revoke all on function public.push_shared_rows(uuid, text, jsonb) from anon;
revoke all on function public.studyos_claim_share_invite(uuid, text) from anon, authenticated;

-- ─── Realtime ───────────────────────────────────────────────────────────────
-- studyos_items è già nella pubblicazione (schema.sql). Il client usa gli eventi come segnale.

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'studyos_shares'
    ) then
      execute 'alter publication supabase_realtime add table public.studyos_shares';
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'studyos_share_invites'
    ) then
      execute 'alter publication supabase_realtime add table public.studyos_share_invites';
    end if;
  end if;
end $$;
