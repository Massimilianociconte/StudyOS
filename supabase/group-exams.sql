-- Appelli condivisi dei gruppi, cronologia delle modifiche e correzioni del gruppo al catalogo BARB.
-- Da eseguire nel SQL Editor dopo groups.sql (versione del 12/11), sharing.sql e people.sql. Rieseguibile.
--
-- Un appello del gruppo (corso + data + tipo di prova) esiste una volta sola per gruppo: lo vedono
-- tutti i membri, lo modifica chiunque, lo elimina solo chi l'ha aggiunto o chi gestisce il gruppo.
-- Le scritture passano solo dalle funzioni qui sotto: controllano la versione da cui parte chi
-- modifica (`conflict` se nel frattempo è cambiato), scrivono la cronologia e la voce di attività.
-- Le scelte personali (appello scelto, stato, voto, promemoria) non stanno qui: sono dati personali
-- (`examPlan` in studyos_items) e il gruppo non le vede.

do $$
begin
  if to_regclass('public.studyos_groups') is null
     or to_regclass('public.studyos_group_members') is null
     or to_regclass('public.studyos_group_activity') is null
     or to_regprocedure('public.studyos_group_stamp()') is null
     or to_regprocedure('public.studyos_is_group_member(text)') is null
     or to_regprocedure('public.studyos_group_role(text)') is null
     or not exists (select 1 from pg_trigger
                    where tgrelid = to_regclass('public.studyos_group_members')
                      and tgname = 'studyos_group_members_pin_identity' and not tgisinternal
                      and tgenabled in ('O', 'A') and tgtype = 19
                      and tgfoid = to_regprocedure('public.studyos_group_members_pin_identity()')) then
    raise exception 'Esegui prima groups.sql (versione del 12/11 o successiva): mancano tabelle, funzioni o la guardia sulle righe dei membri.';
  end if;
end $$;

-- Gli id dei gruppi li sceglie il client (forma «studyGroup_…»): niente testo libero (email, spazi) in un id che
-- viaggia verso gli agenti. «not valid»: i gruppi già salvati restano, solo i nuovi devono avere la forma giusta.
alter table public.studyos_groups drop constraint if exists studyos_groups_id_shape;
alter table public.studyos_groups add constraint studyos_groups_id_shape
  check (id ~ '^[A-Za-z0-9_-]{1,120}$') not valid;

-- ---------------------------------------------------------------------------------------------
-- Funzioni pure
-- ---------------------------------------------------------------------------------------------

-- Nome del corso confrontabile: accenti tolti, solo lettere e cifre ASCII minuscole, spazi singoli.
-- Stessa regola di normalizeCourseName in src/lib/groupExams.ts (stessi esempi nei due test).
create or replace function public.studyos_course_norm(p_name text)
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select btrim(lower(regexp_replace(
    translate(coalesce(p_name, ''),
      'ÀÁÂÃÄÅàáâãäåÈÉÊËèéêëÌÍÎÏìíîïÒÓÔÕÖòóôõöÙÚÛÜùúûüÇçÑñ',
      'AAAAAAaaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCcNn'),
    '[^A-Za-z0-9]+', ' ', 'g')))
$$;

-- Giorno AAAA-MM-GG valido, altrimenti null (mai un errore).
create or replace function public.studyos_try_date(p_value text)
returns date
language plpgsql
stable
set search_path = pg_catalog
as $$
begin
  if p_value is null or p_value !~ '^\d{4}-\d{2}-\d{2}$' then
    return null;
  end if;
  return p_value::date;
exception when others then
  return null;
end;
$$;

create or replace function public.studyos_exam_kind_label(p_kind text)
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select case p_kind
    when 'appello' then 'Appello'
    when 'preappello' then 'Preappello'
    when 'prova_in_itinere' then 'Prova in itinere'
    when 'scritto' then 'Scritto'
    when 'orale' then 'Orale'
    when 'laboratorio' then 'Laboratorio'
    else 'Altra prova'
  end
$$;

-- Regola unica sulle email (stessa di src/lib/institutionalEmail.ts; stessi esempi in
-- tests/fixtures/emailVectors.json, da cui nasce scripts/supabase/email-vectors-tests.sql):
-- 1. il testo si normalizza: NFKC («＠» e «﹫» diventano «@»), niente caratteri invisibili (U+00AD, U+200B-200F,
--    U+202A-202E, U+2060, U+2066-2069, U+FEFF), gli spazi strani (U+0085, U+2028, U+2029, U+1680) diventano spazi e
--    «%40», «&#64;», «&commat;», «(at)», «[at]», «{at}» diventano «@». Senza nessuna «@» il testo resta com'è stato
--    scritto (nessuna normalizzazione visibile);
-- 2. ogni corsa di caratteri senza spazi ASCII che contiene una «@» è UN candidato (oltre 300 caratteri: sempre
--    nascosto per intero);
-- 3. si toglie dal candidato l'inizio (virgolette, parentesi aperte, «mailto:») e la fine (punteggiatura): il
--    resto si tiene solo se è per intero «parte-locale@unimi.it», parte locale ASCII `[A-Za-z0-9._+-]+`, dominio
--    confrontato solo con maiuscole/minuscole ASCII; altrimenti tutto il candidato diventa «[email nascosta]». Se
--    il candidato nascosto inizia con «@» si nasconde anche la corsa prima, se finisce con «@» anche quella dopo.
-- Gli indirizzi tenuti restano con le loro maiuscole. Tempo lineare: nessun testo lungo può far scadere una chiamata.
create or replace function public.studyos_email_normalize(p_text text)
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select regexp_replace(
    regexp_replace(
      regexp_replace(normalize(coalesce(p_text, ''), NFKC),
        '[\u00AD\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]', '', 'g'),
      '[\u0085\u2028\u2029\u1680]', ' ', 'g'),
    '%40|&#0*64;|&#[xX]0*40;|&[cC][oO][mM][mM][aA][tT];|\([aA][tT]\)|\[[aA][tT]\]|\{[aA][tT]\}', '@', 'g')
$$;

-- Parte che lavora sul testo GIÀ normalizzato e con almeno una «@».
create or replace function public.studyos_hide_emails_normalized(p_norm text, p_keep boolean)
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  with tok as (
    select r.ord, r.m[1] as ws, r.m[2] as run
    from regexp_matches(p_norm, '([ \t\n\r\f\v]+)|([^ \t\n\r\f\v]+)', 'g') with ordinality as r (m, ord)
  ), runs as (
    select t.ord, t.run, char_length(t.run) > 300 as long_run, position('@' in t.run) > 0 as has_at
    from tok as t where t.run is not null
  ), parts as (
    select u.ord, u.has_at, u.long_run,
      case when u.has_at and not u.long_run then regexp_match(u.run,
        '^([''’`*"(<\[]*(?:[mM][aA][iI][lL][tT][oO]:)?)(.*?)([.,;:!?)>\]''’`*"]*)$') end as p
    from runs as u
  ), cls as (
    select q.ord, q.long_run, q.p[1] as lead, q.p[3] as trail,
      q.has_at and (q.long_run or not coalesce(coalesce(p_keep, false)
        and q.p[2] ~ '^[A-Za-z0-9._+-]+@[uU][nN][iI][mM][iI]\.[iI][tT]$', false)) as hide,
      q.p[2] as core
    from parts as q
  ), flags as (
    select c.ord, c.long_run, c.lead, c.trail, c.hide,
      (c.hide and not c.long_run and left(c.core, 1) = '@') as ex_prev,
      (c.hide and not c.long_run and right(c.core, 1) = '@') as ex_next
    from cls as c
  ), final as (
    select f.ord, f.long_run, f.lead, f.trail, f.hide,
      coalesce(lag(f.ex_next) over (order by f.ord), false) or coalesce(lead(f.ex_prev) over (order by f.ord), false) as full_hide
    from flags as f
  )
  select string_agg(
    case when t.run is null then t.ws
         when f.full_hide or f.long_run then '[email nascosta]'
         when f.hide then coalesce(f.lead, '') || '[email nascosta]' || coalesce(f.trail, '')
         else t.run end, '' order by t.ord)
  from tok as t left join final as f on f.ord = t.ord
$$;

-- Nasconde gli indirizzi; con p_keep restano gli @unimi.it (solo nei campi email e contatti del catalogo).
-- Mai un errore per il contenuto: in caso di problemi il testo intero diventa «[email nascosta]».
drop function if exists public.studyos_hide_emails(text);
create or replace function public.studyos_hide_emails(p_text text, p_keep boolean default false)
returns text
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare
  v_norm text;
begin
  if p_text is null then
    return null;
  end if;
  v_norm := public.studyos_email_normalize(p_text);
  if position('@' in v_norm) = 0 then
    return p_text;
  end if;
  return public.studyos_hide_emails_normalized(v_norm, p_keep);
exception when others then
  return '[email nascosta]';
end;
$$;

-- Testo con indirizzi email: vale solo se ogni indirizzo è esattamente @unimi.it (niente
-- sottodomini, niente «@» rimasti, niente trucchi Unicode). Stessa regola di onlyInstitutionalEmails nel client.
create or replace function public.studyos_only_unimi_emails(p_text text)
returns boolean
language sql
immutable
set search_path = pg_catalog
as $$
  select position('@' in n.v) = 0 or public.studyos_hide_emails_normalized(n.v, true) = n.v
  from (select public.studyos_email_normalize(p_text) as v) as n
$$;

revoke all on function public.studyos_email_normalize(text) from public, anon, authenticated;
revoke all on function public.studyos_hide_emails_normalized(text, boolean) from public, anon, authenticated;
revoke all on function public.studyos_hide_emails(text, boolean) from public, anon, authenticated;
revoke all on function public.studyos_only_unimi_emails(text) from public, anon, authenticated;

-- Ogni valore testuale di un oggetto jsonb contiene solo indirizzi @unimi.it (si controlla valore per valore).
create or replace function public.studyos_fields_only_unimi(p_fields jsonb)
returns boolean
language sql
immutable
set search_path = pg_catalog
as $$
  select case when jsonb_typeof(p_fields) = 'object' then not exists (
    select 1 from jsonb_each(p_fields) as e
    where jsonb_typeof(e.value) = 'string' and not public.studyos_only_unimi_emails(e.value #>> '{}'))
  else true end
$$;

revoke all on function public.studyos_fields_only_unimi(jsonb) from public, anon, authenticated;

-- Esito delle funzioni di scrittura: { status, row?, message?, field? }.
create or replace function public.studyos_group_result(p_status text, p_row jsonb default null, p_message text default null, p_field text default null)
returns jsonb
language sql
immutable
set search_path = pg_catalog
as $$
  select jsonb_build_object('status', p_status)
    || case when p_row is null then '{}'::jsonb else jsonb_build_object('row', p_row) end
    || case when p_message is null then '{}'::jsonb else jsonb_build_object('message', p_message) end
    || case when p_field is null then '{}'::jsonb else jsonb_build_object('field', p_field) end
$$;

-- ---------------------------------------------------------------------------------------------
-- Tabelle
-- ---------------------------------------------------------------------------------------------

create table if not exists public.studyos_group_exam_sessions (
  id text primary key constraint studyos_gexam_id_shape check (id ~ '^[A-Za-z0-9_-]{1,120}$'),
  group_id text not null references public.studyos_groups (id) on delete cascade,
  course_key text not null constraint studyos_gexam_course_key_shape
    check (course_key ~ '^(barb:[A-Za-z0-9_.:-]{1,120}|nome:[a-z0-9 ]{1,160})$'),
  course_id text,
  course_name text not null constraint studyos_gexam_course_name_len check (char_length(course_name) between 2 and 160),
  course_norm text not null,
  exam_date date not null,
  kind text not null constraint studyos_gexam_kind
    check (kind in ('appello', 'preappello', 'prova_in_itinere', 'scritto', 'orale', 'laboratorio', 'altro')),
  label text not null default '' constraint studyos_gexam_label_len check (char_length(label) <= 80),
  exam_time text constraint studyos_gexam_time_shape check (exam_time is null or exam_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  room text not null default '' constraint studyos_gexam_room_len check (char_length(room) <= 120),
  notes text not null default '' constraint studyos_gexam_notes_len check (char_length(notes) <= 1000),
  registration_opens date,
  registration_closes date,
  barb_session_id text,
  source text not null default 'member' constraint studyos_gexam_source check (source in ('member', 'barb')),
  version integer not null default 1,
  created_by text not null,
  created_by_name text not null default '',
  updated_by text not null,
  updated_by_name text not null default '',
  deleted_at timestamptz,
  deleted_by text,
  deleted_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Un appello vivo per corso + data + tipo, sia con la chiave del corso sia con il nome normalizzato
-- (un membro sceglie il corso dal catalogo, un altro lo scrive a mano: resta un solo appello).
create unique index if not exists studyos_gexam_live_key
  on public.studyos_group_exam_sessions (group_id, course_key, exam_date, kind) where deleted_at is null;
create unique index if not exists studyos_gexam_live_name_key
  on public.studyos_group_exam_sessions (group_id, course_norm, exam_date, kind) where deleted_at is null;
create index if not exists studyos_gexam_group_date_idx
  on public.studyos_group_exam_sessions (group_id, exam_date);
create index if not exists studyos_gexam_deleted_idx
  on public.studyos_group_exam_sessions (group_id, deleted_at) where deleted_at is not null;

create table if not exists public.studyos_group_catalog_overrides (
  id text primary key constraint studyos_gover_id_shape check (id ~ '^[A-Za-z0-9_-]{1,120}$'),
  group_id text not null references public.studyos_groups (id) on delete cascade,
  target_kind text not null constraint studyos_gover_kind check (target_kind in ('teacher', 'course', 'schedule_rule', 'contact')),
  target_id text not null constraint studyos_gover_target_shape check (target_id ~ '^[A-Za-z0-9_.:-]{1,160}$'),
  target_label text not null default '' constraint studyos_gover_label_len check (char_length(target_label) <= 160),
  fields jsonb not null default '{}'::jsonb constraint studyos_gover_fields_object check (jsonb_typeof(fields) = 'object'),
  version integer not null default 1,
  created_by text not null,
  created_by_name text not null default '',
  updated_by text not null,
  updated_by_name text not null default '',
  deleted_at timestamptz,
  deleted_by text,
  deleted_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists studyos_gover_live_key
  on public.studyos_group_catalog_overrides (group_id, target_kind, target_id) where deleted_at is null;
create index if not exists studyos_gover_deleted_idx
  on public.studyos_group_catalog_overrides (group_id, deleted_at) where deleted_at is not null;

-- Cronologia condivisa: chi ha cambiato cosa, com'era prima e com'è dopo. La scrivono solo le funzioni.
create table if not exists public.studyos_group_history (
  id bigint generated always as identity primary key,
  group_id text not null references public.studyos_groups (id) on delete cascade,
  record_kind text not null constraint studyos_ghist_kind check (record_kind in ('exam_session', 'catalog_override')),
  record_id text not null,
  action text not null constraint studyos_ghist_action check (action in ('create', 'update', 'delete', 'restore')),
  version integer not null,
  before jsonb,
  after jsonb,
  changed_fields text[] not null default '{}',
  actor_user_id text not null,
  actor_name text not null default '',
  changed_at timestamptz not null default now()
);

create index if not exists studyos_ghist_group_idx on public.studyos_group_history (group_id, changed_at desc);
create index if not exists studyos_ghist_record_idx on public.studyos_group_history (record_kind, record_id, changed_at desc);
create index if not exists studyos_ghist_actor_idx on public.studyos_group_history (group_id, actor_user_id, changed_at desc);

-- Timbro del server (updated_at = now()) come le altre tabelle dei gruppi.
drop trigger if exists studyos_gexam_stamp on public.studyos_group_exam_sessions;
create trigger studyos_gexam_stamp
  before insert or update on public.studyos_group_exam_sessions
  for each row execute function public.studyos_group_stamp();
drop trigger if exists studyos_gover_stamp on public.studyos_group_catalog_overrides;
create trigger studyos_gover_stamp
  before insert or update on public.studyos_group_catalog_overrides
  for each row execute function public.studyos_group_stamp();

-- ---------------------------------------------------------------------------------------------
-- RLS: i membri leggono; nessuno scrive direttamente (solo le funzioni security definer).
-- ---------------------------------------------------------------------------------------------

alter table public.studyos_group_exam_sessions enable row level security;
alter table public.studyos_group_catalog_overrides enable row level security;
alter table public.studyos_group_history enable row level security;

revoke all on table public.studyos_group_exam_sessions from public, anon, authenticated;
revoke all on table public.studyos_group_catalog_overrides from public, anon, authenticated;
revoke all on table public.studyos_group_history from public, anon, authenticated;
grant select on table public.studyos_group_exam_sessions to authenticated;
grant select on table public.studyos_group_catalog_overrides to authenticated;
grant select on table public.studyos_group_history to authenticated;

drop policy if exists studyos_gexam_select on public.studyos_group_exam_sessions;
create policy studyos_gexam_select on public.studyos_group_exam_sessions for select to authenticated
  using (public.studyos_is_group_member(group_id));
drop policy if exists studyos_gover_select on public.studyos_group_catalog_overrides;
create policy studyos_gover_select on public.studyos_group_catalog_overrides for select to authenticated
  using (public.studyos_is_group_member(group_id));
drop policy if exists studyos_ghist_select on public.studyos_group_history;
create policy studyos_ghist_select on public.studyos_group_history for select to authenticated
  using (public.studyos_is_group_member(group_id));

-- ---------------------------------------------------------------------------------------------
-- Controllo dei campi
-- ---------------------------------------------------------------------------------------------

-- { ok: true, value: {...} } con i campi puliti, oppure { ok: false, field, message }.
create or replace function public.studyos_exam_session_clean(p_fields jsonb)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  v_key text;
  v_course_id text;
  v_name text;
  v_norm text;
  v_date date;
  v_kind text;
  v_label text;
  v_time text;
  v_room text;
  v_notes text;
  v_opens date;
  v_closes date;
  v_barb text;
  v_source text;
begin
  if jsonb_typeof(p_fields) is distinct from 'object' then
    return jsonb_build_object('ok', false, 'field', 'fields', 'message', 'Dati dell''appello mancanti.');
  end if;
  for v_key in select jsonb_object_keys(p_fields) loop
    if v_key not in ('courseId', 'courseName', 'date', 'kind', 'label', 'time', 'room', 'notes',
                     'registrationOpens', 'registrationCloses', 'barbSessionId', 'source') then
      return jsonb_build_object('ok', false, 'field', v_key, 'message', 'Campo non previsto.');
    end if;
    if jsonb_typeof(p_fields -> v_key) not in ('string', 'null') then
      return jsonb_build_object('ok', false, 'field', v_key, 'message', 'Valore non valido.');
    end if;
  end loop;

  v_course_id := nullif(btrim(coalesce(p_fields ->> 'courseId', '')), '');
  v_name := btrim(regexp_replace(coalesce(p_fields ->> 'courseName', ''), '\s+', ' ', 'g'));
  v_kind := coalesce(p_fields ->> 'kind', '');
  v_label := btrim(coalesce(p_fields ->> 'label', ''));
  v_time := nullif(btrim(coalesce(p_fields ->> 'time', '')), '');
  v_room := btrim(coalesce(p_fields ->> 'room', ''));
  v_notes := btrim(coalesce(p_fields ->> 'notes', ''));
  v_barb := nullif(btrim(coalesce(p_fields ->> 'barbSessionId', '')), '');
  v_source := coalesce(nullif(p_fields ->> 'source', ''), 'member');

  if v_course_id is not null and v_course_id !~ '^[A-Za-z0-9_.:-]{1,120}$' then
    return jsonb_build_object('ok', false, 'field', 'courseId', 'message', 'Corso non valido.');
  end if;
  if char_length(v_name) < 2 or char_length(v_name) > 160 then
    return jsonb_build_object('ok', false, 'field', 'courseName', 'message', 'Scrivi il nome del corso (da 2 a 160 caratteri).');
  end if;
  v_norm := public.studyos_course_norm(v_name);
  if v_norm = '' then
    return jsonb_build_object('ok', false, 'field', 'courseName', 'message', 'Scrivi il nome del corso con lettere o cifre.');
  end if;
  v_date := public.studyos_try_date(p_fields ->> 'date');
  if v_date is null or v_date < date '2000-01-01' or v_date > date '2100-12-31' then
    return jsonb_build_object('ok', false, 'field', 'date', 'message', 'Data non valida: usa AAAA-MM-GG.');
  end if;
  if v_kind not in ('appello', 'preappello', 'prova_in_itinere', 'scritto', 'orale', 'laboratorio', 'altro') then
    return jsonb_build_object('ok', false, 'field', 'kind', 'message', 'Tipo di prova non valido.');
  end if;
  if char_length(v_label) > 80 then
    return jsonb_build_object('ok', false, 'field', 'label', 'message', 'Etichetta troppo lunga (massimo 80 caratteri).');
  end if;
  if v_time is not null and v_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
    return jsonb_build_object('ok', false, 'field', 'time', 'message', 'Ora non valida: usa HH:MM.');
  end if;
  if char_length(v_room) > 120 then
    return jsonb_build_object('ok', false, 'field', 'room', 'message', 'Aula troppo lunga (massimo 120 caratteri).');
  end if;
  if char_length(v_notes) > 1000 then
    return jsonb_build_object('ok', false, 'field', 'notes', 'message', 'Note troppo lunghe (massimo 1000 caratteri).');
  end if;
  if nullif(p_fields ->> 'registrationOpens', '') is not null then
    v_opens := public.studyos_try_date(p_fields ->> 'registrationOpens');
    if v_opens is null then
      return jsonb_build_object('ok', false, 'field', 'registrationOpens', 'message', 'Data di apertura iscrizioni non valida.');
    end if;
  end if;
  if nullif(p_fields ->> 'registrationCloses', '') is not null then
    v_closes := public.studyos_try_date(p_fields ->> 'registrationCloses');
    if v_closes is null then
      return jsonb_build_object('ok', false, 'field', 'registrationCloses', 'message', 'Data di chiusura iscrizioni non valida.');
    end if;
  end if;
  if v_opens is not null and v_closes is not null and v_opens > v_closes then
    return jsonb_build_object('ok', false, 'field', 'registrationCloses', 'message', 'La chiusura delle iscrizioni viene prima dell''apertura.');
  end if;
  if v_barb is not null and v_barb !~ '^[A-Za-z0-9_.:-]{1,160}$' then
    return jsonb_build_object('ok', false, 'field', 'barbSessionId', 'message', 'Appello ufficiale non valido.');
  end if;
  if v_source not in ('member', 'barb') then
    return jsonb_build_object('ok', false, 'field', 'source', 'message', 'Origine non valida.');
  end if;
  if v_source = 'barb' and (v_barb is null or v_course_id is null) then
    return jsonb_build_object('ok', false, 'field', 'source', 'message', 'Un appello dal catalogo ha bisogno del corso e dell''appello ufficiale.');
  end if;

  return jsonb_build_object('ok', true, 'value', jsonb_build_object(
    'course_key', case when v_course_id is not null then 'barb:' || v_course_id else 'nome:' || v_norm end,
    'course_id', v_course_id,
    'course_name', v_name,
    'course_norm', v_norm,
    'exam_date', to_char(v_date, 'YYYY-MM-DD'),
    'kind', v_kind,
    'label', v_label,
    'exam_time', v_time,
    'room', v_room,
    'notes', v_notes,
    'registration_opens', to_char(v_opens, 'YYYY-MM-DD'),
    'registration_closes', to_char(v_closes, 'YYYY-MM-DD'),
    'barb_session_id', v_barb,
    'source', v_source
  ));
end;
$$;

-- Campi permessi per tipo di correzione; testi brevi; email solo @unimi.it.
create or replace function public.studyos_catalog_override_clean(p_kind text, p_fields jsonb)
returns jsonb
language plpgsql
immutable
set search_path = public
as $$
declare
  v_key text;
  v_value text;
  v_out jsonb := '{}'::jsonb;
  v_allowed text[];
  v_max integer;
begin
  v_allowed := case p_kind
    when 'teacher' then array['officeHours', 'officeHoursPlace', 'office', 'phone', 'email', 'website', 'note']
    when 'course' then array['room', 'building', 'site', 'lessonTimes', 'note']
    when 'schedule_rule' then array['room', 'building', 'site', 'note']
    when 'contact' then array['label', 'value', 'url', 'note']
    else null
  end;
  if v_allowed is null then
    return jsonb_build_object('ok', false, 'field', 'targetKind', 'message', 'Tipo di correzione non valido.');
  end if;
  if jsonb_typeof(p_fields) is distinct from 'object' then
    return jsonb_build_object('ok', false, 'field', 'fields', 'message', 'Correzioni mancanti.');
  end if;
  for v_key in select jsonb_object_keys(p_fields) loop
    if not (v_key = any (v_allowed)) then
      return jsonb_build_object('ok', false, 'field', v_key, 'message', 'Campo non previsto per questa correzione.');
    end if;
    if jsonb_typeof(p_fields -> v_key) = 'null' then
      continue;
    end if;
    if jsonb_typeof(p_fields -> v_key) <> 'string' then
      return jsonb_build_object('ok', false, 'field', v_key, 'message', 'Valore non valido.');
    end if;
    v_value := btrim(regexp_replace(public.studyos_email_normalize(p_fields ->> v_key), '\s+', ' ', 'g'));
    if v_value = '' then
      continue;
    end if;
    v_max := case v_key when 'phone' then 40 when 'note' then 500 when 'officeHours' then 300
      when 'lessonTimes' then 300 when 'value' then 300 when 'url' then 300 when 'website' then 300 else 160 end;
    if char_length(v_value) > v_max then
      return jsonb_build_object('ok', false, 'field', v_key, 'message', format('Testo troppo lungo (massimo %s caratteri).', v_max));
    end if;
    if v_key = 'email' then
      v_value := lower(v_value collate "C");
      if v_value !~ '^[a-z0-9._+-]+@unimi\.it$' then
        return jsonb_build_object('ok', false, 'field', 'email', 'message', 'Solo indirizzi istituzionali che finiscono con @unimi.it.');
      end if;
    elsif v_key = 'phone' and v_value !~ '^[0-9 +()./-]{3,40}$' then
      return jsonb_build_object('ok', false, 'field', 'phone', 'message', 'Numero di telefono non valido.');
    elsif v_key in ('website', 'url') and v_value !~* '^(https?://|mailto:)[^\s<>"]+$' then
      return jsonb_build_object('ok', false, 'field', v_key, 'message', 'Indirizzo non valido: deve iniziare con https:// o mailto:.');
    elsif v_key = 'website' and v_value ~* '^mailto:' then
      return jsonb_build_object('ok', false, 'field', 'website', 'message', 'Il sito deve iniziare con https://.');
    end if;
    if not public.studyos_only_unimi_emails(v_value) then
      return jsonb_build_object('ok', false, 'field', v_key, 'message', 'Solo indirizzi istituzionali che finiscono con @unimi.it.');
    end if;
    v_out := v_out || jsonb_build_object(v_key, v_value);
  end loop;
  if v_out = '{}'::jsonb then
    return jsonb_build_object('ok', false, 'field', 'fields', 'message', 'Scrivi almeno una correzione.');
  end if;
  return jsonb_build_object('ok', true, 'value', v_out);
end;
$$;

-- Campi cambiati tra due righe di un appello (nomi dei campi del client).
create or replace function public.studyos_exam_session_changes(p_old jsonb, p_new jsonb)
returns text[]
language sql
immutable
set search_path = pg_catalog
as $$
  select coalesce(array_agg(x.name order by x.ord), '{}') from (
    select f.ord, f.name
    from (values
      -- Il collegamento al catalogo ufficiale (course_id, barb_session_id, source) conta come cambio del corso.
      (1, 'course', array['course_key', 'course_name', 'course_id', 'barb_session_id', 'source']),
      (2, 'date', array['exam_date']),
      (3, 'kind', array['kind']),
      (4, 'label', array['label']),
      (5, 'time', array['exam_time']),
      (6, 'room', array['room']),
      (7, 'notes', array['notes']),
      (8, 'registrationOpens', array['registration_opens']),
      (9, 'registrationCloses', array['registration_closes'])
    ) as f (ord, name, cols)
    where exists (select 1 from unnest(f.cols) as c (col) where (p_old -> c.col) is distinct from (p_new -> c.col))
    union all
    select 10, 'deleted'
    where ((p_old ->> 'deleted_at') is null) is distinct from ((p_new ->> 'deleted_at') is null)
  ) as x
$$;

create or replace function public.studyos_catalog_override_changes(p_old jsonb, p_new jsonb)
returns text[]
language sql
immutable
set search_path = pg_catalog
as $$
  select coalesce(array_agg(x.name order by x.name), '{}') from (
    select k.key as name
    from (
      select jsonb_object_keys(coalesce(p_old -> 'fields', '{}'::jsonb)) as key
      union
      select jsonb_object_keys(coalesce(p_new -> 'fields', '{}'::jsonb))
    ) as k
    where (p_old -> 'fields' -> k.key) is distinct from (p_new -> 'fields' -> k.key)
    union all
    select 'targetLabel' where (p_old -> 'target_label') is distinct from (p_new -> 'target_label')
    union all
    select 'deleted' where ((p_old ->> 'deleted_at') is null) is distinct from ((p_new ->> 'deleted_at') is null)
  ) as x
$$;

-- ---------------------------------------------------------------------------------------------
-- Funzioni interne (nessun grant)
-- ---------------------------------------------------------------------------------------------

-- Nome del membro nel gruppo; null se chi chiama non è membro.
create or replace function public.studyos_group_member_name(p_group_id text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select left(coalesce(nullif(btrim(m.display_name), ''), 'Un membro'), 80)
  from public.studyos_group_members as m
  where m.group_id = p_group_id and m.user_id = auth.uid()::text
$$;

-- Prima di ogni scrittura: una per volta nel gruppo, tetto di 60 modifiche l'ora per membro,
-- pulizia di eliminati vecchi (180 giorni) e cronologia vecchia (365 giorni). true = si può scrivere.
create or replace function public.studyos_group_write_gate(p_group_id text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  perform pg_advisory_xact_lock(hashtext('studyos-group-write:' || p_group_id));
  if (select count(*) from public.studyos_group_history
      where group_id = p_group_id and actor_user_id = auth.uid()::text
        and changed_at > now() - interval '1 hour') >= 60 then
    return false;
  end if;
  delete from public.studyos_group_exam_sessions
    where group_id = p_group_id and deleted_at < now() - interval '180 days';
  delete from public.studyos_group_catalog_overrides
    where group_id = p_group_id and deleted_at < now() - interval '180 days';
  delete from public.studyos_group_history
    where group_id = p_group_id and changed_at < now() - interval '365 days';
  return true;
end;
$$;

create or replace function public.studyos_group_history_write(
  p_group_id text, p_kind text, p_record_id text, p_action text, p_version integer,
  p_before jsonb, p_after jsonb, p_changed text[], p_actor_name text)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.studyos_group_history
    (group_id, record_kind, record_id, action, version, before, after, changed_fields, actor_user_id, actor_name)
  values (p_group_id, p_kind, p_record_id, p_action, p_version, p_before, p_after,
    coalesce(p_changed, '{}'), auth.uid()::text, p_actor_name)
$$;

create or replace function public.studyos_exam_session_title(p_row jsonb)
returns text
language sql
immutable
set search_path = public
as $$
  select left(public.studyos_exam_kind_label(p_row ->> 'kind') || ' ' || (p_row ->> 'course_name')
    || ' del ' || to_char((p_row ->> 'exam_date')::date, 'DD/MM/YYYY'), 200)
$$;

create or replace function public.studyos_group_activity_write(p_group_id text, p_actor_name text, p_text text)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.studyos_group_activity (id, group_id, actor_display_name, text, actor_user_id)
  values ('activity-gexam-' || replace(gen_random_uuid()::text, '-', ''), p_group_id, p_actor_name,
    left(p_text, 300), auth.uid()::text)
$$;

-- Un altro appello vivo con stessa data, stesso tipo e stesso corso (chiave o nome).
create or replace function public.studyos_exam_session_twin(p_group_id text, p_value jsonb, p_except text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select to_jsonb(s) from public.studyos_group_exam_sessions as s
  where s.group_id = p_group_id and s.deleted_at is null
    and s.exam_date = (p_value ->> 'exam_date')::date and s.kind = p_value ->> 'kind'
    and (s.course_key = p_value ->> 'course_key' or s.course_norm = p_value ->> 'course_norm')
    and s.id is distinct from p_except
  order by s.created_at
  limit 1
$$;

revoke all on function public.studyos_group_member_name(text) from public, anon, authenticated;
revoke all on function public.studyos_group_write_gate(text) from public, anon, authenticated;
revoke all on function public.studyos_group_history_write(text, text, text, text, integer, jsonb, jsonb, text[], text) from public, anon, authenticated;
revoke all on function public.studyos_group_activity_write(text, text, text) from public, anon, authenticated;
revoke all on function public.studyos_exam_session_twin(text, jsonb, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Appelli: creare, modificare, eliminare
-- ---------------------------------------------------------------------------------------------

-- p_expected_version null = nuovo appello con id p_id (scelto dal client; ripetere la stessa
-- creazione dopo una risposta persa restituisce ok con la riga già scritta). Altrimenti modifica
-- di p_id partendo da quella versione: `conflict` con la riga attuale se nel frattempo è cambiata.
-- p_fields contiene sempre l'appello intero (campi del client), non solo i campi cambiati.
create or replace function public.save_group_exam_session(
  p_group_id text, p_id text, p_expected_version integer, p_fields jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me text := auth.uid()::text;
  v_name text;
  v_clean jsonb;
  v_val jsonb;
  v_cur public.studyos_group_exam_sessions;
  v_row public.studyos_group_exam_sessions;
  v_twin jsonb;
  v_next jsonb;
  v_changed text[];
begin
  if v_me is null then
    return public.studyos_group_result('denied', null, 'Accedi con il tuo account.');
  end if;
  if p_id is null or p_id !~ '^[A-Za-z0-9_-]{1,120}$' then
    return public.studyos_group_result('invalid', null, 'Id dell''appello non valido.', 'id');
  end if;
  v_name := public.studyos_group_member_name(p_group_id);
  if v_name is null then
    return public.studyos_group_result('denied', null, 'Non fai parte di questo gruppo.');
  end if;
  v_clean := public.studyos_exam_session_clean(p_fields);
  if not (v_clean ->> 'ok')::boolean then
    return public.studyos_group_result('invalid', null, v_clean ->> 'message', v_clean ->> 'field');
  end if;
  v_val := v_clean -> 'value';
  if not public.studyos_group_write_gate(p_group_id) then
    return public.studyos_group_result('invalid', null, 'Troppe modifiche in un''ora: riprova più tardi.', 'rate');
  end if;

  select * into v_cur from public.studyos_group_exam_sessions where id = p_id for update;

  if p_expected_version is null then
    if found then
      if v_cur.group_id = p_group_id and v_cur.created_by = v_me and v_cur.version = 1 and v_cur.deleted_at is null then
        return public.studyos_group_result('ok', to_jsonb(v_cur));
      end if;
      return public.studyos_group_result('invalid', null, 'Id dell''appello già usato.', 'id');
    end if;
    v_twin := public.studyos_exam_session_twin(p_group_id, v_val, null);
    if v_twin is not null then
      return public.studyos_group_result('duplicate', v_twin, 'Questo appello c''è già nel gruppo.');
    end if;
    insert into public.studyos_group_exam_sessions (
      id, group_id, course_key, course_id, course_name, course_norm, exam_date, kind, label, exam_time,
      room, notes, registration_opens, registration_closes, barb_session_id, source, version,
      created_by, created_by_name, updated_by, updated_by_name)
    values (
      p_id, p_group_id, v_val ->> 'course_key', v_val ->> 'course_id', v_val ->> 'course_name', v_val ->> 'course_norm',
      (v_val ->> 'exam_date')::date, v_val ->> 'kind', v_val ->> 'label', v_val ->> 'exam_time',
      v_val ->> 'room', v_val ->> 'notes', (v_val ->> 'registration_opens')::date, (v_val ->> 'registration_closes')::date,
      v_val ->> 'barb_session_id', v_val ->> 'source', 1, v_me, v_name, v_me, v_name)
    returning * into v_row;
    perform public.studyos_group_history_write(p_group_id, 'exam_session', v_row.id, 'create', 1, null, to_jsonb(v_row), '{}', v_name);
    perform public.studyos_group_activity_write(p_group_id, v_name,
      'ha aggiunto l''appello «' || public.studyos_exam_session_title(to_jsonb(v_row)) || '»');
    return public.studyos_group_result('ok', to_jsonb(v_row));
  end if;

  if not found or v_cur.group_id <> p_group_id then
    return public.studyos_group_result('not_found', null, 'Appello non trovato.');
  end if;
  if v_cur.deleted_at is not null then
    return public.studyos_group_result('gone', to_jsonb(v_cur), 'Questo appello è stato eliminato.');
  end if;
  if v_cur.version <> p_expected_version then
    return public.studyos_group_result('conflict', to_jsonb(v_cur), 'Nel frattempo qualcuno ha modificato questo appello.');
  end if;
  v_next := to_jsonb(v_cur) || v_val;
  v_changed := public.studyos_exam_session_changes(to_jsonb(v_cur), v_next);
  if cardinality(v_changed) = 0 then
    return public.studyos_group_result('ok', to_jsonb(v_cur));
  end if;
  v_twin := public.studyos_exam_session_twin(p_group_id, v_val, p_id);
  if v_twin is not null then
    return public.studyos_group_result('duplicate', v_twin, 'Con questi dati l''appello c''è già nel gruppo.');
  end if;
  update public.studyos_group_exam_sessions set
    course_key = v_val ->> 'course_key', course_id = v_val ->> 'course_id', course_name = v_val ->> 'course_name',
    course_norm = v_val ->> 'course_norm', exam_date = (v_val ->> 'exam_date')::date, kind = v_val ->> 'kind',
    label = v_val ->> 'label', exam_time = v_val ->> 'exam_time', room = v_val ->> 'room', notes = v_val ->> 'notes',
    registration_opens = (v_val ->> 'registration_opens')::date,
    registration_closes = (v_val ->> 'registration_closes')::date,
    barb_session_id = v_val ->> 'barb_session_id', source = v_val ->> 'source',
    version = v_cur.version + 1, updated_by = v_me, updated_by_name = v_name
  where id = p_id
  returning * into v_row;
  perform public.studyos_group_history_write(p_group_id, 'exam_session', v_row.id, 'update', v_row.version,
    to_jsonb(v_cur), to_jsonb(v_row), v_changed, v_name);
  return public.studyos_group_result('ok', to_jsonb(v_row));
exception when unique_violation then
  return public.studyos_group_result('duplicate',
    public.studyos_exam_session_twin(p_group_id, v_val, p_id), 'Questo appello c''è già nel gruppo.');
end;
$$;

create or replace function public.delete_group_exam_session(p_id text, p_expected_version integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me text := auth.uid()::text;
  v_group text;
  v_name text;
  v_role text;
  v_cur public.studyos_group_exam_sessions;
  v_row public.studyos_group_exam_sessions;
begin
  if v_me is null then
    return public.studyos_group_result('denied', null, 'Accedi con il tuo account.');
  end if;
  select group_id into v_group from public.studyos_group_exam_sessions where id = p_id;
  v_name := case when v_group is null then null else public.studyos_group_member_name(v_group) end;
  if v_name is null then
    return public.studyos_group_result('not_found', null, 'Appello non trovato.');
  end if;
  if not public.studyos_group_write_gate(v_group) then
    return public.studyos_group_result('invalid', null, 'Troppe modifiche in un''ora: riprova più tardi.', 'rate');
  end if;
  select * into v_cur from public.studyos_group_exam_sessions where id = p_id for update;
  if not found then
    return public.studyos_group_result('not_found', null, 'Appello non trovato.');
  end if;
  if v_cur.deleted_at is not null then
    return public.studyos_group_result('gone', to_jsonb(v_cur), 'Questo appello era già stato eliminato.');
  end if;
  v_role := public.studyos_group_role(v_group);
  if v_cur.created_by <> v_me and coalesce(v_role, '') not in ('owner', 'admin') then
    return public.studyos_group_result('denied', to_jsonb(v_cur), 'Può eliminarlo solo chi l''ha aggiunto o chi gestisce il gruppo.');
  end if;
  if v_cur.version is distinct from p_expected_version then
    return public.studyos_group_result('conflict', to_jsonb(v_cur), 'Nel frattempo qualcuno ha modificato questo appello.');
  end if;
  update public.studyos_group_exam_sessions set
    deleted_at = now(), deleted_by = v_me, deleted_by_name = v_name,
    version = v_cur.version + 1, updated_by = v_me, updated_by_name = v_name
  where id = p_id
  returning * into v_row;
  perform public.studyos_group_history_write(v_group, 'exam_session', p_id, 'delete', v_row.version,
    to_jsonb(v_cur), to_jsonb(v_row), array['deleted'], v_name);
  perform public.studyos_group_activity_write(v_group, v_name,
    'ha eliminato l''appello «' || public.studyos_exam_session_title(to_jsonb(v_row)) || '»');
  return public.studyos_group_result('ok', to_jsonb(v_row));
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Correzioni del gruppo al catalogo BARB (docenti, aule, ricevimento, contatti)
-- ---------------------------------------------------------------------------------------------

create or replace function public.save_group_catalog_override(
  p_group_id text, p_id text, p_expected_version integer, p_target_kind text, p_target_id text,
  p_target_label text, p_fields jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me text := auth.uid()::text;
  v_name text;
  v_clean jsonb;
  v_label text := left(btrim(public.studyos_email_normalize(p_target_label)), 160);
  v_cur public.studyos_group_catalog_overrides;
  v_row public.studyos_group_catalog_overrides;
  v_twin public.studyos_group_catalog_overrides;
  v_changed text[];
begin
  if v_me is null then
    return public.studyos_group_result('denied', null, 'Accedi con il tuo account.');
  end if;
  if p_id is null or p_id !~ '^[A-Za-z0-9_-]{1,120}$' then
    return public.studyos_group_result('invalid', null, 'Id della correzione non valido.', 'id');
  end if;
  if p_target_id is null or p_target_id !~ '^[A-Za-z0-9_.:-]{1,160}$' then
    return public.studyos_group_result('invalid', null, 'Elemento del catalogo non valido.', 'targetId');
  end if;
  v_name := public.studyos_group_member_name(p_group_id);
  if v_name is null then
    return public.studyos_group_result('denied', null, 'Non fai parte di questo gruppo.');
  end if;
  if not public.studyos_only_unimi_emails(v_label) then
    return public.studyos_group_result('invalid', null, 'Solo indirizzi istituzionali che finiscono con @unimi.it.', 'targetLabel');
  end if;
  v_clean := public.studyos_catalog_override_clean(p_target_kind, p_fields);
  if not (v_clean ->> 'ok')::boolean then
    return public.studyos_group_result('invalid', null, v_clean ->> 'message', v_clean ->> 'field');
  end if;
  if not public.studyos_group_write_gate(p_group_id) then
    return public.studyos_group_result('invalid', null, 'Troppe modifiche in un''ora: riprova più tardi.', 'rate');
  end if;

  select * into v_cur from public.studyos_group_catalog_overrides where id = p_id for update;

  if p_expected_version is null then
    if found then
      if v_cur.group_id = p_group_id and v_cur.created_by = v_me and v_cur.version = 1 and v_cur.deleted_at is null then
        return public.studyos_group_result('ok', to_jsonb(v_cur));
      end if;
      return public.studyos_group_result('invalid', null, 'Id della correzione già usato.', 'id');
    end if;
    select * into v_twin from public.studyos_group_catalog_overrides
      where group_id = p_group_id and target_kind = p_target_kind and target_id = p_target_id and deleted_at is null;
    if found then
      return public.studyos_group_result('duplicate', to_jsonb(v_twin), 'Il gruppo ha già una correzione per questo elemento: modificala.');
    end if;
    insert into public.studyos_group_catalog_overrides (
      id, group_id, target_kind, target_id, target_label, fields, version,
      created_by, created_by_name, updated_by, updated_by_name)
    values (p_id, p_group_id, p_target_kind, p_target_id, v_label, v_clean -> 'value', 1, v_me, v_name, v_me, v_name)
    returning * into v_row;
    perform public.studyos_group_history_write(p_group_id, 'catalog_override', v_row.id, 'create', 1, null, to_jsonb(v_row), '{}', v_name);
    return public.studyos_group_result('ok', to_jsonb(v_row));
  end if;

  if not found or v_cur.group_id <> p_group_id then
    return public.studyos_group_result('not_found', null, 'Correzione non trovata.');
  end if;
  if v_cur.deleted_at is not null then
    return public.studyos_group_result('gone', to_jsonb(v_cur), 'Questa correzione è stata eliminata.');
  end if;
  if v_cur.target_kind <> p_target_kind or v_cur.target_id <> p_target_id then
    return public.studyos_group_result('invalid', null, 'Una correzione non cambia elemento del catalogo.', 'targetId');
  end if;
  if v_cur.version <> p_expected_version then
    return public.studyos_group_result('conflict', to_jsonb(v_cur), 'Nel frattempo qualcuno ha modificato questa correzione.');
  end if;
  v_changed := public.studyos_catalog_override_changes(to_jsonb(v_cur),
    to_jsonb(v_cur) || jsonb_build_object('fields', v_clean -> 'value', 'target_label', v_label));
  if cardinality(v_changed) = 0 then
    return public.studyos_group_result('ok', to_jsonb(v_cur));
  end if;
  update public.studyos_group_catalog_overrides set
    fields = v_clean -> 'value', target_label = v_label,
    version = v_cur.version + 1, updated_by = v_me, updated_by_name = v_name
  where id = p_id
  returning * into v_row;
  perform public.studyos_group_history_write(p_group_id, 'catalog_override', v_row.id, 'update', v_row.version,
    to_jsonb(v_cur), to_jsonb(v_row), v_changed, v_name);
  return public.studyos_group_result('ok', to_jsonb(v_row));
exception when unique_violation then
  return public.studyos_group_result('duplicate', null, 'Il gruppo ha già una correzione per questo elemento: modificala.');
end;
$$;

create or replace function public.delete_group_catalog_override(p_id text, p_expected_version integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me text := auth.uid()::text;
  v_group text;
  v_name text;
  v_role text;
  v_cur public.studyos_group_catalog_overrides;
  v_row public.studyos_group_catalog_overrides;
begin
  if v_me is null then
    return public.studyos_group_result('denied', null, 'Accedi con il tuo account.');
  end if;
  select group_id into v_group from public.studyos_group_catalog_overrides where id = p_id;
  v_name := case when v_group is null then null else public.studyos_group_member_name(v_group) end;
  if v_name is null then
    return public.studyos_group_result('not_found', null, 'Correzione non trovata.');
  end if;
  if not public.studyos_group_write_gate(v_group) then
    return public.studyos_group_result('invalid', null, 'Troppe modifiche in un''ora: riprova più tardi.', 'rate');
  end if;
  select * into v_cur from public.studyos_group_catalog_overrides where id = p_id for update;
  if not found then
    return public.studyos_group_result('not_found', null, 'Correzione non trovata.');
  end if;
  if v_cur.deleted_at is not null then
    return public.studyos_group_result('gone', to_jsonb(v_cur), 'Questa correzione era già stata eliminata.');
  end if;
  v_role := public.studyos_group_role(v_group);
  if v_cur.created_by <> v_me and coalesce(v_role, '') not in ('owner', 'admin') then
    return public.studyos_group_result('denied', to_jsonb(v_cur), 'Può eliminarla solo chi l''ha scritta o chi gestisce il gruppo.');
  end if;
  if v_cur.version is distinct from p_expected_version then
    return public.studyos_group_result('conflict', to_jsonb(v_cur), 'Nel frattempo qualcuno ha modificato questa correzione.');
  end if;
  update public.studyos_group_catalog_overrides set
    deleted_at = now(), deleted_by = v_me, deleted_by_name = v_name,
    version = v_cur.version + 1, updated_by = v_me, updated_by_name = v_name
  where id = p_id
  returning * into v_row;
  perform public.studyos_group_history_write(v_group, 'catalog_override', p_id, 'delete', v_row.version,
    to_jsonb(v_cur), to_jsonb(v_row), array['deleted'], v_name);
  return public.studyos_group_result('ok', to_jsonb(v_row));
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Ripristino dalla cronologia: la riga torna com'era prima della modifica scelta.
-- ---------------------------------------------------------------------------------------------

-- p_expected_version = versione attuale della riga vista da chi ripristina (conflict se è cambiata).
-- Una creazione non si ripristina (per togliere un appello si elimina). Un ripristino che
-- eliminerebbe di nuovo la riga vale come eliminazione: solo autore o chi gestisce il gruppo.
create or replace function public.restore_group_record(p_history_id bigint, p_expected_version integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me text := auth.uid()::text;
  v_hist public.studyos_group_history;
  v_name text;
  v_role text;
  v_b jsonb;
  v_s public.studyos_group_exam_sessions;
  v_s_row public.studyos_group_exam_sessions;
  v_o public.studyos_group_catalog_overrides;
  v_o_row public.studyos_group_catalog_overrides;
  v_twin jsonb;
  v_changed text[];
begin
  if v_me is null then
    return public.studyos_group_result('denied', null, 'Accedi con il tuo account.');
  end if;
  select * into v_hist from public.studyos_group_history where id = p_history_id;
  v_name := case when v_hist.id is null then null else public.studyos_group_member_name(v_hist.group_id) end;
  if v_name is null then
    return public.studyos_group_result('not_found', null, 'Modifica non trovata nella cronologia.');
  end if;
  v_b := v_hist.before;
  if v_b is null then
    return public.studyos_group_result('invalid', null, 'Un''aggiunta non si ripristina: per toglierla, elimina l''elemento.', 'historyId');
  end if;
  -- Lo stato salvato deve essere dello stesso gruppo e dello stesso elemento della voce.
  if (v_b ->> 'group_id') is distinct from v_hist.group_id or (v_b ->> 'id') is distinct from v_hist.record_id then
    return public.studyos_group_result('not_found', null, 'Modifica non trovata nella cronologia.');
  end if;
  if not public.studyos_group_write_gate(v_hist.group_id) then
    return public.studyos_group_result('invalid', null, 'Troppe modifiche in un''ora: riprova più tardi.', 'rate');
  end if;
  v_role := public.studyos_group_role(v_hist.group_id);

  if v_hist.record_kind = 'exam_session' then
    -- Solo la riga dello stesso gruppo della voce di cronologia: un id può tornare in un altro
    -- gruppo dopo la pulizia, e la sua cronologia vecchia non deve toccarlo.
    select * into v_s from public.studyos_group_exam_sessions
      where id = v_hist.record_id and group_id = v_hist.group_id for update;
    if not found then
      return public.studyos_group_result('gone', null, 'L''appello non c''è più: è stato tolto definitivamente.');
    end if;
    if v_s.version is distinct from p_expected_version then
      return public.studyos_group_result('conflict', to_jsonb(v_s), 'Nel frattempo qualcuno ha modificato questo appello.');
    end if;
    if (v_b ->> 'deleted_at') is not null and v_s.deleted_at is null
       and v_s.created_by <> v_me and coalesce(v_role, '') not in ('owner', 'admin') then
      return public.studyos_group_result('denied', to_jsonb(v_s), 'Può eliminarlo solo chi l''ha aggiunto o chi gestisce il gruppo.');
    end if;
    if (v_b ->> 'deleted_at') is null then
      v_twin := public.studyos_exam_session_twin(v_hist.group_id, v_b, v_s.id);
      if v_twin is not null then
        return public.studyos_group_result('duplicate', v_twin, 'Nel gruppo c''è già un appello uguale: non si può ripristinare.');
      end if;
    end if;
    v_changed := public.studyos_exam_session_changes(to_jsonb(v_s), v_b);
    if cardinality(v_changed) = 0 then
      return public.studyos_group_result('ok', to_jsonb(v_s));
    end if;
    update public.studyos_group_exam_sessions set
      course_key = v_b ->> 'course_key', course_id = v_b ->> 'course_id', course_name = v_b ->> 'course_name',
      course_norm = v_b ->> 'course_norm', exam_date = (v_b ->> 'exam_date')::date, kind = v_b ->> 'kind',
      label = v_b ->> 'label', exam_time = v_b ->> 'exam_time', room = v_b ->> 'room', notes = v_b ->> 'notes',
      registration_opens = (v_b ->> 'registration_opens')::date,
      registration_closes = (v_b ->> 'registration_closes')::date,
      barb_session_id = v_b ->> 'barb_session_id', source = v_b ->> 'source',
      -- Un ripristino che elimina scrive la data di adesso, non quella vecchia (la finestra di 180 giorni riparte).
      deleted_at = case when (v_b ->> 'deleted_at') is null then null else now() end,
      deleted_by = case when (v_b ->> 'deleted_at') is null then null else v_me end,
      deleted_by_name = case when (v_b ->> 'deleted_at') is null then null else v_name end,
      version = v_s.version + 1, updated_by = v_me, updated_by_name = v_name
    where id = v_s.id
    returning * into v_s_row;
    perform public.studyos_group_history_write(v_hist.group_id, 'exam_session', v_s.id, 'restore', v_s_row.version,
      to_jsonb(v_s), to_jsonb(v_s_row), v_changed, v_name);
    if v_s.deleted_at is not null and v_s_row.deleted_at is null then
      perform public.studyos_group_activity_write(v_hist.group_id, v_name,
        'ha ripristinato l''appello «' || public.studyos_exam_session_title(to_jsonb(v_s_row)) || '»');
    end if;
    return public.studyos_group_result('ok', to_jsonb(v_s_row));
  end if;

  select * into v_o from public.studyos_group_catalog_overrides
    where id = v_hist.record_id and group_id = v_hist.group_id for update;
  if not found then
    return public.studyos_group_result('gone', null, 'La correzione non c''è più: è stata tolta definitivamente.');
  end if;
  if v_o.version is distinct from p_expected_version then
    return public.studyos_group_result('conflict', to_jsonb(v_o), 'Nel frattempo qualcuno ha modificato questa correzione.');
  end if;
  if (v_b ->> 'deleted_at') is not null and v_o.deleted_at is null
     and v_o.created_by <> v_me and coalesce(v_role, '') not in ('owner', 'admin') then
    return public.studyos_group_result('denied', to_jsonb(v_o), 'Può eliminarla solo chi l''ha scritta o chi gestisce il gruppo.');
  end if;
  -- Una correzione vecchia con un indirizzo non istituzionale (etichetta o campi) non si rimette in vigore.
  if not public.studyos_only_unimi_emails(coalesce(v_b ->> 'target_label', ''))
     or not public.studyos_fields_only_unimi(v_b -> 'fields') then
    return public.studyos_group_result('invalid', null, 'Solo indirizzi istituzionali che finiscono con @unimi.it.', 'targetLabel');
  end if;
  if (v_b ->> 'deleted_at') is null and exists (
    select 1 from public.studyos_group_catalog_overrides
    where group_id = v_o.group_id and target_kind = v_o.target_kind and target_id = v_o.target_id
      and deleted_at is null and id <> v_o.id) then
    return public.studyos_group_result('duplicate', null, 'Il gruppo ha già un''altra correzione per questo elemento.');
  end if;
  v_changed := public.studyos_catalog_override_changes(to_jsonb(v_o), v_b);
  if cardinality(v_changed) = 0 then
    return public.studyos_group_result('ok', to_jsonb(v_o));
  end if;
  update public.studyos_group_catalog_overrides set
    fields = coalesce(v_b -> 'fields', '{}'::jsonb), target_label = coalesce(v_b ->> 'target_label', ''),
    deleted_at = case when (v_b ->> 'deleted_at') is null then null else now() end,
    deleted_by = case when (v_b ->> 'deleted_at') is null then null else v_me end,
    deleted_by_name = case when (v_b ->> 'deleted_at') is null then null else v_name end,
    version = v_o.version + 1, updated_by = v_me, updated_by_name = v_name
  where id = v_o.id
  returning * into v_o_row;
  perform public.studyos_group_history_write(v_hist.group_id, 'catalog_override', v_o.id, 'restore', v_o_row.version,
    to_jsonb(v_o), to_jsonb(v_o_row), v_changed, v_name);
  return public.studyos_group_result('ok', to_jsonb(v_o_row));
end;
$$;

revoke all on function public.save_group_exam_session(text, text, integer, jsonb) from public, anon;
revoke all on function public.delete_group_exam_session(text, integer) from public, anon;
revoke all on function public.save_group_catalog_override(text, text, integer, text, text, text, jsonb) from public, anon;
revoke all on function public.delete_group_catalog_override(text, integer) from public, anon;
revoke all on function public.restore_group_record(bigint, integer) from public, anon;
grant execute on function public.save_group_exam_session(text, text, integer, jsonb) to authenticated;
grant execute on function public.delete_group_exam_session(text, integer) to authenticated;
grant execute on function public.save_group_catalog_override(text, text, integer, text, text, text, jsonb) to authenticated;
grant execute on function public.delete_group_catalog_override(text, integer) to authenticated;
grant execute on function public.restore_group_record(bigint, integer) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Connettore remoto degli agenti: sola lettura degli appelli e delle correzioni dei miei gruppi.
-- Usa studyos_agent_user di agent.sql (risolta quando si chiama: senza agent.sql nessuno la chiama).
-- Niente id degli account: solo nomi visibili, come nell'app.
-- ---------------------------------------------------------------------------------------------

create or replace function public.studyos_agent_group_snapshot(p_secret text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := public.studyos_agent_user(p_secret);
  v_me text;
begin
  if v_user is null then
    raise exception 'Collegamento dell''assistente non valido o revocato.' using errcode = '28000';
  end if;
  v_me := v_user::text;
  -- Spec §9.3: il testo scritto dai membri e i loro nomi arrivano agli agenti senza NESSUN indirizzo
  -- (nemmeno @unimi.it: un membro può averlo); gli @unimi.it restano solo nei campi email e contatto
  -- delle correzioni (email, value, url, website). Si redige valore per valore, mai rileggendo JSON.
  -- Solo gruppi con id di forma sicura (gli id li sceglie il client): gli altri non escono dal server.
  return jsonb_build_object(
    'groups', coalesce((
      select jsonb_agg(jsonb_build_object('id', g.id, 'name', public.studyos_hide_emails(left(g.name, 120))) order by g.name, g.id)
      from public.studyos_groups as g
      join public.studyos_group_members as m on m.group_id = g.id and m.user_id = v_me
      where g.id ~ '^[A-Za-z0-9_-]{1,120}$'), '[]'::jsonb),
    'sessions', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', s.id, 'group_id', s.group_id,
          -- Senza «@» nel nome si restituiscono il testo e le chiavi come sono salvati; con una «@» il nome è
          -- oscurato e le chiavi si ricavano da quello (il nome si oscura una sola volta per riga).
          'course_key', case when s.course_key like 'barb:%' or cn.name is not distinct from s.course_name then s.course_key
            else 'nome:' || public.studyos_course_norm(cn.name) end,
          'course_id', s.course_id,
          'course_name', cn.name,
          'course_norm', case when cn.name is not distinct from s.course_name then s.course_norm
            else public.studyos_course_norm(cn.name) end,
          'exam_date', s.exam_date, 'kind', s.kind, 'label', public.studyos_hide_emails(left(s.label, 200)),
          'exam_time', s.exam_time, 'room', public.studyos_hide_emails(left(s.room, 200)),
          'notes', public.studyos_hide_emails(left(s.notes, 2000)),
          'registration_opens', s.registration_opens, 'registration_closes', s.registration_closes,
          'barb_session_id', s.barb_session_id, 'source', s.source, 'version', s.version,
          'created_by_name', public.studyos_hide_emails(left(s.created_by_name, 200)),
          'updated_by_name', public.studyos_hide_emails(left(s.updated_by_name, 200)),
          'deleted_at', s.deleted_at, 'deleted_by_name', public.studyos_hide_emails(left(s.deleted_by_name, 200)),
          'created_at', s.created_at, 'updated_at', s.updated_at,
          'mine', s.created_by = v_me) order by s.exam_date, s.id)
      from (
        select * from public.studyos_group_exam_sessions
        where group_id in (select group_id from public.studyos_group_members where user_id = v_me)
          and group_id ~ '^[A-Za-z0-9_-]{1,120}$'
        order by exam_date desc, id
        limit 2000
      ) as s
      cross join lateral (select public.studyos_hide_emails(left(s.course_name, 200)) as name) as cn), '[]'::jsonb),
    'overrides', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', o.id, 'group_id', o.group_id, 'target_kind', o.target_kind, 'target_id', o.target_id,
          'target_label', public.studyos_hide_emails(left(o.target_label, 200)),
          -- Solo valori di testo (la funzione di scrittura non ne accetta altri): quelli di altro tipo si scartano.
          'fields', coalesce((
            select jsonb_object_agg(e.key, to_jsonb(public.studyos_hide_emails(left(e.value #>> '{}', 1000),
              e.key in ('email', 'value', 'url', 'website'))))
            from jsonb_each(o.fields) as e
            where jsonb_typeof(e.value) = 'string'), '{}'::jsonb),
          'version', o.version,
          'created_by_name', public.studyos_hide_emails(left(o.created_by_name, 200)),
          'updated_by_name', public.studyos_hide_emails(left(o.updated_by_name, 200)),
          'deleted_at', o.deleted_at, 'deleted_by_name', public.studyos_hide_emails(left(o.deleted_by_name, 200)),
          'created_at', o.created_at, 'updated_at', o.updated_at,
          'mine', o.created_by = v_me) order by o.target_kind, o.target_id)
      from public.studyos_group_catalog_overrides as o
      where o.deleted_at is null
        and o.group_id ~ '^[A-Za-z0-9_-]{1,120}$'
        and o.group_id in (select group_id from public.studyos_group_members where user_id = v_me)), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.studyos_agent_group_snapshot(text) from public;
grant execute on function public.studyos_agent_group_snapshot(text) to anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Realtime: appelli e correzioni arrivano subito agli altri membri (la cronologia si legge a richiesta).
-- ---------------------------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'studyos_group_exam_sessions'
    ) then
      execute 'alter publication supabase_realtime add table public.studyos_group_exam_sessions';
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'studyos_group_catalog_overrides'
    ) then
      execute 'alter publication supabase_realtime add table public.studyos_group_catalog_overrides';
    end if;
  end if;
end $$;
