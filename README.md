# StudyOS

StudyOS e una PWA local-first per organizzazione dello studio universitario: dashboard, calendario, task, sessioni, materie, esami, materiali, obiettivi, statistiche e backup.

## Avvio locale

```bash
npm install
npm run dev
```

Il server Vite parte su `http://localhost:5173/` se la porta e libera.

## Build

```bash
npm run build
```

La build statica viene generata in `dist/` ed e pensata per hosting statico, incluso GitHub Pages.

## Privacy

- Nessuna API esterna obbligatoria.
- Nessuna chiave segreta nel frontend.
- I dati personali restano nel browser tramite IndexedDB.
- I backup possono essere esportati in JSON cifrato con Web Crypto API e AES-GCM.
- Il vault locale opzionale salva lo snapshot dati cifrato e non persiste la passphrase in chiaro.

## GitHub Pages

La configurazione Vite usa `base: "./"` per funzionare anche sotto path di repository. Dopo `npm run build`, pubblica il contenuto di `dist/` con il metodo GitHub Pages che preferisci.

Il workflow `.github/workflows/pages.yml` compila la PWA e pubblica `dist/` su GitHub Pages quando viene fatto push su `main`.

## Cloud sync

La roadmap sicura per account e sync multi-dispositivo e documentata in `docs/cloud-sync-architecture.md`.

Sintesi:

- GitHub Pages resta solo hosting statico.
- Account e dati condivisi richiedono un backend esterno con regole lato server.
- La scelta consigliata e Supabase Auth + Postgres RLS.
- IndexedDB resta cache offline e coda di sincronizzazione.
- I payload possono essere cifrati lato client prima dell'upload.
