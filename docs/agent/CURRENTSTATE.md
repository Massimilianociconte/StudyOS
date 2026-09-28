# Stato del progetto (28 settembre 2026)

StudyOS è una PWA React/Vite local-first. La versione corrente integra la
persistenza incrementale, la sync opzionale Supabase per entità, il vault
locale, il timer persistente e il dataset BARB con pipeline Firecrawl OSS
locale.

Verifiche eseguite: `npm test` (38 test), `npm run lint`, `npm run build` e
`npm run barb:validate` passano. La sync BARB completa con `--fresh` ha
acquisito 67 pagine ufficiali, senza errori e senza differenze rispetto
all'overlay applicato; il candidato completo è stato riapplicato per aggiornare
la data di verifica. Una prova nella preview della build ha confermato che
un task locale rimane visibile dopo il reload.

Una funzione SQL condizionale protegge il push cloud da scritture obsolete.
Lo schema è stato provato in un PostgreSQL temporaneo: nuova versione accettata,
versione vecchia rifiutata, retry identico accettato. Il proprietario del
progetto ha confermato l'esecuzione di `supabase/schema.sql` e
`supabase/verify.sql` nel nuovo progetto Supabase.

L'overlay BARB contiene 33 corsi e 31 docenti. Gli orari giornalieri non sono
presenti nel dataset. La prova end-to-end della sync cloud tra due account o
dispositivi richiede un backend Supabase configurato e credenziali di test.
Le due variabili pubbliche `VITE_SUPABASE_URL` e
`VITE_SUPABASE_PUBLISHABLE_KEY` sono state impostate nelle variabili GitHub
Actions del repository; la `.env` locale è esclusa dal controllo versione.

Revisione completa (28 settembre 2026, sera): corretti bug di sync (tombstone
con vault bloccato durante una sync, cursore avanzato senza applicare modifiche,
re-upload completo al primo login, ripristino backup annullato dalla sync,
logout offline impossibile), XSS `javascript:` nei materiali, falsi positivi
di check-updates (email Cloudflare), date non valide nel calendario. Aggiunti
CSP in build, ErrorBoundary delle viste con ricarica automatica dopo un deploy,
timeout delle richieste Supabase, caricamento differito di supabase-js.
Verifiche: `npm test`, `npm run lint`, `npm run build`, `npm run barb:validate`,
test SQL su immagine Supabase Postgres 17 e test end-to-end con stack Supabase
locale e due origini browser. Lo schema aggiornato va rieseguito nel progetto
Supabase (vedi supabase/README.md).
