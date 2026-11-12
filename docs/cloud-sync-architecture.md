# Sincronizzazione cloud di StudyOS

La PWA conserva i dati in IndexedDB. La sincronizzazione opzionale usa
Supabase Auth e la tabella `studyos_items` definita in `supabase/schema.sql`,
con RLS per proprietario. GitHub Pages ospita soltanto i file statici.

Prima di usare una build con questa versione del client, applica il contenuto
aggiornato di `supabase/schema.sql` nel progetto Supabase. La funzione
`push_studyos_rows` controlla e scrive ogni versione nella stessa operazione
SQL; se manca, il client segnala errore e conserva le modifiche in coda.

Le variabili pubbliche della build sono `VITE_SUPABASE_URL` e
`VITE_SUPABASE_PUBLISHABLE_KEY`. La chiave `service_role` non deve entrare nel
frontend. Ogni modifica locale crea una voce in `syncOutbox`; il servizio
`src/lib/cloudSync.ts` invia le righe, scarica le modifiche con un cursore
`updated_at` e le fonde per entità. I tombstone propagano le eliminazioni;
realtime segnala che è utile fare un pull, con un controllo periodico di
riserva. Un errore di invio lascia la voce in coda e viene ritentato.
Il server respinge una versione più vecchia rispetto a quella già salvata;
il client rilegge la riga in conflitto. Un batch troppo grande viene isolato,
così le altre modifiche continuano a partire. I file dei materiali non passano
dalle righe: vanno nel bucket privato `studyos-files` di Supabase Storage (fino a 25 MB,
`supabase/storage.sql`) tramite `src/lib/attachmentSync.ts`, con una copia locale finché
non sono caricati; la riga porta solo `storedFile`. Vedi
[superpowers/specs/2026-11-12-attachments-storage-design.md](superpowers/specs/2026-11-12-attachments-storage-design.md).

Al primo collegamento e quando cambia account viene eseguito un pull completo.
Il cambio account con dati sul dispositivo ferma la sync finché nel pannello
Account non si sceglie «Mostra solo i dati di questo account» (consigliato) o
«Aggiungi i dati di prima»: senza una scelta esplicita non si unisce mai. Il vault bloccato
sospende la sync; prima di bloccarlo le modifiche devono essere salvate.
Un cambio account con modifiche ancora in coda viene fermato finché l'account
precedente non completa la sincronizzazione, per non perdere i tombstone.
Un reset solo locale forza un nuovo pull dal cloud; un reset propagato crea
tombstone e li invia quando la connessione è disponibile.

**Limite di privacy attuale:** il vault cifra lo snapshot in IndexedDB e i
backup possono essere cifrati, ma la sync Supabase invia il payload JSON in
chiaro (`encrypted: false`). Le policy RLS controllano l'accesso; non c'è
ancora cifratura end-to-end del cloud. La UI lo segnala esplicitamente.

Garanzie aggiuntive (revisione del 28 settembre 2026):

- con il vault bloccato o durante il caricamento lo stato in memoria è vuoto: la
  sync si sospende (niente pull applicati, cursore fermo, nessuna voce dell'outbox
  trasformata in eliminazione) e riparte allo sblocco;
- una voce "put" senza entità in memoria non diventa mai un tombstone;
- il primo collegamento di un nuovo dispositivo non ricarica le entità appena
  scaricate (prima veniva re-inviato l'intero dataset, allegati compresi);
- il ripristino di un backup assegna `updatedAt` = adesso alle entità cambiate,
  altrimenti il server (LWW) le rifiuterebbe e il pull annullerebbe il ripristino;
- richieste Supabase con timeout di 30 s; errori di rete mostrati in italiano;
- il logout funziona anche offline (la sessione viene rimossa dal dispositivo);
- supabase-js e il motore di sync sono caricati dopo l'avvio (bundle iniziale ~50 KB gz più leggero).

Verifica end-to-end eseguita con stack Supabase locale (CLI, Postgres 17 + Auth +
Realtime) e due origini browser come due dispositivi: upload iniziale di dati
creati prima del login, merge bidirezionale, realtime, eliminazioni, modifica
durante un'interruzione del server + reload + recupero automatico, vault
bloccato durante modifiche remote, ripristino backup, logout offline. Lo schema
è stato provato anche sull'immagine Postgres ufficiale Supabase: LWW, retry
idempotente, id incoerente rifiutato, RLS tra utenti, `anon` senza accesso.

Preferenze personali e nuovi tipi di entità (29 settembre 2026):

- nome, foto, obiettivo di ore settimanali, CFU del corso e visibilità della
  sezione BARB sono un'entità `preferences` (id `main`) sincronizzata come le
  altre: seguono l'account e non il dispositivo. Il vecchio profilo salvato
  nelle impostazioni locali viene migrato una volta e poi svuotato, così un
  cambio account non mostra il nome dell'account precedente;
- una build precedente scarta i tipi di entità che non conosce ma fa avanzare
  il cursore. `SYNC_SCHEMA` in `cloudSync.ts` va incrementato ogni volta che si
  aggiunge un tipo: al primo avvio della nuova build il pull riparte da zero
  (merge LWW normale) e recupera le righe saltate;
- nessuna modifica allo schema SQL: `entity_type` è testo libero.

Verifica end-to-end (stack Supabase locale, due origini browser): preferenze,
voti del libretto, intervalli di ripasso ed eventi importati da .ics arrivano
all'altro dispositivo; le modifiche remote arrivano in realtime; un evento
reimportato con lo stesso UID viene aggiornato, non duplicato; con
`cloud:schema` riportato a 1 il client recupera un'entità mancante.

Correzioni di novembre 2026 (sync personale):

- attivare o togliere la password del dispositivo riscrive le tabelle con ciò
  che è già su disco (`persistedCollections()`), dentro la stessa operazione
  esclusiva che cambia modalità. Le modifiche arrivate nel frattempo (pull dal
  cloud, sessione del Pomodoro) restano in memoria e le salva il passo dopo,
  già nella nuova modalità; prima venivano sovrascritte da una copia presa
  prima dell'attesa e il cursore cloud le saltava (P8);
- bloccare il vault a metà pull non fa più avanzare il cursore: se il blocco
  svuota la memoria con modifiche non ancora scritte, `requestPersist()`
  rifiuta con `PersistenceDiscardedError` invece di «riuscire» senza scrivere.
  Il merge ricontrolla il workspace dopo la lettura della coda e dopo aver
  applicato le righe, e prima di scrivere cursore e `merged`; anche le
  scritture dell'outbox si annullano con il vault bloccato (P9);
- «Svuota dispositivo» segna uno svuotamento (`noteLocalReset`, anche dentro
  `clearAllLocalData`). Ogni passata prende la sua guardia dopo `bindUser` e
  la controlla subito prima di scrivere cursore, `merged`, `migrated`, schema
  e ultima sync: una prima sync in volo non riscrive più i segni appena tolti
  (il dispositivo restava vuoto). La passata si interrompe senza errore e
  riparte da zero (P10);
- senza Web Locks (più schede attive insieme) una scheda rimasta indietro non
  toglie più la voce accodata da un'altra: le voci portano chi le ha scritte
  (`writer`) e, senza vault, per quelle di un'altra pagina si invia la copia
  più recente tra memoria e disco. Col vault su disco c'è solo lo snapshot
  cifrato: il limite resta e la guardia a scheda unica è l'unica protezione (P15);
- le voci che non partiranno mai così come sono (elemento oltre il limite di
  un invio, 900 KB) vengono segnate come ferme (`parked: "too-large"`,
  `src/lib/stuckOutbox.ts`): non contano tra le modifiche da inviare
  (`stuckCount` a parte, badge «N elementi non sincronizzabili») e il pannello
  Account le elenca con titolo e dimensione. Si può scaricarne una copia
  (backup parziale `scope: "items"`, unito all'importazione; protetta da
  password con la stessa cifratura della copia di sicurezza, opzione già
  attiva se c'è la password dell'app, altrimenti il pannello dice che è in
  chiaro) o toglierle dalla
  coda dopo una conferma: restano solo su questo dispositivo. Finché ci sono,
  il cambio di account e «Esci e togli i dati da qui» restano fermi con un
  messaggio che le nomina, perché toglierle da qui le perderebbe. Una modifica
  locale riaccoda la voce senza segno e la rimette in gioco (P12);
- la domanda sul cambio di account (dati di un altro account su questo
  dispositivo) si ricorda su disco per la coppia di account
  (`cloud:switchAsked`, anche dopo un ricaricamento). Le modifiche in coda per
  l'account di prima bloccano il cambio solo se c'erano prima della domanda;
  quelle fatte mentre la persona sceglie (o salvate dal Pomodoro) non bloccano
  più entrambi i pulsanti: «Aggiungi» le porta nel nuovo account con la prima
  unione, «Mostra solo» si ferma con un messaggio che dice quale pulsante le
  tiene (`accountSwitchBlock`, P6). Togliere o mettere la password, e
  bloccare, vanno uno alla volta: durante un cambio «Blocca» è disattivato e
  rifiutato, e la riscrittura rifiuta prima di scrivere se il workspace è
  bloccato e non ha la chiave (revisione di P8).

