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
