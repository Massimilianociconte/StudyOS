# BARB: struttura dei dati universitari

`src/data/university/barb.seed.ts` contiene la base verificata. La CLI genera
un candidato revisionabile e, dopo `barb:apply`, aggiorna
`barb.synced.json`. `mergeUniversityDataset` compone i due file nella build.
La vista `BarbView` legge il dataset tramite `useBarbStore`, che crea anche
un mirror in IndexedDB quando cambia la versione dei dati.

La pipeline è in `scripts/university/pipeline.mjs`:

1. Il provider `unimiProvider.mjs` seleziona piano, calendario e contatti.
2. `firecrawlLocal.mjs` acquisisce le pagine HTML con cache, retry e limite di
   concorrenza. L'API Firecrawl deve essere raggiungibile in loopback.
3. I parser puri in `src/lib/university/parsers.ts` estraggono coorte, corsi,
   schede insegnamento e docenti. `easyAcademy.mjs` legge gli orari JSON dal
   portale ufficiale; le regole ricorrenti coprono solo settimane consecutive
   osservate.
4. La whitelist in `officialSources.ts` controlla URL iniziali e destinazioni
   dei redirect. `validateDataset` controlla struttura, date, docenti e fonti.
5. `diffSynced` produce il report; `applyCandidate` verifica provider e formato
   prima della scrittura atomica dell'overlay.

La provenienza rimane sui record (`sourceUrl`, `retrievedAt`, `contentHash`,
`confidence`). I conflitti sono visibili e i dati non pubblicati restano null.
La UI non contatta UNIMI o Firecrawl durante l'uso ordinario: per aggiornare i
dati occorre eseguire la CLI e ricompilare l'app.
