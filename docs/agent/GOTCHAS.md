# Invarianti e limiti

- Lo scraping universitario parte solo dalla CLI, usa Firecrawl in loopback e
  controlla anche la destinazione finale dei redirect.
- `barb:sync` scrive report e candidato nella cache; `barb:apply` aggiorna
  atomicamente l'overlay versionato solo se l'acquisizione è completa e il
  dataset è valido; `--force` richiede una revisione manuale del report.
- Il vault cifra IndexedDB, mentre la sync Supabase invia ancora JSON non
  cifrato. Non descriverla come cifratura cloud end-to-end.
- Il lock del vault e l'applicazione di dati remoti richiedono una scrittura
  IndexedDB confermata. Gli errori di push non eliminano voci dall'outbox.
- La sync cloud aggiornata richiede la funzione `push_studyos_rows` definita in
  `supabase/schema.sql` prima dell'uso; senza migrazione il client conserva la
  coda e mostra un errore. File incorporati nuovi: massimo 600 KiB.
- La UI BARB legge il dataset incluso nella build: dopo `barb:apply` occorre
  ricompilare e distribuire l'app per vedere l'aggiornamento in browser.
- La sync cloud non deve mai leggere lo stato con vault bloccato o app in
  caricamento: `cloudSync.ts` interrompe la passata (`SyncSuspendedError`)
  senza toccare outbox e cursori. Una voce put senza entità non è un tombstone.
- unimi.it offusca a volte le email via Cloudflare (`/cdn-cgi/l/email-protection`):
  `parsers.ts` le decodifica prima di hash e parsing, altrimenti ogni check
  segnala pagine "cambiate" inesistenti.
- In build la CSP (vite.config.ts) consente script solo same-origin e connessioni
  solo verso il progetto Supabase configurato: nuove origini esterne vanno aggiunte lì.
- `normalizeExternalUrl`/`safeHref` (src/lib/safeUrl.ts) sono obbligatori per ogni
  link proveniente da dati utente, backup o sync (blocca `javascript:`).
- Le etichette vivono in `src/lib/labels.ts` (condivise: valori enum come priorità,
  stati, categorie, tipi di allegato, e testi della struttura o di più schermate) o in
  `src/lib/labels/<schermata>.ts` (testi di una sola schermata, caricati con lei; mai
  riesportati da `labels.ts`). La UI non mostra mai i codici interni (`high`, `todo`).
- Griglie Tailwind: ogni `grid` senza colonne esplicite ha `grid-cols-1`
  (`minmax(0,1fr)`), altrimenti il testo `nowrap`/troncato allarga la traccia
  implicita e la pagina sfora in orizzontale su mobile.
- Una riga flex con più `Tag` più un'icona fissa non si restringe (`min-width: auto`):
  nelle schede a due colonne su mobile (~170 px) i tag vanno in un gruppo `flex-wrap`,
  altrimenti l'icona esce dalla scheda e la colonna destra sfora la pagina.
- Gli eventi ripetuti (`recurrence`, `recurrenceUntil`) restano un solo record: le
  occorrenze si calcolano con `expandEvents` (src/lib/recurrence.ts) e non si
  salvano. Spostare o modificare un'occorrenza agisce sull'intera serie.
- Testo in colore accento: usare `var(--accent-ink)` (scurito nel tema chiaro),
  non `var(--accent)`, che su fondo chiaro non è leggibile.
- Dettagli e modifiche aprono `Drawer` (src/components/ui.tsx): pannello a destra su
  desktop, foglio dal basso su mobile, Esc/click fuori per chiudere, focus trap.
- Su mobile la barra in basso mostra 4 sezioni + "Altro" (foglio con tutte le altre):
  una nuova vista va aggiunta a `navItems` in AppShell.
- Layout per larghezza (AppShell): <640 px barra in basso + pulsante "+", 640–1279 px
   barra laterale compatta a icone (92 px), ≥1280 px barra laterale completa (288 px). Lo spazio
   utile è la larghezza meno la barra: a 768 px restano ~640 px, a 1024 ~880, a 1280 ~950.
  Scegliere i breakpoint delle viste su questi valori (due colonne affiancate da `lg`).
- Tailwind usa `hoverOnlyWhenSupported`: un'azione nascosta fino al passaggio del mouse va
  scritta con `can-hover:opacity-0 can-hover:group-hover:opacity-100`, mai `opacity-0` +
  `hover:`, altrimenti su tablet touch resta invisibile. Altezze: `dvh`, non `vh`.
- Preferenze personali (nome, foto, ore settimanali, CFU del corso, BARB visibile): entità
  sincronizzata `preferences` con id `main`, letta con `selectPreferences` (oggetto stabile).
  Non rimettere dati personali in `settings`, che restano del dispositivo.
- Aggiungendo una collezione sincronizzata: registrarla in `collections.ts`, nuova versione
  Dexie in `db.ts`, backup parziali in SettingsView e incrementare `SYNC_SCHEMA`.
- I menu di scelta della materia usano `selectableSubjects` (niente materie archiviate o già
  superate, tranne quella selezionata). Le materie create dal libretto hanno stato "completed".
- Libretto: voto 18–30 con lode (vale 30 nella media) o idoneità (solo CFU). La media
  ponderata usa i CFU della materia; base di laurea = media × 110 / 30.
- Import .ics: `sourceUid` sull'evento evita i duplicati a ogni nuovo import; una regola
  settimanale su più giorni (BYDAY=MO,WE) diventa una serie per giorno.
- `sourceStamp` (evento importato, solo la serie, mai le righe dei giorni): sempre una stringa
  `"<file>.<evento>"`, due impronte cyrb53 in base 36. `<file>` = l'evento com'era nel file
  (testi, colore, inizio/fine/RRULE come sono scritti, il fuso a cui porta ogni TZID — nome IANA,
  o un'impronta del VTIMEZONE se il nome è inventato —, promemoria, «saltato»: uguale su ogni
  dispositivo, anche per le ore senza fuso); `<evento>` = come l'import l'ha scritto qui.
  Stesso `<file>` al prossimo import → le modifiche fatte qui restano; `<file>` diverso ma
  l'import scriverebbe lo stesso `<evento>` (stesso evento scritto in altro modo), o il file è
  uguale all'evento com'è adesso (il proprio export con le modifiche) → le modifiche restano e
  si aggiorna solo `<file>`, senza contarlo né avvisare; entrambi diversi → vince il
  file e l'anteprima lo dice (`editsReplaced`); senza impronta (import di prima) e uguale al
  file → si scrive solo l'impronta (non conta come aggiornato); diverso → vince il file, con
  avviso. Lo scrive solo `mergeIcsImport`: tolto da righe, figlie di una divisione e modifiche
  a mano (`repeat.ts`), mai agli agenti (`HIDDEN_FIELDS`, `NEVER_KEYS`). Con le condivisioni
  viaggia come un campo normale: non è in `PROTECTED_KEY` né in `v_protected` di
  `supabase/sharing.sql`, e se il client la togliesse una modifica di chi riceve la farebbe
  perdere al proprietario (il server non la conserva).
- «Saltato» nel .ics: `X-STUDYOS-STATUS:skipped` su un evento normale (niente STATUS:CANCELLED né
  EXDATE, così le altre app lo mostrano ancora). In import `STATUS:CANCELLED` vale «saltato»
  solo dentro un VCALENDAR con PRODID di StudyOS (i file vecchi); per ogni altra app è un
  annullamento vero.
- Proiezione del voto di laurea (`src/lib/graduation.ts`): solo Scienze biologiche (L-13) e
  BARB (LM-6) di UNIMI, con le regole delle fonti ufficiali elencate in `DEGREE_PROGRAMS`.
  Base = media ponderata × 110 / 30 per entrambi. Scienze biologiche: prova finale 18-19 → 2
  … 30/30L → 8 punti, lodi 2/3/4 → 0,2/0,4/1, Erasmus ≥70% "fino a" 1 punto. BARB: tesi 1–9
  punti, lodi senza punti. Lode di laurea e arrotondamenti non si calcolano. Se il corso
  cambia le regole, aggiornare la tabella, la data della fonte e `tests/graduation.test.mjs`.

- Stato UI (`src/lib/uiState.ts`, chiave `studyos-ui`): solo navigazione, mai contenuti.
  Ambito "tab" in sessionStorage (refresh della stessa scheda: date, ricerche, elemento
  aperto, scroll); ambito "device" anche in localStorage (modalità, ordinamenti, filtri,
  ultima sezione). Ogni valore salvato passa da un validatore (`oneOf`, `isNullableString`)
  e gli id di entità sparite vanno ignorati nella vista. Una nuova vista va aggiunta anche
  ad `APP_VIEWS` nello store. Il reset dei dati locali svuota lo stato UI.
- Agenti MCP: `npm run agent` ascolta solo `127.0.0.1:47321` ed è per lo sviluppo
  e per lo stdio. Il sito pubblicato parla con l'hub Cloudflare
  (`VITE_AGENT_HUB_ORIGIN`), mai col loopback. La CSP deve elencare l'origine
  esatta dell'hub: un wildcard `*.workers.dev` non copre `nome.account.workers.dev`.
  La chiave di collegamento è un secret di Wrangler, non sta nel repository né
  nel bundle. Il token nel browser non autorizza `/mcp`. ChatGPT web e l'app Mac
  usano l'hub pubblico e OAuth; non lanciano un processo sul Mac. I dati restano
  nell'IndexedDB del browser aperto. Agli agenti non vanno mai codici di invito,
  email, byte dei file, foto, passphrase o la chiave di collegamento.
- Agenti MCP, tempi e formato: l'hub risponde a `tools/call` entro 45 s
  (`approvalWaitMs`) perché i client MCP chiudono a 60 s; oltre, `pending_approval` e
  `studyos_approval_status`. Le conferme nel browser sono in coda e non fermano il poll:
  le esecuzioni restano in serie (`serial` in `agentLink`), perché `createdId` legge
  l'id nuovo per differenza. Lo stdio MCP è un JSON per riga, non `Content-Length`.
  Ogni entità verso gli agenti passa da `publicEntity` (via `cover`, `dataUrl` e
  stringhe `data:`). Negli schemi niente `const` né `required: []`: Gemini e i
  function schema OpenAI li rifiutano. Una lista troppo lunga si accorcia togliendo
  elementi (`has_more`/`next_offset`), mai tagliando il JSON.
- Supabase RLS e upsert: `INSERT … ON CONFLICT DO UPDATE` controlla la policy di INSERT sulla
  riga proposta e quella di SELECT sulla riga nuova. Per modificare righe di altri utenti usare
  `update` mirati; `onConflict` deve nominare la chiave vera (membri: `group_id,user_id`).
  Verificare le policy con le chiamate reali del client, non solo SQL diretto.
- `useStudyStore.setState` da solo non salva: IndexedDB e coda di sync si aggiornano solo con
  `commit()` (fuori dallo store: `retryPersist`). Vale per ogni modulo che scrive nello store.
- supabase-js riusa un canale realtime con lo stesso topic finché non è rimosso: attendere
  `removeChannel` prima di ricrearlo e non avviare due sottoscrizioni in parallelo.
- Bundle iniziale: niente import statici di `lib/supabase`, `lib/groupSync` o dei dati BARB
  (`university/examSessions`, JSON) da store, shell o componenti sempre montati; usare
  `import()` (vedi App, NotificationsBell, `importBarbExamSessions`). Animazioni con `m.` sotto
  `LazyMotion` (strict): `motion.` lancia errore.
- `Drawer` usa un portal su `body` e una pila: Esc e Tab li gestisce solo il drawer in cima.
  Un drawer dentro un altro (es. Invita sopra il dettaglio del gruppo) è quindi sicuro.
- `isSharedAvailable` (groupSync): senza sessione non memorizza nulla e salva in IndexedDB solo
  l'esito positivo; "migrazione assente" vale 10 minuti in memoria. Un `false` persistente
  impediva di usare i gruppi condivisi dopo il login o dopo aver applicato `groups.sql`.
- Link di invito: codice nel frammento (`#invito=`), letto a livello di app
  (`useGroupInviteLinks`, anche su `hashchange`), mai in GroupsView. L'invito in sospeso vive
  in `lib/groupInvite.ts` (localStorage, 14 giorni); l'ingresso automatico dopo il login avviene
  solo se l'utente l'aveva confermato.
- Lessico dell'interfaccia: sezioni "Home", "Calendario", "Attività" (mai "task"; i
  sotto-elementi sono "passaggi"), "Studio", "Corso di laurea" (vista `barb`), cronologia
  dei gruppi (mai "attività"), "appelli ufficiali" per le date UNIMI, "password" e non
  passphrase/vault. Etichette dei campi facoltativi accordate al nome ("Materia
  (facoltativa)"). I messaggi del server MCP (`src/agent/`) citano "Impostazioni → Agenti":
  la categoria si chiama "Agenti AI" per restare riconoscibile.
- Keep-alive Supabase: la pausa del piano Free guarda l'attività del database, quindi i cron
  devono eseguire una query (meglio una scrittura: RPC `studyos_keepalive`), non solo una
  richiesta HTTP. Il cron principale è il Worker Cloudflare (`worker/keepalive.jsonc`, deploy
  con `-c`, mai insieme all'hub `studyos-agent`). Workers Free ammette 5 cron per
  account e l'account ne usa già 4: più orari vanno in una sola espressione; GitHub Actions è solo la riserva perché
  spegne i cron dei repository pubblici dopo 60 giorni senza commit. Le chiavi
  `sb_publishable_` vanno solo nell'header `apikey`, non in `Authorization: Bearer`.
- Dati di altre persone: solo in `useSharedStore` e nelle tabelle Dexie `sharedItems` e
  `sharedOutbox`, mai in `COLLECTIONS`, nella coda di sync personale, nei backup o nei
  selettori di Home, Statistiche, streak e promemoria. Con la password dell'app attiva
  restano solo in memoria; il logout vero (non l'avvio senza sessione) li cancella, insieme
  alle modifiche non ancora inviate.
- `studyos_scope_covers` (`supabase/sharing.sql`) e `scopeCovers` (`src/lib/sharing.ts`)
  sono specchi: una sezione nuova o cambiata va aggiornata in entrambi, nei casi di
  `tests/sharing.test.mjs` e in `scripts/supabase/sharing-check.mjs`.
- Il client scrive su righe altrui solo con `push_shared_rows`; il server accetta anche le
  scritture dirette sulla tabella che la RLS consente, ripulite dallo stesso trigger. Un
  esito `denied` scarta la voce in coda e mostra un avviso in AppShell, in ogni sezione
  ("Non hai più il permesso…", che copre anche un rifiuto per valore o per tipo). Il
  ripristino dalla cronologia è una nuova versione del proprietario, non una scrittura sulla
  tabella delle revisioni.
- I valori scritti da chi riceve li ripulisce il server: `studyos_recipient_payload` e il
  trigger `studyos_items_recipient_values` (anche per le scritture dirette consentite dalla
  RLS). Un campo nuovo mostrato come immagine, colore o link nelle viste del proprietario va
  aggiunto lì e passato dai filtri client (`safeCssColor`, `safeImageDataUrl`, `safeHref`).
- Lo stesso trigger fissa le colonne della riga di chi riceve (`id`, `created_at`,
  `updated_at`, `version`, `encrypted`; `client_id` con prefisso `r:<id utente>:`): il
  cursore di pull del proprietario è `max(updated_at)` e il suo pull salta il proprio
  `client_id`, quindi lasciarli al client farebbe sparire modifiche. Il controllo dell'eco
  Realtime di chi riceve confronta anche `r:<proprio id>:<clientId>`.
- `studyos_recipient_payload` conosce i campi di ogni tipo (testi obbligatori, testi
  facoltativi, liste) copiati da `src/types.ts`: un campo obbligatorio nuovo in un tipo
  condivisibile va aggiunto anche lì e in `scripts/supabase/sharing-check.mjs` (`full*`),
  altrimenti le creazioni di chi riceve vengono rifiutate o restano senza controllo.
  Un campo esistente non può cambiare tipo JSON in modifica.
- `withoutProtectedKeys` (`src/lib/sharing.ts`) toglie `cover`, `dataUrl`, `*DataUrl` e
  `sourceUid` dalle righe di chi riceve prima dell'invio: il server, senza la chiave, tiene
  il valore salvato. Non rimandarle "per completezza".
- Chi riceve una sezione vede id e ora di eliminazione degli elementi eliminati di quel tipo
  anche fuori dal filtro per materie (il tombstone non ha più la materia).
- Dexie è alla versione 6 (tabelle `sharedItems` e `sharedOutbox`): mai tornare a una build
  con la versione 5, non aprirebbe il database locale.
- `updateShare` e `revokeShare` chiedono le righe toccate (`.select("id")`): zero righe
  diventa "Questa condivisione non c'è più." e un aggiornamento dell'elenco, anche per gli
  strumenti MCP, che rispondono con un errore.
- Ordine degli script SQL sul progetto: `schema.sql`, `groups.sql`, `sharing.sql`,
  `sharing-verify.sql`. `groups.sql` si può rieseguire; dopo averlo rieseguito riesegui anche
  `sharing.sql`.
- Un elemento che esce da un filtro (materia cambiata, voto registrato) non genera un evento
  Realtime per chi lo vedeva: sparisce al controllo successivo (al più 5 minuti). Il confronto
  con gli id visibili (`visibleKeys`) parte solo dal timer dei 5 minuti, dal ritorno sulla
  scheda se l'ultimo controllo completo è più vecchio, o quando cambia la firma dei permessi di
  un proprietario (`src/lib/shareRecheck.ts`, con test): non rimetterlo in ogni passata. Un
  `DELETE` vero non arriva mai sul canale filtrato `user_id=in.(…)` (la riga vecchia ha solo
  l'id); arriva, con il solo id, a chi si iscrive senza filtro, anche senza accesso.
- Chi guarda e la generazione vivono in `src/lib/shareViewer.ts` (senza supabase-js, provato in
  `tests/sharedStore.test.mjs`): ogni attesa in `shareSync.ts` è seguita da `still(gen)`.
- Cronologia: le revisioni di creazione e modifica non hanno chiavi protette
  (`studyos_without_protected` in `sharing.sql`), quelle di eliminazione sì. Il ripristino
  (`restoreEntities` → `restoredPayload`) tiene sempre copertine, file e UID della copia locale
  del proprietario; senza copia li prende dall'eliminazione successiva (`protectedFrom`), e
  rifiuta la versione di una modifica di un tipo in `PROTECTED_ENTITY_TYPES` che non ha né
  l'una né l'altra: lo decide al momento di scrivere, perché la sync può eliminare l'elemento
  mentre si scaricano le versioni. Un campo protetto nuovo in `src/types.ts` va aggiunto a
  `PROTECTED_ENTITY_TYPES` (un test lo controlla). L'elenco legge `REVISION_LIST_COLUMNS`
  (niente payload): la versione intera si scarica per id. Pianificazione dell'annullamento in
  `src/lib/shareHistory.ts` (caricato con `import()`); i testi (`REVISION_CHANGE_LABEL`,
  `revisionListIntro`, `REVERT_TEXT`) sono in `src/lib/labels/sharing.ts`, caricati con la
  schermata.
- Il cursore di pull per proprietario include la firma dei permessi (`grantSignature`):
  un filtro allargato riparte da zero, altrimenti gli elementi già esistenti non
  arriverebbero mai.
- Nel calendario le occorrenze condivise hanno la chiave con il prefisso del proprietario:
  due persone possono avere eventi con lo stesso id.
- «Questo e i successivi» (`planSplit`, e `planAll` dal primo giorno): il motore classifica la
  modifica da solo (`followingChange`), così modulo, trascinamento e agente fanno lo stesso
  (R1-S1 bis).
  - A. Regola nuova = frequenza, intervallo, giorni scelti, schema del mese o fine scelta. Non lo
    è la regola che segue solo il giorno spostato (`movedRule`, stessa fine, volte rimaste o
    "fino al" spostato), né BYDAY esplicito contro implicito con gli stessi giorni. Assorbe TUTTE
    le parti dopo della famiglia (`laterPartsOf`, comprese le divisioni degli antenati) e la parte
    modificata arriva alla fine della famiglia (`familyEnd`: l'ultima data vera dell'ultima parte,
    non il "fino al" scritto; o mai), mai all'inizio della divisione dopo; una fine scelta nel
    modulo vince. La scelta elenca le date che spariscono e dice che quelle parti perdono titolo,
    orario e dettagli propri (`scopeImpact.gone`; l'agente le dà in `removedDates`). L'agente
    passa una `repeat` senza `end` con la fine che la parte mostra, come il modulo (quindi fine
    della famiglia); "mai" solo con `end.type=never` (R1-S1 ter).
  - B. Spostamento (trascinamento o nuova data di inizio) = cambio di programma come l'ora: le
    parti dopo con lo stesso programma della serie prima della modifica (regola senza fine, ora,
    giorni di un tutto il giorno; `scheduleKey` + `sameTime`) si spostano: partono dove va la loro
    prima volta (`movedDate`: di `shift` giorni; "il 2° lunedì" va al 2° martedì dello stesso
    mese) con i giorni della regola e "fino al" che seguono; le altre tengono il loro.
    Spostamento + regola nuova = A.
  - Nulla sparisce spostando (R1-S1 ter): ogni parte ferma quella prima (`originalDate`) solo
    dopo l'ultimo giorno che quella mostrava, spostato con lei se si sposta. Una parte con un
    programma suo può quindi avere `originalDate` dopo il suo inizio, e sul suo primo giorno
    c'è anche la lezione spostata (voluto). La scelta dice quei giorni (`scopeImpact.both`).
    Nel file .ics la figlia porta quel giorno in `X-STUDYOS-FROM;VALUE=DATE` (solo se diverso
    dal giorno di DTSTART); l'import lo usa in `linkChild` se è un giorno dopo il primo della
    madre ed entro un anno dal primo della figlia, altrimenti (e nei file vecchi) il primo
    giorno della figlia.
  - C. I giorni di un tutto il giorno (`spanDays`) contano come ora (`sameTime`).
  - In B e C tutte le parti dopo prendono i campi cambiati (`laterPartsPlan`).
- Eliminare «Questo e i successivi» (`planDelete`) toglie tutte le parti dopo della famiglia
  (`laterPartsOf`, comprese le divisioni degli antenati), come la regola nuova di A; modulo e
  agente passano dallo stesso piano.
- Agente e «Tutti»: `studyos_delete_event` senza `occurrenceDate` su una serie è «Tutti»
  (`planDelete` con `includeSplits` dal primo giorno: tutta la famiglia, anche dall'id di una
  parte; `parts` nel risultato). `studyos_update_event` senza `occurrenceDate` o con `scope=all`
  è «Tutti» della modifica: cambia solo quella serie e le parti dopo (divise prima con
  «Questo e i successivi») restano, elencate in `keptParts` come le dice la scelta del calendario.
- Tutto il giorno = DATE CIVILI nel fuso dell'evento (`timeZone` della serie, altrimenti quello
  fissato alla creazione), mai in quello del dispositivo: chi legge o scrive istanti passa da
  `allDayDays` / `allDayTimes` / `allDaySpan` (repeat.ts). Si salva la mezzanotte in quel fuso
  (moduli `draftTimes` con `EventDraft.timeZone`, ricorrenza, vacanza, trascinamento
  `draggedTimes`, `shiftPatchDays` con `allDay`); il motore rilegge in quel fuso e un istante che lì
  non è mezzanotte (agente, app vecchie) vale la mezzanotte più vicina con i giorni dalla durata
  arrotondata, come `timingOf` in ics.ts. Le occorrenze espanse invece stanno alla mezzanotte del
  DISPOSITIVO dei loro giorni (la griglia legge così): `allDayDays` le riconosce da `occurrenceKey`,
  `startDayOf(…, true, zona)` è per inizi salvati e modifiche, `shownDayOf` per l'occorrenza mostrata.
  L'agente uguale: `nextEventRange(evento, args, zona)` (toolkit.ts) legge start/end come giorni
  ("YYYY-MM-DD" o un'ora senza offset = quel giorno; con offset = il suo giorno nel fuso dell'evento)
  e scrive con `allDayTimes` nel fuso della serie o dell'evento (update_event, update_shared_item).
  Mai `allDayRange` (mezzanotte del dispositivo) su un evento che esiste: da ≥ 12 h di distanza
  (Roma aperta da Auckland) la mezzanotte più vicina è a pari merito e vince il giorno prima. Un
  evento altrui spostato da un'occorrenza resta nel riferimento del dispositivo (lo scarto si somma
  alla serie); un tutto il giorno condiviso creato dall'agente porta il fuso di chi lo crea.
- «Tutti» con una regola nuova che non comprende il giorno aperto (da lunedì 16 «mar e gio»): la
  serie parte dal primo giorno della regola nuova dal suo primo giorno di prima in poi (martedì 3,
  `alignedSeriesStart`), mai un giorno in più che la regola non ha; la scelta dice quel giorno
  (`newStart`). Vale anche aprendo dal primo giorno. «Questo e i successivi» uguale, dal giorno
  aperto: la parte nuova parte dal primo giorno della regola da lì in poi (martedì 17, stessa ora,
  `occurrenceEditCalls` → `timesMoved`), il giorno aperto sparisce e la parte prima finisce lunedì 9;
  la scelta dice da dove riprende (`ScopeImpact.startsOn`) e il giorno aperto è tra quelli che
  spariscono (`gone`, anche per l'agente in `removedDates`). Uno spostamento senza regola nuova no.
- «Questo e i successivi» da un giorno spostato da solo si misura da ciò che si è aperto (mercoledì 18),
  non dalla sua data (lunedì 16): senza cambiarne giorno né orario la serie tiene il suo programma e il
  giorno resta spostato nella parte nuova (`staysPut`, `movedAway` in planSplit); cambiando la data, la
  parte nuova parte dal giorno scelto; le date che spariscono sono quelle che si vedono (`shownDayOf`).
  «Tutti» uguale: solo titolo o dettagli da un giorno spostato non sposta la serie (resta di lunedì).
  Solo l'ora sullo stesso giorno aperto (`timeOnMovedDay`): la serie resta di lunedì all'ora nuova e il
  giorno resta mercoledì 18; per «Questo e i successivi» una seconda chiamata «Solo questo» va alla
  parte nuova (`OccurrenceCall.seriesId`: chi esegue le chiamate usa `call.seriesId ?? serie`). La
  scelta nomina il giorno aperto (`scopeOptions({ opened })`), mai lunedì 16.
- «fino a» (`seriesSpan.until`) e «La serie ora finisce» (`ScopeImpact.endsOn`) dicono l'ultima data
  che c'è davvero (`lastShownDate`): non un giorno annullato, un giorno spostato dove sta ora.
- Agenti MCP e condivisione: persone come `personId` (`person_` + 16 cifre esadecimali),
  elementi come `person_…:tipo:id`; mai email, token, codici o id di account. Gli strumenti
  distruttivi hanno solo `id` e `confirm`; `studyos_share_with` e `studyos_update_share`
  chiedono sempre conferma, anche in una sessione fidata. Le proiezioni dei dati condivisi
  sono a elenco consentito (niente file, copertine, cronometri, `sourceUid`, link non sicuri a
  qualunque profondità) e gli elementi di persone nascoste sono invisibili anche agli agenti.
- Realtime su `studyos_share_invites` funziona anche con il SELECT concesso per colonna
  (`token_hash` escluso): verificato sullo stack locale il 10/11/2026 (0,63 s). Non
  concedere il SELECT su tutta la tabella: esporrebbe l'hash del token.
- Connettore remoto (`src/agent/cloudRunner.ts`): durante un'esecuzione `globalThis.Date` è
  `ZonedDate` (`src/agent/zonedDate.ts`) nel fuso di chi ha dato il consenso, perché il Worker gira
  in UTC. Anche `deviceTimeZone()` (`src/lib/tz.ts`) restituisce quel fuso (lo imposta
  `withZonedDate`): store e motore lo fissano sulle serie nuove e sulle divisioni. Il codice che
  ha bisogno del fuso «del dispositivo» passa da `deviceTimeZone()`, mai da
  `Intl.DateTimeFormat().resolvedOptions()`, che sul Worker dice "UTC" (le serie create dal
  connettore finivano in UTC e d'estate un'ora dopo). Il `Date` globale è uno solo: le esecuzioni sono serializzate da un lock del modulo, e
  un modulo caricato con `import()` durante l'esecuzione non deve salvare `Date` in una costante
  (resterebbe `ZonedDate` anche dopo). Lo store condiviso
  (`useStudyStore`) si riempie con i dati dell'account solo per la durata della chiamata, con la
  persistenza sospesa, e si svuota alla fine.
- Connettore remoto, CPU: il piano Free dà 10 ms per richiesta. Non mettere calcoli costosi dentro
  un comparatore di `sort` sui dati dell'account (`urgentTasks` costava 8 ms per date ricalcolate a
  ogni confronto). Misura con un account di prova grande prima di aggiungere lavoro alle risposte
  di `studyos_overview`. `withZonedDate` riusa una classe `ZonedDate` per fuso: crearne una a ogni
  chiamata faceva ricompilare al motore ogni `new Date` (in Node, account con 1500 attività, 800
  eventi e 1000 sessioni: seconda `studyos_overview` da 45–52 a 28–31 ms; account piccolo invariato,
  6–15 ms). Il resto è `parseISO`/`format` di date-fns per ogni sessione e attività nei selettori
  (`studyStreak`, `studyMinutesThisWeek`, `urgentTasks`), più caro con `ZonedDate`. I numeri di Node
  non sono quelli del Worker: misura `cpuTime` con `wrangler tail` sull'account vero prima di
  concludere che serve il piano a pagamento.
- Connettore remoto, permessi: il segreto del permesso vive solo nell'hub (stato del Durable Object,
  legato al token OAuth); il database ne tiene l'hash. «Revoca l'accesso agli assistenti» revoca
  tutti i permessi dell'account (`studyos_revoke_agent_grants`), anche a browser scollegato.
- OAuth dell'hub: `/register` e `/authorize` sono aperti a chiunque. `oauth.ts` tiene al massimo
  50 client (al limite toglie quelli senza token, consensi o codici, dal più vecchio, ma non nei
  2 minuti dopo la registrazione; una registrazione mai usata scade dopo 24 ore) e 5 consensi
  aperti per client, 20 in tutto, per 5 minuti. Oltre i 20 il nuovo prende il posto del più
  vecchio, prima quelli dei client senza `usedAt`: mai un 429, che chiunque potrebbe rinnovare
  per tenere fuori l'utente vero. `httpHub` toglie dalla coda i consensi sostituiti. `revokeAll`
  toglie anche i client. Non togliere questi limiti: senza, 50 registrazioni bloccavano per
  sempre i connettori nuovi.
  `/pair` si blocca con 8 tentativi sbagliati negli ultimi 10 minuti (finestra scorrevole,
  `pairFailureTimes` nello stato salvato; i tentativi rifiutati col blocco non contano): un
  contatore che non scende mai teneva il blocco per sempre con un tentativo ogni 10 minuti.
- Locale: la porta 8787 può essere occupata da un'altra app. Per `wrangler dev` usa
  `--port 8797` e controlla con `lsof -iTCP:8787` prima di mandare richieste a 8787.
