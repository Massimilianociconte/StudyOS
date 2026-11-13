-- Controlli dopo l'aggiornamento dal SQL pubblicato (scripts/supabase/upgrade-from-published.sh), sulle
-- righe di scripts/supabase/upgrade-seed.sql. SOLO Postgres temporaneo. Tutto in una transazione annullata
-- alla fine: le prove come account autenticati non lasciano tracce.
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
-- Messaggio d'errore di un'istruzione (null se riesce), senza fermare la transazione. Il controllo del
-- risultato va in un'istruzione successiva: quella che chiama error_of non vede le sue modifiche.
create function pg_temp.error_of(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlerrm;
end $$;

\set olga '11111111-1111-1111-1111-111111111111'
\set bea '22222222-2222-2222-2222-222222222222'
\set a '504b3482-7f1b-4add-bfbc-7b3effbf21d7'
\set b 'fc0191e0-6663-4a43-b060-131e397f02cc'

-- Segni delle migrazioni una tantum.
select pg_temp.expect('U0 migrazioni una tantum fatte',
  (select count(*) from public.studyos_migrations where name in ('people_email_invites', 'names_from_email')) = 2);

-- Email dei membri e delle condivisioni: nessuna resta.
select pg_temp.expect('U1 nessuna email nei membri dei gruppi', not exists (select 1 from public.studyos_group_members where email is not null));
select pg_temp.expect('U1 nessuna email nelle condivisioni', not exists (select 1 from public.studyos_shares where grantee_email is not null));

-- Inviti di gruppo: quello per l'email di A (confermata prima dell'11/11) passa al suo account, senza
-- indirizzo né codice; gli altri per email spariscono; quello con il codice resta.
select pg_temp.expect('U2 invito di gruppo per email legato ad A, senza indirizzo né codice',
  (select recipient_user_id = :'a' and recipient_email is null and code = '' and status = 'pending'
   from public.studyos_group_invites where id = 'groupInvite_old_a'));
select pg_temp.expect('U3 inviti di gruppo per email non legati: spariti (in attesa, accettato, rifiutato)',
  not exists (select 1 from public.studyos_group_invites
    where id in ('groupInvite_old_nobody', 'groupInvite_old_accepted', 'groupInvite_old_declined')));
select pg_temp.expect('U4 invito con il codice intatto',
  (select code = 'OLD-CODE-0002' and recipient_user_id is null and status = 'pending'
   from public.studyos_group_invites where id = 'groupInvite_old_code'));
select pg_temp.expect('U4 nessun invito con destinatario porta il codice',
  not exists (select 1 from public.studyos_group_invites where code <> '' and (recipient_user_id is not null or recipient_email is not null)));

-- Inviti di condivisione: quello per A legato; quello per un indirizzo senza account resta slegato
-- (e scaduto per l'app); l'accettato e quello via link non cambiano.
select pg_temp.expect('U5 invito di condivisione per email legato ad A',
  (select recipient_user_id = :'a' from public.studyos_share_invites where recipient_email = 'a@test.local'));
select pg_temp.expect('U5 invito per un indirizzo senza account: resta, slegato',
  (select recipient_user_id is null and status = 'pending' from public.studyos_share_invites where recipient_email = 'nessuno@test.local'));
select pg_temp.expect('U5 invito accettato e invito via link intatti',
  (select count(*) from public.studyos_share_invites
    where (status = 'accepted' and accepted_by = :'bea') or (recipient_email is null and status = 'pending')) = 2);

-- Nomi presi dalla parte dell'email prima della @: diventano «Studente»; i nomi veri restano.
select pg_temp.expect('U6 nomi dei membri', (select string_agg(display_name, ',' order by user_id)
  from public.studyos_group_members where group_id = 'gruppo vecchio 1') = 'Studente,Studente,Bruno');
select pg_temp.expect('U6 nome del proprietario nel gruppo',
  (select owner_display_name from public.studyos_groups where id = 'gruppo vecchio 1') = 'Studente'
  and (select owner_display_name from public.studyos_groups where id = 'group_normale') = 'Olga');
select pg_temp.expect('U6 nome nell''invito legato', (select from_display_name from public.studyos_group_invites where id = 'groupInvite_old_a') = 'Studente');
select pg_temp.expect('U6 nome nella risorsa e nell''attività',
  (select added_by_display_name from public.studyos_group_resources where id = 'res_old_1') = 'Studente'
  and (select actor_display_name from public.studyos_group_activity where id = 'act_old_1') = 'Studente');
select pg_temp.expect('U6 nomi nelle condivisioni dirette',
  not exists (select 1 from public.studyos_shares where owner_name = 'owner' or grantee_name = 'bea')
  and (select count(*) from public.studyos_shares where owner_name = 'Studente' and grantee_name = 'Studente') = 2);
select pg_temp.expect('U6 nomi negli inviti di condivisione',
  not exists (select 1 from public.studyos_share_invites where owner_name = 'owner'));

-- Gruppi e dati personali: nessuna riga persa o cambiata.
select pg_temp.expect('U7 tre gruppi, id e nome lungo intatti',
  (select count(*) from public.studyos_groups) = 3
  and (select char_length(name) from public.studyos_groups where id = 'group_lungo') = 132
  and exists (select 1 from public.studyos_groups where id = 'gruppo vecchio 1'));
select pg_temp.expect('U8 elementi personali intatti (anche il file incorporato, che sposta il client)',
  (select count(*) from public.studyos_items) = 3
  and (select payload ->> 'dataUrl' from public.studyos_items where entity_id = 'att_old_1') = 'data:application/pdf;base64,JVBERi0='
  and (select deleted from public.studyos_items where entity_id = 'task_old_2'));
select pg_temp.expect('U8 nessuna iscrizione push e nessun promemoria creati dall''aggiornamento',
  (select count(*) from public.studyos_push_subscriptions) = 0 and (select count(*) from public.studyos_push_reminders) = 0);

-- Prove come account autenticati, sui dati di prima.
select id as a_share_invite from public.studyos_share_invites where recipient_email = 'a@test.local' \gset
set local role authenticated;

-- A vede e accetta l'invito di gruppo migrato: entra senza email, con il nome mandato dall'app.
select set_config('request.jwt.claim.sub', :'a', true) \g /dev/null
select pg_temp.expect('P1 A vede l''invito migrato', (select count(*) from public.studyos_group_invites where recipient_user_id = :'a' and status = 'pending') = 1);
select pg_temp.expect('P1 A accetta l''invito migrato', pg_temp.error_of($$select public.accept_group_invite('groupInvite_old_a', 'Ada')$$) is null);
select pg_temp.expect('P1 A è membro, senza email',
  (select email is null and display_name = 'Ada' from public.studyos_group_members where group_id = 'gruppo vecchio 1' and user_id = :'a'));
-- A accetta l'invito di condivisione migrato senza token.
select pg_temp.expect('P2 A accetta l''invito di condivisione migrato senza token',
  pg_temp.error_of(format('select public.accept_share_invite(%L::uuid, null, %L, %L::jsonb)', :'a_share_invite', 'Ada', '[]')) is null);

-- Olga modifica il gruppo con il nome lungo senza cambiarlo (anche con l'upsert dell'app); un nome
-- nuovo oltre 120 caratteri è respinto con il messaggio dell'app.
select set_config('request.jwt.claim.sub', :'olga', true) \g /dev/null
-- (Una istruzione per la modifica e una per il controllo: la lettura nella stessa istruzione non la vedrebbe.)
select pg_temp.expect('P3 gruppo con il nome lungo: modifica senza cambiare il nome',
  pg_temp.error_of($$update public.studyos_groups set description = 'Nuova descrizione' where id = 'group_lungo'$$) is null);
select pg_temp.expect('P3 la modifica è salvata',
  (select description from public.studyos_groups where id = 'group_lungo') = 'Nuova descrizione');
select pg_temp.expect('P3 upsert dell''app con lo stesso nome lungo',
  pg_temp.error_of(format($f$insert into public.studyos_groups (id, name, owner_id, owner_display_name, invite_code, description)
    values ('group_lungo', %L, %L, 'Olga', 'OLD-CODE-0003', 'Ancora') on conflict (id) do update set description = excluded.description$f$,
    (select name from public.studyos_groups where id = 'group_lungo'), :'olga')) is null);
select pg_temp.expect('P3 nome nuovo oltre 120 caratteri respinto',
  pg_temp.error_of(format('update public.studyos_groups set name = %L where id = %L', repeat('x', 121), 'group_lungo'))
    = 'Il nome del gruppo può avere al massimo 120 caratteri.');
select pg_temp.expect('P3 nome nuovo corto accettato',
  pg_temp.error_of($$update public.studyos_groups set name = 'Farmacologia' where id = 'group_lungo'$$) is null);

-- Gruppo con l'id con lo spazio: membri, inviti e lettura funzionano; la riga del gruppo non si può più
-- modificare (vincolo «not valid» sull'id, comportamento accettato: NEW-8 nel registro delle revisioni).
select pg_temp.expect('P4 il gruppo con l''id vecchio si legge con i suoi membri',
  (select count(*) from public.studyos_group_members where group_id = 'gruppo vecchio 1') = 4);
select pg_temp.expect('P4 modifica della riga del gruppo con l''id vecchio: respinta dal vincolo (accettato)',
  pg_temp.error_of($$update public.studyos_groups set description = 'x' where id = 'gruppo vecchio 1'$$) like '%studyos_groups_id_shape%');

-- Bea, nel gruppo vecchio, non legge email di nessuno.
select set_config('request.jwt.claim.sub', :'bea', true) \g /dev/null
select pg_temp.expect('P5 Bea vede i membri senza email',
  (select count(*) from public.studyos_group_members where group_id = 'gruppo vecchio 1' and email is null) = 4);

reset role;
select pg_temp.expect('P2 condivisione di A senza email, nome dall''app',
  (select grantee_email is null and grantee_name = 'Ada' from public.studyos_shares where owner_id = :'olga' and grantee_user_id = :'a'));
rollback;
