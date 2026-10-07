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

