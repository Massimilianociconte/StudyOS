-- Prove della guardia di revisione nella push degli assistenti (agent.sql, 1.10.0): stessa revisione
-- con contenuto diverso rifiutata, revisione più vecchia rifiutata, invio ripetuto accettato, valori
-- strani o fuori scala a ultima scrittura vince, richieste agli assistenti prese una volta sola, una
-- riga rifiutata non blocca le altre del lotto. SOLO Postgres temporaneo
-- (scripts/supabase/scratch-pg.sh) o stack locale, mai il progetto reale. Tutto in una transazione
-- annullata alla fine.
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

\set alice '504b3482-7f1b-4add-bfbc-7b3effbf21d7'

select set_config('request.jwt.claim.sub', :'alice', true) \g /dev/null
set local role authenticated;
select public.studyos_create_agent_grant('prove revisione') as secret \gset
reset role;
select set_config('request.jwt.claim.sub', '', true) \g /dev/null

-- Una scheda come la scrive il connettore: revisione e retro a scelta, timbro sempre più recente.
create function pg_temp.card(p_id text, p_rev jsonb, p_back text, p_at text) returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('entity_type', 'flashcard', 'entity_id', p_id, 'deleted', false,
    'payload', jsonb_build_object('id', p_id, 'deckId', 'deck_1', 'front', '[{"type":"text","text":"Q"}]'::jsonb,
      'back', jsonb_build_array(jsonb_build_object('type', 'text', 'text', p_back)), 'revision', p_rev,
      'updatedAt', p_at, 'tags', '[]'::jsonb)))
$$;

create function pg_temp.request(p_id text, p_rev jsonb, p_token text, p_at text) returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('entity_type', 'aiRequest', 'entity_id', p_id, 'deleted', false,
    'payload', jsonb_build_object('id', p_id, 'status', case when p_token = '' then 'pending' else 'claimed' end,
      'claimToken', nullif(p_token, ''), 'attempts', 1, 'revision', p_rev, 'updatedAt', p_at)))
$$;

create function pg_temp.push(p_secret text, p_rows jsonb) returns boolean language sql as $$
  select bool_and(accepted) from public.studyos_agent_push(p_secret, 'prove', p_rows, 'studyos_save_flashcards', null)
$$;

set local role anon;

select pg_temp.expect('scheda nuova accettata', pg_temp.push(:'secret', pg_temp.card('c1', '1', 'base', '2026-11-16T10:00:00.000Z')));
select pg_temp.expect('revisione successiva accettata', pg_temp.push(:'secret', pg_temp.card('c1', '2', 'A', '2026-11-16T10:01:00.000Z')));
select pg_temp.expect('stessa revisione, altro contenuto: rifiutata',
  not pg_temp.push(:'secret', pg_temp.card('c1', '2', 'B', '2026-11-16T10:02:00.000Z')));
select pg_temp.expect('stessa revisione, stesso contenuto (invio ripetuto): accettata',
  pg_temp.push(:'secret', pg_temp.card('c1', '2', 'A', '2026-11-16T10:03:00.000Z')));
select pg_temp.expect('revisione più vecchia: rifiutata',
  not pg_temp.push(:'secret', pg_temp.card('c1', '1', 'vecchia', '2026-11-16T10:04:00.000Z')));
reset role;
select pg_temp.expect('il retro resta quello della revisione 2',
  (select payload->'back'->0->>'text' = 'A' from public.studyos_items where entity_type = 'flashcard' and entity_id = 'c1'));
set local role anon;

-- Valori che non sono interi sicuri: ultima scrittura vince, senza errori di conversione.
select pg_temp.expect('revisione testo: ultima scrittura vince', pg_temp.push(:'secret', pg_temp.card('c2', '"9"', 'testo', '2026-11-16T10:00:00.000Z')));
select pg_temp.expect('revisione null: ultima scrittura vince', pg_temp.push(:'secret', pg_temp.card('c2', 'null', 'nullo', '2026-11-16T10:01:00.000Z')));
select pg_temp.expect('revisione oggetto: ultima scrittura vince', pg_temp.push(:'secret', pg_temp.card('c2', '{"x":1}', 'oggetto', '2026-11-16T10:02:00.000Z')));
select pg_temp.expect('revisione negativa: ultima scrittura vince', pg_temp.push(:'secret', pg_temp.card('c2', '-1', 'negativa', '2026-11-16T10:03:00.000Z')));
select pg_temp.expect('revisione fuori scala salvata', pg_temp.push(:'secret', pg_temp.card('c3', '1e300', 'enorme', '2026-11-16T10:00:00.000Z')));
select pg_temp.expect('dopo una revisione fuori scala la scheda non resta bloccata',
  pg_temp.push(:'secret', pg_temp.card('c3', '2', 'sbloccata', '2026-11-16T10:01:00.000Z')));
select pg_temp.expect('2^53 + 1 non conta come revisione',
  pg_temp.push(:'secret', pg_temp.card('c3', '9007199254740993', 'oltre', '2026-11-16T10:02:00.000Z'))
  and pg_temp.push(:'secret', pg_temp.card('c3', '3', 'dopo', '2026-11-16T10:03:00.000Z')));
select pg_temp.expect('revisione decimale: ultima scrittura vince',
  pg_temp.push(:'secret', pg_temp.card('c3', '2.5', 'decimale', '2026-11-16T10:04:00.000Z'))
  and pg_temp.push(:'secret', pg_temp.card('c3', '2', 'dopo decimale', '2026-11-16T10:05:00.000Z')));

-- Richieste agli assistenti: due prese dalla stessa versione, passa solo la prima.
select pg_temp.expect('richiesta creata dall''app (senza revisione)', pg_temp.push(:'secret', pg_temp.request('r1', 'null', '', '2026-11-16T10:00:00.000Z')));
select pg_temp.expect('prima presa accettata', pg_temp.push(:'secret', pg_temp.request('r1', '1', 'token-a', '2026-11-16T10:01:00.000Z')));
select pg_temp.expect('seconda presa dalla stessa versione rifiutata',
  not pg_temp.push(:'secret', pg_temp.request('r1', '1', 'token-b', '2026-11-16T10:01:30.000Z')));
reset role;
select pg_temp.expect('il token salvato è quello della prima presa',
  (select payload->>'claimToken' = 'token-a' from public.studyos_items where entity_type = 'aiRequest' and entity_id = 'r1'));
set local role anon;

-- Lotto misto: la riga in conflitto torna accepted=false, le altre si scrivono.
select pg_temp.expect('lotto misto: una rifiutata, una accettata',
  (select array_agg(accepted order by entity_id) = array[false, true]
   from public.studyos_agent_push(:'secret', 'prove', pg_temp.card('c1', '1', 'vecchia', '2026-11-16T11:00:00.000Z') || pg_temp.card('c4', '1', 'nuova', '2026-11-16T11:00:00.000Z'), 'studyos_save_flashcards', null)));

-- Altri tipi: nessuna guardia (anche con un campo revision).
select pg_temp.expect('task: revisione più bassa accettata come prima',
  pg_temp.push(:'secret', '[{"entity_type":"task","entity_id":"t1","deleted":false,"payload":{"id":"t1","revision":5,"updatedAt":"2026-11-16T10:00:00.000Z"}}]'::jsonb)
  and pg_temp.push(:'secret', '[{"entity_type":"task","entity_id":"t1","deleted":false,"payload":{"id":"t1","revision":1,"updatedAt":"2026-11-16T10:01:00.000Z"}}]'::jsonb));

reset role;

-- La funzione resta interna.
select pg_temp.expect('guardia non chiamabile da anon e authenticated',
  not has_function_privilege('anon', 'public.studyos_agent_revision_conflict(text,jsonb,boolean,jsonb,boolean)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.studyos_agent_revision_conflict(text,jsonb,boolean,jsonb,boolean)', 'EXECUTE'));

rollback;
