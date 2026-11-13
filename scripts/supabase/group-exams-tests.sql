-- Prove di group-exams.sql. SOLO Postgres temporaneo o stack locale (mai il progetto reale).
-- Tutto in una transazione annullata alla fine. Ogni controllo che fallisce interrompe lo script.
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

-- Chi chiama: owner Olga (1111), membri Bea (2222) e Ada (504b), estranea Mallory (fc01).
\set olga '11111111-1111-1111-1111-111111111111'
\set bea '22222222-2222-2222-2222-222222222222'
\set ada '504b3482-7f1b-4add-bfbc-7b3effbf21d7'
\set mallory 'fc0191e0-6663-4a43-b060-131e397f02cc'

insert into public.studyos_groups (id, name, owner_id, owner_display_name, invite_code)
  values ('gx', 'Farmaco', :'olga', 'Olga', 'GX-CODE-1');
insert into public.studyos_group_members (group_id, user_id, display_name, role) values
  ('gx', :'olga', 'Olga', 'owner'), ('gx', :'bea', 'Bea', 'member'), ('gx', :'ada', 'Ada', 'member');

-- N1-N6: nome del corso normalizzato (stessi esempi di tests/groupExams.test.mjs).
select pg_temp.expect('N1 nome semplice', public.studyos_course_norm('Farmacologia Speciale') = 'farmacologia speciale');
select pg_temp.expect('N2 spazi', public.studyos_course_norm('  Biologia   Molecolare II ') = 'biologia molecolare ii');
select pg_temp.expect('N3 punteggiatura', public.studyos_course_norm('Chimica – Organica (A-L)') = 'chimica organica a l');
select pg_temp.expect('N4 accento iniziale', public.studyos_course_norm('Ànatomia Umana') = 'anatomia umana');
select pg_temp.expect('N5 maiuscole accentate', public.studyos_course_norm('ÉTICA e Società') = 'etica e societa');
select pg_temp.expect('N6 vuoto', public.studyos_course_norm('') = '');

-- E1-E6: email ammesse nei testi del catalogo.
select pg_temp.expect('E1 unimi', public.studyos_only_unimi_emails('cl.biol@unimi.it · via Celoria, 26'));
select pg_temp.expect('E2 unimi maiuscolo e punto finale', public.studyos_only_unimi_emails('Scrivi a Mario.Rossi@UNIMI.IT.'));
select pg_temp.expect('E3 gmail no', not public.studyos_only_unimi_emails('mario@gmail.com'));
select pg_temp.expect('E4 sottodominio no', not public.studyos_only_unimi_emails('mario@studenti.unimi.it'));
select pg_temp.expect('E5 dominio esteso no', not public.studyos_only_unimi_emails('x@unimi.it.evil.com'));
select pg_temp.expect('E6 doppia chiocciola no', not public.studyos_only_unimi_emails('x@unimi.it@evil.com'));

-- Da qui si chiama come persona autenticata.
set local role authenticated;
select set_config('request.jwt.claim.sub', :'bea', true) \g /dev/null

-- S1: Bea crea il preappello.
select pg_temp.expect('S1 creazione', r ->> 'status' = 'ok' and (r -> 'row' ->> 'version')::int = 1
  and r -> 'row' ->> 'course_key' = 'barb:farm-spec' and r -> 'row' ->> 'created_by_name' = 'Bea')
from (select public.save_group_exam_session('gx', 'gexam_a1', null, jsonb_build_object(
  'courseId', 'farm-spec', 'courseName', 'Farmacologia Speciale', 'date', '2027-01-12', 'kind', 'preappello',
  'room', 'Aula C03')) as r) as t;
-- S2: stessa creazione ripetuta (risposta persa): ok, nessuna riga nuova in cronologia.
select pg_temp.expect('S2 creazione ripetuta', r ->> 'status' = 'ok')
from (select public.save_group_exam_session('gx', 'gexam_a1', null, jsonb_build_object(
  'courseId', 'farm-spec', 'courseName', 'Farmacologia Speciale', 'date', '2027-01-12', 'kind', 'preappello')) as r) as t;
select pg_temp.expect('S2 una voce di cronologia', count(*) = 1) from public.studyos_group_history where record_id = 'gexam_a1';
select pg_temp.expect('S2 una voce di attività', count(*) = 1) from public.studyos_group_activity
  where group_id = 'gx' and text like 'ha aggiunto l''appello «Preappello Farmacologia Speciale del 12/01/2027»';

-- S3-S4: Ada prova a crearlo di nuovo (stesso corso dal catalogo, poi scritto a mano): duplicate.
select set_config('request.jwt.claim.sub', :'ada', true) \g /dev/null
select pg_temp.expect('S3 duplicato con la chiave', r ->> 'status' = 'duplicate' and r -> 'row' ->> 'id' = 'gexam_a1')
from (select public.save_group_exam_session('gx', 'gexam_b1', null, jsonb_build_object(
  'courseId', 'farm-spec', 'courseName', 'Farmacologia speciale', 'date', '2027-01-12', 'kind', 'preappello')) as r) as t;
select pg_temp.expect('S4 duplicato con il nome', r ->> 'status' = 'duplicate' and r -> 'row' ->> 'id' = 'gexam_a1')
from (select public.save_group_exam_session('gx', 'gexam_b2', null, jsonb_build_object(
  'courseName', ' FARMACOLOGIA  speciale ', 'date', '2027-01-12', 'kind', 'preappello')) as r) as t;
select pg_temp.expect('S4b altro tipo stesso giorno: ok', r ->> 'status' = 'ok')
from (select public.save_group_exam_session('gx', 'gexam_b3', null, jsonb_build_object(
  'courseName', 'Farmacologia Speciale', 'date', '2027-01-12', 'kind', 'orale')) as r) as t;

-- S5: Ada modifica partendo dalla versione 1.
select pg_temp.expect('S5 modifica', r ->> 'status' = 'ok' and (r -> 'row' ->> 'version')::int = 2
  and r -> 'row' ->> 'room' = 'Aula G24' and r -> 'row' ->> 'updated_by_name' = 'Ada')
from (select public.save_group_exam_session('gx', 'gexam_a1', 1, jsonb_build_object(
  'courseId', 'farm-spec', 'courseName', 'Farmacologia Speciale', 'date', '2027-01-12', 'kind', 'preappello',
  'room', 'Aula G24')) as r) as t;
select pg_temp.expect('S5 cronologia con campi cambiati', changed_fields = array['room'] and before ->> 'room' = 'Aula C03'
  and after ->> 'room' = 'Aula G24' and actor_name = 'Ada')
from public.studyos_group_history where record_id = 'gexam_a1' and action = 'update';
-- S6: stessa modifica senza cambi: ok, versione invariata.
select pg_temp.expect('S6 nessun cambio', r ->> 'status' = 'ok' and (r -> 'row' ->> 'version')::int = 2)
from (select public.save_group_exam_session('gx', 'gexam_a1', 2, jsonb_build_object(
  'courseId', 'farm-spec', 'courseName', 'Farmacologia Speciale', 'date', '2027-01-12', 'kind', 'preappello',
  'room', 'Aula G24')) as r) as t;

-- S7: Bea modifica dalla versione 1 (vecchia): conflict con la riga attuale.
select set_config('request.jwt.claim.sub', :'bea', true) \g /dev/null
select pg_temp.expect('S7 conflitto', r ->> 'status' = 'conflict' and (r -> 'row' ->> 'version')::int = 2)
from (select public.save_group_exam_session('gx', 'gexam_a1', 1, jsonb_build_object(
  'courseId', 'farm-spec', 'courseName', 'Farmacologia Speciale', 'date', '2027-01-14', 'kind', 'preappello')) as r) as t;
-- S8: modifica che lo renderebbe uguale a un altro appello: duplicate.
select pg_temp.expect('S8 modifica verso un duplicato', r ->> 'status' = 'duplicate' and r -> 'row' ->> 'id' = 'gexam_b3')
from (select public.save_group_exam_session('gx', 'gexam_a1', 2, jsonb_build_object(
  'courseId', 'farm-spec', 'courseName', 'Farmacologia Speciale', 'date', '2027-01-12', 'kind', 'orale')) as r) as t;

-- V1-V4: campi non validi.
select pg_temp.expect('V1 data impossibile', r ->> 'status' = 'invalid' and r ->> 'field' = 'date')
from (select public.save_group_exam_session('gx', 'gexam_v1', null, jsonb_build_object(
  'courseName', 'Fisiologia', 'date', '2027-02-30', 'kind', 'appello')) as r) as t;
select pg_temp.expect('V2 campo sconosciuto', r ->> 'status' = 'invalid' and r ->> 'field' = 'grade')
from (select public.save_group_exam_session('gx', 'gexam_v2', null, jsonb_build_object(
  'courseName', 'Fisiologia', 'date', '2027-02-10', 'kind', 'appello', 'grade', '30')) as r) as t;
select pg_temp.expect('V3 tipo sbagliato', r ->> 'status' = 'invalid' and r ->> 'field' = 'kind')
from (select public.save_group_exam_session('gx', 'gexam_v3', null, jsonb_build_object(
  'courseName', 'Fisiologia', 'date', '2027-02-10', 'kind', 'esame')) as r) as t;
select pg_temp.expect('V4 iscrizioni al contrario', r ->> 'status' = 'invalid' and r ->> 'field' = 'registrationCloses')
from (select public.save_group_exam_session('gx', 'gexam_v4', null, jsonb_build_object(
  'courseName', 'Fisiologia', 'date', '2027-02-10', 'kind', 'appello',
  'registrationOpens', '2027-01-20', 'registrationCloses', '2027-01-10')) as r) as t;

-- M1-M4: Mallory non è nel gruppo.
select set_config('request.jwt.claim.sub', :'mallory', true) \g /dev/null
select pg_temp.expect('M1 estranea non scrive', r ->> 'status' = 'denied')
from (select public.save_group_exam_session('gx', 'gexam_m1', null, jsonb_build_object(
  'courseName', 'Fisiologia', 'date', '2027-02-10', 'kind', 'appello')) as r) as t;
select pg_temp.expect('M2 estranea non legge appelli', count(*) = 0) from public.studyos_group_exam_sessions;
select pg_temp.expect('M3 estranea non legge cronologia', count(*) = 0) from public.studyos_group_history;
select pg_temp.expect('M4 estranea non elimina (non trovato)', public.delete_group_exam_session('gexam_a1', 2) ->> 'status' = 'not_found');
do $$
begin
  insert into public.studyos_group_exam_sessions (id, group_id, course_key, course_name, course_norm, exam_date, kind, created_by, updated_by)
  values ('gexam_direct', 'gx', 'nome:x', 'xx', 'xx', '2027-01-01', 'appello', 'x', 'x');
  raise exception 'FALLITO: M5 scrittura diretta accettata';
exception when insufficient_privilege then
  null;
end $$;
select 'ok M5 nessuna scrittura diretta';

-- D1-D4: eliminazione.
select set_config('request.jwt.claim.sub', :'ada', true) \g /dev/null
select pg_temp.expect('D1 membro non autore: denied', public.delete_group_exam_session('gexam_a1', 2) ->> 'status' = 'denied');
select set_config('request.jwt.claim.sub', :'bea', true) \g /dev/null
select pg_temp.expect('D2 versione vecchia: conflict', public.delete_group_exam_session('gexam_a1', 1) ->> 'status' = 'conflict');
select pg_temp.expect('D3 autrice elimina', r ->> 'status' = 'ok' and r -> 'row' ->> 'deleted_at' is not null
  and (r -> 'row' ->> 'version')::int = 3 and r -> 'row' ->> 'deleted_by_name' = 'Bea')
from (select public.delete_group_exam_session('gexam_a1', 2) as r) as t;
select pg_temp.expect('D4 già eliminato: gone', public.delete_group_exam_session('gexam_a1', 3) ->> 'status' = 'gone');
select pg_temp.expect('D5 modifica di un eliminato: gone', r ->> 'status' = 'gone')
from (select public.save_group_exam_session('gx', 'gexam_a1', 3, jsonb_build_object(
  'courseName', 'Farmacologia Speciale', 'date', '2027-01-12', 'kind', 'preappello')) as r) as t;

-- R1-R5: ripristino dalla cronologia.
select set_config('request.jwt.claim.sub', :'ada', true) \g /dev/null
select pg_temp.expect('R1 creazione: non si ripristina', public.restore_group_record(
  (select id from public.studyos_group_history where record_id = 'gexam_a1' and action = 'create'), 3) ->> 'status' = 'invalid');
select pg_temp.expect('R2 versione vecchia: conflict', public.restore_group_record(
  (select id from public.studyos_group_history where record_id = 'gexam_a1' and action = 'delete'), 2) ->> 'status' = 'conflict');
select pg_temp.expect('R3 un membro ripristina l''eliminato', r ->> 'status' = 'ok' and r -> 'row' ->> 'deleted_at' is null
  and (r -> 'row' ->> 'version')::int = 4 and r -> 'row' ->> 'room' = 'Aula G24')
from (select public.restore_group_record(
  (select id from public.studyos_group_history where record_id = 'gexam_a1' and action = 'delete'), 3) as r) as t;
select pg_temp.expect('R3 voce di attività', count(*) = 1) from public.studyos_group_activity
  where group_id = 'gx' and text like 'ha ripristinato l''appello%' and actor_display_name = 'Ada';
select pg_temp.expect('R4 annullare il ripristino elimina: Ada no', public.restore_group_record(
  (select id from public.studyos_group_history where record_id = 'gexam_a1' and action = 'restore'), 4) ->> 'status' = 'denied');
select set_config('request.jwt.claim.sub', :'olga', true) \g /dev/null
select pg_temp.expect('R5 chi gestisce il gruppo sì', r ->> 'status' = 'ok' and r -> 'row' ->> 'deleted_at' is not null)
from (select public.restore_group_record(
  (select id from public.studyos_group_history where record_id = 'gexam_a1' and action = 'restore'), 4) as r) as t;
-- R6: un nuovo appello uguale occupa la chiave; ripristinare il vecchio dà duplicate.
select pg_temp.expect('R6a nuovo appello uguale', public.save_group_exam_session('gx', 'gexam_c1', null, jsonb_build_object(
  'courseName', 'Farmacologia Speciale', 'date', '2027-01-12', 'kind', 'preappello')) ->> 'status' = 'ok');
select pg_temp.expect('R6b ripristino del vecchio: duplicate', public.restore_group_record(
  (select id from public.studyos_group_history where record_id = 'gexam_a1' and action = 'delete'), 5) ->> 'status' = 'duplicate');

-- O1-O8: correzioni al catalogo.
select set_config('request.jwt.claim.sub', :'bea', true) \g /dev/null
select pg_temp.expect('O1 email non istituzionale', r ->> 'status' = 'invalid' and r ->> 'field' = 'email')
from (select public.save_group_catalog_override('gx', 'gover_t1', null, 'teacher', 'unimi-mario-rossi', 'Mario Rossi',
  jsonb_build_object('email', 'mario@gmail.com')) as r) as t;
select pg_temp.expect('O2 sottodominio', r ->> 'status' = 'invalid' and r ->> 'field' = 'email')
from (select public.save_group_catalog_override('gx', 'gover_t1', null, 'teacher', 'unimi-mario-rossi', 'Mario Rossi',
  jsonb_build_object('email', 'mario@studenti.unimi.it')) as r) as t;
select pg_temp.expect('O3 email nel ricevimento', r ->> 'status' = 'invalid' and r ->> 'field' = 'officeHours')
from (select public.save_group_catalog_override('gx', 'gover_t1', null, 'teacher', 'unimi-mario-rossi', 'Mario Rossi',
  jsonb_build_object('officeHours', 'scrivere a mario@gmail.com')) as r) as t;
select pg_temp.expect('O4 sito non http', r ->> 'status' = 'invalid' and r ->> 'field' = 'website')
from (select public.save_group_catalog_override('gx', 'gover_t1', null, 'teacher', 'unimi-mario-rossi', 'Mario Rossi',
  jsonb_build_object('website', 'javascript:alert(1)')) as r) as t;
select pg_temp.expect('O5 correzione valida, email in minuscolo', r ->> 'status' = 'ok'
  and r -> 'row' -> 'fields' ->> 'email' = 'mario.rossi@unimi.it' and r -> 'row' -> 'fields' ->> 'officeHours' = 'Mar 10-12')
from (select public.save_group_catalog_override('gx', 'gover_t1', null, 'teacher', 'unimi-mario-rossi', 'Mario Rossi',
  jsonb_build_object('email', 'Mario.Rossi@UNIMI.IT', 'officeHours', ' Mar  10-12 ', 'phone', null)) as r) as t;
select set_config('request.jwt.claim.sub', :'ada', true) \g /dev/null
select pg_temp.expect('O6 seconda correzione dello stesso docente: duplicate', r ->> 'status' = 'duplicate')
from (select public.save_group_catalog_override('gx', 'gover_t2', null, 'teacher', 'unimi-mario-rossi', 'Mario Rossi',
  jsonb_build_object('office', 'Studio 3')) as r) as t;
select pg_temp.expect('O7 modifica', r ->> 'status' = 'ok' and (r -> 'row' ->> 'version')::int = 2)
from (select public.save_group_catalog_override('gx', 'gover_t1', 1, 'teacher', 'unimi-mario-rossi', 'Mario Rossi',
  jsonb_build_object('email', 'mario.rossi@unimi.it', 'officeHours', 'Mer 14-16')) as r) as t;
select pg_temp.expect('O7 cronologia', changed_fields = array['officeHours']) from public.studyos_group_history
  where record_id = 'gover_t1' and action = 'update';
select pg_temp.expect('O8 contatto con email unimi', public.save_group_catalog_override('gx', 'gover_c1', null, 'contact',
  'contatto:segreteria-studenti', 'Segreteria Studenti',
  jsonb_build_object('value', 'cl.biol@unimi.it · via Celoria, 26')) ->> 'status' = 'ok');
select pg_temp.expect('O9 campo di un altro tipo', r ->> 'status' = 'invalid' and r ->> 'field' = 'email')
from (select public.save_group_catalog_override('gx', 'gover_r1', null, 'course', 'farm-spec', 'Farmacologia Speciale',
  jsonb_build_object('email', 'a@unimi.it')) as r) as t;
select pg_temp.expect('O10 membro non autore non elimina', public.delete_group_catalog_override('gover_t1', 2) ->> 'status' = 'denied');
select set_config('request.jwt.claim.sub', :'bea', true) \g /dev/null
select pg_temp.expect('O11 autrice elimina', public.delete_group_catalog_override('gover_t1', 2) ->> 'status' = 'ok');
select pg_temp.expect('O12 ripristino della correzione', r ->> 'status' = 'ok' and r -> 'row' ->> 'deleted_at' is null)
from (select public.restore_group_record(
  (select id from public.studyos_group_history where record_id = 'gover_t1' and action = 'delete'), 3) as r) as t;

-- L1: tetto di 60 modifiche l'ora per membro.
reset role;
insert into public.studyos_group_history (group_id, record_kind, record_id, action, version, actor_user_id, actor_name)
  select 'gx', 'exam_session', 'finto', 'update', g, :'ada', 'Ada' from generate_series(1, 60) as g;
set local role authenticated;
select set_config('request.jwt.claim.sub', :'ada', true) \g /dev/null
select pg_temp.expect('L1 troppe modifiche', r ->> 'status' = 'invalid' and r ->> 'field' = 'rate')
from (select public.save_group_exam_session('gx', 'gexam_l1', null, jsonb_build_object(
  'courseName', 'Genetica', 'date', '2027-03-01', 'kind', 'appello')) as r) as t;

-- P1: gli eliminati di oltre 180 giorni spariscono alla scrittura successiva nel gruppo.
reset role;
update public.studyos_group_exam_sessions set deleted_at = now() - interval '200 days' where id = 'gexam_a1';
set local role authenticated;
select set_config('request.jwt.claim.sub', :'bea', true) \g /dev/null
select pg_temp.expect('P1 scrittura', public.save_group_exam_session('gx', 'gexam_p1', null, jsonb_build_object(
  'courseName', 'Genetica', 'date', '2027-03-01', 'kind', 'appello')) ->> 'status' = 'ok');
reset role;
select pg_temp.expect('P1 eliminato vecchio tolto', not exists (select 1 from public.studyos_group_exam_sessions where id = 'gexam_a1'));

-- A1-A3: connettore remoto (segreto di 64 caratteri, solo i gruppi dell'account).
insert into public.studyos_agent_grants (user_id, secret_hash, label)
  values (:'bea', public.studyos_agent_secret_hash(repeat('a', 64)), 'prova');
set local role anon;
select pg_temp.expect('A1 snapshot', jsonb_array_length(s -> 'groups') = 1 and jsonb_array_length(s -> 'sessions') >= 3
  and not exists (select 1 from jsonb_array_elements(s -> 'sessions') as e where e ? 'created_by' or e ? 'updated_by' or e ? 'deleted_by')
  and exists (select 1 from jsonb_array_elements(s -> 'sessions') as e where (e ->> 'mine')::boolean)
  and jsonb_array_length(s -> 'overrides') = 2)
from (select public.studyos_agent_group_snapshot(repeat('a', 64)) as s) as t;
do $$
begin
  perform public.studyos_agent_group_snapshot(repeat('b', 64));
  raise exception 'FALLITO: A2 segreto sbagliato accettato';
exception when sqlstate '28000' then
  null;
end $$;
select 'ok A2 segreto sbagliato rifiutato';
reset role;

-- ---------------------------------------------------------------------------------------------
-- Giro di correzioni 1 (revisione R-I1)
-- ---------------------------------------------------------------------------------------------
-- Due gruppi senza Bea: Mallory è proprietaria di gy e semplice membro di gz (di Olga).
insert into public.studyos_groups (id, name, owner_id, owner_display_name, invite_code)
  values ('gy', 'Altro A', :'mallory', 'Mallory', 'GY-CODE-1'), ('gz', 'Altro B', :'olga', 'Olga', 'GZ-CODE-1');
insert into public.studyos_group_members (group_id, user_id, display_name, role) values
  ('gy', :'mallory', 'Mallory', 'owner'), ('gz', :'olga', 'Olga', 'owner'), ('gz', :'mallory', 'Mallory', 'member');

-- Q1: lo snapshot di Bea non contiene i gruppi degli altri (con righe vere negli altri gruppi).
insert into public.studyos_group_exam_sessions (id, group_id, course_key, course_name, course_norm, exam_date, kind, created_by, updated_by)
  values ('gexam_q1y', 'gy', 'nome:fisica', 'Fisica', 'fisica', '2027-02-01', 'appello', :'mallory', :'mallory'),
         ('gexam_q1z', 'gz', 'nome:fisica', 'Fisica', 'fisica', '2027-02-01', 'appello', :'mallory', :'mallory');
insert into public.studyos_group_catalog_overrides (id, group_id, target_kind, target_id, fields, created_by, updated_by)
  values ('gover_q1y', 'gy', 'teacher', 'unimi-q1', '{"office": "Studio Q"}', :'mallory', :'mallory'),
         ('gover_q1z', 'gz', 'teacher', 'unimi-q1', '{"office": "Studio Q"}', :'mallory', :'mallory');
set local role anon;
select pg_temp.expect('Q1 isolamento tra gruppi', jsonb_array_length(s -> 'groups') = 1
  and jsonb_array_length(s -> 'sessions') > 0 and jsonb_array_length(s -> 'overrides') > 0
  and not exists (select 1 from jsonb_array_elements(s -> 'sessions') as e where e ->> 'group_id' <> 'gx')
  and not exists (select 1 from jsonb_array_elements(s -> 'overrides') as e where e ->> 'group_id' <> 'gx'))
from (select public.studyos_agent_group_snapshot(repeat('a', 64)) as s) as t;
reset role;
delete from public.studyos_group_exam_sessions where id in ('gexam_q1y', 'gexam_q1z');
delete from public.studyos_group_catalog_overrides where id in ('gover_q1y', 'gover_q1z');

-- Id di gruppo con testo libero: i nuovi si rifiutano (forma dell'id); quelli vecchi restano ma non escono verso gli agenti.
do $$
begin
  insert into public.studyos_groups (id, name, owner_id, owner_display_name, invite_code)
    values ('bea.privata@gmail.com', 'Strano', '11111111-1111-1111-1111-111111111111', 'Olga', 'ST-CODE-1');
  raise exception 'FALLITO: ID1 id di gruppo con email accettato';
exception when check_violation then
  null;
end $$;
select 'ok ID1 id di gruppo con testo libero rifiutato';
alter table public.studyos_groups drop constraint studyos_groups_id_shape;
insert into public.studyos_groups (id, name, owner_id, owner_display_name, invite_code)
  values ('vecchio@gruppo', 'Vecchio', :'olga', 'Olga', 'ST-CODE-2');
insert into public.studyos_group_members (group_id, user_id, display_name, role) values ('vecchio@gruppo', :'bea', 'Bea', 'member');
insert into public.studyos_group_exam_sessions (id, group_id, course_key, course_name, course_norm, exam_date, kind, created_by, updated_by)
  values ('gexam_old', 'vecchio@gruppo', 'nome:fisica', 'Fisica', 'fisica', '2027-02-01', 'appello', :'olga', :'olga');
alter table public.studyos_groups add constraint studyos_groups_id_shape check (id ~ '^[A-Za-z0-9_-]{1,120}$') not valid;
set local role anon;
select pg_temp.expect('ID2 gruppo con id strano non esce', not exists (select 1 from jsonb_array_elements(s -> 'groups') as e where e ->> 'id' like '%@%')
  and not exists (select 1 from jsonb_array_elements(s -> 'sessions') as e where e ->> 'group_id' like '%@%'))
from (select public.studyos_agent_group_snapshot(repeat('a', 64)) as s) as t;
reset role;
delete from public.studyos_groups where id = 'vecchio@gruppo';

-- M1: dopo la pulizia di un id, lo stesso id in un altro gruppo non si ripristina dalla cronologia vecchia.
set local role authenticated;
select set_config('request.jwt.claim.sub', :'mallory', true) \g /dev/null
select pg_temp.expect('M1 creo in gy', public.save_group_exam_session('gy', 'gexam_m1', null, jsonb_build_object(
  'courseName', 'Chimica Generale', 'date', '2027-04-01', 'kind', 'appello')) ->> 'status' = 'ok');
select pg_temp.expect('M1 elimino in gy', public.delete_group_exam_session('gexam_m1', 1) ->> 'status' = 'ok');
select pg_temp.expect('M1 correzione in gy', public.save_group_catalog_override('gy', 'gover_m1', null, 'teacher',
  'unimi-x', 'X', jsonb_build_object('office', 'Studio 1')) ->> 'status' = 'ok');
select pg_temp.expect('M1 elimino la correzione in gy', public.delete_group_catalog_override('gover_m1', 1) ->> 'status' = 'ok');
reset role;
delete from public.studyos_group_exam_sessions where id = 'gexam_m1';
delete from public.studyos_group_catalog_overrides where id = 'gover_m1';
set local role authenticated;
select set_config('request.jwt.claim.sub', :'mallory', true) \g /dev/null
select pg_temp.expect('M1 stesso id in gz', public.save_group_exam_session('gz', 'gexam_m1', null, jsonb_build_object(
  'courseName', 'Biochimica', 'date', '2027-04-02', 'kind', 'appello', 'notes', 'privata di gz')) ->> 'status' = 'ok');
select pg_temp.expect('M1 stesso id correzione in gz', public.save_group_catalog_override('gz', 'gover_m1', null, 'teacher',
  'unimi-y', 'Y', jsonb_build_object('office', 'Studio gz')) ->> 'status' = 'ok');
select pg_temp.expect('M1 ripristino da gy non tocca gz', public.restore_group_record(
  (select id from public.studyos_group_history where group_id = 'gy' and record_id = 'gexam_m1' and action = 'delete'), 1) ->> 'status' = 'gone');
select pg_temp.expect('M1 correzione: stessa cosa', public.restore_group_record(
  (select id from public.studyos_group_history where group_id = 'gy' and record_id = 'gover_m1' and action = 'delete'), 1) ->> 'status' = 'gone');
reset role;
select pg_temp.expect('M1 la riga di gz è intatta', (select course_name = 'Biochimica' and notes = 'privata di gz' and version = 1
  from public.studyos_group_exam_sessions where id = 'gexam_m1')
  and (select fields ->> 'office' = 'Studio gz' and version = 1 from public.studyos_group_catalog_overrides where id = 'gover_m1'));
select pg_temp.expect('M1 nessuna voce di ripristino', not exists (select 1 from public.studyos_group_history where action = 'restore'
  and record_id in ('gexam_m1', 'gover_m1') and group_id in ('gy', 'gz')));

-- L1b: una versione attesa nulla non salta il controllo di conflitto (elimina e ripristina).
set local role authenticated;
select set_config('request.jwt.claim.sub', :'bea', true) \g /dev/null
select pg_temp.expect('N1b creo', public.save_group_exam_session('gx', 'gexam_n1', null, jsonb_build_object(
  'courseName', 'Immunologia', 'date', '2027-05-01', 'kind', 'appello')) ->> 'status' = 'ok');
select pg_temp.expect('N1b modifico', public.save_group_exam_session('gx', 'gexam_n1', 1, jsonb_build_object(
  'courseName', 'Immunologia', 'date', '2027-05-01', 'kind', 'appello', 'room', 'Aula 5')) ->> 'status' = 'ok');
select pg_temp.expect('N1b elimina senza versione: conflict', public.delete_group_exam_session('gexam_n1', null) ->> 'status' = 'conflict');
select pg_temp.expect('N1b ripristina senza versione: conflict', public.restore_group_record(
  (select id from public.studyos_group_history where record_id = 'gexam_n1' and action = 'update'), null) ->> 'status' = 'conflict');
select pg_temp.expect('N1b correzione senza versione: conflict', public.save_group_catalog_override('gx', 'gover_n1', null, 'teacher',
  'unimi-n', 'N', jsonb_build_object('office', 'Studio 9')) ->> 'status' = 'ok'
  and public.delete_group_catalog_override('gover_n1', null) ->> 'status' = 'conflict');
select pg_temp.expect('N1b ancora viva', (select deleted_at is null and version = 2 from public.studyos_group_exam_sessions where id = 'gexam_n1'));

-- L2: un ripristino che elimina di nuovo scrive una data di eliminazione nuova (non quella vecchia).
select pg_temp.expect('N2 elimina', public.delete_group_exam_session('gexam_n1', 2) ->> 'status' = 'ok');
select pg_temp.expect('N2 ripristina', public.restore_group_record(
  (select id from public.studyos_group_history where record_id = 'gexam_n1' and action = 'delete'), 3) ->> 'status' = 'ok');
reset role;
update public.studyos_group_history set before = jsonb_set(before, '{deleted_at}', to_jsonb((now() - interval '200 days')::text))
  where record_id = 'gexam_n1' and action = 'restore';
set local role authenticated;
select set_config('request.jwt.claim.sub', :'bea', true) \g /dev/null
select pg_temp.expect('N2 annullo il ripristino: elimina con data nuova', r ->> 'status' = 'ok'
  and (r -> 'row' ->> 'deleted_at')::timestamptz > now() - interval '1 day')
from (select public.restore_group_record(
  (select id from public.studyos_group_history where record_id = 'gexam_n1' and action = 'restore'), 4) as r) as t;

-- L3: collegare un appello manuale al catalogo ufficiale (solo barbSessionId e source) si salva.
select pg_temp.expect('N3 creo manuale con corso', public.save_group_exam_session('gx', 'gexam_n3', null, jsonb_build_object(
  'courseId', 'chim-org', 'courseName', 'Chimica Organica', 'date', '2027-06-01', 'kind', 'appello')) ->> 'status' = 'ok');
select pg_temp.expect('N3 collego al catalogo', r ->> 'status' = 'ok' and (r -> 'row' ->> 'version')::int = 2
  and r -> 'row' ->> 'barb_session_id' = 'ufficiale-1' and r -> 'row' ->> 'source' = 'barb')
from (select public.save_group_exam_session('gx', 'gexam_n3', 1, jsonb_build_object(
  'courseId', 'chim-org', 'courseName', 'Chimica Organica', 'date', '2027-06-01', 'kind', 'appello',
  'barbSessionId', 'ufficiale-1', 'source', 'barb')) as r) as t;
select pg_temp.expect('N3 cronologia', changed_fields = array['course']) from public.studyos_group_history
  where record_id = 'gexam_n3' and action = 'update';

-- M2: l'etichetta della correzione segue la regola @unimi.it.
select pg_temp.expect('E7 etichetta con email non istituzionale', r ->> 'status' = 'invalid' and r ->> 'field' = 'targetLabel'
  and r ->> 'message' = 'Solo indirizzi istituzionali che finiscono con @unimi.it.')
from (select public.save_group_catalog_override('gx', 'gover_e7', null, 'teacher', 'unimi-e7',
  'Mario Rossi - mario.privato@gmail.com', jsonb_build_object('office', 'Studio 2')) as r) as t;
select pg_temp.expect('E8 etichetta con email unimi', public.save_group_catalog_override('gx', 'gover_e8', null, 'teacher', 'unimi-e8',
  'Mario Rossi - mario.rossi@unimi.it', jsonb_build_object('office', 'Studio 2')) ->> 'status' = 'ok');
reset role;
-- Una riga vecchia con etichetta sporca (scritta prima del giro): il ripristino la rifiuta.
update public.studyos_group_catalog_overrides set target_label = 'Y - sporco@gmail.com' where id = 'gover_e8';
insert into public.studyos_group_history (group_id, record_kind, record_id, action, version, before, after, actor_user_id, actor_name)
  select 'gx', 'catalog_override', 'gover_e8', 'update', 1, to_jsonb(o), to_jsonb(o), :'bea', 'Bea'
  from public.studyos_group_catalog_overrides as o where o.id = 'gover_e8';
set local role authenticated;
select set_config('request.jwt.claim.sub', :'bea', true) \g /dev/null
select pg_temp.expect('E9 ripristino con etichetta sporca: invalid', r ->> 'status' = 'invalid')
from (select public.restore_group_record((select max(id) from public.studyos_group_history where record_id = 'gover_e8'), 1) as r) as t;
reset role;
update public.studyos_group_catalog_overrides set target_label = 'Mario Rossi' where id = 'gover_e8';

-- M2: lo snapshot non porta mai email non istituzionali, in nessun campo di testo.
select set_config('request.jwt.claim.sub', '', true) \g /dev/null
update public.studyos_group_members set display_name = 'bea.privata@gmail.com' where group_id = 'gx' and user_id = :'bea';
set local role authenticated;
select set_config('request.jwt.claim.sub', :'bea', true) \g /dev/null
select pg_temp.expect('X0 appello con email nei testi', public.save_group_exam_session('gx', 'gexam_x2', null, jsonb_build_object(
  'courseName', 'Genetica Umana', 'date', '2027-07-01', 'kind', 'appello', 'label', 'scrivi a ab@gmail.com',
  'room', 'aula x@y.com', 'notes', 'ada99@hotmail.it, Mario@UNIMI.IT, z@studenti.unimi.it, q@unimi.it.evil.com'))
  ->> 'status' = 'ok');
select pg_temp.expect('X0b corso con email nel nome', public.save_group_exam_session('gx', 'gexam_x3', null, jsonb_build_object(
  'courseName', 'Chimica - bea.privata@gmail.com', 'date', '2027-07-02', 'kind', 'appello')) ->> 'status' = 'ok');
reset role;
set local role anon;
-- Spec §9.3: nei testi dei membri e nei nomi non resta NESSUNA email (nemmeno @unimi.it); gli @unimi.it
-- restano solo nei campi email/contatto delle correzioni.
select pg_temp.expect('X1 nessuna email nei testi dei membri',
  (s -> 'sessions')::text !~ '@' and (s -> 'groups')::text !~ '@'
  and (s -> 'sessions')::text like '%[email nascosta]%'
  and not exists (select 1 from jsonb_array_elements(s -> 'overrides') as o
    where (o ->> 'target_label') ~ '@' or (o ->> 'created_by_name') ~ '@' or (o -> 'fields' ->> 'note') ~ '@'))
from (select public.studyos_agent_group_snapshot(repeat('a', 64)) as s) as t;
select pg_temp.expect('X1 gli @unimi.it restano nel campo email della correzione',
  exists (select 1 from jsonb_array_elements(s -> 'overrides') as o where o -> 'fields' ->> 'email' = 'mario.rossi@unimi.it'))
from (select public.studyos_agent_group_snapshot(repeat('a', 64)) as s) as t;
select pg_temp.expect('X1 il nome del membro non è un indirizzo', not exists (
  select 1 from jsonb_array_elements(s -> 'sessions') as e where e ->> 'created_by_name' ~ '@'))
from (select public.studyos_agent_group_snapshot(repeat('a', 64)) as s) as t;
select pg_temp.expect('X1 course_norm e course_key dal nome già oscurato', exists (
  select 1 from jsonb_array_elements(s -> 'sessions') as e
  where e ->> 'id' = 'gexam_x3' and e ->> 'course_name' = 'Chimica - [email nascosta]'
    and e ->> 'course_norm' = 'chimica email nascosta' and e ->> 'course_key' = 'nome:chimica email nascosta'))
from (select public.studyos_agent_group_snapshot(repeat('a', 64)) as s) as t;
reset role;
select pg_temp.expect('X1b il redattore: tutti nascosti o solo gli unimi',
  public.studyos_hide_emails('a@b.it e c@unimi.it') = '[email nascosta] e [email nascosta]'
  and public.studyos_hide_emails('a@b.it e c@unimi.it', true) = '[email nascosta] e c@unimi.it');

-- N1: una riga vecchia con caratteri strani (scritta prima dei controlli) non rompe mai lo snapshot,
-- né con il locale C né con en_US.UTF-8 (dove lower('İ') = 'i').
update public.studyos_group_catalog_overrides set fields = fields || jsonb_build_object('note', E'\u0001a@UNİMI.IT', 'office', E'\u0008b@gmail.com\u0001')
  where id = 'gover_t1';
update public.studyos_group_exam_sessions set notes = E'\u0001\u0008a@UNİMI.IT \\u0001x@y.com' where id = 'gexam_x2';
set local role anon;
select pg_temp.expect('N1 snapshot con testi strani', (s -> 'overrides')::text !~ 'gmail|UN.MI|x@y' and (s -> 'sessions')::text !~ 'UN.MI|x@y')
from (select public.studyos_agent_group_snapshot(repeat('a', 64)) as s) as t;
reset role;
select pg_temp.expect('N1b nessuna eccezione nemmeno su testo vuoto o nullo', public.studyos_hide_emails(null) is null and public.studyos_hide_emails('') = '');

-- D16 con i trucchi Unicode: la scrittura li rifiuta.
set local role authenticated;
select set_config('request.jwt.claim.sub', :'bea', true) \g /dev/null
select pg_temp.expect('E10 email con I turca', r ->> 'status' = 'invalid' and r ->> 'field' = 'email')
from (select public.save_group_catalog_override('gx', 'gover_e10', null, 'teacher', 'unimi-e10', 'X',
  jsonb_build_object('email', E'a@UNİMI.IT')) as r) as t;
select pg_temp.expect('E11 email con chiocciola larga e dominio estraneo', r ->> 'status' = 'invalid'
  and r ->> 'message' = 'Solo indirizzi istituzionali che finiscono con @unimi.it.')
from (select public.save_group_catalog_override('gx', 'gover_e11', null, 'teacher', 'unimi-e11', 'X',
  jsonb_build_object('note', E'scrivi a x＠gmail.com')) as r) as t;
select pg_temp.expect('E12 etichetta con chiocciola piccola', r ->> 'status' = 'invalid' and r ->> 'field' = 'targetLabel')
from (select public.save_group_catalog_override('gx', 'gover_e12', null, 'teacher', 'unimi-e12',
  E'Mario x﹫gmail.com', jsonb_build_object('office', 'Studio 2')) as r) as t;
select pg_temp.expect('E13 spazio senza larghezza prima di una chiocciola', r ->> 'status' = 'invalid')
from (select public.save_group_catalog_override('gx', 'gover_e13', null, 'teacher', 'unimi-e13', 'X',
  jsonb_build_object('note', E'bea​@gmail.com')) as r) as t;
select pg_temp.expect('E14 unimi con chiocciola larga: accettato, scritto normale', r ->> 'status' = 'ok'
  and r -> 'row' -> 'fields' ->> 'email' = 'a@unimi.it')
from (select public.save_group_catalog_override('gx', 'gover_e14', null, 'teacher', 'unimi-e14', 'X',
  jsonb_build_object('email', E'A＠UNIMI.IT')) as r) as t;
-- NEW-2: la «%» non fa più parte della parte locale e le «@» scritte in altro modo contano come «@».
select pg_temp.expect('E15 percento nella parte locale dell''email', r ->> 'status' = 'invalid' and r ->> 'field' = 'email')
from (select public.save_group_catalog_override('gx', 'gover_e15', null, 'teacher', 'unimi-e15', 'X',
  jsonb_build_object('email', 'bea.privata%gmail.com@unimi.it')) as r) as t;
select pg_temp.expect('E16 mailto con %40', r ->> 'status' = 'invalid' and r ->> 'field' = 'url')
from (select public.save_group_catalog_override('gx', 'gover_e16', null, 'contact', 'contatto:e16', 'X',
  jsonb_build_object('url', 'mailto:bea.privata%40gmail.com')) as r) as t;
select pg_temp.expect('E17 [at] in un contatto', r ->> 'status' = 'invalid' and r ->> 'field' = 'value')
from (select public.save_group_catalog_override('gx', 'gover_e17', null, 'contact', 'contatto:e17', 'X',
  jsonb_build_object('value', 'bea.privata[at]gmail.com')) as r) as t;
-- R3-6: nei link (url, website) «%40» nel percorso non è una chiocciola; «(AT)» staccato non è una chiocciola.
select pg_temp.expect('E18 link di Teams nel contatto: accettato com''è', r ->> 'status' = 'ok'
  and r -> 'row' -> 'fields' ->> 'url' = 'https://teams.microsoft.com/l/meetup-join/19%3ameeting_x%40thread.v2/0')
from (select public.save_group_catalog_override('gx', 'gover_e18', null, 'contact', 'contatto:e18', 'Lezioni online',
  jsonb_build_object('url', 'https://teams.microsoft.com/l/meetup-join/19%3ameeting_x%40thread.v2/0')) as r) as t;
select pg_temp.expect('E19 Google Calendar nel sito del docente: accettato', r ->> 'status' = 'ok'
  and r -> 'row' -> 'fields' ->> 'website' = 'https://calendar.google.com/calendar/embed?src=c_abc%40group.calendar.google.com')
from (select public.save_group_catalog_override('gx', 'gover_e19', null, 'teacher', 'unimi-e19', 'X',
  jsonb_build_object('website', 'https://calendar.google.com/calendar/embed?src=c_abc%40group.calendar.google.com')) as r) as t;
select pg_temp.expect('E20 «Sede di Asti (AT), aula 3» nella sede del corso: accettato', r ->> 'status' = 'ok'
  and r -> 'row' -> 'fields' ->> 'site' = 'Sede di Asti (AT), aula 3')
from (select public.save_group_catalog_override('gx', 'gover_e20', null, 'course', 'corso-e20', 'Corso',
  jsonb_build_object('site', 'Sede di Asti (AT), aula 3')) as r) as t;
select pg_temp.expect('E21 bea(at)gmail.com: rifiutato', r ->> 'status' = 'invalid' and r ->> 'field' = 'note')
from (select public.save_group_catalog_override('gx', 'gover_e21', null, 'teacher', 'unimi-e21', 'X',
  jsonb_build_object('note', 'scrivi a bea(at)gmail.com')) as r) as t;
select pg_temp.expect('E22 %40 in un testo che non è un link: rifiutato', r ->> 'status' = 'invalid' and r ->> 'field' = 'note')
from (select public.save_group_catalog_override('gx', 'gover_e22', null, 'teacher', 'unimi-e22', 'X',
  jsonb_build_object('note', 'scrivi a bea%40gmail.com')) as r) as t;
select pg_temp.expect('E23 %40 nell''utente di un link: rifiutato', r ->> 'status' = 'invalid' and r ->> 'field' = 'url')
from (select public.save_group_catalog_override('gx', 'gover_e23', null, 'contact', 'contatto:e23', 'X',
  jsonb_build_object('url', 'https://bea.privata%40gmail.com@example.com/')) as r) as t;
select pg_temp.expect('E24 chiocciola vera nel percorso di un link: rifiutata', r ->> 'status' = 'invalid' and r ->> 'field' = 'url')
from (select public.save_group_catalog_override('gx', 'gover_e24', null, 'contact', 'contatto:e24', 'X',
  jsonb_build_object('url', 'https://example.com/@bea')) as r) as t;
reset role;
set local role anon;
-- R5-C: per gli agenti un link si decodifica; con un indirizzo che non è @unimi.it (Teams: «…%40thread.v2»,
-- Google Calendar: «…%40group.calendar.google.com») diventa il segnaposto. L'app lo mostra com'è (E18, E19).
select pg_temp.expect('E25 lo snapshot dà il segnaposto per i link con un indirizzo non @unimi.it, il resto com''è', exists (
    select 1 from jsonb_array_elements(s -> 'overrides') as o
    where o ->> 'id' = 'gover_e18' and o -> 'fields' ->> 'url' = '[email nascosta]')
  and exists (select 1 from jsonb_array_elements(s -> 'overrides') as o
    where o ->> 'id' = 'gover_e19' and o -> 'fields' ->> 'website' = '[email nascosta]')
  and exists (select 1 from jsonb_array_elements(s -> 'overrides') as o
    where o ->> 'id' = 'gover_e20' and o -> 'fields' ->> 'site' = 'Sede di Asti (AT), aula 3')
  and (s -> 'overrides')::text !~ 'thread\.v2|group\.calendar')
from (select public.studyos_agent_group_snapshot(repeat('a', 64)) as s) as t;
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', :'bea', true) \g /dev/null
-- NEW-4: senza «@» il snapshot dà il testo e le chiavi come sono salvati (nessuna piega NFKC).
select pg_temp.expect('NF1 appello con ordinale e ellissi', public.save_group_exam_session('gx', 'gexam_nf1', null, jsonb_build_object(
  'courseName', E'Chimica 1º modulo', 'date', '2027-09-01', 'kind', 'appello', 'notes', E'vedi sito…')) ->> 'status' = 'ok');
reset role;
set local role anon;
select pg_temp.expect('NF2 testo e chiavi salvati, non normalizzati', exists (
  select 1 from jsonb_array_elements(s -> 'sessions') as e
  where e ->> 'id' = 'gexam_nf1' and e ->> 'course_name' = E'Chimica 1º modulo' and e ->> 'notes' = E'vedi sito…'
    and e ->> 'course_key' = 'nome:chimica 1 modulo' and e ->> 'course_norm' = 'chimica 1 modulo'))
from (select public.studyos_agent_group_snapshot(repeat('a', 64)) as s) as t;
reset role;
-- NEW-5: i valori di una correzione che non sono testo (scritti direttamente) non arrivano agli agenti.
update public.studyos_group_catalog_overrides set fields = fields
  || jsonb_build_object('note2', jsonb_build_array('bea.privata@gmail.com'), 'office2', jsonb_build_object('x', 'y@gmail.com'))
  where id = 'gover_t1';
set local role anon;
select pg_temp.expect('NF3 valori non testuali scartati', (s -> 'overrides')::text !~ 'bea.privata|y@gmail|note2|office2')
from (select public.studyos_agent_group_snapshot(repeat('a', 64)) as s) as t;
reset role;
-- R3-5: il nome di un gruppo ha al massimo 120 caratteri (Unicode) quando lo si scrive o lo si cambia. È un
-- trigger, non un CHECK: i nomi vecchi più lunghi restano e il resto del gruppo si modifica ancora.
do $$
begin
  insert into public.studyos_groups (id, name, owner_id, owner_display_name, invite_code)
    values ('gnl1', repeat('n', 121), '11111111-1111-1111-1111-111111111111', 'Olga', 'NL-CODE-1');
  raise exception 'FALLITO: NL1 nome di 121 caratteri accettato';
exception when sqlstate '23514' then
  null;
end $$;
select 'ok NL1 nome di 121 caratteri rifiutato';
insert into public.studyos_groups (id, name, owner_id, owner_display_name, invite_code)
  values ('gnl2', repeat(chr(128512), 120), :'olga', 'Olga', 'NL-CODE-2');
select pg_temp.expect('NL2 120 caratteri accettati (anche 120 emoji: si contano i caratteri, non i byte)', char_length(name) = 120)
from public.studyos_groups where id = 'gnl2';
do $$
begin
  update public.studyos_groups set name = repeat('n', 121) where id = 'gnl2';
  raise exception 'FALLITO: NL3 rinomina a 121 caratteri accettata';
exception when sqlstate '23514' then
  null;
end $$;
select 'ok NL3 rinomina a 121 caratteri rifiutata';
-- Un nome più lungo salvato prima del limite (qui si spegne il trigger per scriverlo).
set local session_replication_role = replica;
update public.studyos_groups set name = repeat('v', 200) where id = 'gnl2';
set local session_replication_role = origin;
set local role authenticated;
select set_config('request.jwt.claim.sub', :'olga', true) \g /dev/null
update public.studyos_groups set description = 'nuova' where id = 'gnl2';
select pg_temp.expect('NL4 il proprietario cambia la descrizione senza toccare il nome lungo', description = 'nuova' and char_length(name) = 200)
from public.studyos_groups where id = 'gnl2';
-- L'app scrive con un upsert che riporta tutto, nome compreso: con lo stesso nome passa.
insert into public.studyos_groups (id, name, description, owner_id, owner_display_name, invite_code)
  values ('gnl2', repeat('v', 200), 'dall''app', :'olga', 'Olga', 'NL-CODE-2')
  on conflict (id) do update set name = excluded.name, description = excluded.description;
select pg_temp.expect('NL5 upsert dell''app con lo stesso nome lungo', description = 'dall''app') from public.studyos_groups where id = 'gnl2';
do $$
begin
  insert into public.studyos_groups (id, name, description, owner_id, owner_display_name, invite_code)
    values ('gnl2', repeat('w', 200), 'altro', '11111111-1111-1111-1111-111111111111', 'Olga', 'NL-CODE-2')
    on conflict (id) do update set name = excluded.name, description = excluded.description;
  raise exception 'FALLITO: NL6 upsert con un altro nome lungo accettato';
exception when sqlstate '23514' then
  null;
end $$;
select 'ok NL6 upsert con un altro nome lungo rifiutato';
update public.studyos_groups set name = 'Nome corto' where id = 'gnl2';
select pg_temp.expect('NL7 rinomina a un nome corto', name = 'Nome corto') from public.studyos_groups where id = 'gnl2';
reset role;
delete from public.studyos_groups where id = 'gnl2';

-- R3-4: un nome vecchio più lungo di 120 si taglia al confine di una parola PRIMA di oscurarlo: mai un pezzo di
-- indirizzo senza «@» (tagliato a metà, «bea.privata@gmail.com» diventerebbe «bea.priv»).
set local session_replication_role = replica;
update public.studyos_groups set name = repeat('x', 110) || ' bea.privata@gmail.com' where id = 'gx';
set local session_replication_role = origin;
set local role anon;
select pg_temp.expect('SN1 nome tagliato al confine di una parola', (select e ->> 'name' from jsonb_array_elements(s -> 'groups') as e
  where e ->> 'id' = 'gx') = repeat('x', 110))
from (select public.studyos_agent_group_snapshot(repeat('a', 64)) as s) as t;
reset role;
set local session_replication_role = replica;
update public.studyos_groups set name = repeat('x', 105) || ' bea.privata(at)gmail.com' where id = 'gx';
set local session_replication_role = origin;
set local role anon;
select pg_temp.expect('SN2 nemmeno «bea.privata(at» resta', (select e ->> 'name' from jsonb_array_elements(s -> 'groups') as e
  where e ->> 'id' = 'gx') = repeat('x', 105))
from (select public.studyos_agent_group_snapshot(repeat('a', 64)) as s) as t;
reset role;

-- NEW-1: un nome di gruppo enorme (300 KB, salvato prima del limite) non fa scadere lo snapshot di nessuno.
set local session_replication_role = replica;
update public.studyos_groups set name = repeat('a@b ', 75000) where id = 'gx';
set local session_replication_role = origin;
set local role anon;
set local statement_timeout = '1s';
select pg_temp.expect('LIN1 nome di gruppo da 300 KB: snapshot sotto il secondo',
  length(s -> 'groups' -> 0 ->> 'name') <= 600 and (s -> 'groups' -> 0 ->> 'name') !~ '@')
from (select public.studyos_agent_group_snapshot(repeat('a', 64)) as s) as t;
reset role;
set local statement_timeout = '8s';
select pg_temp.expect('LIN2 il redattore da solo: 400 KB di «a@b » e 50 KB di una corsa sola',
  public.studyos_hide_emails(repeat('a@b ', 100000)) = '[email nascosta]'
  and public.studyos_hide_emails('@' || repeat('x', 50000)) = '[email nascosta]');
select pg_temp.expect('LIN3 400 KB con 10 chiocciole: si analizza ed è lineare',
  public.studyos_hide_emails(repeat('ciao mondo ', 36000) || 'prof@unimi.it, x.y@gmail.com ' || repeat('a@b ', 8) || 'fine', true)
    = repeat('ciao mondo ', 36000) || 'prof@unimi.it, [email nascosta] ' || repeat('[email nascosta] ', 8) || 'fine');
set local statement_timeout = 0;
set local session_replication_role = replica;
update public.studyos_groups set name = 'Farmaco' where id = 'gx';
set local session_replication_role = origin;

-- R3-1: 2000 appelli scritti da un membro, ogni testo al limite della sua colonna e pieno di «@»: lo snapshot
-- (come anon, come il Worker) resta sotto il secondo. Tre forme: «@ @ …» (troppe chiocciole: tutto nascosto),
-- «a@b a@b …», e la più cara, 10 chiocciole per valore (il massimo che si analizza) con corse vicine da nascondere.
create function pg_temp.load_sessions(p_course text, p_label text, p_room text, p_notes text, p_name text) returns integer
language sql as $$
  delete from public.studyos_group_exam_sessions where id like 'gexam_load_%';
  insert into public.studyos_group_exam_sessions (id, group_id, course_key, course_name, course_norm, exam_date, kind, label, room, notes,
      created_by, created_by_name, updated_by, updated_by_name)
    select 'gexam_load_' || g, 'gx', 'nome:load' || g, p_course, 'load' || g, date '2028-01-01' + (g % 300), 'appello',
      p_label, p_room, p_notes, 'u-load', p_name, 'u-load', p_name
    from generate_series(1, 2000) as g;
  select count(*)::integer from public.studyos_group_exam_sessions where id like 'gexam_load_%';
$$;
select pg_temp.expect('LOAD0 le tre forme rispettano i limiti delle colonne', bool_and(char_length(c) between 150 and 160
  and char_length(l) between 75 and 80 and char_length(r) between 115 and 120 and char_length(n) between 975 and 1000))
from (values
  (rtrim(repeat('a@ ', 53)) || 'z', rtrim(repeat('@ ', 40)), rtrim(repeat('@ ', 60)), rtrim(repeat('@ ', 500))),
  (left(repeat('a@b ', 40), 159) || 'z', left(repeat('a@b ', 20), 80), left(repeat('a@b ', 30), 120), left(repeat('a@b ', 250), 1000)),
  (left(repeat('c@d ', 10) || repeat('e', 160), 160), left(repeat('q@ ', 10) || repeat('z', 80), 80),
   left(repeat('@r ', 10) || repeat('s', 120), 120), repeat(' @ ' || repeat('y', 95), 10))) as v (c, l, r, n);
select pg_temp.expect('LOAD1a 2000 appelli «@ @ …»', pg_temp.load_sessions(rtrim(repeat('a@ ', 53)) || 'z', rtrim(repeat('@ ', 40)),
  rtrim(repeat('@ ', 60)), rtrim(repeat('@ ', 500)), rtrim(repeat('@ ', 40))) = 2000);
set local role anon;
set local statement_timeout = '1s';
select pg_temp.expect('LOAD1 snapshot sotto il secondo, nessuna chiocciola', jsonb_array_length(s -> 'sessions') = 2000
  and (s -> 'sessions')::text !~ '@')
from (select public.studyos_agent_group_snapshot(repeat('a', 64)) as s) as t;
reset role;
set local statement_timeout = 0;
select pg_temp.expect('LOAD2a 2000 appelli «a@b a@b …»', pg_temp.load_sessions(left(repeat('a@b ', 40), 159) || 'z',
  left(repeat('a@b ', 20), 80), left(repeat('a@b ', 30), 120), left(repeat('a@b ', 250), 1000), left(repeat('a@b ', 20), 80)) = 2000);
set local role anon;
set local statement_timeout = '1s';
select pg_temp.expect('LOAD2 snapshot sotto il secondo, nessuna chiocciola', jsonb_array_length(s -> 'sessions') = 2000
  and (s -> 'sessions')::text !~ '@')
from (select public.studyos_agent_group_snapshot(repeat('a', 64)) as s) as t;
reset role;
set local statement_timeout = 0;
select pg_temp.expect('LOAD3a 2000 appelli con 10 chiocciole per testo', pg_temp.load_sessions(left(repeat('c@d ', 10) || repeat('e', 160), 160),
  left(repeat('q@ ', 10) || repeat('z', 80), 80), left(repeat('@r ', 10) || repeat('s', 120), 120),
  repeat(' @ ' || repeat('y', 95), 10), left(repeat('q@ ', 10) || repeat('z', 80), 80)) = 2000);
set local role anon;
set local statement_timeout = '1s';
select pg_temp.expect('LOAD3 snapshot sotto il secondo, nessuna chiocciola, i vicini nascosti', jsonb_array_length(s -> 'sessions') = 2000
  and (s -> 'sessions')::text !~ '@' and (s -> 'sessions')::text !~ 'yyy'
  and (select e ->> 'notes' from jsonb_array_elements(s -> 'sessions') as e where e ->> 'id' = 'gexam_load_1')
    = repeat(' [email nascosta] [email nascosta]', 10))
from (select public.studyos_agent_group_snapshot(repeat('a', 64)) as s) as t;
reset role;
set local statement_timeout = 0;
delete from public.studyos_group_exam_sessions where id like 'gexam_load_%';

-- ---------------------------------------------------------------------------------------------
-- Giro di correzioni 5 (revisione R-I1): copie per gli agenti scritte alla scrittura (trigger), lo snapshot le
-- legge e non oscura nulla. Il tempo dello snapshot dipende dal numero di righe e dalla lunghezza delle copie.
-- ---------------------------------------------------------------------------------------------
select pg_temp.expect('AC0 versione della regola', public.studyos_email_rule_version() = 5);
select pg_temp.expect('AC1 ogni appello ha le copie della versione attuale, uguali alla regola sul testo salvato',
  bool_and(agent_rule = public.studyos_email_rule_version()
    and agent_course_name = public.studyos_hide_emails(left(course_name, 200))
    and agent_label = public.studyos_hide_emails(left(label, 200))
    and agent_room = public.studyos_hide_emails(left(room, 200))
    and agent_notes = public.studyos_hide_emails(left(notes, 2000))
    and agent_created_by_name = public.studyos_hide_emails(left(created_by_name, 200))
    and agent_updated_by_name = public.studyos_hide_emails(left(updated_by_name, 200))
    and agent_deleted_by_name is not distinct from public.studyos_hide_emails(left(deleted_by_name, 200))
    and agent_course_norm is not null and agent_course_key is not null) and count(*) > 5)
from public.studyos_group_exam_sessions;
select pg_temp.expect('AC1b ogni correzione ha le copie della versione attuale', bool_and(agent_rule = public.studyos_email_rule_version()
    and agent_target_label = public.studyos_hide_emails(left(target_label, 200)) and jsonb_typeof(agent_fields) = 'object'
    and agent_updated_by_name = public.studyos_hide_emails(left(updated_by_name, 200))) and count(*) > 5)
from public.studyos_group_catalog_overrides;

-- AC2: una scrittura con la funzione scrive le copie; la risposta e la cronologia non le portano.
set local role authenticated;
select set_config('request.jwt.claim.sub', :'olga', true) \g /dev/null
select pg_temp.expect('AC2 creazione: la risposta non porta le copie', r ->> 'status' = 'ok' and (r -> 'row')::text !~ '"agent_')
from (select public.save_group_exam_session('gx', 'gexam_ac1', null, jsonb_build_object(
  'courseName', 'Chimica prof@unimi.it', 'date', '2027-10-01', 'kind', 'appello', 'label', 'Turno prof@unimi.it',
  'room', 'Aula 1', 'notes', 'scrivi a bea.privata@gmail.com')) as r) as t;
reset role;
select pg_temp.expect('AC2b copie scritte dal trigger: corso, chiave e nome normalizzato dal nome oscurato',
  agent_course_name = 'Chimica [email nascosta]' and agent_course_norm = 'chimica email nascosta'
  and agent_course_key = 'nome:chimica email nascosta' and agent_label = 'Turno [email nascosta]' and agent_room = 'Aula 1'
  and agent_notes = 'scrivi a [email nascosta]' and agent_created_by_name = 'Olga' and agent_rule = public.studyos_email_rule_version()
  and course_name = 'Chimica prof@unimi.it' and notes = 'scrivi a bea.privata@gmail.com')
from public.studyos_group_exam_sessions where id = 'gexam_ac1';
select pg_temp.expect('AC2c la cronologia non conserva le copie', count(*) >= 1 and bool_and(coalesce(before::text, '') !~ '"agent_'
  and coalesce(after::text, '') !~ '"agent_'))
from public.studyos_group_history where record_kind = 'exam_session';
-- AC3: una modifica con la funzione aggiorna le copie.
set local role authenticated;
select set_config('request.jwt.claim.sub', :'olga', true) \g /dev/null
select pg_temp.expect('AC3 modifica', r ->> 'status' = 'ok' and (r -> 'row')::text !~ '"agent_')
from (select public.save_group_exam_session('gx', 'gexam_ac1', 1, jsonb_build_object(
  'courseName', 'Chimica prof@unimi.it', 'date', '2027-10-01', 'kind', 'appello', 'label', 'Turno prof@unimi.it',
  'room', 'Aula 1', 'notes', 'niente indirizzi')) as r) as t;
reset role;
select pg_temp.expect('AC3b copia aggiornata', agent_notes = 'niente indirizzi' and version = 2)
from public.studyos_group_exam_sessions where id = 'gexam_ac1';
-- AC4: una scrittura diretta (SQL Editor) passa dal trigger: le copie non si scrivono a mano.
update public.studyos_group_exam_sessions set notes = 'bea.privata@gmail.com', agent_notes = 'bea.privata@gmail.com', agent_rule = 99
  where id = 'gexam_ac1';
select pg_temp.expect('AC4 copia ricalcolata, non quella scritta', agent_notes = '[email nascosta]' and agent_rule = public.studyos_email_rule_version())
from public.studyos_group_exam_sessions where id = 'gexam_ac1';
-- AC5: eliminazione e ripristino ricalcolano le copie.
set local role authenticated;
select set_config('request.jwt.claim.sub', :'olga', true) \g /dev/null
select pg_temp.expect('AC5 eliminazione', r ->> 'status' = 'ok' and (r -> 'row')::text !~ '"agent_')
from (select public.delete_group_exam_session('gexam_ac1', 2) as r) as t;
reset role;
select pg_temp.expect('AC5b copia del nome di chi elimina', agent_deleted_by_name = 'Olga' and deleted_by_name = 'Olga')
from public.studyos_group_exam_sessions where id = 'gexam_ac1';
set local role authenticated;
select set_config('request.jwt.claim.sub', :'olga', true) \g /dev/null
select pg_temp.expect('AC5c ripristino', r ->> 'status' = 'ok' and (r -> 'row')::text !~ '"agent_')
from (select public.restore_group_record((select id from public.studyos_group_history
  where record_id = 'gexam_ac1' and action = 'delete'), 3) as r) as t;
reset role;
select pg_temp.expect('AC5d copie dopo il ripristino', agent_deleted_by_name is null and deleted_at is null
  and agent_notes = public.studyos_hide_emails(notes) and agent_rule = public.studyos_email_rule_version())
from public.studyos_group_exam_sessions where id = 'gexam_ac1';

-- AC6: correzioni. url e website come agentCorrectionLink: decodificati, nulli (il segnaposto) con un indirizzo
-- non @unimi.it; mailto unimi resta nel campo url; email e value tengono gli @unimi.it; gli altri campi no.
set local role authenticated;
select set_config('request.jwt.claim.sub', :'olga', true) \g /dev/null
select pg_temp.expect('AC6 correzione di un contatto: la risposta non porta le copie', r ->> 'status' = 'ok' and (r -> 'row')::text !~ '"agent_')
from (select public.save_group_catalog_override('gx', 'gover_ac6', null, 'contact', 'contatto:ac6', 'Segreteria prof@unimi.it',
  jsonb_build_object('url', 'mailto:prof@unimi.it', 'value', 'prof@unimi.it', 'label', 'Scrivi a prof@unimi.it')) as r) as t;
reset role;
select pg_temp.expect('AC6b copie della correzione', agent_fields ->> 'url' = 'mailto:prof@unimi.it'
  and agent_fields ->> 'value' = 'prof@unimi.it' and agent_fields ->> 'label' = 'Scrivi a [email nascosta]'
  and agent_target_label = 'Segreteria [email nascosta]' and fields ->> 'label' = 'Scrivi a prof@unimi.it')
from public.studyos_group_catalog_overrides where id = 'gover_ac6';
select pg_temp.expect('AC6c Teams e Google Calendar: il link resta nella riga, la copia è il segnaposto',
  (select fields ->> 'url' = 'https://teams.microsoft.com/l/meetup-join/19%3ameeting_x%40thread.v2/0' and agent_fields ->> 'url' = '[email nascosta]'
   from public.studyos_group_catalog_overrides where id = 'gover_e18')
  and (select fields ->> 'website' like 'https://calendar.google.com/%' and agent_fields ->> 'website' = '[email nascosta]'
   from public.studyos_group_catalog_overrides where id = 'gover_e19')
  and (select agent_fields ->> 'site' = 'Sede di Asti (AT), aula 3' from public.studyos_group_catalog_overrides where id = 'gover_e20'));
-- Scritta direttamente (la funzione la rifiuterebbe): «?to=bea%40gmail.com» non arriva agli agenti.
insert into public.studyos_group_catalog_overrides (id, group_id, target_kind, target_id, target_label, fields, created_by, created_by_name, updated_by, updated_by_name)
  values ('gover_ac6d', 'gx', 'contact', 'contatto:ac6d', 'X', jsonb_build_object('url', 'https://x.it/?to=bea%40gmail.com',
    'note', 'bea@gmail.com', 'email', 'prof@unimi.it', 'n', 3), :'olga', 'Olga', :'olga', 'Olga');
select pg_temp.expect('AC6d scrittura diretta: link nullo, nota oscurata, valori non testuali scartati',
  agent_fields = jsonb_build_object('url', '[email nascosta]', 'note', '[email nascosta]', 'email', 'prof@unimi.it'))
from public.studyos_group_catalog_overrides where id = 'gover_ac6d';
set local role anon;
select pg_temp.expect('AC6e lo snapshot dà le copie', exists (select 1 from jsonb_array_elements(s -> 'overrides') as o
    where o ->> 'id' = 'gover_ac6d' and o -> 'fields' = jsonb_build_object('url', '[email nascosta]', 'note', '[email nascosta]', 'email', 'prof@unimi.it'))
  and exists (select 1 from jsonb_array_elements(s -> 'sessions') as e where e ->> 'id' = 'gexam_ac1'
    and e ->> 'course_name' = 'Chimica [email nascosta]' and e ->> 'course_key' = 'nome:chimica email nascosta'
    and e ->> 'course_norm' = 'chimica email nascosta' and e ->> 'notes' = '[email nascosta]')
  and s::text !~ '"agent_')
from (select public.studyos_agent_group_snapshot(repeat('a', 64)) as s) as t;
reset role;

-- AC7: aggiornamento (backfill) alla versione della regola. Righe scritte prima (senza copie) o con una versione
-- vecchia: si ricalcolano una volta, senza cambiare updated_at né version; rieseguito non tocca nulla.
set local session_replication_role = replica;
update public.studyos_group_exam_sessions set agent_rule = 4, agent_notes = 'vecchia copia bea.privata@gmail.com' where id = 'gexam_ac1';
update public.studyos_group_exam_sessions set agent_rule = null, agent_course_name = null, agent_course_norm = null, agent_course_key = null,
  agent_label = null, agent_room = null, agent_notes = null, agent_created_by_name = null, agent_updated_by_name = null,
  agent_deleted_by_name = null where id = 'gexam_nf1';
update public.studyos_group_catalog_overrides set agent_rule = null, agent_fields = null, agent_target_label = null where id = 'gover_e18';
set local session_replication_role = origin;
set local role anon;
select pg_temp.expect('AC7 prima dell''aggiornamento: lo snapshot dà il segnaposto, mai il testo', exists (
    select 1 from jsonb_array_elements(s -> 'sessions') as e where e ->> 'id' = 'gexam_nf1' and e ->> 'notes' = '[email nascosta]'
      and e ->> 'course_name' = '[email nascosta]' and e ->> 'course_key' = 'nome:email nascosta')
  and exists (select 1 from jsonb_array_elements(s -> 'overrides') as o where o ->> 'id' = 'gover_e18' and o -> 'fields' = '{}'::jsonb
      and o ->> 'target_label' = '[email nascosta]'))
from (select public.studyos_agent_group_snapshot(repeat('a', 64)) as s) as t;
reset role;
create temp table ac7_before as
  select id, updated_at, version from public.studyos_group_exam_sessions
  union all select id, updated_at, version from public.studyos_group_catalog_overrides;
select pg_temp.expect('AC7b aggiornamento: solo le tre righe vecchie', public.studyos_agent_copies_refresh() = 3);
select pg_temp.expect('AC7c copie ricalcolate', (select agent_notes = public.studyos_hide_emails(notes) and agent_rule = public.studyos_email_rule_version()
    and agent_course_name = public.studyos_hide_emails(course_name) from public.studyos_group_exam_sessions where id = 'gexam_ac1')
  and (select agent_course_name = course_name and agent_course_key = course_key and agent_notes = notes and agent_rule = public.studyos_email_rule_version()
    from public.studyos_group_exam_sessions where id = 'gexam_nf1')
  and (select agent_fields ->> 'url' = '[email nascosta]' and agent_rule = public.studyos_email_rule_version()
    from public.studyos_group_catalog_overrides where id = 'gover_e18'));
select pg_temp.expect('AC7d updated_at e version invariati', not exists (
  select 1 from ac7_before as b join (select id, updated_at, version from public.studyos_group_exam_sessions
    union all select id, updated_at, version from public.studyos_group_catalog_overrides) as x using (id)
  where x.updated_at is distinct from b.updated_at or x.version is distinct from b.version));
select pg_temp.expect('AC7e rieseguito: nessuna riga', public.studyos_agent_copies_refresh() = 0);
select pg_temp.expect('AC7f i trigger del timbro sono di nuovo attivi', (select count(*) from pg_trigger
  where tgname in ('studyos_gexam_stamp', 'studyos_gover_stamp') and tgenabled = 'O') = 2);
drop table ac7_before;

-- AC8: le copie si leggono come il resto della riga (stessa RLS: i membri, che vedono già il testo intero); anon
-- nessun privilegio; nessuno le scrive se non il trigger.
select pg_temp.expect('AC8 privilegi sulle colonne delle copie',
  has_column_privilege('authenticated', 'public.studyos_group_exam_sessions', 'agent_notes', 'SELECT')
  and not has_column_privilege('anon', 'public.studyos_group_exam_sessions', 'agent_notes', 'SELECT')
  and not has_column_privilege('anon', 'public.studyos_group_catalog_overrides', 'agent_fields', 'SELECT')
  and not has_column_privilege('authenticated', 'public.studyos_group_exam_sessions', 'agent_notes', 'UPDATE')
  and not has_column_privilege('authenticated', 'public.studyos_group_catalog_overrides', 'agent_fields', 'INSERT')
  and not has_function_privilege('authenticated', 'public.studyos_agent_copies_refresh()', 'EXECUTE')
  and not has_function_privilege('anon', 'public.studyos_agent_link(text)', 'EXECUTE'));
set local role authenticated;
select set_config('request.jwt.claim.sub', :'mallory', true) \g /dev/null
select pg_temp.expect('AC8b chi non è nel gruppo non legge le copie', (select count(*) from public.studyos_group_exam_sessions where id = 'gexam_ac1') = 0
  and (select count(*) from public.studyos_group_catalog_overrides where id = 'gover_ac6') = 0);
select set_config('request.jwt.claim.sub', :'bea', true) \g /dev/null
select pg_temp.expect('AC8c un membro legge la copia (meno di quanto legge già)', agent_notes = '[email nascosta]' and notes = 'bea.privata@gmail.com')
from public.studyos_group_exam_sessions where id = 'gexam_ac1';
reset role;

-- AC9: se il calcolo delle copie fallisse, la scrittura passa con copie vuote: lo snapshot dà il segnaposto.
savepoint ac9;
create or replace function public.studyos_email_rule_version() returns integer language plpgsql immutable
  set search_path = pg_catalog as $$ begin raise exception 'rotto per la prova'; end $$;
update public.studyos_group_exam_sessions set notes = 'scrivi a bea.privata@gmail.com' where id = 'gexam_ac1';
update public.studyos_group_catalog_overrides set target_label = 'Y' where id = 'gover_ac6';
select pg_temp.expect('AC9 copie vuote, scrittura riuscita', (select notes = 'scrivi a bea.privata@gmail.com' and agent_notes is null
    and agent_course_name is null and agent_rule is null from public.studyos_group_exam_sessions where id = 'gexam_ac1')
  and (select target_label = 'Y' and agent_fields is null and agent_rule is null from public.studyos_group_catalog_overrides where id = 'gover_ac6'));
set local role anon;
select pg_temp.expect('AC9b snapshot: segnaposto, nessun testo', exists (select 1 from jsonb_array_elements(s -> 'sessions') as e
    where e ->> 'id' = 'gexam_ac1' and e ->> 'notes' = '[email nascosta]' and e ->> 'course_name' = '[email nascosta]')
  and (s -> 'sessions')::text !~ 'bea.privata')
from (select public.studyos_agent_group_snapshot(repeat('a', 64)) as s) as t;
reset role;
rollback to savepoint ac9;
select pg_temp.expect('AC9c dopo la prova la regola è di nuovo quella', public.studyos_email_rule_version() = 5);

-- R5-1: le forme più care della revisione 4 (N2, N3, N5 con U+FDFA, N6), 2000 appelli al limite delle colonne: lo
-- snapshot (anon, come il Worker) resta sotto il secondo in tutte, perché legge copie già fatte.
create function pg_temp.shape(p_name text, p_part text) returns text language sql immutable as $$
  select btrim(case p_name
    when 'N2' then case p_part
      when 'course' then left('x' || repeat(' @ ' || rtrim(repeat('w ', 7)), 10), 160)
      when 'label' then left('x' || repeat(' @ ' || repeat('w ', 3), 10), 80)
      when 'room' then left('x' || repeat(' @ ' || repeat('w ', 5), 10), 120)
      when 'notes' then left('x' || repeat(' @ ' || repeat('w ', 48), 10), 1000)
      else left('x' || repeat(' @ ' || repeat('w ', 3), 10), 80) end
    when 'N3' then case p_part
      when 'course' then left('y' || repeat(E' @ ' || rtrim(repeat(E'ｗ​ ', 5)), 10), 160)
      when 'label' then left('x' || repeat(E'\t@\t' || repeat(E'ｗ​\t', 2), 10), 80)
      when 'room' then left('x' || repeat(E'\t@\t' || repeat(E'ｗ​\t', 3), 10), 120)
      when 'notes' then left('x' || repeat(E'\t@\t' || repeat(E'ｗ​\t', 32), 10), 1000)
      else left('x' || repeat(E'\t@\t' || repeat(E'ｗ​\t', 2), 10), 80) end
    when 'N5' then case p_part
      when 'course' then 'x@ ' || repeat(E'ﷺ', 157)
      when 'label' then 'x@ ' || repeat(E'ﷺ', 77)
      when 'room' then 'x@ ' || repeat(E'ﷺ', 117)
      when 'notes' then 'x@ ' || repeat(E'ﷺ', 997)
      else 'x@ ' || repeat(E'ﷺ', 77) end
    else case p_part
      when 'course' then left('y' || repeat(E' @ ' || repeat(E'ﷺ', 13), 10), 160)
      when 'label' then left('y' || repeat(E' @ ' || repeat(E'ﷺ', 5), 10), 80)
      when 'room' then left('y' || repeat(E' @ ' || repeat(E'ﷺ', 9), 10), 120)
      when 'notes' then left('y' || repeat(E' @ ' || repeat(E'ﷺ', 97), 10), 1000)
      else left('y' || repeat(E' @ ' || repeat(E'ﷺ', 5), 10), 80) end
  end)
$$;
select pg_temp.expect('LOAD4a le forme N2, N3, N5, N6 sono al limite delle colonne', bool_and(
  char_length(pg_temp.shape(n, 'course')) between 155 and 160 and char_length(pg_temp.shape(n, 'label')) between 75 and 80
  and char_length(pg_temp.shape(n, 'room')) between 115 and 120 and char_length(pg_temp.shape(n, 'notes')) between 985 and 1000
  and char_length(pg_temp.shape(n, 'member')) between 75 and 80))
from unnest(array['N2', 'N3', 'N5', 'N6']) as n;
select pg_temp.expect('LOAD4b N2: 2000 appelli', pg_temp.load_sessions(pg_temp.shape('N2', 'course'), pg_temp.shape('N2', 'label'),
  pg_temp.shape('N2', 'room'), pg_temp.shape('N2', 'notes'), pg_temp.shape('N2', 'member')) = 2000);
set local role anon;
set local statement_timeout = '1s';
select pg_temp.expect('LOAD4 N2: snapshot sotto il secondo, nessuna chiocciola', jsonb_array_length(s -> 'sessions') = 2000
  and (s -> 'sessions')::text !~ '@')
from (select public.studyos_agent_group_snapshot(repeat('a', 64)) as s) as t;
reset role;
set local statement_timeout = 0;
select pg_temp.expect('LOAD5b N3: 2000 appelli', pg_temp.load_sessions(pg_temp.shape('N3', 'course'), pg_temp.shape('N3', 'label'),
  pg_temp.shape('N3', 'room'), pg_temp.shape('N3', 'notes'), pg_temp.shape('N3', 'member')) = 2000);
set local role anon;
set local statement_timeout = '1s';
select pg_temp.expect('LOAD5 N3: snapshot sotto il secondo, nessuna chiocciola né lettera larga', jsonb_array_length(s -> 'sessions') = 2000
  and (s -> 'sessions')::text !~ E'[@ｗ]')
from (select public.studyos_agent_group_snapshot(repeat('a', 64)) as s) as t;
reset role;
set local statement_timeout = 0;
select pg_temp.expect('LOAD6b N5 (U+FDFA): 2000 appelli', pg_temp.load_sessions(pg_temp.shape('N5', 'course'), pg_temp.shape('N5', 'label'),
  pg_temp.shape('N5', 'room'), pg_temp.shape('N5', 'notes'), pg_temp.shape('N5', 'member')) = 2000);
set local role anon;
set local statement_timeout = '1s';
select pg_temp.expect('LOAD6 N5: snapshot sotto il secondo, ogni testo è il segnaposto (cresce di oltre 32)', jsonb_array_length(s -> 'sessions') = 2000
  and (s -> 'sessions')::text !~ E'[@ﷺ]'
  and (select bool_and(e ->> 'notes' = '[email nascosta]' and e ->> 'course_name' = '[email nascosta]' and e ->> 'updated_by_name' = '[email nascosta]')
       from jsonb_array_elements(s -> 'sessions') as e where e ->> 'id' like 'gexam_load_%'))
from (select public.studyos_agent_group_snapshot(repeat('a', 64)) as s) as t;
reset role;
set local statement_timeout = 0;
select pg_temp.expect('LOAD7b N6: 2000 appelli', pg_temp.load_sessions(pg_temp.shape('N6', 'course'), pg_temp.shape('N6', 'label'),
  pg_temp.shape('N6', 'room'), pg_temp.shape('N6', 'notes'), pg_temp.shape('N6', 'member')) = 2000);
set local role anon;
set local statement_timeout = '1s';
select pg_temp.expect('LOAD7 N6: snapshot sotto il secondo, nessuna chiocciola né U+FDFA', jsonb_array_length(s -> 'sessions') = 2000
  and (s -> 'sessions')::text !~ E'[@ﷺ]')
from (select public.studyos_agent_group_snapshot(repeat('a', 64)) as s) as t;
reset role;
set local statement_timeout = 0;
delete from public.studyos_group_exam_sessions where id like 'gexam_load_%';

-- W1: una scrittura con la funzione, ogni testo al limite nella forma più cara (e il nome del membro copiato), resta
-- sotto i 50 ms: il trigger delle copie costa poco a ogni scrittura (si misura dentro una funzione).
select set_config('request.jwt.claim.sub', '', true) \g /dev/null
update public.studyos_group_members set display_name = pg_temp.shape('N3', 'member') where group_id = 'gx' and user_id = :'olga';
create function pg_temp.timed_write(p_id text, p_shape text, p_version integer, p_date text) returns interval language plpgsql as $$
declare
  v_start timestamptz := clock_timestamp();
  v_result jsonb;
begin
  v_result := public.save_group_exam_session('gx', p_id, p_version, jsonb_build_object(
    'courseName', pg_temp.shape(p_shape, 'course'), 'date', p_date, 'kind', 'appello', 'label', pg_temp.shape(p_shape, 'label'),
    'room', pg_temp.shape(p_shape, 'room'), 'notes', pg_temp.shape(p_shape, 'notes')));
  if v_result ->> 'status' is distinct from 'ok' then
    raise exception 'FALLITO: W1 scrittura %', v_result;
  end if;
  return clock_timestamp() - v_start;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub', :'olga', true) \g /dev/null
select pg_temp.expect('W1 scrittura N3 al limite sotto 50 ms', pg_temp.timed_write('gexam_w1', 'N3', null, '2027-11-01') < interval '50 ms');
select pg_temp.expect('W1b modifica N2 al limite sotto 50 ms', pg_temp.timed_write('gexam_w1', 'N2', 1, '2027-11-01') < interval '50 ms');
select pg_temp.expect('W1c scrittura N5 al limite sotto 50 ms', pg_temp.timed_write('gexam_w2', 'N5', null, '2027-11-02') < interval '50 ms');
select pg_temp.expect('W1d scrittura N6 al limite sotto 50 ms', pg_temp.timed_write('gexam_w3', 'N6', null, '2027-11-03') < interval '50 ms');
reset role;
select pg_temp.expect('W1e copie della scrittura al limite', agent_rule = public.studyos_email_rule_version()
  and agent_notes = public.studyos_hide_emails(notes) and agent_updated_by_name = public.studyos_hide_emails(updated_by_name)
  and updated_by_name = pg_temp.shape('N3', 'member'))
from public.studyos_group_exam_sessions where id = 'gexam_w1';
select set_config('request.jwt.claim.sub', '', true) \g /dev/null
update public.studyos_group_members set display_name = 'Olga' where group_id = 'gx' and user_id = :'olga';
delete from public.studyos_group_exam_sessions where id in ('gexam_w1', 'gexam_w2', 'gexam_w3');

-- L4: ogni funzione nuova ha i privilegi giusti.
select pg_temp.expect('G5 scrittura chiusa ad anon e aperta ad authenticated', bool_and(
    not has_function_privilege('anon', f, 'EXECUTE') and has_function_privilege('authenticated', f, 'EXECUTE')))
from unnest(array['public.save_group_exam_session(text,text,integer,jsonb)', 'public.delete_group_exam_session(text,integer)',
  'public.save_group_catalog_override(text,text,integer,text,text,text,jsonb)', 'public.delete_group_catalog_override(text,integer)',
  'public.restore_group_record(bigint,integer)']) as f;
select pg_temp.expect('G6 redattore, controlli di scrittura, pulizia delle correzioni e limite del nome: chiusi a tutti',
  bool_and(f is not null and not has_function_privilege('anon', f, 'EXECUTE') and not has_function_privilege('authenticated', f, 'EXECUTE')
    and not has_function_privilege('public', f, 'EXECUTE')) and count(*) = 14)
from unnest(array[to_regprocedure('public.studyos_hide_emails(text,boolean,boolean,boolean)'),
  to_regprocedure('public.studyos_only_unimi_emails(text,boolean)'), to_regprocedure('public.studyos_email_normalize(text,boolean)'),
  to_regprocedure('public.studyos_fields_only_unimi(jsonb)'), to_regprocedure('public.studyos_catalog_override_clean(text,jsonb)'),
  to_regprocedure('public.studyos_groups_name_limit()'), to_regprocedure('public.studyos_cut_at_run(text,integer)'),
  to_regprocedure('public.studyos_email_rule_version()'), to_regprocedure('public.studyos_url_decode(text)'),
  to_regprocedure('public.studyos_agent_link(text)'), to_regprocedure('public.studyos_without_agent_copies(jsonb)'),
  to_regprocedure('public.studyos_gexam_agent_copy()'), to_regprocedure('public.studyos_gover_agent_copy()'),
  to_regprocedure('public.studyos_agent_copies_refresh()')]) as f;
select pg_temp.expect('G7 le firme vecchie non ci sono più', to_regprocedure('public.studyos_hide_emails_normalized(text,boolean)') is null
  and to_regprocedure('public.studyos_hide_emails(text,boolean)') is null and to_regprocedure('public.studyos_hide_emails(text)') is null
  and to_regprocedure('public.studyos_only_unimi_emails(text)') is null and to_regprocedure('public.studyos_email_normalize(text)') is null);

-- X1: il proprietario non può cambiare l'account di una riga di membro né iscrivere un altro account.
set local role authenticated;
select set_config('request.jwt.claim.sub', :'olga', true) \g /dev/null
update public.studyos_group_members set user_id = :'mallory', display_name = 'mallory@gmail.com'
  where group_id = 'gx' and user_id = :'ada';
select pg_temp.expect('X1 account e nome della riga restano', exists (select 1 from public.studyos_group_members
    where group_id = 'gx' and user_id = :'ada' and display_name = 'Ada')
  and not exists (select 1 from public.studyos_group_members where group_id = 'gx' and user_id = :'mallory'));
update public.studyos_group_members set group_id = 'gz' where group_id = 'gx' and user_id = :'bea';
select pg_temp.expect('X1 il gruppo della riga resta', exists (select 1 from public.studyos_group_members where group_id = 'gx' and user_id = :'bea'));
do $$
begin
  insert into public.studyos_group_members (group_id, user_id, display_name, role)
    values ('gx', 'fc0191e0-6663-4a43-b060-131e397f02cc', 'Forzata', 'member');
  raise exception 'FALLITO: X1 iscrizione forzata accettata';
exception when insufficient_privilege then
  null;
end $$;
select 'ok X1 iscrizione forzata rifiutata';
update public.studyos_group_members set role = 'admin' where group_id = 'gx' and user_id = :'ada';
select pg_temp.expect('X1 il proprietario promuove ancora', exists (select 1 from public.studyos_group_members where group_id = 'gx' and user_id = :'ada' and role = 'admin'));
select set_config('request.jwt.claim.sub', :'mallory', true) \g /dev/null
select pg_temp.expect('X1 ingresso con il codice', public.join_group_by_code('GX-CODE-1', 'Mal') = 'gx');
select pg_temp.expect('X1 chi è entrato è membro', exists (select 1 from public.studyos_group_members
  where group_id = 'gx' and user_id = :'mallory' and display_name = 'Mal'));
reset role;

-- L6: il tetto di 60 modifiche l'ora vale per TUTTE le funzioni di scrittura (Ada ne ha già 60 nel gruppo).
set local role authenticated;
select set_config('request.jwt.claim.sub', :'ada', true) \g /dev/null
select pg_temp.expect('CAP1 modifica', r ->> 'status' = 'invalid' and r ->> 'field' = 'rate')
from (select public.save_group_exam_session('gx', 'gexam_x2', 1, jsonb_build_object(
  'courseName', 'Genetica Umana', 'date', '2027-07-01', 'kind', 'appello', 'room', 'Aula 1')) as r) as t;
select pg_temp.expect('CAP2 eliminazione', r ->> 'status' = 'invalid' and r ->> 'field' = 'rate')
from (select public.delete_group_exam_session('gexam_x2', 1) as r) as t;
select pg_temp.expect('CAP3 correzione', r ->> 'status' = 'invalid' and r ->> 'field' = 'rate')
from (select public.save_group_catalog_override('gx', 'gover_cap', null, 'teacher', 'unimi-cap', 'X',
  jsonb_build_object('office', 'Studio 1')) as r) as t;
select pg_temp.expect('CAP4 eliminazione correzione', r ->> 'status' = 'invalid' and r ->> 'field' = 'rate')
from (select public.delete_group_catalog_override('gover_t1', 1) as r) as t;
select pg_temp.expect('CAP5 ripristino', r ->> 'status' = 'invalid' and r ->> 'field' = 'rate')
from (select public.restore_group_record((select id from public.studyos_group_history
  where record_id = 'gexam_n1' and action = 'update'), 1) as r) as t;

-- L6: chi viene tolto dal gruppo perde subito ogni accesso (lettura e scritture).
select pg_temp.expect('RM0 prima: Ada legge', (select count(*) from public.studyos_group_exam_sessions where group_id = 'gx') > 0);
reset role;
-- Una voce di cronologia VERA del gruppo, letta prima che Ada esca (per il ripristino del test RM3).
select max(id) as hid from public.studyos_group_history where group_id = 'gx' and before is not null \gset
select pg_temp.expect('RM0b voce di cronologia trovata', :hid > 0);
delete from public.studyos_group_members where group_id = 'gx' and user_id = :'ada';
set local role authenticated;
select set_config('request.jwt.claim.sub', :'ada', true) \g /dev/null
select pg_temp.expect('RM1 non legge appelli, correzioni, cronologia', (select count(*) from public.studyos_group_exam_sessions) = 0
  and (select count(*) from public.studyos_group_catalog_overrides where group_id = 'gx') = 0
  and (select count(*) from public.studyos_group_history where group_id = 'gx') = 0);
select pg_temp.expect('RM2 non scrive', public.save_group_exam_session('gx', 'gexam_rm', null, jsonb_build_object(
  'courseName', 'Fisica', 'date', '2027-08-01', 'kind', 'appello')) ->> 'status' = 'denied'
  and public.save_group_catalog_override('gx', 'gover_rm', null, 'teacher', 'unimi-rm', 'X',
  jsonb_build_object('office', 'S')) ->> 'status' = 'denied');
select pg_temp.expect('RM3 non elimina né ripristina', public.delete_group_exam_session('gexam_x2', 1) ->> 'status' = 'not_found'
  and public.delete_group_catalog_override('gover_t1', 1) ->> 'status' = 'not_found'
  and public.restore_group_record(:hid, 1) ->> 'status' = 'not_found');
reset role;
select pg_temp.expect('RM3b la voce di cronologia esiste ancora: il rifiuto non era per un id nullo',
  exists (select 1 from public.studyos_group_history where id = :hid));
reset role;

-- G1-G4: privilegi.
select pg_temp.expect('G1 anon non scrive appelli', not has_function_privilege('anon', 'public.save_group_exam_session(text,text,integer,jsonb)', 'EXECUTE'));
select pg_temp.expect('G2 authenticated scrive con la funzione', has_function_privilege('authenticated', 'public.save_group_exam_session(text,text,integer,jsonb)', 'EXECUTE'));
select pg_temp.expect('G3 funzioni interne chiuse', not has_function_privilege('authenticated', 'public.studyos_group_write_gate(text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.studyos_group_history_write(text,text,text,text,integer,jsonb,jsonb,text[],text)', 'EXECUTE'));
select pg_temp.expect('G4 nessun insert diretto', not has_table_privilege('authenticated', 'public.studyos_group_exam_sessions', 'INSERT')
  and not has_table_privilege('authenticated', 'public.studyos_group_history', 'INSERT')
  and not has_table_privilege('anon', 'public.studyos_group_catalog_overrides', 'SELECT'));

-- C1: eliminare il gruppo porta via appelli, correzioni e cronologia.
delete from public.studyos_groups where id = 'gx';
select pg_temp.expect('C1 cascade', not exists (select 1 from public.studyos_group_exam_sessions where group_id = 'gx')
  and not exists (select 1 from public.studyos_group_catalog_overrides where group_id = 'gx')
  and not exists (select 1 from public.studyos_group_history where group_id = 'gx'));

rollback;
\echo 'group-exams-tests: tutto ok'
