# Promemoria con l'app chiusa

I promemoria degli eventi (lezioni, esami, appelli: tutti eventi del calendario; i task non
hanno promemoria) arrivano come notifica push anche quando nessuna scheda di StudyOS è aperta,
su ogni dispositivo dell'account con le notifiche attive. Su ogni dispositivo compare **una
notifica per promemoria**, in qualunque ordine arrivino push e scheda aperta.

## Percorso

1. **Client** (`src/lib/pushReminderSync.ts`, caricato con `import()` dal watcher dei
   promemoria, mai nel bundle iniziale). Con un account e almeno un dispositivo con le notifiche
   attive calcola i promemoria dei prossimi 7 giorni (`pushReminderRows` in
   `src/lib/pushReminders.ts`, la stessa pianificazione della scheda aperta: `planReminders`),
   li confronta con le righe ancora da mandare sul server e scrive solo le differenze, a pezzi
   (upsert da 100, cancellazioni da 50), 4 s dopo l'ultima modifica e ogni 30 minuti. Ospite:
   niente. Interruttore spento o nessun dispositivo: le righe in attesa si tolgono.
2. **Tabella** `public.studyos_push_reminders` (`supabase/push-reminders.sql`), chiave
   `(user_id, id)`, RLS solo per l'account stesso. Vincoli (trigger `studyos_push_reminders_guard`):
   - `fire_at` entro 14 giorni (oltre: errore; già passato da oltre 30 minuti: riga ignorata);
   - **al più 400 righe per account, contando anche quelle già mandate** (restano fino a un giorno
     dopo l'istante): oltre, errore `54000`. Una riga cancellata libera il posto;
   - un client **non sposta** una riga (`fire_at` resta quello dell'inserimento: l'id contiene già
     l'istante) e **non la rimette in coda** (`sent_at` e `skipped` di una riga mandata restano);
   - titolo 1–120 caratteri, testo ≤ 400, `url` solo `?apri=…`, `id` e `tag` ASCII ≤ 200,
     `zone` (fuso di chi scrive) IANA o vuoto.
3. **Job** `studyos_push_due_reminders()` (security definer, chiusa ai client) ogni minuto con
   `pg_cron` (job `studyos-push-reminders`):
   - salta le righe in ritardo di oltre 30 minuti, toglie quelle di oltre un giorno;
   - **a turno tra gli account**: prima il primo promemoria di ogni account, poi il secondo… (al
     più 10 per account e 500 per giro), così pochi account pieni non fanno slittare gli altri
     oltre i 30 minuti;
   - **al più 60 promemoria mandati all'ora per account** (registro
     `studyos_push_reminder_sends`, chiuso ai client, che resta anche dopo una cancellazione): gli
     altri aspettano il giro dopo (e oltre i 30 minuti si saltano);
   - per ogni promemoria manda al Worker `/push` (tipo `reminder`, `pg_net`, segreto dal Vault)
     le iscrizioni di **quell'account soltanto**, ognuna con il suo `account`. Una richiesta per
     tipo di testo: i dispositivi con `private` ricevono «Promemoria StudyOS» e l'ora, gli altri
     il titolo. Senza `pg_net`, Vault o segreti non manda niente e non segna niente.
4. **Worker** `POST /push`: stesso percorso di inviti e permessi (vedi
   [agent-mcp.md](agent-mcp.md#notifiche-push-route-push-del-worker)); mette l'`account`
   dell'iscrizione nel messaggio cifrato di quel dispositivo.
5. **Service worker** (`public/sw.js`): mostra la notifica; il tocco apre `?apri=calendario`.

## Niente doppioni

Pagina e service worker dello stesso dispositivo condividono una piccola cache
(`studyos-push-local-v1`, Cache Storage, `src/lib/pushLocal.ts`; il service worker non legge
localStorage). L'`activate` del service worker non la cancella.

- **Push prima**: il service worker mostra il promemoria e ricorda il tag (`by=push`). La scheda
  aperta dopo (tocco sulla notifica, app aperta entro 30 minuti) lo ritrova e mette solo la voce
  nella campanella, senza una seconda notifica di sistema.
- **Scheda aperta prima**: mostra la notifica e ricorda il tag (`by=page`). Se arriva anche la
  push (stesso tag `studyos-reminder-<chiave>`), il service worker la mostra in silenzio
  (`silent`) e la sostituisce: resta una notifica sola. Deve mostrare qualcosa: le push sono
  `userVisibleOnly`.
- **`sent_at` dalla scheda**: la scheda segna la riga (`markReminderShown`) solo se ha mostrato
  una notifica di sistema vera **e** la scheda è in uso (`visibilityState === "visible"` e
  `document.hasFocus()`). Una scheda dimenticata aperta su un computer non toglie il promemoria
  al telefono: lì arriva la push, e sul computer la push sostituisce la notifica in silenzio.
- Il confronto con il server parte solo quando i dati nello store sono dell'account della
  sessione e aggiornati (`reminderSyncReady`): sync ferma, nessuna scelta «ask» aperta tra i dati
  di due account, e un giro di sync finito **dopo** che questo account è diventato quello della
  sessione (il primo account visto: dopo l'apertura della pagina). Dopo un cambio di account il
  `lastSync` salvato del nuovo account non basta. Prima di ogni scrittura si ricontrolla che la
  sessione sia ancora dello stesso account.

## Dispositivi in fusi diversi

Ogni riga porta `zone`, il fuso del dispositivo che l'ha scritta (il testo «Oggi alle 09:00» è
nella sua ora). Scelta: **resta la riga di chi ha scritto per primo, finché è giusta per il suo
fuso**.

- Evento con un fuso suo (quasi tutti: il fuso si salva alla creazione): stesso istante e stesso
  id ovunque. Un dispositivo in un altro fuso non riscrive la riga per il testo: rifà il testo
  nel fuso della riga (`reminderTextIn`) e lo confronta.
- Evento senza fuso suo (vecchi, «tutto il giorno» senza fuso, «alle 20:00»): l'istante dipende
  dall'orologio. La riga scritta in un altro fuso copre lo stesso promemoria (stesso evento,
  occorrenza e regola: `reminderSlotOf`) se è ancora quella che un dispositivo in quel fuso
  scriverebbe (`pushReminderRows(…, { zone })`); allora non si scrive la propria. Il promemoria
  scatta all'ora di quel fuso.
- Una riga non più giusta (evento cambiato o cancellato) si toglie o si sostituisce una volta;
  l'altro dispositivo poi trova la nuova riga giusta per il suo fuso e la lascia. Niente
  ping-pong. Due righe per lo stesso promemoria (versioni vecchie): ne resta una.
- Limiti noti: per un evento senza fuso, a cavallo della mezzanotte, il giorno dell'occorrenza
  può essere diverso nei due fusi e restano due righe (due notifiche a un'ora di distanza). Con la
  scheda aperta in un fuso diverso da quello della riga, la notifica della scheda (ora del
  dispositivo) e la push (ora della riga) sono due.

## Fine della sessione

- `turnOffPushHere()` (`src/lib/pushDevice.ts`) è l'unico modo di spegnere le notifiche del
  dispositivo prima di un'uscita o di una cancellazione: «Esci», «Esci e togli i dati», «Ho
  dimenticato la password», «Cancella tutti i dati» (tutti e tre i modi). Annulla l'iscrizione
  del browser e toglie la sua riga finché la sessione c'è ancora (al più 5 s, non lancia mai).
- `startPushSessionGuard` (avviato da `App`) parte sempre, anche se il permesso arriva più tardi
  nella stessa pagina; carica `push.ts` solo con il permesso o lo stato delle notifiche di questo
  dispositivo. Segue la sessione che finisce da sola: scaduta, revocata, uscita da un'altra scheda
  o dispositivo, altro account. Se le notifiche erano dell'account uscito, l'iscrizione del
  browser si annulla (`dropPushOfEndedSession`).
- **Filtro del service worker**: la guardia scrive l'account entrato nella cache condivisa
  (`writePushAccount`; `null` quando la sessione è finita). Una push con un `account` diverso da
  quello scritto (riga rimasta sul server dopo un cambio di account) mostra solo «StudyOS» /
  «Hai una nuova notifica.» con lo stesso tag (le push sono `userVisibleOnly`: una push senza
  notifica fa comparire l'avviso del browser o consuma il credito delle push silenziose). Se la
  pagina non ha mai scritto l'account (versione vecchia), si mostra tutto come prima.
- **Pulizia sul server** (`people.sql`): la riga dell'iscrizione ricorda la sessione che l'ha
  scritta (`session_id`, dal token, trigger `studyos_push_subscriptions_session`; il client non
  può sceglierla). Quando la sessione finisce (uscita, revoca, «esci ovunque») un trigger su
  `auth.sessions` toglie le sue iscrizioni. Se il progetto non permette il trigger su
  `auth.sessions`, lo script va avanti con un avviso (`session_cleanup_ready` false) e restano
  `push_gone` e «Rimuovi».
- «Cancella tutti i dati» dall'account toglie anche le righe dei promemoria
  (`erase_studyos_account_items` in `schema.sql` e `clearPushReminders` nel client).
- «Cancella tutti i dati» (ogni modo) svuota anche la cache condivisa (`resetPushLocal` in
  `resetAllData`): promemoria già mostrati e account del service worker. L'account si riscrive
  subito se resta una sessione (scelta «separa»: si resta dentro), altrimenti resta vuoto.

## Impostazioni

Impostazioni → Profilo, scheda delle notifiche:

- «Promemoria con l'app chiusa», per tutto l'account (`preferences.pushReminders`, assente =
  acceso). Spento: i promemoria arrivano solo con StudyOS aperto.
- «Mostra il titolo nelle notifiche» (solo con la password dell'app): vedi Privacy.
- «Dispositivi con le notifiche»: i dispositivi dell'account (tipo di browser dall'host
  dell'endpoint, ultimo accesso; l'endpoint non si mostra) con «Rimuovi», che toglie la riga sul
  server: il dispositivo smette subito di ricevere le notifiche dell'account, anche se è perso.
  Su questo dispositivo spegne anche l'iscrizione del browser.

## Privacy

Decisione del titolare: **con la password dell'app (vault) attiva, le notifiche dei promemoria
non mostrano il titolo**: «Promemoria StudyOS» e l'ora («Tra 15 minuti · 10:00»). L'interruttore
«Mostra il titolo nelle notifiche» (Impostazioni, per dispositivo, `settings.pushShowTitles`) lo
rimette. Senza password il titolo resta.

- Per dispositivo: la riga dell'iscrizione ha `private` (`people.sql`), scritta dal client
  (`enablePush`, `syncPushSubscription`, `updatePushPrivacy` quando cambia la scelta). Il job
  manda il testo senza titolo ai dispositivi con `private`: il titolo non lascia mai il database
  verso quei dispositivi.
- Anche la notifica di sistema della scheda aperta usa «Promemoria StudyOS»; nella campanella
  dell'app (dietro la password) il titolo resta.
- Inviti e permessi (`studyos_push_notify`, `people.sql`): il loro testo ha nomi di persone e di
  gruppi, quindi ai dispositivi con `private` va un lotto a parte con «StudyOS» e «Hai una nuova
  notifica.» (stesso link e tag); nella campanella dell'app il testo intero resta.
- Il contenuto della push è cifrato fino al dispositivo (RFC 8291) e il Worker registra solo
  conteggi.

## Attivazione

Ordine: prima il deploy del Worker (route `/push`, tipo `reminder`, `account`), poi `pg_net`,
Vault, `pg_cron` e `push-reminders.sql`. Al contrario i promemoria in scadenza verrebbero segnati
come inviati verso un Worker che non li consegna, e andrebbero persi. I passi completi sono in
[supabase/README.md](../supabase/README.md), paragrafo «Pubblicazione di questa versione»; alla fine
`push-reminders-verify.sql` e `people-verify.sql` tutto verde (`session_cleanup_ready` può restare
false).

## Test

- `tests/pushReminders.test.mjs`: righe, chiavi, diff, fusi orari (Europe/Rome, cambi
  dell'ora legale, tutto il giorno, serie ripetute), dispositivi in fusi diversi, cambio di
  account, collegamenti nel sorgente.
- `tests/swPush.test.mjs`: push prima o dopo la scheda, account diverso (testo generico, stesso
  tag), cache assente.
- `tests/pushLocal.test.mjs`: cache condivisa, titolo nascosto, dispositivi, `private`, pulizia
  della cache con «Cancella tutti i dati».
- `tests/pushDevice.test.mjs`: `turnOffPushHere`, guardia della sessione (anche con il permesso
  dato dopo), ogni chiamante.
- `tests/pushRoute.test.mjs`: tipo `reminder`, `account` per iscrizione, lotto pieno al limite,
  endpoint strani scartati.
- SQL: su un Postgres temporaneo con stub di `auth.sessions`, `pg_net`, Vault e `pg_cron` (mai
  sul progetto reale), comprese le sonde della revisione (rimessa in coda, spostamento, tetto,
  turni, tetto orario, testo privato, pulizia delle sessioni).
- `scripts/supabase/push-notify-tests.sql` (in `scratch-pg.sh`): i sei trigger di
  `studyos_push_notify` (invito al gruppo, invito alla condivisione, invito accettato, ingresso nel
  gruppo, cambio di permesso, condivisione tolta) mandano il testo generico ai dispositivi con
  `private`, lotti da 15 mai misti.
