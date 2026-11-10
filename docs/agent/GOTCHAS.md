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
- Le etichette dei valori enum (priorità, stati, categorie, tipi di allegato) vivono
  solo in `src/lib/labels.ts`: la UI non mostra mai i codici interni (`high`, `todo`).
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
