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
