-- Prove di studyos_push_notify (people.sql) con pg_net e Vault finti. SOLO Postgres temporaneo
-- (scripts/supabase/scratch-pg.sh), mai lo stack locale né il progetto reale: lo script si ferma se
-- trova già gli schemi net o vault. Tutto in una transazione annullata alla fine.
-- Revisione finale:
-- - M-1: i dispositivi con la password dell'app (`private`) ricevono solo «StudyOS» e «Hai una nuova
--   notifica.», con lo stesso tipo, url e tag, per ognuno dei sei trigger delle persone;
-- - L-1: al massimo 15 iscrizioni per richiesta, lotti mai misti tra dispositivi con e senza password.
\set ON_ERROR_STOP 1
\pset tuples_only on
\pset format unaligned
begin;

do $$
begin
  if exists (select 1 from pg_namespace where nspname in ('net', 'vault')) then
    raise exception 'pg_net o Vault già presenti: queste prove vanno solo su un Postgres temporaneo';
  end if;
end $$;

create function pg_temp.expect(p_label text, p_ok boolean) returns text language plpgsql as $$
begin
  if p_ok is distinct from true then
    raise exception 'FALLITO: %', p_label;
  end if;
  return 'ok ' || p_label;
end $$;

-- pg_net e Vault finti: stesse firme usate da people.sql, nessuna rete.
create schema net;
create table net.captured (n bigserial primary key, url text, body jsonb, headers jsonb);
create function net.http_post(
  url text,
  body jsonb default '{}'::jsonb,
  params jsonb default '{}'::jsonb,
  headers jsonb default '{}'::jsonb,
  timeout_milliseconds integer default 5000
) returns bigint language sql as $$
  insert into net.captured (url, body, headers) values (url, body, headers) returning n
$$;
create schema vault;
create table vault.decrypted_secrets (name text, decrypted_secret text, created_at timestamptz default now());
insert into vault.decrypted_secrets (name, decrypted_secret) values
  ('studyos_push_secret', 'segreto-di-prova'),
  ('studyos_push_url', 'https://worker.esempio.test/push');

-- Olga (proprietaria), Bea (invitata), Ada (amministratrice); ognuna con un dispositivo senza e uno con
-- la password dell'app.
\set olga '11111111-1111-1111-1111-111111111111'
\set bea '22222222-2222-2222-2222-222222222222'
\set ada '504b3482-7f1b-4add-bfbc-7b3effbf21d7'
\set mallory 'fc0191e0-6663-4a43-b060-131e397f02cc'

insert into public.studyos_groups (id, name, owner_id, owner_display_name, invite_code)
  values ('gp-push', 'Visite Dr. Rossi', :'olga', 'Olga', 'GP-PUSH-1');
insert into public.studyos_group_members (group_id, user_id, display_name, role) values
  ('gp-push', :'olga', 'Olga', 'owner'), ('gp-push', :'ada', 'Ada', 'admin');
insert into public.studyos_push_subscriptions (user_id, endpoint, p256dh, auth, private)
select u.id::uuid, 'https://push.esempio.test/' || u.label || case when p then '-priv' else '-pub' end,
  repeat('A', 87), repeat('B', 22), p
from (values (:'olga', 'olga'), (:'bea', 'bea'), (:'ada', 'ada')) as u (id, label)
cross join (values (false), (true)) as v (p);
delete from net.captured;

-- Notifica completa e notifica generica dello stesso tag: due richieste, iscrizioni separate, testo
-- generico = notifica completa con solo titolo e testo cambiati.
create function pg_temp.pair(p_label text, p_tag text, p_public text[], p_private text[], p_body text)
returns text language plpgsql as $$
declare
  v_count integer;
  v_pub jsonb;
  v_priv jsonb;
  v_pub_ep text[];
  v_priv_ep text[];
begin
  select count(*) into v_count from net.captured c where c.body #>> '{notification,tag}' = p_tag;
  if v_count <> 2 then
    raise exception 'FALLITO: % (% richieste invece di 2)', p_label, v_count;
  end if;
  select c.body -> 'notification', array(select e ->> 'endpoint' from jsonb_array_elements(c.body -> 'subscriptions') e order by 1)
    into v_pub, v_pub_ep
  from net.captured c where c.body #>> '{notification,tag}' = p_tag and c.body #>> '{notification,title}' <> 'StudyOS';
  select c.body -> 'notification', array(select e ->> 'endpoint' from jsonb_array_elements(c.body -> 'subscriptions') e order by 1)
    into v_priv, v_priv_ep
  from net.captured c where c.body #>> '{notification,tag}' = p_tag and c.body #>> '{notification,title}' = 'StudyOS';
  if v_pub ->> 'body' is distinct from p_body then
    raise exception 'FALLITO: % (testo completo: %)', p_label, v_pub ->> 'body';
  end if;
  if v_pub_ep is distinct from p_public or v_priv_ep is distinct from p_private then
    raise exception 'FALLITO: % (iscrizioni % / %)', p_label, v_pub_ep, v_priv_ep;
  end if;
  if v_priv is distinct from v_pub || jsonb_build_object('title', 'StudyOS', 'body', 'Hai una nuova notifica.') then
    raise exception 'FALLITO: % (generica: %)', p_label, v_priv;
  end if;
  return 'ok ' || p_label;
end $$;

-- 1. Invito a un gruppo (Olga → Bea).
set local role authenticated;
select set_config('request.jwt.claim.sub', :'olga', true) \g /dev/null
select public.invite_person_to_group('gp-push', :'bea', 'Olga') as group_invite \gset
-- 2. Bea accetta: «nuovo membro» a Olga (proprietaria e autrice dell'invito) e ad Ada (amministratrice).
select set_config('request.jwt.claim.sub', :'bea', true) \g /dev/null
select public.accept_group_invite(:'group_invite', 'Bea') \g /dev/null
-- 3. Invito a condividere (Olga → Bea) con le sezioni.
select set_config('request.jwt.claim.sub', :'olga', true) \g /dev/null
select public.invite_person_to_share(:'bea', 'Olga',
  '[{"scope":"calendar","permission":"view","subject_ids":[],"subject_names":[]},{"scope":"tasks","permission":"view","subject_ids":[],"subject_names":[]}]'::jsonb,
  '[]'::jsonb) ->> 'id' as share_invite \gset
-- 4. Bea accetta: «invito accettato» a Olga.
select set_config('request.jwt.claim.sub', :'bea', true) \g /dev/null
select public.accept_share_invite(:'share_invite'::uuid, null, 'Bea', '[]'::jsonb) \g /dev/null
-- 5. Olga passa il calendario a «Può modificare»: «permessi cambiati» a Bea.
select set_config('request.jwt.claim.sub', :'olga', true) \g /dev/null
select id as calendar_share from public.studyos_shares
  where owner_id = :'olga' and grantee_user_id = :'bea' and scope = 'calendar' \gset
update public.studyos_shares set permission = 'edit' where id = :'calendar_share';
\set permission_tag 'share-permission:' :calendar_share
reset role;
select max(n) as before_revoke from net.captured \gset
set local role authenticated;
-- 6. Olga smette di condividere il calendario: «accesso tolto» a Bea (stesso tag del passo 5).
delete from public.studyos_shares where id = :'calendar_share';
reset role;
select set_config('request.jwt.claim.sub', '', true) \g /dev/null

\set invite_tag 'group-invite:' :group_invite
\set share_tag 'share-invite:' :share_invite
\set accepted_tag 'share-accepted:' :share_invite
select pg_temp.pair('M1 invito a un gruppo', :'invite_tag',
  array['https://push.esempio.test/bea-pub'], array['https://push.esempio.test/bea-priv'],
  'Olga ti invita nel gruppo Visite Dr. Rossi');
select pg_temp.pair('M1 nuovo membro', 'group-join:' || md5('gp-push') || ':' || :'bea',
  array['https://push.esempio.test/ada-pub', 'https://push.esempio.test/olga-pub'],
  array['https://push.esempio.test/ada-priv', 'https://push.esempio.test/olga-priv'],
  'Bea ora fa parte del gruppo Visite Dr. Rossi');
select pg_temp.pair('M1 invito a condividere', :'share_tag',
  array['https://push.esempio.test/bea-pub'], array['https://push.esempio.test/bea-priv'],
  'Olga vuole condividere con te: Calendario, Attività');
select pg_temp.pair('M1 invito accettato', :'accepted_tag',
  array['https://push.esempio.test/olga-pub'], array['https://push.esempio.test/olga-priv'],
  'Bea ha accettato il tuo invito');

-- Permesso cambiato e accesso tolto hanno lo stesso tag: si separano con l'ordine delle richieste.
select pg_temp.expect('M1 permessi cambiati: completa e generica, prima della revoca',
  (select count(*) from net.captured c where c.n <= :before_revoke and c.body #>> '{notification,tag}' = :'permission_tag') = 2
  and (select count(*) from net.captured c where c.n <= :before_revoke and c.body #>> '{notification,tag}' = :'permission_tag'
    and c.body #>> '{notification,title}' = 'Permessi cambiati'
    and c.body #>> '{notification,body}' = 'Olga ora ti permette di modificare: Calendario') = 1);
select pg_temp.expect('M1 accesso tolto (smesso di condividere): completa e generica',
  (select count(*) from net.captured c where c.n > :before_revoke and c.body #>> '{notification,tag}' = :'permission_tag') = 2
  and (select count(*) from net.captured c where c.n > :before_revoke and c.body #>> '{notification,tag}' = :'permission_tag'
    and c.body #>> '{notification,title}' = 'Accesso tolto'
    and c.body #>> '{notification,body}' = 'Olga ha smesso di condividere con te: Calendario') = 1);
select pg_temp.expect('M1 permessi cambiati e accesso tolto: le generiche solo al dispositivo con la password, stesso tipo, url e tag',
  (select count(*) from net.captured c
    where c.body #>> '{notification,tag}' = :'permission_tag'
      and c.body -> 'notification' = jsonb_build_object('kind', 'permission', 'title', 'StudyOS', 'body', 'Hai una nuova notifica.',
        'url', '?apri=condivisione', 'tag', :'permission_tag')
      and c.body -> 'subscriptions' @> '[{"endpoint": "https://push.esempio.test/bea-priv"}]'
      and jsonb_array_length(c.body -> 'subscriptions') = 1) = 2);
select pg_temp.expect('M1 permessi cambiati e accesso tolto: le complete solo al dispositivo senza password',
  (select count(*) from net.captured c
    where c.body #>> '{notification,tag}' = :'permission_tag' and c.body #>> '{notification,title}' <> 'StudyOS'
      and c.body -> 'subscriptions' @> '[{"endpoint": "https://push.esempio.test/bea-pub"}]'
      and jsonb_array_length(c.body -> 'subscriptions') = 1) = 2);
select pg_temp.expect('M1 nessun nome nelle richieste con la password dell''app',
  not exists (select 1 from net.captured c
    where c.body #>> '{notification,title}' = 'StudyOS'
      and (c.body::text like '%Olga%' or c.body::text like '%Bea%' or c.body::text like '%Rossi%'
        or c.body::text like '%Calendario%' or c.body::text like '%Attività%')));
select pg_temp.expect('M1 segreto e account in ogni richiesta',
  not exists (select 1 from net.captured c
    where c.headers ->> 'x-studyos-push-secret' is distinct from 'segreto-di-prova'
      or exists (select 1 from jsonb_array_elements(c.body -> 'subscriptions') e where not e ? 'account')));

-- Bacheca (revisione del 23/11/2026): versioni precedenti scritte dal server e avviso agli altri membri.
-- Bea (membro) pubblica e modifica il suo annuncio, Ada (amministratrice) lo modifica, Bea non può
-- toccare quello di Ada, nessuno riscrive la cronologia, fissare non è una modifica.
delete from net.captured;
set local role authenticated;
select set_config('request.jwt.claim.sub', :'bea', true) \g /dev/null
insert into public.studyos_group_resources (id, group_id, kind, title, body, added_by_user_id, added_by_display_name, revisions)
  values ('res-bea', 'gp-push', 'note', 'Lezioni', 'Aula 3', :'bea', 'Bea',
    '[{"id": "rev_finta", "at": "2026-01-01T00:00:00Z", "byUserId": "x", "byDisplayName": "Olga", "kind": "note", "title": "falso"}]');
update public.studyos_group_resources set pinned = true where id = 'res-bea';
update public.studyos_group_resources set body = 'Aula 5' where id = 'res-bea';
select set_config('request.jwt.claim.sub', :'ada', true) \g /dev/null
update public.studyos_group_resources set title = 'Lezioni di giovedì' where id = 'res-bea';
insert into public.studyos_group_resources (id, group_id, kind, title, added_by_user_id, added_by_display_name)
  values ('res-ada', 'gp-push', 'note', 'Regole', :'ada', 'Ada');
select set_config('request.jwt.claim.sub', :'bea', true) \g /dev/null
-- Cronologia riscritta a mano: il server la ignora (e non è una modifica: nessun avviso).
update public.studyos_group_resources set revisions = '[]'::jsonb, pinned = false where id = 'res-bea';
do $$
begin
  update public.studyos_group_resources set title = 'rubato' where id = 'res-ada';
  raise exception 'FALLITO: Bea ha modificato l''annuncio di Ada';
exception when raise_exception then
  if sqlerrm not like 'Solo l''autore%' then
    raise;
  end if;
end $$;
-- Mallory non è nel gruppo: la RLS non le mostra la riga (zero righe, nessun errore).
select set_config('request.jwt.claim.sub', :'mallory', true) \g /dev/null
update public.studyos_group_resources set title = 'rubato' where id = 'res-bea';
reset role;
select set_config('request.jwt.claim.sub', '', true) \g /dev/null

select pg_temp.expect('B1 annuncio nuovo senza versioni (quelle mandate dal client non contano)',
  (select revisions from public.studyos_group_resources where id = 'res-ada') = '[]'::jsonb);
select pg_temp.expect('B1 due modifiche, due versioni: fissare e riscrivere la cronologia non contano',
  (select jsonb_agg(jsonb_build_array(e ->> 'byDisplayName', e ->> 'title', e ->> 'body', e ->> 'byUserId') order by o)
     from public.studyos_group_resources r cross join jsonb_array_elements(r.revisions) with ordinality as t (e, o)
     where r.id = 'res-bea')
  = jsonb_build_array(jsonb_build_array('Bea', 'Lezioni', 'Aula 3', :'bea'), jsonb_build_array('Ada', 'Lezioni', 'Aula 5', :'ada')));
select pg_temp.expect('B1 contenuto attuale e titolo non rubato',
  (select title || '|' || body || '|' || pinned::text from public.studyos_group_resources where id = 'res-bea') = 'Lezioni di giovedì|Aula 5|false'
  and (select title from public.studyos_group_resources where id = 'res-ada') = 'Regole');
select pg_temp.expect('B1 ora della versione = timbro del server della modifica',
  (select (r.revisions -> -1 ->> 'at')::timestamptz = r.updated_at from public.studyos_group_resources r where r.id = 'res-bea'));
select rev ->> 'id' as bea_rev from public.studyos_group_resources r, jsonb_array_elements(r.revisions) rev
  where r.id = 'res-bea' and rev ->> 'byDisplayName' = 'Bea' \gset
select rev ->> 'id' as ada_rev from public.studyos_group_resources r, jsonb_array_elements(r.revisions) rev
  where r.id = 'res-bea' and rev ->> 'byDisplayName' = 'Ada' \gset
select pg_temp.expect('B1 solo due avvisi (le due modifiche), ognuno con completa e generica',
  (select count(*) from net.captured c where c.body #>> '{notification,tag}' like 'board-edit:%') = 4
  and (select count(distinct c.body #>> '{notification,tag}') from net.captured c) = 2);
select pg_temp.pair('B1 modifica di Bea: a Olga e Ada', 'board-edit:' || md5(:'bea_rev'),
  array['https://push.esempio.test/ada-pub', 'https://push.esempio.test/olga-pub'],
  array['https://push.esempio.test/ada-priv', 'https://push.esempio.test/olga-priv'],
  '"Lezioni": modificato il testo.');
select pg_temp.pair('B1 modifica di Ada: a Olga e Bea', 'board-edit:' || md5(:'ada_rev'),
  array['https://push.esempio.test/bea-pub', 'https://push.esempio.test/olga-pub'],
  array['https://push.esempio.test/bea-priv', 'https://push.esempio.test/olga-priv'],
  '"Lezioni di giovedì" (prima "Lezioni"): modificato il titolo.');
select pg_temp.expect('B1 titolo con dove e chi, tipo e url ammessi dal Worker',
  (select count(*) from net.captured c
    where c.body #>> '{notification,title}' = 'Modifica annuncio in bacheca "Visite Dr. Rossi" da parte di Ada'
      and c.body #>> '{notification,kind}' = 'accepted' and c.body #>> '{notification,url}' = '?apri=gruppi') = 1
  and (select count(*) from net.captured c
    where c.body #>> '{notification,title}' = 'Modifica annuncio in bacheca "Visite Dr. Rossi" da parte di Bea') = 1);

-- Tetto di 20 versioni: le più vecchie escono, ogni modifica avvisa lo stesso (anche oltre il tetto).
-- Senza account (come lo script SQL): nessun limite di invio per chi agisce.
delete from net.captured;
do $$
begin
  for i in 1..22 loop
    update public.studyos_group_resources set body = 'Aula ' || (100 + i) where id = 'res-bea';
  end loop;
end $$;
select pg_temp.expect('B2 al massimo 20 versioni, le più recenti',
  (select jsonb_array_length(revisions) from public.studyos_group_resources where id = 'res-bea') = 20
  and (select revisions -> 0 ->> 'body' from public.studyos_group_resources where id = 'res-bea') = 'Aula 102'
  and (select revisions -> -1 ->> 'body' from public.studyos_group_resources where id = 'res-bea') = 'Aula 121');
select pg_temp.expect('B2 un avviso per modifica, anche oltre il tetto',
  (select count(distinct c.body #>> '{notification,tag}') from net.captured c where c.body #>> '{notification,tag}' like 'board-edit:%') = 22);

-- L-1: 17 iscrizioni senza password (9 di Olga, 8 di Bea) e 2 con la password (Ada) → richieste da 15 e 2,
-- più una da 2 per i dispositivi con la password.
delete from net.captured;
delete from public.studyos_push_subscriptions;
insert into public.studyos_push_subscriptions (user_id, endpoint, p256dh, auth, private)
select u.id::uuid, 'https://push.esempio.test/lotto-' || u.label || '-' || g, repeat('A', 87), repeat('B', 22), u.p
from (values (:'olga', 'olga', 9, false), (:'bea', 'bea', 8, false), (:'ada', 'ada', 2, true)) as u (id, label, n, p)
cross join lateral generate_series(1, u.n) as g;
select public.studyos_push_notify(array[:'olga', :'bea', :'ada', :'olga']::uuid[], 'invite', 'Invito a un gruppo',
  'Olga ti invita nel gruppo Visite Dr. Rossi', '?apri=notifiche', 'lotti') \g /dev/null
select pg_temp.expect('L1 tre richieste: 15 e 2 senza password, 2 con la password',
  array(select jsonb_array_length(c.body -> 'subscriptions') || ':' || (c.body #>> '{notification,title}') from net.captured c order by c.n)
    = array['15:Invito a un gruppo', '2:Invito a un gruppo', '2:StudyOS']);
select pg_temp.expect('L1 ogni iscrizione una volta sola',
  (select count(*) from net.captured c cross join jsonb_array_elements(c.body -> 'subscriptions') e) = 19
  and (select count(distinct e ->> 'endpoint') from net.captured c cross join jsonb_array_elements(c.body -> 'subscriptions') e) = 19);
select pg_temp.expect('L1 lotti mai misti',
  not exists (select 1 from net.captured c cross join jsonb_array_elements(c.body -> 'subscriptions') e
    join public.studyos_push_subscriptions s on s.endpoint = e ->> 'endpoint'
    where s.private <> ((c.body #>> '{notification,title}') = 'StudyOS')));
select pg_temp.expect('L1 la generica tiene tipo, url e tag',
  (select c.body -> 'notification' from net.captured c where c.body #>> '{notification,title}' = 'StudyOS')
    = '{"kind": "invite", "title": "StudyOS", "body": "Hai una nuova notifica.", "url": "?apri=notifiche", "tag": "lotti"}'::jsonb);

-- Senza dispositivi con la password: una sola richiesta, come prima.
delete from net.captured;
select public.studyos_push_notify(array[:'bea']::uuid[], 'accepted', 'Nuovo membro', 'Bea ora fa parte del gruppo', '?apri=gruppi', 'solo-bea') \g /dev/null
select pg_temp.expect('L1 senza password: una richiesta, testo completo',
  (select count(*) from net.captured) = 1
  and (select c.body #>> '{notification,body}' from net.captured c) = 'Bea ora fa parte del gruppo');

rollback;
