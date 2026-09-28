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
