# Promemoria con l'app chiusa

I promemoria degli eventi (lezioni, esami, appelli: tutti eventi del calendario; i task non
hanno promemoria) arrivano come notifica push anche quando nessuna scheda di StudyOS è aperta,
su ogni dispositivo dell'account con le notifiche attive. Con una scheda aperta la notifica resta
una sola.

## Percorso

1. **Client** (`src/lib/pushReminderSync.ts`, caricato con `import()` dal watcher dei
   promemoria, mai nel bundle iniziale). Con un account e almeno un dispositivo con le notifiche
   attive calcola i promemoria dei prossimi 7 giorni (`pushReminderRows` in
   `src/lib/pushReminders.ts`, la stessa pianificazione della scheda aperta: `planReminders`),
   li confronta con le righe ancora da mandare sul server e scrive solo le differenze, a pezzi
   (upsert da 100, cancellazioni da 50), 4 s dopo l'ultima modifica e ogni 30 minuti. Ospite:
   niente. Interruttore spento o nessun dispositivo: le righe in attesa si tolgono.
2. **Tabella** `public.studyos_push_reminders` (`supabase/push-reminders.sql`), chiave
   `(user_id, id)`, RLS solo per l'account stesso. Vincoli: `fire_at` entro 14 giorni (oltre:
   errore; già passato da oltre 30 minuti: riga ignorata), al più 300 righe in attesa per
   account, titolo 1–120 caratteri, testo ≤ 400, `url` solo `?apri=…`, `id` e `tag` ASCII ≤ 200.
3. **Job** `studyos_push_due_reminders()` (security definer, chiusa ai client) ogni minuto con
   `pg_cron` (job `studyos-push-reminders`): prende le righe scadute non mandate (al più 10 per
   account e 500 per giro), salta quelle in ritardo di oltre 30 minuti, toglie quelle di oltre un
   giorno, e per ogni promemoria manda al Worker `/push` (tipo `reminder`, `pg_net`, segreto dal
   Vault) le iscrizioni di **quell'account soltanto**. Senza `pg_net`, Vault o segreti non manda
   niente e non segna niente.
4. **Worker** `POST /push`: stesso percorso di inviti e permessi (vedi
   [agent-mcp.md](agent-mcp.md#notifiche-push-route-push-del-worker)).
5. **Service worker** (`public/sw.js`): mostra la notifica; il tocco apre `?apri=calendario`.

## Niente doppioni

- Stesso tag sui due percorsi: `studyos-reminder-<chiave>` (`reminderTagOf`). Se la scheda
  aperta e la push mostrano lo stesso promemoria, il sistema tiene una notifica sola.
- La scheda aperta segna `sent_at` sulla riga (`markReminderShown`) solo dopo aver mostrato una
  notifica di sistema vera: un avviso solo nella campanella di una scheda dimenticata non deve
  togliere la push al telefono.
- Il confronto con il server parte solo dopo un giro completo della sync in questa pagina
  (`status` `idle` e `lastSync` dopo l'apertura della pagina): con dati locali vecchi il client
  toglierebbe le righe appena scritte da un altro dispositivo.

## Fine della sessione

- `turnOffPushHere()` (`src/lib/pushDevice.ts`) è l'unico modo di spegnere le notifiche del
  dispositivo prima di un'uscita o di una cancellazione: «Esci», «Esci e togli i dati», «Ho
  dimenticato la password», «Cancella tutti i dati» (tutti e tre i modi). Annulla l'iscrizione
  del browser e toglie la sua riga finché la sessione c'è ancora (al più 5 s, non lancia mai).
- `startPushSessionGuard` (avviato da `App`) segue la sessione che finisce da sola: scaduta,
  revocata, uscita da un'altra scheda o dispositivo, altro account. Se le notifiche erano
  dell'account uscito, l'iscrizione del browser si annulla (`dropPushOfEndedSession`); la riga
  sul server la toglie `push_gone` alla prima notifica respinta.
- «Cancella tutti i dati» dall'account toglie anche le righe dei promemoria
  (`erase_studyos_account_items` in `schema.sql` e `clearPushReminders` nel client).

## Impostazioni

Impostazioni → Notifiche: «Promemoria con l'app chiusa», per tutto l'account
(`preferences.pushReminders`, assente = acceso). Spento: i promemoria arrivano solo con StudyOS
aperto.

## Privacy

Titolo dell'evento e quando: gli stessi dati già in `studyos_items` sotto RLS; il contenuto
della push è cifrato fino al dispositivo (RFC 8291) e il Worker registra solo conteggi. Con il
vault dell'app bloccato la notifica mostra comunque il titolo sulla schermata di blocco del
sistema: chi non lo vuole spegne l'interruttore.

## Attivazione

Passi in [supabase/README.md](../supabase/README.md) (sezione «Promemoria con l'app chiusa»):
notifiche push già attive (`pg_net`, Vault, Worker), `pg_cron`, `push-reminders.sql`,
`schema.sql` di nuovo, `push-reminders-verify.sql` tutto verde, deploy del Worker (tipo
`reminder`).

## Test

- `tests/pushReminders.test.mjs`: righe, chiavi, diff, fusi orari (Europe/Rome, cambi
  dell'ora legale, tutto il giorno, serie ripetute), collegamenti nel sorgente.
- `tests/pushDevice.test.mjs`: `turnOffPushHere`, guardia della sessione, ogni chiamante.
- `tests/pushRoute.test.mjs`: tipo `reminder`, lotto pieno al limite, endpoint strani scartati.
- SQL: da provare su un Postgres temporaneo con stub di `pg_net`, Vault e `pg_cron` (mai sul
  progetto reale).
