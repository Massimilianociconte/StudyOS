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

Revisione UI/UX (29 settembre 2026): studiate tutte le viste con dati demo nel
browser (desktop 1440×900, mobile 375×812, tema scuro e chiaro). BARB ora usa
gruppi del piano di studi, card dense e dettaglio corso in un pannello laterale
(pagina da 4253 a 2375 px). Il calendario ha una griglia oraria vera con eventi
posizionati per durata, trascinamento con orario, agenda per giorno e ricorrenze.
Task in righe compatte raggruppate per scadenza (da 3473 a 1561 px); Materie,
Esami, Materiali, Obiettivi e Studio compattati e con modifica completa
(prima non si potevano modificare materie e obiettivi). Corretti: streak azzerato
al mattino, sessioni che cambiavano stato con un click, template sessione finti,
sezioni irraggiungibili da mobile, etichette inglesi, overflow orizzontale mobile.
Verifiche: `npm test` (50 test, anche con TZ UTC e America/New_York), lint e build.

Tablet e funzioni per lo studio (29 settembre 2026, notte): navigazione a tre livelli
(barra in basso su telefono, barra compatta a icone 640–1279 px, barra completa da
1280 px), breakpoint delle viste ricalibrati sullo spazio utile, azioni visibili anche
senza mouse, schede scorrevoli con sfumatura, eventi sovrapposti a cascata nelle colonne
strette del calendario, Kanban con selettore di colonna. Verificato senza overflow a
375, 600, 700, 768, 810, 1024, 1180, 1280 e 1366 px. Nuove funzioni: libretto con media
aritmetica e ponderata, CFU e base di laurea; ripasso attivo con valutazione e intervalli
crescenti, argomenti creabili (anche dal programma d'esame); registrazione manuale ed
eliminazione delle sessioni; import/export .ics; preferenze personali sincronizzate.
Rimossi i valori fissi (obiettivo 18 h) e la "sessione pianificata" invisibile del pulsante
Aggiungi. Verifiche: `npm test` (59 test, anche con TZ UTC, New York, Tokyo), lint, build
e prova end-to-end della sync con stack Supabase locale e due origini browser.

Libretto e laurea (29 settembre 2026): nuova sezione con media ponderata e aritmetica
calcolate dai voti registrati, CFU e proiezione del voto di laurea per Scienze biologiche
(L-13) e Biologia applicata alla ricerca biomedica (LM-6) con le regole ufficiali UNIMI
(fonti e date nella vista). Il corso di laurea è una preferenza sincronizzata: imposta anche
i CFU totali e la visibilità della sezione BARB. Verifiche: 65 test, lint, build, prova nel
browser a 375, 1024×768, 1180×820 e 1280×800.


Stato dell'interfaccia (29 settembre 2026): refresh e hard refresh riaprono la stessa sezione
con schede, filtri, elemento aperto, data del calendario e scroll (`src/lib/uiState.ts`).
"Vista iniziale" ha la nuova opzione predefinita "Ultima sezione aperta" per le schede nuove;
le impostazioni locali passano a `schemaVersion` 2 e chi aveva la dashboard predefinita
viene portato a "ultima sezione". Verifiche: 69 test, lint, build, prova nel browser di
refresh, scheda nuova, schede parallele, BARB con corso aperto e telefono a 375 px.

Corsi, appelli BARB e calendario personale (5 ottobre 2026): filtri per semestre
nel catalogo BARB, nelle Materie e in Dashboard con override personale
(`semesterOverride`); dataset versionato di 12 appelli ufficiali verificati
(feed FBG/F92, vedi `docs/barb-exams.md`) con stati prossimo/futuro/passato;
Calendario Esami BARB generale (giorno/settimana/mese, filtro corso, avvisi di
stessa giornata) separato dal Calendario personale, con importazione selettiva
idempotente (`sourceUid` stabile, promemoria giornalieri senza durata stimata);
34 icone scientifiche distinte (`CourseIcon`, nessuna generica). Nav rinominata
"Calendario personale"; sidebar xl a 288 px; titoli di sezione senza
sillabazione automatica. Verifiche: 104 test, lint, build, `barb:validate` ed
end-to-end in browser (2 corsi aggiunti, 10 appelli importati, re-import senza
duplicati) in tema scuro/chiaro e a 375 px.

Impostazioni, gruppi, notifiche e task (6 ottobre 2026): Impostazioni
riorganizzate in 6 categorie con navigazione ad ancore (Profilo, Aspetto,
Account, Privacy, Backup, Spazio e dati con zona pericolosa); Task con empty
state a CTA singola, TaskModal (Nuova task → Crea task) e durata valore+unità
(fattori in `lib/duration.ts`); campanella notifiche con badge e pannello
(lettura singola/totale, eliminazione; collezione sincronizzata); Gruppi con
bacheca (pin, link/note/file/attività), membri con ruoli, inviti per email +
codice/link (`?invito=`), cronologia attività e sync condivisa opzionale
(`supabase/groups.sql` da applicare a mano, vedi `docs/groups-sync.md`;
verificata su Postgres temporaneo con scenario Alice→Bob). Nuove collezioni
sync: SYNC_SCHEMA 3, Dexie v5. Verifiche: 108 test, lint, build ed e2e browser
completo (gruppo, risorsa, pin, invito, attività, badge) a 1440 px e 375 px.
