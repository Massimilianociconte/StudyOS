# Corsi, appelli BARB e calendario personale

Richiesta: semestri visibili nel piano personale e nel catalogo; tutte le date pubbliche ufficiali BARB verificabili; calendario generale indipendente; importazione selettiva idempotente; sistema di icone scientifiche coerente.

## Scelte

- Riutilizzare il dataset BARB e la persistenza locale/cloud esistenti; nessun nuovo archivio personale.
- Associazione stabile delle materie mediante id universitario con fallback solo a nomi normalizzati esatti. Semestre ufficiale per le materie BARB, con eventuale override personale esplicito.
- Dataset appelli versionato, fonti e data di verifica consultabili. Distinguere assenza di date verificate da indisponibilità della fonte. Non dedurre alias di corsi né orari/sedi mancanti.
- Esami: schede Calendario Esami BARB e preparazione personale; calendario generale giorno/settimana/mese, filtro corso e segnalazione di più corsi nella stessa giornata. Non dichiarare sovrapposizioni orarie quando gli orari mancano.
- Importazione in Calendario personale dalla selezione dei corsi del piano e dei singoli appelli, con UID stabile e duplicati ignorati. Le date diventano promemoria giornalieri, gli eventuali orari ufficiali restano nei dettagli: la durata dell'esame non viene stimata.
- Icone SVG scientifiche con mappatura esplicita di tutti gli insegnamenti.

## Lavoro

1. Ricerca ufficiale FBG/F92 e schede corsi, parser/retrieval ripetibile e dataset con provenienza.
2. UI calendario generale, dettagli e selezione/importazione.
3. Filtri semestri, piano personale, badge e icone custom.
4. Importazione persistente idempotente, nomenclatura calendario personale, integrazione nella panoramica.
5. Revisione indipendente, test di regressione dati/import, lint/build/barb:validate e prova responsive in browser.

## Verifica

Comandi definiti dal repository: npm test, npm run lint, npm run build, npm run barb:validate. Prova UI di filtri, evento aperto, selezione multipla, import ripetuto, calendario personale e larghezza 375px. Nessun deploy previsto.
