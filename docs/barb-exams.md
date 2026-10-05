# Appelli ufficiali BARB

Il calendario legge `src/data/university/barb.exams.json`, incluso nella build.
Non acquisisce dati universitari dal browser. `examSessions.ts` esporta dati,
catalogo per gli appelli e funzioni pure per associazione, stato e collisioni.
Una materia personale usa prima `universityCourseId`; senza collegamento usa
solo il nome normalizzato esatto e univoco. Un collegamento non più valido non
viene reinterpretato tramite il nome personale.

## Copertura verificata il 5 ottobre 2026

Le fonti pubbliche complete hanno restituito 22 record di iscrizione,
corrispondenti a **12 appelli distinti**:

| Insegnamento | Appelli | Date pubblicate | Ora | Luogo |
| --- | ---: | --- | --- | --- |
| Accertamento di lingua inglese B2 | 3 | 7, 14, 21 ottobre 2026 | Non indicata | Online |
| Cellule staminali e medicina rigenerativa | 7 | 11 gennaio; 8, 23 febbraio; 22 giugno; 5, 20 luglio; 13 settembre 2027 | 10:00 | Non indicato |
| Patenting and technology transfer, precedente ordinamento F92 | 2 | 19 gennaio, 9 febbraio 2027 | 09:00 | B3 |

Il piano attuale comprende 33 attività: due hanno appelli pubblicati in queste
fonti. L'assenza di un appello nel feed completo significa che **non è pubblicato
nel calendario pubblico verificato**, senza dedurre l'assenza di esami o date
accessibili soltanto in Unimia/Ariel autenticati. I test d'inglese riportano
esplicitamente un placement test riservato alle matricole 2026/27 e richiedono
la scelta di una sola data. Avviso e indicazione di più giorni rimangono nei
record; non vengono inventati orari per i turni.

Sono state controllate tutte le 33 schede ufficiali del piano, comprese le
attività opzionali: i collegamenti “Calendario degli appelli” rimandano alla
stessa pagina centrale. Questi controlli sono registrati in `sources`.

## Fonti e corrispondenze

- [Pagina appelli BARB](https://barb.cdl.unimi.it/it/studiare/appelli-esame).
- [Calendario centrale](https://www.unimi.it/it/studiare/frequentare-un-corso-di-laurea/seguire-il-percorso-di-studi/esami/calendario-degli-appelli): il JavaScript pubblico usa `/foProssimiEsami/json/<codice>` per **tutti** gli appelli; `/1` e `/30` sono filtri oggi/mese, esclusi dall'acquisizione.
- Feed completi [FBG](https://work.unimi.it/foProssimiEsami/json/FBG) e [F92](https://work.unimi.it/foProssimiEsami/json/F92).
- PDF ufficiali [FBG](https://work.unimi.it/foProssimiEsami/pdf/FBG) e [F92](https://work.unimi.it/foProssimiEsami/pdf/F92), pagina 1 di entrambi: confronto manuale dopo classificazione `detect-pdf --analyze --json`, estrazione `pdf2md --compact --pages` e controllo visivo delle celle vuote. I derivati iniziali sono in `/tmp`, non accanto alle fonti né nel repository.
- [Avviso pubblico Ariel](https://myariel.unimi.it/course/search.php?lang=it&perpage=all&search=Cellule+staminali): la docente Graziella Messina conferma il nuovo nome dal 2025/26 del precedente insegnamento Biologia del differenziamento e terapie cellulari. La scheda diretta Ariel `id=9157` richiede accesso; l'annuncio è visibile nella ricerca pubblica.
- [Scheda F1B-10](https://www.unimi.it/it/ugov/of/af20260000f1b-10): nome e 6 CFU di Patenting and technology transfer, supplemento al catalogo degli appelli. Non entra nel piano corrente. Gli altri metadati non verificati restano null; la UI lo segnala come precedente ordinamento.

L'inglese si associa mediante `codW4=B26-38`, uguale al codice della scheda
ufficiale del piano. Cellule si associa per nome esatto; i record F92 col nome
precedente usano soltanto l'alias documentato. Le iscrizioni FBG/F92 si uniscono
quando coincidono data, prova, commissione, titolo della prova, ora e luogo,
e l'alias è verificato. I 22 record originali rimangono integralmente nelle
`sourceReferences`, con codice ordinamento, identificativi e scadenze.

L'identità di importazione è stabile e usa l'identificativo ufficiale primario.
Le successive acquisizioni riconciliano gli identificativi delle iscrizioni
già verificati: se sopravvive soltanto F92, l'appello conserva l'identità
precedente. Le iscrizioni non più presenti si conservano come `historical`
con la data della loro ultima verifica, senza dichiararle ancora pubblicate.
Una correzione ufficiale di data, ora o prova mantiene questa identità quando
l'identificativo di iscrizione è lo stesso; il calendario recepisce i nuovi campi.
Prove o commissioni distinte non si fondono soltanto perché si svolgono nello
stesso giorno. Fonti discordanti sullo stesso identificativo bloccano
l'acquisizione. Le collisioni confrontano insegnamenti distinti, escludendo
più parti dello stesso corso e gli alias già uniti.

## Aggiornare e verificare

```bash
npm run barb:sync:exams                 # candidato nella cache, nessuna applicazione
npm run barb:sync:exams -- --apply      # applicazione atomica dopo verifica completa
npm run barb:validate:exams            # sola validazione offline
node --import ./scripts/lib/register-ts.mjs --test tests/barbExams.test.mjs
npm run lint
npm run build
```

La CLI `scripts/university/exams.mjs` verifica protocollo HTTPS e dominio UNIMI
prima di ogni richiesta e redirect, limita timeout/redirect e ritenta errori
transitori. Controlla nuovamente entrambi i feed, l'evidenza dell'alias, la
scheda legacy e i link agli appelli di tutte le schede del piano. Un nuovo
collegamento a date richiede prima un parser verificato: il run non applica
un'acquisizione incompleta. Un errore di rete o parsing produce stato
`non-verificato`, mai `non-pubblicato`; quest'ultimo si usa solo per un feed
completo valido e vuoto.

Il candidato `.cache/ai/university/barb.exams.candidate.json` conserva i dati
acquisiti e gli errori. Appelli non associabili restano integrali in
`unmatched` e bloccano l'applicazione. Il dataset verificato precedente non
viene sovrascritto su errori. Ora, luogo e iscrizioni mancanti restano null.
Dopo l'applicazione serve una nuova build per aggiornare il browser.
