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

Gruppi condivisi, sync e avvio (7 ottobre 2026): la condivisione tra account non poteva
funzionare (upsert dei membri con `onConflict: "id"` su una tabella senza `id`, più la policy
di lettura che nascondeva la riga nuova al proprietario). Corretti `groups.sql` (riga propria
leggibile, niente scritture a nome di altri, trigger sulla bacheca, ruoli e uscita, codici
univoci, nome di chi entra nelle RPC) e il client (appartenenze dal server, membri autorevoli,
`sharedAt` per propagare cancellazioni e rimozioni, update mirati per ruolo e fissaggio,
attività pubblicate, niente voci doppie, salvataggio dopo ogni scrittura). Realtime della sync
personale: due sessioni in parallelo all'avvio lo spegnevano, ora serializzate. Avvio: niente
supabase-js né dataset BARB nel bundle iniziale e framer-motion con `LazyMotion` (da ~294 a
168 kB gzip). Verifiche: 115 test, lint, build, stack Supabase locale (41 controlli API ed
end-to-end nell'app su due origini). Gli ultimi ritocchi (salvataggio dopo le scritture di
groupSync, casella inviti caricata in differita dalla campanella, oggetti stabili nel merge)
hanno test, typecheck, build e prova nel browser, ma non un secondo giro sullo stack locale.
Da fare sul progetto reale: rieseguire `groups.sql`.

Inviti ai gruppi (8 ottobre 2026): pannello Invita evidente (su ogni gruppo e nel dettaglio) con
link per WhatsApp/Telegram/email/condivisione di sistema, QR code (`uqr`, scaricabile o
condivisibile), codice e invito per email; il proprietario rigenera il codice per disattivare
link e QR inviati. Link con il codice nel frammento; all'apertura l'app ricorda l'invito, apre
Gruppi con anteprima (RPC `preview_group_invite`) e un tocco per entrare; senza account si
accede o ci si registra dalla stessa scheda e si entra da soli dopo il login. Corretti anche
`isSharedAvailable` (restava "non disponibile" dopo il login) e i drawer annidati. Verifiche:
119 test, lint, build, end-to-end su stack Supabase locale (registrazione da link, anteprima,
codice rigenerato, già membro) e QR riletto con jsQR. Da fare sul progetto reale: rieseguire
`groups.sql` e aggiungere `https://massimilianociconte.github.io/StudyOS/**` ai Redirect URLs.


Icone delle materie (8 ottobre 2026): `CourseIcon` ridisegnato in stile duotone (contorno,
corpo tenue al 24% e accenti pieni, tutto `currentColor`) con metafore più specifiche:
cromosoma per genetica, polmoni per fisiologia, gaussiana per biostatistica, capsula e
compressa per farmacologia, mitocondrio, tiroide, micropiastra per la diagnostica, camice per
il tirocinio, divisione asimmetrica per le staminali. Verifiche: fogli di confronto a 100/36/20/14
px su riquadro pastello e su fondo scuro, viste BARB ed Esami nel browser, 119 test, lint, build.

Agenti MCP (9 novembre 2026): ChatGPT parla con l'hub pubblico su Cloudflare
Workers, non con `npm run agent`. Il sito pubblicato riceve l'origine da
`VITE_AGENT_HUB_ORIGIN` e non chiama il loopback, così funziona anche dal
telefono con la pagina aperta. La chiave di collegamento è un secret di
Wrangler. `npm run agent` resta per lo sviluppo e per lo stdio di Claude e
Cursor. I dati restano nell'IndexedDB del browser collegato. La discovery di
ChatGPT usa MCP `2026-07-28`: l'hub risponde a `server/discover` e `tools/list`
con `resultType`, `ttlMs` e `cacheScope`, in JSON, sia su `/mcp` sia sulla radice.
`resources/list` e `prompts/list` rispondono con elenchi vuoti. Senza una risposta
JSON-RPC valida l'accesso OAuth riesce e l'elenco azioni fallisce. Una chat già
aperta non vede il connettore finché non lo si aggiunge da +. Da fare sul progetto reale: rieseguire
`groups.sql` e i Redirect URLs, invariati rispetto all'8 ottobre.

Audit agenti MCP (9 novembre 2026, server 1.1.0): 62 strumenti, tre nuovi
(`studyos_get_libretto`, `studyos_list_barb_courses`, `studyos_add_barb_courses`).
Eventi ripetuti espansi in occorrenze, nomi delle materie nelle risposte, data e
fuso orario in stato e panoramica, date ISO validate, copertine e file mai inviati.
Conferme in coda senza bloccare le letture, risposta entro 45 s, azioni non
ritirate scartate dopo 2 minuti. OAuth: `iss` nel redirect, `resource` assente o
radice accettati, `/revoke`, loopback con porta variabile e `cursor://`. Stdio
riscritto in JSON per riga. Verifiche: 132 test, lint, build, dry-run del Worker,
stdio reale, strumenti eseguiti nell'app in sviluppo e conferma end-to-end con
l'hub locale. Da fare: deploy del Worker e push su `main`.

Semplificazione UX per chi apre l'app la prima volta (10 novembre 2026): solo parole,
gerarchia, flussi e pulsanti; aspetto grafico, dati, logica e server MCP invariati.
Navigazione in tre gruppi (Ogni giorno, Università, Strumenti) con Impostazioni in fondo
e una frase di aiuto per sezione; nomi nuovi: Home (era Dashboard), Calendario (era
Calendario personale), Attività (era Task), Corso di laurea (era BARB · UNIMI); su
telefono "Altro" apre le sezioni raggruppate. La Home ha la guida "Per iniziare" a quattro
passi che si spuntano da soli (materie, lezioni, prima attività, profilo) e si può
nascondere su questo dispositivo. "Aggiungi" chiede "Cosa vuoi aggiungere?", spiega ogni
tipo, invia con Invio e si apre dalle viste già sul tipo giusto (`src/lib/quickAdd.ts`).
Badge account e profilo aprono Impostazioni sulla categoria giusta
(`src/lib/settingsJump.ts`). In ogni vista un solo pulsante principale con verbo + oggetto,
campi rari in "Altre opzioni", stati vuoti con un'azione, conferme che dicono cosa si perde.
Esami apre "I miei esami" se ne esiste almeno uno. Verifiche: 132 test, lint, build e
giro nel browser di tutte le sezioni a 1440×900, 1024×768 e 375 px senza overflow.

Keep-alive Supabase (10 novembre 2026): il progetto Free non va più in pausa dopo 7 giorni
senza uso. Worker Cloudflare `studyos-supabase-keepalive` (`worker/keepalive.ts`, config
`worker/keepalive.jsonc`, nessun URL pubblico) con cron alle 03:17 e 15:17 UTC (una sola espressione `17 3,15 * * *`) che chiama
l'RPC `studyos_keepalive` (`supabase/keepalive.sql`: una riga aggiornata a ogni battito).
Riserva e controllo in `.github/workflows/supabase-keepalive.yml` (lun e gio): avvisa se il
Worker tace da più di 2 giorni e fallisce se Supabase non risponde. Worker distribuito con
URL e chiave publishable come secret; verificati SQL su Postgres 17 locale, giro
`--test-scheduled` contro il progetto reale e cron in produzione. Da fare sul progetto reale:
eseguire `supabase/keepalive.sql` nel SQL Editor (finché manca i cron usano una lettura di
ripiego e lo segnalano).

Condivisione granulare tra account (10 novembre 2026): nuova sezione Condivisione
(Strumenti) per dare e ricevere accesso a calendario, appelli ufficiali, attività, studio,
progressi, materiali e obiettivi, con filtro per materie e permesso «Può vedere» o «Può
modificare», modificabile e revocabile. Inviti con link, QR o email e richiesta di
condivisione in cambio. I dati altrui compaiono nelle viste con il segno della persona
(calendario sovrapposto e filtrabile, "Appelli condivisi" nel Corso di laurea, "Condivisi con
te" nelle altre sezioni) e stanno in una cache separata (`useSharedStore`, Dexie v6). Le
modifiche di altri hanno una cronologia di 90 giorni con ripristino e sono controllate dal
server (colori, link, campi protetti, colonne della riga e tipi dei campi, anche per le
scritture dirette sulla tabella). L'avviso di permesso negato compare in ogni sezione e si
chiude con "Ok". Accettare o rifiutare un invito di gruppo richiede un'email confermata.
Server MCP 1.2.0 con 8 strumenti per i dati condivisi. Verifiche dopo la revisione finale:
228 test, lint, build, `sharing-check.mjs` (114 controlli) sullo stack locale, prova su due
origini. Da fare sul progetto reale, in quest'ordine nel SQL Editor: rieseguire
`supabase/groups.sql`, poi `supabase/sharing.sql` (un unico script), poi
`supabase/sharing-verify.sql`; quindi deploy del Worker `studyos-agent` e push su `main`.
Dexie è alla versione 6: non tornare a una build precedente.

Condivisione, seguiti della revisione finale (10 novembre 2026): cronologia più leggera
(copertine, file e `sourceUid` solo nelle eliminazioni; rieseguendo `sharing.sql` le revisioni
già salvate si alleggeriscono) con l'elenco che scarica solo titoli; il ripristino riprende
copertine e file dalla copia del proprietario o dall'eliminazione successiva. Chi riceve
confronta gli id visibili solo ogni 5 minuti e quando cambiano i permessi. In "Modifiche di
altri" si annullano in un colpo le modifiche di una persona da un giorno. Il ciclo di chi guarda
è in `src/lib/shareViewer.ts`, con test per la generazione e la ricarica dopo il reset locale.
Verifiche: 239 test, lint, build, `sharing.sql` eseguito due volte e `sharing-verify.sql` (12
colonne pronte) sullo stack locale, `sharing-check.mjs` (117 controlli), prova nel browser
dell'annullamento e del ripristino di un allegato eliminato. Sul progetto reale: eseguire
`supabase/sharing.sql` e poi `supabase/sharing-verify.sql`.

Seconda revisione dei seguiti (11 novembre 2026): il negozio rifiuta, al momento di scrivere, la
versione di una modifica senza copia né eliminazione da cui prendere il file (`restoredPayload`);
sessioni, argomenti, obiettivi e note si ripristinano anche se eliminati. L'annullamento di una
persona riconosce le modifiche e le eliminazioni successive del proprietario (ora del server della
riga), permette di lasciarle com'erano, esegue solo il controllo confermato e conta ciò che non
ha ripristinato; le persone vengono da tutti i 90 giorni. Pianificazione in
`src/lib/shareHistory.ts` (caricato con `import()`), cadenza del ricontrollo in
`src/lib/shareRecheck.ts` (anche al ritorno sulla scheda). `light_history_ready` controlla anche il
corpo del trigger. Provato sullo stack locale: un `DELETE` vero non arriva mai sul canale Realtime
filtrato per proprietario. Verifiche: 249 test, lint, build, SQL due volte e verifica, 121 controlli,
prova nel browser dell'annullamento (riepilogo cambiato tra controllo e conferma, elementi lasciati
com'erano) e del ripristino di un obiettivo eliminato.

Più account sullo stesso connettore MCP (11 novembre 2026, server 1.3.0): ogni browser collegato
manda all'hub un id casuale e il nome del profilo, e l'hub tiene un account per nome. Ogni strumento
ha il parametro facoltativo `account`, obbligatorio quando gli account sono più di uno, e
`studyos_list_accounts` li elenca. Le azioni vanno solo ai browser dell'account scelto. Logica in
`src/agent/accounts.ts`, instradamento in `src/agent/httpHub.ts`, test in
`tests/agent-accounts.test.mjs`. Verificato con l'hub locale e due browser, «Massimiliano Ciconte» e
«Camilla Rossi»:
- una task creata con `account: "Camilla Rossi"` arriva e chiede conferma solo nello StudyOS di Camilla;
- senza nome, o con un nome sconosciuto, la risposta elenca gli account e non esegue niente;
- «Scollega questo browser» toglie l'account dall'elenco.

Per usarlo con ChatGPT servono il deploy del Worker e la pubblicazione del sito, poi va ricreato il
connettore.

Connettore remoto di un solo account (11 novembre 2026, server 1.4.0): un secondo connettore,
`https://<hub>/u/<nome>/mcp`, lavora sui dati cloud dell'account con StudyOS chiuso. «Consenti»
nello StudyOS di quell'account crea un permesso (`supabase/agent.sql`, solo l'hash del segreto nel
database); l'hub conserva il segreto legato al token e con la chiave publishable chiama
`studyos_agent_pull` e `studyos_agent_push`. Gli strumenti sono quelli dell'app eseguiti
sull'hub (`src/agent/cloudRunner.ts`), nel fuso del browser che ha dato il consenso
(`src/agent/zonedDate.ts`); esclusi condivisioni, risorse dei gruppi, cronometro e registro.
Verificato:
- `scripts/supabase/agent-check.mjs` 25 controlli e `supabase/agent-verify.sql` tutto `true` sullo
  stack locale;
- `tests/cloudRunner.test.mjs`, `tests/cloudHub.test.mjs`, `tests/zonedDate.test.mjs`;
- end-to-end con l'hub locale e con `wrangler dev`: consenso di «Camilla Rossi» con l'app, poi app
  chiusa e chiamate MCP (materia, task con scadenza, evento alle 9 di Roma, eliminazione, panoramica);
  riaperta l'app con lo stesso account, le modifiche c'erano; la revoca dall'app blocca il connettore;
- CPU su 1340 righe (935 KB): 0,2–6 ms per chiamata a Worker caldo, prima lettura completa circa 5 ms;
  la prima richiesta di un Worker appena avviato arriva a 25–50 ms (compilazione).

Per usarlo: `agent.sql` e `agent-verify.sql` nel SQL Editor, secret `STUDYOS_SUPABASE_URL` e
`STUDYOS_SUPABASE_KEY` sul Worker, deploy del Worker e pubblicazione del
sito. Non provato sul progetto reale.

Ricerca di persone, inviti all'account e notifiche push (11 novembre 2026): la conferma email è
spenta sul progetto reale (account attivi alla registrazione), quindi nessun invito si accetta
più per email. Chi ha un account si trova con l'email esatta o con `@nome` (profilo trovabile di
default, si spegne in Impostazioni → Profilo) e si invita in un gruppo o a vedere i propri dati;
l'invito è legato all'account del destinatario, che lo vede in Notifiche e lo accetta con un
tocco. Link, QR e codice restano per chi non ha un account; gli inviti per email già pendenti
vengono legati una volta sola o risultano "Scaduto". Notifiche push (browser, Android, iPhone e
iPad con l'app nella schermata Home) per invito ricevuto, invito accettato e permesso cambiato:
trigger SQL → `pg_net` → Worker `studyos-agent` `/push` (cifratura RFC 8291, VAPID, nessuna
`service_role`) → servizio push → service worker; il permesso del browser si chiede solo dopo
un tocco e toccare la notifica apre la pagina giusta (`?apri=`). Agenti MCP invariati (nessuno
strumento nuovo). Sul progetto reale: rieseguire `groups.sql`, `sharing.sql` e `people.sql`
(prima del push su `main`, che pubblica il client: legge `recipient_user_id` e senza la colonna
si fermano gruppi e condivisioni), poi `people-verify.sql` tutto verde;
abilitare `pg_net`; `node scripts/push-keys.mjs`; segreti in Vault; quattro `wrangler secret put`
e `wrangler deploy`; push su `main`.
Verifiche della ricerca persone e delle push (11 novembre 2026): 291 test, lint, build, `barb:validate`;
stack locale: `groups.sql`, `sharing.sql` e `people.sql` due volte e `people-verify.sql`, `people-check.mjs`
109 controlli e `sharing-check.mjs` 121 controlli, 0 falliti; prova nel browser con tre account (ricerca per
email e `@nome`, profilo non trovabile, invito di gruppo e di dati con accettazione immediata, permesso cambiato,
interruttore e proposta una tantum, `?apri=`, uscita dall'account, inviti dal vivo anche dopo un accesso senza ricaricare). La consegna push vera si prova sul
progetto reale dopo il deploy del Worker. Il browser integrato nega il permesso delle notifiche e non registra il
service worker: permesso concesso, iscrizione, tocco sulla notifica e iscrizione tolta all'uscita si ripetono su
un browser vero.

Ricerca persone e push su `main` (12 novembre 2026): il ramo `claude/people-push-6582b6` è unito
sopra la revisione del 12/11 (senza i suoi tre commit finali su gruppi e connettore, che `main`
aveva già risolto a modo suo). Gli inviti di gruppo ricevuti hanno un solo percorso, per account:
lettura, Realtime, notifiche, chiusura delle notifiche e ritiro degli inviti usano
`recipient_user_id` (`isReceivedInvite`, `invitesToNotify` in `src/lib/groups.ts`), mai l'email.
L'unico uso rimasto dell'email è togliere le copie locali di vecchi inviti per email mai legati a un
account (`isLegacyEmailInvite`). `accept_group_invite` in `groups.sql` e `people.sql` è la stessa:
account destinatario, membro senza email, una sola voce «è entrato nel gruppo».
