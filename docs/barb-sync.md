# BARB: sincronizzazione su richiesta

La PWA legge `src/data/university/barb.seed.ts` più l'overlay versionato
`src/data/university/barb.synced.json`. Il browser non esegue scraping. La CLI
usa Firecrawl OSS sul Mac per le pagine HTML ufficiali UNIMI e interroga il
portale orari ufficiale EasyAcademy tramite la sua API JSON.

## Preparazione

```bash
npm run firecrawl:up       # avvia/verifica lo stack locale esistente
npm run firecrawl:health
```

L'endpoint predefinito è `http://localhost:3002`; `FIRECRAWL_BASE_URL` accetta
solo un indirizzo loopback. `FIRECRAWL_API_KEY` può sostituire la chiave di test
dello stack locale. La CLI richiede Node 22.18 o successivo.

## Acquisizione e verifica

```bash
npm run barb:sync                             # tutti i dati, solo report
npm run barb:sync:courses                     # piano e insegnamenti
npm run barb:sync:teachers                    # schede, docenti, programma, esami
npm run barb:sync:schedule                    # date semestri e orari
npm run barb:sync:contacts                    # referenti e contatti
npm run barb:sync -- --scope teachers --course "Anatomia dell'uomo"
npm run barb:check-updates                    # hash delle pagine note
npm run barb:validate                         # validazione offline seed + overlay
```

`--fresh` ignora la cache delle pagine; `--cache-ttl 2h` ne cambia la durata.
`--offline` controlla l'overlay esistente senza rete. `--autostart` avvia
Firecrawl se spento. `--json` produce output leggibile da altri programmi.
Il filtro `--course` si usa con `--scope teachers` e richiede un nome o ID
univoco; se una sottostringa indica più corsi, il comando segnala l'ambiguità
senza acquisirli.

Ogni run crea `report.json` e `report.md` in
`.cache/ai/university/runs/<id>/` e aggiorna
`.cache/ai/university/barb.candidate.json`. Il report elenca pagine, hash,
errori, avvisi e differenze rispetto all'overlay applicato. La CLI rifiuta
redirect verso domini esterni o indirizzi non HTTPS. I report e la cache sono
temporanei e ignorati da Git.

## Applicazione

Controlla il report e le fonti ufficiali collegate prima di applicare:

```bash
npm run barb:apply
npm run barb:validate
npm test
npm run build
```

Si può anche usare `npm run barb:sync -- --apply` per applicare il risultato
dello stesso run. Errori di acquisizione, parsing o validazione bloccano
sia `--apply` sia il successivo `barb:apply`: il candidato conserva l'esito
dell'acquisizione. La CLI esce con codice 1 anche per un run di sola lettura
con errori. `--force` va usato solo dopo verifica manuale del report. Il seed
rimane intatto: viene sostituito atomicamente solo l'overlay JSON. Dopo una
nuova applicazione serve una nuova build della PWA.

## Stato verificato nel repository

L'overlay attuale include 33 corsi e 31 docenti. Le date dei semestri sono
presenti; gli orari giornalieri risultano ancora non pubblicati nel dataset.
La vista BARB mostra esplicitamente i campi non disponibili e i corsi segnalati
come non erogati. Per lo stato più recente esegui `npm run barb:status` e
controlla il report della nuova sincronizzazione prima di applicarla.
