-- Prove della sezione «flashcards» (Flashcard e quiz) in sharing.sql: chi riceve legge raccolte,
-- schede, quiz e domande del proprietario, mai i suoi stati di ripasso e le sue sessioni; con «Può
-- modificare» scrive solo valori del tipo giusto; la cronologia del proprietario registra chi ha
-- cambiato cosa. SOLO Postgres temporaneo (scripts/supabase/scratch-pg.sh) o stack locale, mai il
-- progetto reale. Tutto in una transazione annullata alla fine.
\set ON_ERROR_STOP 1
\pset tuples_only on
\pset format unaligned
begin;

create function pg_temp.expect(p_label text, p_ok boolean) returns text language plpgsql as $$
begin
  if p_ok is distinct from true then
    raise exception 'FALLITO: %', p_label;
  end if;
  return 'ok ' || p_label;
end $$;

-- true se il comando fallisce (vincolo, policy o trigger), senza annullare la transazione.
create function pg_temp.fails(p_sql text) returns boolean language plpgsql as $$
begin
  execute p_sql;
  return false;
exception when others then
  return true;
end $$;

\set alice '504b3482-7f1b-4add-bfbc-7b3effbf21d7'
\set bob 'fc0191e0-6663-4a43-b060-131e397f02cc'

create function pg_temp.r(p_type text, p_payload jsonb, p_deleted boolean default false) returns jsonb
language sql as $$
  select jsonb_build_object('entity_type', p_type, 'entity_id', p_payload->>'id', 'deleted', p_deleted, 'payload', p_payload)
$$;
create function pg_temp.base(p_id text, p_at text default '2026-11-16T10:00:00.000Z') returns jsonb
language sql as $$
  select jsonb_build_object('id', p_id, 'createdAt', '2026-11-16T10:00:00.000Z', 'updatedAt', p_at, 'archived', false, 'tags', '[]'::jsonb)
$$;
-- Righe di Alice lette come superutente (le prove sotto girano come utenti con RLS).
create function pg_temp.stored(p_type text, p_id text) returns jsonb language sql as $$
  select payload from public.studyos_items
  where user_id = '504b3482-7f1b-4add-bfbc-7b3effbf21d7' and entity_type = p_type and entity_id = p_id
$$;

-- Alice e Bob si conoscono già (una condivisione di obiettivi): preparazione, non è la prova.
insert into public.studyos_shares (owner_id, owner_name, scope, permission, grantee_user_id, grantee_name)
values (:'alice', 'Alice', 'goals', 'view', :'bob', 'Bob');

-- Contenuti come li scrive l'app: raccolta, scheda, quiz, domanda; stato di ripasso e sessione personali.
\set deck '{"title": "Chimica", "description": "", "kind": "collection", "position": 1, "subjectId": "s1", "author": {"kind": "person"}}'
\set card '{"deckId": "fd1", "subjectId": "s1", "front": [{"type": "text", "text": "Kc?"}], "back": [{"type": "text", "text": "Rapporto"}], "position": 1, "revision": 1, "author": {"kind": "person"}}'
\set quiz '{"title": "Verifica", "description": "", "deckId": "fd1", "subjectId": "s1", "position": 1, "revision": 1, "author": {"kind": "person"}}'
\set question '{"quizId": "fq1", "subjectId": "s1", "kind": "single", "prompt": [{"type": "text", "text": "2+2?"}], "options": [{"id": "a", "text": "4", "correct": true}, {"id": "b", "text": "5", "correct": false}], "position": 1, "revision": 1}'
\set state '{"deckId": "fd1", "reps": 1, "lapses": 0, "ease": 2.5, "intervalDays": 1, "due": "2026-11-17", "lastResult": "correct", "revision": 1}'
\set run '{"kind": "flashcards", "mode": "review", "title": "Chimica", "deckIds": ["fd1"], "subjectIds": [], "startedAt": "2026-11-16T10:00:00.000Z", "itemIds": ["fc1"], "events": []}'

set local role authenticated;
select set_config('request.jwt.claim.sub', :'alice', true) \g /dev/null

select pg_temp.expect('FC1 Alice salva raccolta, scheda, quiz, domanda, stato e sessione', bool_and(accepted))
from public.push_studyos_rows(:'alice', 'alice-1', jsonb_build_array(
  pg_temp.r('studyDeck', pg_temp.base('fd1') || :'deck'::jsonb),
  pg_temp.r('flashcard', pg_temp.base('fc1') || :'card'::jsonb),
  pg_temp.r('quiz', pg_temp.base('fq1') || :'quiz'::jsonb),
  pg_temp.r('quizQuestion', pg_temp.base('fqq1') || :'question'::jsonb),
  pg_temp.r('flashcardState', pg_temp.base('fc1') || :'state'::jsonb),
  pg_temp.r('studyRun', pg_temp.base('fr1') || :'run'::jsonb)
));

select pg_temp.expect('FC2 filtro per materia su Flashcard e quiz: rifiutato',
  pg_temp.fails(format($q$insert into public.studyos_shares (owner_id, owner_name, scope, subject_ids, permission, grantee_user_id, grantee_name)
    values (%L, 'Alice', 'flashcards', array['s1'], 'view', %L, 'Bob')$q$, :'alice', :'bob')));
select pg_temp.expect('FC2 validazione degli inviti: stesso rifiuto',
  pg_temp.fails($q$select public.studyos_validate_share_items('[{"scope": "flashcards", "subject_ids": ["s1"]}]'::jsonb, true)$q$));
select pg_temp.expect('FC2 otto sezioni in un invito: accettate', not pg_temp.fails($q$select public.studyos_validate_share_items(
  '[{"scope": "calendar"}, {"scope": "barb_exams"}, {"scope": "tasks"}, {"scope": "study"}, {"scope": "progress"}, {"scope": "materials"}, {"scope": "goals"}, {"scope": "flashcards", "permission": "edit"}]'::jsonb, true)$q$));
select pg_temp.expect('FC2 sezioni dei tipi: solo raccolte, schede, quiz e domande',
  public.studyos_scope_types('flashcards') = array['studyDeck', 'flashcard', 'quiz', 'quizQuestion']);

insert into public.studyos_shares (owner_id, owner_name, scope, permission, grantee_user_id, grantee_name)
values (:'alice', 'Alice', 'flashcards', 'view', :'bob', 'Bob');
select 'ok FC3 Alice condivide Flashcard e quiz con Bob (Può vedere)';

select set_config('request.jwt.claim.sub', :'bob', true) \g /dev/null
select pg_temp.expect('FC4 Bob legge raccolta, scheda, quiz e domanda di Alice',
  (select array_agg(entity_type || ':' || entity_id order by entity_type, entity_id) from public.studyos_items where user_id = :'alice' and not deleted)
  = array['flashcard:fc1', 'quiz:fq1', 'quizQuestion:fqq1', 'studyDeck:fd1']);
select pg_temp.expect('FC4 stato di ripasso e sessione di Alice: invisibili a Bob',
  not exists (select 1 from public.studyos_items where user_id = :'alice' and entity_type in ('flashcardState', 'studyRun')));

select pg_temp.expect('FC5 con «Può vedere» Bob non modifica la scheda', bool_and(reason = 'denied'))
from public.push_shared_rows(:'alice', 'bob-1', jsonb_build_array(
  pg_temp.r('flashcard', pg_temp.base('fc1', '2026-11-16T10:05:00.000Z') || :'card'::jsonb || '{"back": [{"type": "text", "text": "No"}]}')));
select pg_temp.expect('FC5 scrittura diretta sulla tabella: respinta',
  pg_temp.fails(format($q$update public.studyos_items set payload = payload || '{"title": "x"}' where user_id = %L and entity_id = 'fc1'$q$, :'alice'))
  or (select pg_temp.stored('flashcard', 'fc1') ->> 'title') is null);

select set_config('request.jwt.claim.sub', :'alice', true) \g /dev/null
update public.studyos_shares set permission = 'edit' where owner_id = :'alice' and scope = 'flashcards';
select 'ok FC6 Alice passa a «Può modificare»';

select set_config('request.jwt.claim.sub', :'bob', true) \g /dev/null
select pg_temp.expect('FC7 Bob modifica scheda, raccolta e domanda e crea una scheda', bool_and(accepted) and count(*) = 4)
from public.push_shared_rows(:'alice', 'bob-2', jsonb_build_array(
  pg_temp.r('flashcard', pg_temp.base('fc1', '2026-11-16T10:06:00.000Z') || :'card'::jsonb
    || '{"back": [{"type": "text", "text": "Rapporto delle concentrazioni"}], "explanation": [{"type": "text", "text": "Perché"}], "revision": 2}'),
  pg_temp.r('studyDeck', pg_temp.base('fd1', '2026-11-16T10:06:00.000Z') || :'deck'::jsonb || '{"description": "Note di Bob"}'),
  pg_temp.r('quizQuestion', pg_temp.base('fqq1', '2026-11-16T10:06:00.000Z') || :'question'::jsonb
    || '{"options": [{"id": "a", "text": "4", "correct": true}, {"id": "b", "text": "5", "correct": false}, {"id": "c", "text": "22", "correct": false}], "revision": 2}'),
  pg_temp.r('flashcard', pg_temp.base('fc-bob', '2026-11-16T10:06:00.000Z') || :'card'::jsonb || '{"position": 2, "author": {"kind": "person"}}')
));
reset role;
select pg_temp.expect('FC7 la scheda di Alice ha il retro di Bob',
  pg_temp.stored('flashcard', 'fc1') #>> '{back,0,text}' = 'Rapporto delle concentrazioni');
select pg_temp.expect('FC7 la cronologia di Alice registra le modifiche di Bob',
  (select count(*) from public.studyos_item_revisions where owner_id = :'alice' and changed_by = :'bob'
     and entity_type in ('flashcard', 'studyDeck', 'quizQuestion')) >= 3);

-- Valori del tipo sbagliato: ogni riga rifiutata, quella salvata resta com'era.
create temp table attacks (label text, type text, id text, patch jsonb);
insert into attacks values
  ('fronte testo', 'flashcard', 'fc1', '{"front": "x"}'),
  ('retro mancante (null)', 'flashcard', 'fc1', '{"back": null}'),
  ('spiegazione testo', 'flashcard', 'fc1', '{"explanation": "x"}'),
  ('fonti oggetto', 'flashcard', 'fc1', '{"sources": {"x": 1}}'),
  ('autore testo', 'flashcard', 'fc1', '{"author": "x"}'),
  ('raccolta della scheda numerica', 'flashcard', 'fc1', '{"deckId": 42}'),
  ('titolo della raccolta oggetto', 'studyDeck', 'fd1', '{"title": {"x": 1}}'),
  ('meta della raccolta testo', 'studyDeck', 'fd1', '{"meta": "x"}'),
  ('madre della raccolta numerica', 'studyDeck', 'fd1', '{"parentId": 7}'),
  ('titolo del quiz lista', 'quiz', 'fq1', '{"title": ["x"]}'),
  ('opzioni testo', 'quizQuestion', 'fqq1', '{"options": "x"}'),
  ('tipo di domanda numerico', 'quizQuestion', 'fqq1', '{"kind": 1}'),
  ('domanda senza quiz', 'quizQuestion', 'fqq1', '{"quizId": null}');
grant select on attacks to authenticated;

set local role authenticated;
select set_config('request.jwt.claim.sub', :'bob', true) \g /dev/null
create temp table attack_results as
select a.label, a.type, a.id, res.reason
from attacks a
cross join lateral public.push_shared_rows(:'alice', 'bob-3', jsonb_build_array(pg_temp.r(a.type,
  (select payload from public.studyos_items where user_id = :'alice' and entity_type = a.type and entity_id = a.id)
    || a.patch || '{"updatedAt": "2026-11-16T10:09:00.000Z"}'))) res;
reset role;
select pg_temp.expect('FC8 tipo sbagliato (' || label || '): rifiutato', reason = 'denied') from attack_results order by label;
select pg_temp.expect('FC8 righe invariate dopo i tentativi',
  pg_temp.stored('flashcard', 'fc1') ->> 'updatedAt' = '2026-11-16T10:06:00.000Z'
  and pg_temp.stored('studyDeck', 'fd1') ->> 'updatedAt' = '2026-11-16T10:06:00.000Z'
  and pg_temp.stored('quiz', 'fq1') ->> 'updatedAt' = '2026-11-16T10:00:00.000Z'
  and pg_temp.stored('quizQuestion', 'fqq1') ->> 'updatedAt' = '2026-11-16T10:06:00.000Z');

set local role authenticated;
select set_config('request.jwt.claim.sub', :'bob', true) \g /dev/null
select pg_temp.expect('FC9 Bob non scrive lo stato di ripasso di Alice (RPC)', bool_and(reason = 'denied'))
from public.push_shared_rows(:'alice', 'bob-4', jsonb_build_array(
  pg_temp.r('flashcardState', pg_temp.base('fc1', '2026-11-16T10:10:00.000Z') || :'state'::jsonb || '{"due": "2027-01-01"}')));
select pg_temp.expect('FC9 né con un insert diretto',
  pg_temp.fails(format($q$insert into public.studyos_items (user_id, entity_type, entity_id, payload)
    values (%L, 'flashcardState', 'fc-x', '{"id": "fc-x", "due": "2027-01-01"}')$q$, :'alice')));
select pg_temp.expect('FC9 né una sessione',
  pg_temp.fails(format($q$insert into public.studyos_items (user_id, entity_type, entity_id, payload)
    values (%L, 'studyRun', 'fr-x', '{"id": "fr-x", "kind": "quiz"}')$q$, :'alice')));

select pg_temp.expect('FC10 Bob elimina la scheda che ha creato', bool_and(accepted))
from public.push_shared_rows(:'alice', 'bob-5', jsonb_build_array(
  pg_temp.r('flashcard', '{"id": "fc-bob", "deletedAt": "2026-11-16T10:11:00.000Z"}', true)));

select set_config('request.jwt.claim.sub', :'alice', true) \g /dev/null
delete from public.studyos_shares where owner_id = :'alice' and scope = 'flashcards';
select set_config('request.jwt.claim.sub', :'bob', true) \g /dev/null
select pg_temp.expect('FC11 condivisione tolta: Bob non legge più nulla della sezione',
  not exists (select 1 from public.studyos_items where user_id = :'alice' and entity_type in ('studyDeck', 'flashcard', 'quiz', 'quizQuestion')));
select pg_temp.expect('FC11 né scrive', bool_and(reason = 'denied'))
from public.push_shared_rows(:'alice', 'bob-6', jsonb_build_array(
  pg_temp.r('flashcard', pg_temp.base('fc1', '2026-11-16T10:12:00.000Z') || :'card'::jsonb)));
reset role;
select pg_temp.expect('FC11 la sync personale di Alice resta intatta',
  (select count(*) from public.studyos_items where user_id = :'alice' and not deleted
     and entity_type in ('studyDeck', 'flashcard', 'quiz', 'quizQuestion', 'flashcardState', 'studyRun')) = 6);

rollback;
