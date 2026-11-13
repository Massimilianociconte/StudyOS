-- Prove del segno dei file dei materiali in push_studyos_rows (schema.sql). SOLO Postgres temporaneo
-- (scripts/supabase/scratch-pg.sh) o stack locale, mai il progetto reale. Tutto in una transazione
-- annullata alla fine. Revisione finale (L-4): un materiale mandato senza `storedFile` (una scheda
-- rimasta aperta con l'app di prima) tiene il segno della riga viva; «cloud» non torna «local».
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

\set ada '504b3482-7f1b-4add-bfbc-7b3effbf21d7'

-- Una riga da mandare: materiale (o altro tipo) con il suo timbro.
create function pg_temp.one_row(p_type text, p_id text, p_payload jsonb, p_deleted boolean default false) returns jsonb
language sql as $$
  select jsonb_build_array(jsonb_build_object('entity_type', p_type, 'entity_id', p_id, 'deleted', p_deleted,
    'payload', jsonb_build_object('id', p_id) || p_payload))
$$;
create function pg_temp.saved(p_id text) returns jsonb language sql as $$
  select payload from public.studyos_items
  where user_id = '504b3482-7f1b-4add-bfbc-7b3effbf21d7' and entity_type = 'attachment' and entity_id = p_id
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', :'ada', true) \g /dev/null

-- S1: materiale caricato nello spazio file («cloud», senza dataUrl).
select pg_temp.expect('S1 materiale «cloud» salvato', bool_and(accepted))
from public.push_studyos_rows(:'ada', 'nuova', pg_temp.one_row('attachment', 'mat-1',
  '{"name": "Dispense", "storedFile": "cloud", "updatedAt": "2026-11-13T09:00:00.000Z"}'));

-- S2: la scheda dell'app di prima rinomina il materiale e lo manda senza `storedFile`.
select pg_temp.expect('S2 modifica accettata', bool_and(accepted))
from public.push_studyos_rows(:'ada', 'vecchia', pg_temp.one_row('attachment', 'mat-1',
  '{"name": "Dispense 2", "updatedAt": "2026-11-13T09:05:00.000Z"}'));
select pg_temp.expect('S2 il nome cambia e il segno «cloud» resta',
  pg_temp.saved('mat-1') ->> 'name' = 'Dispense 2' and pg_temp.saved('mat-1') ->> 'storedFile' = 'cloud');

-- S3: stessa modifica ripetuta (risposta persa): stessa riga, accettata come prima.
select pg_temp.expect('S3 invio ripetuto accettato', bool_and(accepted))
from public.push_studyos_rows(:'ada', 'vecchia', pg_temp.one_row('attachment', 'mat-1',
  '{"name": "Dispense 2", "updatedAt": "2026-11-13T09:05:00.000Z"}'));

-- S4: «local» su una riga viva già «cloud» resta «cloud» (guardia di prima, invariata).
select public.push_studyos_rows(:'ada', 'nuova', pg_temp.one_row('attachment', 'mat-1',
  '{"name": "Dispense 3", "storedFile": "local", "updatedAt": "2026-11-13T09:10:00.000Z"}')) \g /dev/null
select pg_temp.expect('S4 «cloud» non torna «local»', pg_temp.saved('mat-1') ->> 'storedFile' = 'cloud'
  and pg_temp.saved('mat-1') ->> 'name' = 'Dispense 3');

-- S5: file ancora da caricare («local»): senza il campo resta «local».
select public.push_studyos_rows(:'ada', 'nuova', pg_temp.one_row('attachment', 'mat-2',
  '{"name": "Appunti", "storedFile": "local", "updatedAt": "2026-11-13T09:00:00.000Z"}')) \g /dev/null
select public.push_studyos_rows(:'ada', 'vecchia', pg_temp.one_row('attachment', 'mat-2',
  '{"name": "Appunti rinominati", "updatedAt": "2026-11-13T09:01:00.000Z"}')) \g /dev/null
select pg_temp.expect('S5 «local» resta', pg_temp.saved('mat-2') ->> 'storedFile' = 'local');

-- S6: materiale eliminato (tombstone) e poi rimandato senza il campo: il segno non torna (l'oggetto
-- nel bucket può essere già stato tolto).
select public.push_studyos_rows(:'ada', 'nuova', pg_temp.one_row('attachment', 'mat-1',
  '{"name": "Dispense 3", "storedFile": "cloud", "deletedAt": "2026-11-13T09:20:00.000Z", "updatedAt": "2026-11-13T09:20:00.000Z"}', true)) \g /dev/null
select pg_temp.expect('S6 eliminato', (select deleted from public.studyos_items where user_id = :'ada' and entity_id = 'mat-1'));
select public.push_studyos_rows(:'ada', 'vecchia', pg_temp.one_row('attachment', 'mat-1',
  '{"name": "Dispense 3", "updatedAt": "2026-11-13T09:30:00.000Z"}')) \g /dev/null
select pg_temp.expect('S6 rimandato dopo l''eliminazione: niente segno',
  not (select deleted from public.studyos_items where user_id = :'ada' and entity_id = 'mat-1')
  and not (pg_temp.saved('mat-1') ? 'storedFile'));

-- S7: un materiale nuovo senza file (solo link) e un altro tipo restano come sono.
select public.push_studyos_rows(:'ada', 'nuova', pg_temp.one_row('attachment', 'mat-3',
  '{"name": "Sito del corso", "externalUrl": "https://example.org", "updatedAt": "2026-11-13T09:00:00.000Z"}')) \g /dev/null
select pg_temp.expect('S7 link senza segno', not (pg_temp.saved('mat-3') ? 'storedFile'));
select public.push_studyos_rows(:'ada', 'nuova', pg_temp.one_row('task', 'mat-2',
  '{"title": "Stesso id, altro tipo", "updatedAt": "2026-11-13T09:00:00.000Z"}')) \g /dev/null
select pg_temp.expect('S7 altro tipo con lo stesso id: nessun segno preso dal materiale',
  not exists (select 1 from public.studyos_items where user_id = :'ada' and entity_type = 'task' and payload ? 'storedFile'));

-- S8: una modifica più vecchia resta respinta anche con il segno aggiunto.
select pg_temp.expect('S8 modifica più vecchia respinta', not bool_and(accepted))
from public.push_studyos_rows(:'ada', 'vecchia', pg_temp.one_row('attachment', 'mat-2',
  '{"name": "Vecchio nome", "updatedAt": "2026-11-13T08:00:00.000Z"}'));
select pg_temp.expect('S8 nome invariato', pg_temp.saved('mat-2') ->> 'name' = 'Appunti rinominati');

rollback;
