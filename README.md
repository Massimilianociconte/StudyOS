# StudyOS

StudyOS è una PWA local-first per organizzare lo studio universitario: home con i primi passi, calendario (con import/export .ics), attività, timer e sessioni di studio, ripasso attivo a intervalli, materie, esami, libretto con media ponderata e proiezione del voto di laurea (Scienze biologiche e BARB, UNIMI), materiali, obiettivi, statistiche e backup. L'interfaccia si adatta a telefono, tablet (iPad, Galaxy Tab) e desktop.

## Avvio locale

```bash
npm install
npm run dev
```

Il server Vite parte su `http://localhost:5173/` se la porta e libera.
Per usare il cloud in locale, copia `.env.example` in `.env` e inserisci URL e
chiave publishable del tuo progetto Supabase. La `.env` locale non va committata.

## Build

```bash
npm run build
```

Verifiche locali: `npm test`, `npm run lint` e `npm run barb:validate`.

La build statica viene generata in `dist/` ed e pensata per hosting statico, incluso GitHub Pages.

## Privacy

- Nessuna API esterna obbligatoria.
- Nessuna chiave segreta nel frontend.
- Senza account cloud, i dati personali restano nel browser tramite IndexedDB.
- I backup possono essere esportati in JSON cifrato con Web Crypto API e AES-GCM.
- Il vault locale opzionale salva lo snapshot dati cifrato e non persiste la passphrase in chiaro.
- La sync Supabase opzionale invia attualmente payload JSON non cifrati; il vault protegge solo la copia locale.

## GitHub Pages

La configurazione Vite usa `base: "./"` per funzionare anche sotto path di repository. Dopo `npm run build`, pubblica il contenuto di `dist/` con il metodo GitHub Pages che preferisci.

Il workflow `.github/workflows/pages.yml` compila la PWA e pubblica `dist/` su GitHub Pages quando viene fatto push su `main`.

## Dati universitari BARB

La vista BARB usa un seed più un overlay revisionato. Per aggiornare corsi,
docenti, contatti o orari tramite Firecrawl OSS locale, segui
[`docs/barb-sync.md`](docs/barb-sync.md). La sincronizzazione è su richiesta:
il browser non esegue scraping.

Gli **appelli ufficiali BARB** (Esami → Date ufficiali) sono generali e indipendenti
dalle materie personali. Gli appelli verificati si possono scegliere per insegnamento
o singola data e aggiungere al **Calendario**, evitando duplicati. Corsi e materie
mostrano semestri distinti e icone scientifiche. Copertura, fonti e aggiornamento
degli appelli: [`docs/barb-exams.md`](docs/barb-exams.md).

Nei gruppi si possono condividere gli **appelli** (con cronologia e ripristino): ognuno li sceglie per sé nel
piano d'esame personale, che il gruppo non vede. I membri correggono anche docenti e aule del catalogo BARB e
i promemoria autonomi stanno nel pannello Notifiche. Dettagli: [`docs/group-exams.md`](docs/group-exams.md).

## Agenti

ChatGPT usa il sito pubblicato, anche dal telefono: la chiave si incolla in
**Impostazioni → Agenti AI** e non serve il programma sul computer. Claude, Cursor
e la finestra di sviluppo usano ancora `npm run agent`. Dettagli:
[`docs/agent-mcp.md`](docs/agent-mcp.md).

## Cloud sync

L'implementazione opzionale con Supabase Auth, Postgres RLS e coda offline è
descritta in [`docs/cloud-sync-architecture.md`](docs/cloud-sync-architecture.md).
Prima di collegare una build aggiornata al cloud, applica
[`supabase/schema.sql`](supabase/schema.sql) al progetto Supabase.
La procedura manuale da SQL Editor, il controllo successivo e le variabili
GitHub Pages sono in [`supabase/README.md`](supabase/README.md).
