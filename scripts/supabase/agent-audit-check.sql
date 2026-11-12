-- Prova del registro del connettore remoto (agent.sql, 1.8.0) su un Postgres usa e getta.
-- Mai sul progetto reale: richiede lo stub di auth (ruoli anon/authenticated, auth.uid() dalla
-- variabile request.jwt.claim.sub, utenti 1111… e 2222… in auth.users) e schema.sql + agent.sql
-- già applicati. Ogni riga stampa «nome|t»: una riga «…|f» è un controllo fallito.
--   psql "$URL" -v ON_ERROR_STOP=1 -f scripts/supabase/agent-audit-check.sql
\set ON_ERROR_STOP 1
\pset tuples_only on
\pset format unaligned

-- L'hub chiama con la sola chiave publishable: nessun utente (auth.uid() null). I blocchi come
-- authenticated tolgono l'utente quando finiscono.
-- Esito di un'istruzione: 'ok' oppure il codice SQLSTATE dell'errore.
create or replace function pg_temp.outcome(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return 'ok';
exception when others then
  return sqlstate;
end;
$$;

-- Alice (proprietaria) crea il permesso con «Consenti» e scrive dall'app due righe con file incorporati.
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false) \g /dev/null
select public.studyos_create_agent_grant('ChatGPT') as secret \gset
select push_studyos_rows('11111111-1111-1111-1111-111111111111', 'browser', jsonb_build_array(
  jsonb_build_object('entity_type', 'task', 'entity_id', 'au_task', 'deleted', false, 'payload',
    jsonb_build_object('id', 'au_task', 'title', 'Ripasso cap. 3', 'updatedAt', '2026-11-01T08:00:00.000Z', 'cover', 'data:image/png;base64,COPERTINA')),
  jsonb_build_object('entity_type', 'attachment', 'entity_id', 'au_file', 'deleted', false, 'payload',
    jsonb_build_object('id', 'au_file', 'name', 'Dispense', 'updatedAt', '2026-11-01T08:00:00.000Z', 'dataUrl', 'data:application/pdf;base64,FILE'))
)) \g /dev/null
reset role;
select set_config('request.jwt.claim.sub', '', false) \g /dev/null

-- L'hub (anon, chiave publishable) scrive col segreto: modifica, creazione, eliminazione.
set role anon;
select bool_and(accepted) from public.studyos_agent_push(:'secret', 'agent-remote', jsonb_build_array(
  jsonb_build_object('entity_type', 'task', 'entity_id', 'au_task', 'deleted', false, 'payload',
    jsonb_build_object('id', 'au_task', 'title', 'Ripasso cap. 3 e 4', 'updatedAt', '2026-11-02T08:00:00.000Z'))
), 'studyos_update_task') \g /dev/null
select bool_and(accepted) from public.studyos_agent_push(:'secret', 'agent-remote', jsonb_build_array(
  jsonb_build_object('entity_type', 'task', 'entity_id', 'au_new', 'deleted', false, 'payload',
    jsonb_build_object('id', 'au_new', 'title', 'Nuova', 'updatedAt', '2026-11-02T09:00:00.000Z')),
  jsonb_build_object('entity_type', 'attachment', 'entity_id', 'au_file', 'deleted', true, 'payload',
    jsonb_build_object('id', 'au_file', 'deletedAt', '2026-11-02T09:00:00.000Z'))
), 'studyos_create_task') \g /dev/null
-- Hub di prima della 1.8.0: chiama senza p_tool (argomenti con nome, come PostgREST).
select 'A0 push senza p_tool (hub di prima)', bool_and(accepted)
from public.studyos_agent_push(p_secret => :'secret', p_client_id => 'agent-remote', p_rows => jsonb_build_array(
  jsonb_build_object('entity_type', 'goal', 'entity_id', 'au_goal', 'deleted', false, 'payload',
    jsonb_build_object('id', 'au_goal', 'title', 'Obiettivo', 'updatedAt', '2026-11-02T10:00:00.000Z'))
));
reset role;

select 'A1 modifica: una voce update con prima e dopo, senza file', count(*) = 1
  and bool_and(action = 'update' and before->>'title' = 'Ripasso cap. 3' and after->>'title' = 'Ripasso cap. 3 e 4'
    and not (before ? 'cover') and not (after ? 'cover') and before_files is null
    and tool = 'studyos_update_task' and grant_label = 'ChatGPT' and grant_id is not null)
from public.studyos_agent_audit where entity_id = 'au_task';
select 'A2 la riga tiene la copertina rimessa dal database', payload->>'cover' = 'data:image/png;base64,COPERTINA'
from public.studyos_items where entity_id = 'au_task';
select 'A3 creazione: voce create senza prima', count(*) = 1 and bool_and(action = 'create' and before is null and after->>'title' = 'Nuova')
from public.studyos_agent_audit where entity_id = 'au_new';
select 'A4 eliminazione: file a parte, immagine senza file, dopo = tombstone', count(*) = 1
  and bool_and(action = 'delete' and before->>'name' = 'Dispense' and not (before ? 'dataUrl')
    and before_files->>'dataUrl' = 'data:application/pdf;base64,FILE' and after->>'deletedAt' = '2026-11-02T09:00:00.000Z')
from public.studyos_agent_audit where entity_id = 'au_file';
select 'A5 timbro dopo = timbro della riga', bool_and(a.after_stamp = public.studyos_item_stamp(i.payload, i.deleted, i.updated_at))
from public.studyos_agent_audit as a join public.studyos_items as i on i.entity_id = a.entity_id and i.user_id = a.user_id;
select 'A6 push senza p_tool: voce con strumento vuoto', count(*) = 1 and bool_and(tool = '' and action = 'create')
from public.studyos_agent_audit where entity_id = 'au_goal';

-- Riscritture che non cambiano niente: nessuna voce.
set role anon;
select public.studyos_agent_push(:'secret', 'agent-remote', jsonb_build_array(
  jsonb_build_object('entity_type', 'task', 'entity_id', 'au_new', 'deleted', false, 'payload',
    jsonb_build_object('id', 'au_new', 'title', 'Nuova', 'updatedAt', '2026-11-02T09:00:00.000Z')),
  jsonb_build_object('entity_type', 'attachment', 'entity_id', 'au_file', 'deleted', true, 'payload',
    jsonb_build_object('id', 'au_file', 'deletedAt', '2026-11-02T09:00:00.000Z')),
  jsonb_build_object('entity_type', 'task', 'entity_id', 'au_ghost', 'deleted', true, 'payload',
    jsonb_build_object('id', 'au_ghost', 'deletedAt', '2026-11-03T09:00:00.000Z')),
  jsonb_build_object('entity_type', 'task', 'entity_id', 'au_task', 'deleted', false, 'payload',
    jsonb_build_object('id', 'au_task', 'title', 'Vecchia', 'updatedAt', '2026-10-01T08:00:00.000Z'))
), 'studyos_update_task') \g /dev/null
reset role;
select 'A7 stessa riga, eliminazioni a vuoto, scritture rifiutate: nessuna voce', count(*) = 4 from public.studyos_agent_audit;

-- Elenco per il connettore: dal più recente, con filtri e totale.
set role anon;
select 'L1 elenco: 4 voci, la più recente prima, tutte ripristinabili', count(*) = 4
  and bool_and(can_restore and total = 4)
  and (array_agg(entity_id order by created_at desc))[1] = 'au_goal'
from public.studyos_agent_audit_list(:'secret');
select 'L2 filtro per elemento e per strumento', (select count(*) from public.studyos_agent_audit_list(:'secret', p_entity_id => 'au_task')) = 1
  and (select count(*) from public.studyos_agent_audit_list(:'secret', p_tool => 'studyos_create_task')) = 2
  and (select count(*) from public.studyos_agent_audit_list(:'secret', p_limit => 1, p_offset => 1)) = 1
  and (select max(total) from public.studyos_agent_audit_list(:'secret', p_limit => 1)) = 4;
select 'L3 segreto sbagliato: 28000', pg_temp.outcome($$select * from public.studyos_agent_audit_list(repeat('0', 64))$$) = '28000';
select 'L4 anon non legge la tabella né scrive voci', pg_temp.outcome($$select * from public.studyos_agent_audit$$) = '42501'
  and pg_temp.outcome($$insert into public.studyos_agent_audit (user_id, entity_type, entity_id, action) values ('11111111-1111-1111-1111-111111111111', 'task', 'x', 'create')$$) = '42501';
select 'L5 anon non usa le funzioni dell''app né quelle interne', pg_temp.outcome($$select public.studyos_agent_restore_own(gen_random_uuid())$$) = '42501'
  and pg_temp.outcome($$select * from public.studyos_agent_audit_own()$$) = '42501'
  and pg_temp.outcome($$select public.studyos_agent_restore_apply('11111111-1111-1111-1111-111111111111', gen_random_uuid(), null, '', null)$$) = '42501'
  and pg_temp.outcome($$select public.studyos_agent_audit_prune('11111111-1111-1111-1111-111111111111')$$) = '42501';
reset role;

-- Bea vede solo le sue voci (nessuna) e non ripristina quelle di Alice.
select id as task_audit from public.studyos_agent_audit where entity_id = 'au_task' \gset
select id as file_audit from public.studyos_agent_audit where entity_id = 'au_file' \gset
select id as new_audit from public.studyos_agent_audit where entity_id = 'au_new' \gset
set role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false) \g /dev/null
select 'R0 RLS: Bea non vede le voci di Alice', count(*) = 0 from public.studyos_agent_audit;
select 'R0 Bea: elenco dell''app vuoto e ripristino non trovato', (select count(*) from public.studyos_agent_audit_own()) = 0
  and public.studyos_agent_restore_own(:'task_audit')->>'status' = 'not_found';
select 'R0 authenticated non scrive né cancella voci', pg_temp.outcome($$delete from public.studyos_agent_audit$$) = '42501'
  and pg_temp.outcome($$update public.studyos_agent_audit set tool = 'x'$$) = '42501';
reset role;
select set_config('request.jwt.claim.sub', '', false) \g /dev/null

-- Ripristino dal connettore: la modifica torna indietro con un timbro nuovo, file compresi.
set role anon;
select 'R1 ripristino della modifica', public.studyos_agent_restore(:'secret', :'task_audit')->>'status' = 'restored';
reset role;
select 'R2 titolo di prima, copertina intatta, timbro nuovo, client del connettore', payload->>'title' = 'Ripasso cap. 3'
  and payload->>'cover' = 'data:image/png;base64,COPERTINA'
  and (payload->>'updatedAt')::timestamptz > '2026-11-02T08:00:00Z' and client_id = 'agent-remote' and not deleted
from public.studyos_items where entity_id = 'au_task';
select 'R3 voce del ripristino e voce annullata segnata', (select restored_at is not null from public.studyos_agent_audit where id = :'task_audit')
  and (select count(*) = 1 and bool_and(action = 'update' and tool = 'studyos_restore_change' and before->>'title' = 'Ripasso cap. 3 e 4' and after->>'title' = 'Ripasso cap. 3')
    from public.studyos_agent_audit where restore_of = :'task_audit');
set role anon;
select 'R4 una voce già annullata non si ripristina di nuovo', public.studyos_agent_restore(:'secret', :'task_audit')->>'status' = 'already_restored';
select 'R4 voce inesistente', public.studyos_agent_restore(:'secret', gen_random_uuid())->>'status' = 'not_found';
reset role;

-- Ripristino dall'app (Alice): l'eliminazione torna indietro con il file.
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false) \g /dev/null
select 'R5 Alice vede le sue voci dall''app', count(*) >= 5 from public.studyos_agent_audit_own();
select 'R5 Alice legge la tabella (RLS)', count(*) >= 5 from public.studyos_agent_audit;
select 'R6 ripristino dell''eliminazione dall''app', public.studyos_agent_restore_own(:'file_audit')->>'status' = 'restored';
reset role;
select set_config('request.jwt.claim.sub', '', false) \g /dev/null
select 'R7 il file è di nuovo tra i dati, con dataUrl, per ogni dispositivo', not deleted and payload->>'name' = 'Dispense'
  and payload->>'dataUrl' = 'data:application/pdf;base64,FILE' and not (payload ? 'deletedAt') and client_id is null
from public.studyos_items where entity_id = 'au_file';
select 'R8 voce del ripristino dall''app: create, senza permesso', count(*) = 1 and bool_and(action = 'create' and grant_id is null and before is null)
from public.studyos_agent_audit where restore_of = :'file_audit';

-- Conflitto: l'app cambia l'elemento dopo la scrittura del connettore; il ripristino non tocca niente.
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false) \g /dev/null
select push_studyos_rows('11111111-1111-1111-1111-111111111111', 'browser', jsonb_build_array(
  jsonb_build_object('entity_type', 'task', 'entity_id', 'au_new', 'deleted', false, 'payload',
    jsonb_build_object('id', 'au_new', 'title', 'Nuova, cambiata in app', 'updatedAt', '2026-11-04T08:00:00.000Z'))
)) \g /dev/null
reset role;
select set_config('request.jwt.claim.sub', '', false) \g /dev/null
set role anon;
select 'C1 elenco: la voce non è più ripristinabile', not can_restore from public.studyos_agent_audit_list(:'secret', p_entity_id => 'au_new');
select 'C2 ripristino in conflitto con l''elemento attuale', r->>'status' = 'conflict' and r->'current'->>'title' = 'Nuova, cambiata in app'
from (select public.studyos_agent_restore(:'secret', :'new_audit') as r) as x;
reset role;
select 'C3 niente scritto', payload->>'title' = 'Nuova, cambiata in app' and client_id = 'browser'
from public.studyos_items where entity_id = 'au_new';

-- Annullare una creazione la elimina; annullare quel ripristino la rimette.
set role anon;
select public.studyos_agent_push(:'secret', 'agent-remote', jsonb_build_array(
  jsonb_build_object('entity_type', 'calendarEvent', 'entity_id', 'au_event', 'deleted', false, 'payload',
    jsonb_build_object('id', 'au_event', 'title', 'Lezione', 'updatedAt', '2026-11-05T08:00:00.000Z'))
), 'studyos_create_event') \g /dev/null
reset role;
select id as event_audit from public.studyos_agent_audit where entity_id = 'au_event' and restore_of is null \gset
set role anon;
select 'D1 annullare una creazione elimina l''elemento', public.studyos_agent_restore(:'secret', :'event_audit')->>'action' = 'delete';
reset role;
select 'D2 tombstone con timbro nuovo', deleted and (payload->>'deletedAt')::timestamptz > '2026-11-05T08:00:00Z'
from public.studyos_items where entity_id = 'au_event';
select id as undo_audit from public.studyos_agent_audit where restore_of = :'event_audit' \gset
set role anon;
select 'D3 annullare il ripristino rimette l''elemento', public.studyos_agent_restore(:'secret', :'undo_audit')->>'action' = 'create';
reset role;
select 'D4 l''evento è tornato', not deleted and payload->>'title' = 'Lezione' from public.studyos_items where entity_id = 'au_event';

-- Conservazione: al massimo 2000 voci per account e nessuna oltre 90 giorni.
insert into public.studyos_agent_audit (user_id, entity_type, entity_id, action, created_at)
select '11111111-1111-1111-1111-111111111111', 'task', 'old_' || n, 'update', now() - interval '91 days' - n * interval '1 second'
from generate_series(1, 5) as n;
insert into public.studyos_agent_audit (user_id, entity_type, entity_id, action, created_at)
select '11111111-1111-1111-1111-111111111111', 'task', 'bulk_' || n, 'update', now() - interval '1 day' - n * interval '1 second'
from generate_series(1, 2100) as n;
set role anon;
select public.studyos_agent_push(:'secret', 'agent-remote', jsonb_build_array(
  jsonb_build_object('entity_type', 'task', 'entity_id', 'au_last', 'deleted', false, 'payload',
    jsonb_build_object('id', 'au_last', 'title', 'Ultima', 'updatedAt', '2026-11-06T08:00:00.000Z'))
), 'studyos_create_task') \g /dev/null
reset role;
select 'P1 potatura: 2000 voci, nessuna oltre 90 giorni, la più recente resta',
  count(*) = 2000 and min(created_at) > now() - interval '90 days' and bool_or(entity_id = 'au_last')
from public.studyos_agent_audit where user_id = '11111111-1111-1111-1111-111111111111';

-- Un permesso revocato non scrive, non legge e non ripristina.
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false) \g /dev/null
select public.studyos_revoke_agent_grants() \g /dev/null
reset role;
select set_config('request.jwt.claim.sub', '', false) \g /dev/null
set role anon;
select 'V1 permesso revocato: 28000 ovunque', pg_temp.outcome(format($q$select * from public.studyos_agent_audit_list(%L)$q$, :'secret')) = '28000'
  and pg_temp.outcome(format($q$select public.studyos_agent_restore(%L, gen_random_uuid())$q$, :'secret')) = '28000'
  and pg_temp.outcome(format($q$select * from public.studyos_agent_push(%L, 'x', '[]'::jsonb, 't')$q$, :'secret')) = '28000';
reset role;
