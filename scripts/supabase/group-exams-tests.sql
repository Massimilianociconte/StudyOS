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
-- NEW-1: un nome di gruppo enorme (300 KB, scritto dal proprietario) non fa scadere lo snapshot di nessuno.
update public.studyos_groups set name = repeat('a@b ', 75000) where id = 'gx';
set local role anon;
set local statement_timeout = '1s';
select pg_temp.expect('LIN1 nome di gruppo da 300 KB: snapshot sotto il secondo',
  length(s -> 'groups' -> 0 ->> 'name') <= 600 and (s -> 'groups' -> 0 ->> 'name') !~ '@')
from (select public.studyos_agent_group_snapshot(repeat('a', 64)) as s) as t;
reset role;
set local statement_timeout = '8s';
select pg_temp.expect('LIN2 il redattore da solo: 400 KB di «a@b » e 50 KB di una corsa sola',
  length(public.studyos_hide_emails(repeat('a@b ', 100000))) > 0
  and public.studyos_hide_emails('@' || repeat('x', 50000)) = '[email nascosta]');
set local statement_timeout = 0;
update public.studyos_groups set name = 'Farmaco' where id = 'gx';

-- L4: ogni funzione nuova ha i privilegi giusti.
select pg_temp.expect('G5 scrittura chiusa ad anon e aperta ad authenticated', bool_and(
    not has_function_privilege('anon', f, 'EXECUTE') and has_function_privilege('authenticated', f, 'EXECUTE')))
from unnest(array['public.save_group_exam_session(text,text,integer,jsonb)', 'public.delete_group_exam_session(text,integer)',
  'public.save_group_catalog_override(text,text,integer,text,text,text,jsonb)', 'public.delete_group_catalog_override(text,integer)',
  'public.restore_group_record(bigint,integer)']) as f;
select pg_temp.expect('G7 il controllo di scrittura è chiuso ad anon e authenticated', not has_function_privilege('authenticated', 'public.studyos_only_unimi_emails(text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.studyos_only_unimi_emails(text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.studyos_hide_emails_normalized(text,boolean)', 'EXECUTE'));
select pg_temp.expect('G6 il redattore è chiuso ad authenticated', not has_function_privilege('authenticated', 'public.studyos_hide_emails(text,boolean)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.studyos_hide_emails(text,boolean)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.studyos_email_normalize(text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.studyos_fields_only_unimi(jsonb)', 'EXECUTE'));

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
