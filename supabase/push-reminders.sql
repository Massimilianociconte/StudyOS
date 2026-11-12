-- StudyOS: promemoria con l'app chiusa (notifiche push dei promemoria degli eventi). Opzionale.
--
-- Da eseguire nel SQL Editor DOPO schema.sql, groups.sql, sharing.sql e people.sql, come un unico
-- script. Rieseguibile: la tabella e le sue righe restano, funzioni, policy, trigger e job si
-- aggiornano. Controllo: push-reminders-verify.sql.
--
-- Come funziona: l'app (src/lib/pushReminderSync.ts) scrive in studyos_push_reminders i promemoria
-- dei prossimi 7 giorni di chi ha le notifiche attive su almeno un dispositivo. Ogni minuto pg_cron
-- chiama studyos_push_due_reminders(): prende le righe scattate, chiama il Worker POST /push con
-- pg_net e i segreti in Vault (gli stessi di people.sql) e le segna come mandate. Una scheda aperta
-- che mostra il promemoria segna la riga come mandata: niente doppioni (e lo stesso tag della
-- notifica fa vedere una notifica sola se partono tutte e due).
--
-- Senza pg_cron, pg_net o i segreti non parte nessuna push e tutto il resto funziona; le righe
-- scadute dopo mezz'ora si segnano come saltate. Vedi supabase/README.md.

do $$
begin
  if to_regclass('public.studyos_items') is null then
    raise exception 'Esegui prima supabase/schema.sql';
  end if;
  if to_regclass('public.studyos_push_subscriptions') is null then
    raise exception 'Esegui prima supabase/people.sql';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public'
    and table_name = 'studyos_push_subscriptions' and column_name = 'private') then
    raise exception 'Riesegui prima supabase/people.sql (revisione del 12/11/2026: colonne session_id e private)';
  end if;
end $$;

-- ─── Tabella ────────────────────────────────────────────────────────────────

-- Un promemoria da mandare. id deterministico (tipo + evento + occorrenza + promemoria + istante,
-- vedi src/lib/pushReminders.ts): due dispositivi dello stesso account scrivono la stessa riga.
-- Chiave primaria per account: l'id di un altro account non si tocca né si blocca.
create table if not exists public.studyos_push_reminders (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null,
  fire_at timestamptz not null,
  title text not null,
  body text not null default '',
  url text not null default '?apri=calendario',
  tag text not null,
  sent_at timestamptz,
  skipped boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

-- Fuso del dispositivo che ha scritto la riga (l'ora nel testo è in quel fuso): un dispositivo in
-- un altro fuso non la riscrive solo per l'ora formattata diversamente (src/lib/pushReminders.ts).
alter table public.studyos_push_reminders add column if not exists zone text;

-- Stessi limiti del Worker (titolo 120, testo 400, url ?apri=…, tag ASCII senza spazi fino a 200).
alter table public.studyos_push_reminders drop constraint if exists studyos_push_reminders_values_check;
alter table public.studyos_push_reminders add constraint studyos_push_reminders_values_check
  check (
    id ~ '^[!-~]{1,200}$'
    and char_length(title) between 1 and 120
    and btrim(title) <> ''
    and char_length(body) <= 400
    and url ~ '^[?]apri=[a-z]{1,30}$'
    and tag ~ '^[!-~]{1,200}$'
    and (zone is null or zone ~ '^[A-Za-z0-9_+/-]{1,64}$')
  );

-- Righe in attesa per istante: le legge il job ogni minuto.
create index if not exists studyos_push_reminders_due_idx
  on public.studyos_push_reminders (fire_at) where sent_at is null;

-- Promemoria mandati nell'ultima ora per account (tetto orario del job). Separato dalle righe: un
-- client che cancella e riscrive le proprie righe non azzera il conto. Nessuna policy né privilegio:
-- lo tocca solo studyos_push_due_reminders.
create table if not exists public.studyos_push_reminder_sends (
  user_id uuid not null,
  at timestamptz not null default now()
);
create index if not exists studyos_push_reminder_sends_user_idx
  on public.studyos_push_reminder_sends (user_id, at);
alter table public.studyos_push_reminder_sends enable row level security;
revoke all on table public.studyos_push_reminder_sends from public, anon, authenticated;

-- ─── RLS e privilegi ────────────────────────────────────────────────────────

alter table public.studyos_push_reminders enable row level security;
revoke all on table public.studyos_push_reminders from public, anon, authenticated;
grant select, insert, update, delete on table public.studyos_push_reminders to authenticated;

drop policy if exists studyos_push_reminders_select on public.studyos_push_reminders;
create policy studyos_push_reminders_select on public.studyos_push_reminders for select to authenticated
  using (user_id = (select auth.uid()));
drop policy if exists studyos_push_reminders_insert on public.studyos_push_reminders;
create policy studyos_push_reminders_insert on public.studyos_push_reminders for insert to authenticated
  with check (user_id = (select auth.uid()));
drop policy if exists studyos_push_reminders_update on public.studyos_push_reminders;
create policy studyos_push_reminders_update on public.studyos_push_reminders for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists studyos_push_reminders_delete on public.studyos_push_reminders;
create policy studyos_push_reminders_delete on public.studyos_push_reminders for delete to authenticated
  using (user_id = (select auth.uid()));

-- ─── Controlli in scrittura ─────────────────────────────────────────────────

-- - fire_at al più 14 giorni avanti (l'app ne scrive 7); più indietro di mezz'ora: riga ignorata
--   in silenzio (orologio del dispositivo indietro), non verrebbe comunque mandata;
-- - al più 400 righe per account, mandate comprese (le nuove oltre il tetto sono rifiutate): una riga
--   cancellata e riscritta è una riga nuova e passa solo sotto il tetto;
-- - fire_at non cambia (l'istante fa parte dell'id: un promemoria spostato è una riga nuova);
-- - una riga mandata o saltata resta tale: nessun client la rimette in coda (sent_at non torna null);
-- - una riga nuova è sempre "da mandare"; user_id non cambia; updated_at lo scrive il server.
create or replace function public.studyos_push_reminders_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_total integer;
begin
  new.updated_at := now();
  if tg_op = 'UPDATE' then
    new.user_id := old.user_id;
    new.fire_at := old.fire_at;
    if old.sent_at is not null then
      new.sent_at := old.sent_at;
      new.skipped := old.skipped;
    end if;
    return new;
  end if;

  if new.fire_at > now() + interval '14 days' then
    raise exception 'Promemoria oltre 14 giorni' using errcode = '22023';
  end if;
  if new.fire_at < now() - interval '30 minutes' then
    return null;
  end if;
  new.sent_at := null;
  new.skipped := false;
  -- Il tetto conta solo le righe nuove (un upsert di una riga esistente non aggiunge nulla). Il
  -- lucchetto per account evita che due scritture insieme lo superino.
  if not exists (select 1 from public.studyos_push_reminders r where r.user_id = new.user_id and r.id = new.id) then
    perform pg_advisory_xact_lock(hashtextextended('studyos_push_reminders:' || new.user_id::text, 0));
    select count(*) into v_total from public.studyos_push_reminders r where r.user_id = new.user_id;
    if v_total >= 400 then
      raise exception 'Troppi promemoria (al massimo 400 per account)' using errcode = '54000';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists studyos_push_reminders_guard on public.studyos_push_reminders;
create trigger studyos_push_reminders_guard
before insert or update on public.studyos_push_reminders
for each row execute function public.studyos_push_reminders_guard();

-- ─── Invio dei promemoria scattati ──────────────────────────────────────────

-- Chiamata da pg_cron ogni minuto (mai dai client). Restituisce quanti promemoria ha passato al Worker.
-- 1. Le righe scattate da più di mezz'ora e mai mandate (cron fermo, push spente) diventano
--    "saltate": un promemoria in ritardo non serve. Le righe passate da più di un giorno si tolgono.
-- 2. Senza pg_net o senza i segreti in Vault si ferma qui: le righe restano in attesa.
-- 3. Prende le righe scattate, a turno tra gli account (prima il primo promemoria di ogni account,
--    poi il secondo…), al più 10 per account e giro, al più 60 per account all'ora, 500 in tutto:
--    un account con molte righe non fa arrivare in ritardo (e saltare) quelle degli altri. Le segna
--    come mandate nella stessa istruzione (una scheda che le segna insieme aspetta e poi non trova
--    più niente) e per ognuna chiama il Worker con le iscrizioni di quell'account soltanto: una
--    richiesta per promemoria, account e tipo di testo, al più 40 iscrizioni (il Worker ne accetta 49).
--    I dispositivi con la password dell'app (private) ricevono «Promemoria StudyOS» al posto del titolo.
--    Ogni iscrizione porta l'account: il service worker non mostra le push di un altro account.
-- pg_net spedisce solo dopo il commit. Qualsiasi errore: avviso nel log e nessuna riga toccata.
create or replace function public.studyos_push_due_reminders()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_secret text;
  v_url text;
  v_row record;
  v_batch jsonb;
  v_private boolean;
  v_sent integer := 0;
begin
  -- Un solo giro alla volta (pg_cron non ne sovrappone due, una chiamata a mano sì).
  if not pg_try_advisory_xact_lock(hashtextextended('studyos_push_due_reminders', 0)) then
    return 0;
  end if;
  begin
    update public.studyos_push_reminders
      set sent_at = now(), skipped = true
      where sent_at is null and fire_at < now() - interval '30 minutes';
    delete from public.studyos_push_reminders where fire_at < now() - interval '1 day';
    delete from public.studyos_push_reminder_sends where at < now() - interval '1 hour';

    if not exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'net' and p.proname = 'http_post'
    ) or to_regclass('vault.decrypted_secrets') is null then
      return 0;
    end if;
    select s.decrypted_secret into v_secret from vault.decrypted_secrets s
    where s.name = 'studyos_push_secret' order by s.created_at desc limit 1;
    select s.decrypted_secret into v_url from vault.decrypted_secrets s
    where s.name = 'studyos_push_url' order by s.created_at desc limit 1;
    if coalesce(v_secret, '') = '' or coalesce(v_url, '') !~ '^https?://' then
      return 0;
    end if;

    for v_row in
      with used as (
        select l.user_id, count(*) as n
        from public.studyos_push_reminder_sends l
        where l.at > now() - interval '1 hour'
        group by l.user_id
      ),
      due as (
        select d.user_id, d.id
        from (
          select r.user_id, r.id, r.fire_at,
            row_number() over (partition by r.user_id order by r.fire_at, r.id) as rn
          from public.studyos_push_reminders r
          where r.sent_at is null and r.fire_at <= now()
        ) as d
        left join used u on u.user_id = d.user_id
        where d.rn <= least(10, 60 - coalesce(u.n, 0))
        order by d.rn, d.fire_at, d.user_id, d.id
        limit 500
      )
      update public.studyos_push_reminders as t
        set sent_at = now(),
            skipped = not exists (select 1 from public.studyos_push_subscriptions s where s.user_id = t.user_id)
        from due
        where t.user_id = due.user_id and t.id = due.id and t.sent_at is null
        returning t.user_id, t.id, t.title, t.body, t.url, t.tag, t.skipped
    loop
      continue when v_row.skipped;
      insert into public.studyos_push_reminder_sends (user_id) values (v_row.user_id);
      for v_batch, v_private in
        select jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth, 'account', s.user_id) order by s.rn),
          s.private
        from (
          select sub.endpoint, sub.p256dh, sub.auth, sub.user_id, sub.private,
            row_number() over (partition by sub.private order by sub.last_seen_at desc, sub.id) as rn
          from public.studyos_push_subscriptions sub
          where sub.user_id = v_row.user_id
        ) as s
        group by s.private, (s.rn - 1) / 40
        order by s.private, (s.rn - 1) / 40
      loop
        perform net.http_post(
          url := v_url,
          body := jsonb_build_object(
            'notification', jsonb_build_object(
              'kind', 'reminder',
              'title', case when v_private then 'Promemoria StudyOS'
                else left(coalesce(nullif(btrim(v_row.title), ''), 'Promemoria'), 120) end,
              'body', left(coalesce(v_row.body, ''), 400),
              'url', case when v_row.url ~ '^[?]apri=[a-z]{1,30}$' then v_row.url else '?apri=calendario' end,
              'tag', left(v_row.tag, 200)
            ),
            'subscriptions', v_batch
          ),
          params := '{}'::jsonb,
          headers := jsonb_build_object('content-type', 'application/json', 'x-studyos-push-secret', v_secret),
          timeout_milliseconds := 15000
        );
      end loop;
      v_sent := v_sent + 1;
    end loop;
  exception when others then
    raise warning 'studyos_push_due_reminders: %', sqlerrm;
    return 0;
  end;
  return v_sent;
end;
$$;

revoke all on function public.studyos_push_due_reminders() from public, anon, authenticated;
revoke all on function public.studyos_push_reminders_guard() from public, anon, authenticated;

-- ─── Ogni minuto con pg_cron ────────────────────────────────────────────────

-- pg_cron si attiva dal Dashboard (Database → Extensions → pg_cron), poi si riesegue questo script.
-- Senza pg_cron lo script va a buon fine e push-reminders-verify.sql segnala cron_ready = false.
do $$
begin
  if to_regprocedure('cron.schedule(text,text,text)') is null or to_regclass('cron.job') is null then
    raise notice 'pg_cron non attivo: i promemoria con l''app chiusa partiranno dopo averlo attivato e rieseguito questo script';
    return;
  end if;
  execute 'select cron.unschedule(j.jobid) from cron.job j where j.jobname = $1' using 'studyos-push-reminders';
  execute 'select cron.schedule($1, $2, $3)'
    using 'studyos-push-reminders', '* * * * *', 'select public.studyos_push_due_reminders()';
exception when others then
  raise notice 'pg_cron: job dei promemoria non programmato: %', sqlerrm;
end $$;
