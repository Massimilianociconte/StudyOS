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
abilitare `pg_net`; chiavi (due strade in `supabase/README.md`, «Notifiche push»); segreti in Vault; quattro `wrangler secret put`
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
Revisione dopo la review (12 novembre 2026, sera): il nome di chi entra in un gruppo o condivide
non viene più dalla parte locale dell'email (client e `studyos_member_name`: profilo, poi profilo
online, poi «Studente»); un invito a una persona non porta il codice del gruppo; il limite per IP
usa solo `cf-connecting-ip`; la migrazione degli inviti per email lega solo account confermati
prima dell'11/11/2026 e scioglie i legami fatti prima verso account più recenti; i passi delle
push in `supabase/README.md` hanno le due strade per le chiavi (privata dell'11/11 o `--rigenera`).
Da rieseguire sul progetto: `groups.sql`, `people.sql`, `people-verify.sql` (quattro colonne
nuove). Verificato su Postgres usa e getta (porta 55501): script applicati due volte, 33 controlli
di `people-tests` veri (nomi, codici, IP, migrazione, idempotenza); `people-check.mjs` aggiornato
ma non eseguito (serve lo stack locale).

Registro e ripristino del connettore remoto, pagine esatte (12 novembre 2026, server 1.8.0):
ogni scrittura del connettore remoto lascia una voce in `studyos_agent_audit` (prima e dopo,
strumento, permesso), scritta dentro `studyos_agent_push`; 90 giorni, al massimo 2000 voci per
account. `studyos_list_audit` sul remoto legge quel registro, `studyos_restore_change` (solo
remoto) annulla una voce se l'elemento non è cambiato dopo; nell'app «Modifiche del connettore» in
Impostazioni → Agenti fa lo stesso (`src/components/AgentChangesDrawer.tsx`, caricato al tocco).
Nuovo `studyos_split_pages` (`src/agent/pageSplit.ts`) e regola delle pagine inclusive nelle
istruzioni del server. Verificato: `tests/pageSplit.test.mjs`, `tests/remoteAudit.test.mjs`,
`tests/agentChanges.test.mjs`; `agent.sql` applicato due volte su Postgres usa e getta, `agent-verify.sql`
tutto `true`, `scripts/supabase/agent-audit-check.sql` 35 controlli. Per usarlo: rieseguire
`agent.sql` e `agent-verify.sql`, deploy del Worker, pubblicazione del sito, poi ricreare il
connettore. Non provato sul progetto reale né con PostgREST.

File dei materiali in Supabase Storage (12 novembre 2026): i byte dei file non passano più dalle righe
sincronizzate. Un file nuovo va nella copia locale (Dexie v7, cifrata dal vault) e poi nel bucket
privato `studyos-files` (`supabase/storage.sql`, 25 MB, tipi ammessi) in `<uid>/<id>`; i file
incorporati di prima si migrano da soli con account e rete. Chi riceve un materiale condiviso ne
scarica il file finché vede la riga. Il backup completo include i file. Verificato:
`tests/attachments.test.mjs`, `npm test` e `TZ=UTC npm test`, lint, build (supabase-js fuori dal
bundle iniziale), SQL su PostgreSQL 17 con stub di auth e storage (policy, lettura di chi riceve,
revoca, `storedFile` protetta, connettore remoto), e su uno stack Supabase locale con lo Storage
vero: tutti gli script applicati due volte, `verify.sql` e `agent-verify.sql` tutto pronto, 20
controlli con le stesse chiamate REST dell'app (caricamento e upsert, download, elenco, HTML e oltre
25 MB rifiutati, cartelle altrui e sottocartelle rifiutate, chi riceve scarica ma non scrive né
elimina, revoca immediata). Non provato nel browser né sul progetto reale. Per usarlo: `storage.sql`, poi `sharing.sql`/`agent.sql` se in uso, poi i verify (vedi
supabase/README.md). Design: [../superpowers/specs/2026-11-12-attachments-storage-design.md](../superpowers/specs/2026-11-12-attachments-storage-design.md).


Promemoria con l'app chiusa (12 novembre 2026): i promemoria degli eventi (esami e appelli
compresi) arrivano come Web Push anche senza una scheda aperta, su ogni dispositivo con le
notifiche attive, senza doppioni con la scheda aperta (stesso tag). Nuovo `supabase/push-reminders.sql`
(tabella `studyos_push_reminders` per account, `studyos_push_due_reminders()` ogni minuto con
`pg_cron`) e `push-reminders-verify.sql`; `schema.sql` (erase) toglie anche queste righe; il
Worker accetta il tipo `reminder` e corpi fino a ≈ 617 kB. Interruttore per account in
Impostazioni → Notifiche (`preferences.pushReminders`). Ogni uscita e cancellazione spegne prima
le notifiche del dispositivo (`turnOffPushHere`), e la sessione che finisce da sola le segue
(`startPushSessionGuard`). Dettagli e passi in [../push-reminders.md](../push-reminders.md).
Verifiche: `npm test` (1323, anche con `TZ=UTC`), lint, build (bundle iniziale senza supabase-js);
SQL su Postgres 17 temporaneo con stub di `pg_net`, Vault e `pg_cron` (script applicati tre volte,
36 controlli verdi). Sul progetto reale, non ancora fatto: attivare `pg_cron`, eseguire
`push-reminders.sql` e rieseguire `schema.sql`, `push-reminders-verify.sql` tutto verde, deploy del
Worker. La consegna vera con l'app chiusa si prova su un browser vero dopo il deploy.

Promemoria, dopo la revisione (12 novembre 2026, sera): una notifica per promemoria su ogni
dispositivo in ogni ordine (pagina e service worker condividono la cache `studyos-push-local-v1`:
la push mostrata non si ripete nella pagina, quella della pagina rende silenziosa la push);
`sent_at` dalla scheda solo se in uso; trigger che non lascia spostare né rimettere in coda le
righe, tetto di 400 righe per account (anche mandate), job a turno tra gli account e al più 60
promemoria all'ora per account (`studyos_push_reminder_sends`); con la password dell'app i
promemoria dicono solo «Promemoria StudyOS» e l'ora (colonna `private` per dispositivo,
interruttore «Mostra il titolo nelle notifiche»); dispositivi dell'account con «Rimuovi»; righe di
dispositivi in fusi diversi che non si cancellano a vicenda (colonna `zone`); cambio di account
che non scrive i promemoria di un account nell'altro; guardia della sessione anche con il permesso
dato dopo; filtro per account nel service worker (`account` per iscrizione nel messaggio cifrato)
e iscrizione tolta dal server quando la sessione finisce (`session_id`, trigger su
`auth.sessions`, facoltativo). Sul progetto reale: rieseguire `people.sql`, poi
`push-reminders.sql`, i due verify, deploy del Worker. Verifiche: `npm test` (1427, anche con
`TZ=UTC`), lint, build; SQL su Postgres temporaneo con le sonde della revisione.

Dopo la revisione: le voci hanno `call_id` (una chiamata dello strumento, anche su più push) e si
elencano e si annullano per chiamata, tutto o niente, con l'elemento in conflitto nella risposta
(`studyos_agent_restore_call(_own)`; `onlyThisChange` per una voce sola); frasi «Hai…» per i
ripristini fatti dall'app; nessun file nelle immagini dei tombstone; potatura delle 2000 voci solo
oltre 2100; il Worker riprova la push nuova ogni 10 minuti dopo un PGRST202; `studyos_split_pages`
sul remoto non legge il cloud. `agent-audit-check.sql` 59 controlli, anche sopra l'`agent.sql`
della prima revisione.

## Appelli condivisi dei gruppi (12 novembre 2026)

Costruito: appelli, correzioni al catalogo BARB e cronologia nei gruppi (`supabase/group-exams.sql`,
[../group-exams.md](../group-exams.md)); piano d'esame personale (`examPlans`, Dexie 8, `SYNC_SCHEMA` 4);
appelli nel calendario (default «tutti»), nella pagina della materia e nella scheda «Appelli» del gruppo;
«Docenti e aule» per le correzioni; promemoria autonomi nel pannello Notifiche; 21 strumenti MCP nuovi
(94 in tutto, 73 in `catalog.ts`, server 1.9.0); il connettore remoto legge appelli e correzioni da
`studyos_agent_group_snapshot` ma non li scrive. Una sola regola per le email (SQL e TS, vettori
condivisi); trigger che tiene fissi `user_id` e `group_id` dei membri (`groups.sql`). Le notifiche di
appelli nuovi o cambiati sono solo in app (niente push, Task 23 non fatto); i promemoria di un appello
scelto partono anche con l'app chiusa.

Verifica finale unica (Task 25, 13 novembre 2026, commit 59b0ca6): `npm run lint` pulito, `npm test`
e `TZ=UTC npm test` 1648/1648, build ok, nessun client Supabase nel bundle d'ingresso; gli 8 script SQL
applicati sullo stack locale e i 5 verify (`security_issues` vuoto, tutto `t` tranne `cron_ready`, che in
locale non c'è); `people-check` 122/122; e2e 8/8 (anche `08-group-exams.spec.ts`).

Resta alla persona sul progetto reale: eseguire `group-exams.sql` (dopo `schema`, `groups`, `sharing`,
`people`, `storage`, `agent` e `push-reminders`) e le verifiche (`verify.sql`, `sharing-verify.sql` con le
`group_exams_*` vere), pubblicare il client subito dopo (vuole `people.sql` e `group-exams.sql`),
ridistribuire il Worker 1.9.0 e ricreare i connettori.

## Revisione finale del ramo (13 novembre 2026)

Correzioni dopo la revisione finale:

- le notifiche di persone e gruppi (`studyos_push_notify`) mandano ai dispositivi con `private`
  solo «StudyOS» / «Hai una nuova notifica.», con lo stesso link e tag, in lotti separati da 15
  iscrizioni (erano 40: CPU del Worker sul piano Free). Controllo: `push_private_ready` in
  `people-verify.sql`;
- il service worker mostra lo stesso testo generico, con lo stesso tag, per una push di un altro
  account invece di scartarla (le push sono `userVisibleOnly`);
- «Cancella tutti i dati» svuota anche la cache `studyos-push-local-v1` (promemoria mostrati,
  account del service worker riscritto solo se resta una sessione) e i segni `gexam-seen:`;
- `push_studyos_rows` tiene `storedFile` della riga salvata quando una scheda vecchia lo omette
  (`stored_file_guard_ready` in `verify.sql`).

Prove SQL: `scripts/supabase/push-notify-tests.sql` (i sei trigger) e `stored-file-tests.sql` in
`scratch-pg.sh`; `scripts/supabase/upgrade-from-published.sh` applica il SQL pubblicato (c28f036),
scrive righe di allora (email nei membri, inviti per email, nomi dalla parte dell'email, nome di
gruppo oltre 120 caratteri, id con lo spazio), poi gli 8 script attuali due volte e i 5 verify.

Sul progetto reale, in quest'ordine (passi completi in `supabase/README.md`, «Pubblicazione di
questa versione»):

1. eseguire il SQL (gli 8 script, anche `people.sql` e `schema.sql` già eseguiti) e i 5 verify;
2. pubblicare il client subito dopo, poi ricaricare o chiudere le schede vecchie dopo la
   pubblicazione, su ogni dispositivo;
3. deploy del Worker;
4. solo dopo il Worker, attivare i segreti nel Vault, `pg_net` e `pg_cron` (prima del Worker
   nuovo le push andrebbero a un indirizzo senza `/push` e si perderebbero).

Passo 1 fatto il 13/11/2026: gli 8 script di questo ramo, `university.sql` (la tabella c'era) e la
revoca di `EXECUTE` su `rls_auto_enable()` (funzione di Supabase per la RLS automatica). Tutti i
verify come previsto: `security_issues` vuoto; restano `false` solo `vault_ready` e `cron_ready`
fino al passo 4. `pg_net` era già attivo. La prima prova era fallita perché gli script venivano da
una copia vecchia (`groups.sql` senza la guardia sui membri).

Passo 2 fatto il 13/11/2026: client pubblicato (`main` = bcb2c3a). Passo 3: il primo deploy del
Worker è stato rifiutato (10021: `persistence.ts` chiedeva un UUID mentre si caricava il modulo);
corretto in 4a35e39 (`outboxWriter()` al primo uso, test `workerGlobalScope.test.mjs`), poi deploy
riuscito. `/health` risponde 1.9.0 dopo circa 3 minuti, quando Cloudflare riavvia il Durable Object.
`/push` risponde 503 finché mancano `STUDYOS_PUSH_SECRET` e `STUDYOS_VAPID_PRIVATE_KEY` (li mette la
persona).

Passo 4 fatto il 13/11/2026: i due segreti nel Worker (`/push` senza segreto ora dà 401), il Vault
(blocco del README, segreto messo dalla persona), `pg_cron` attivo, `push-reminders.sql` rieseguito
(job `studyos-push-reminders` ogni minuto). `push-reminders-verify.sql` e `people-verify.sql` tutto
`true`. Restano: ricollegare i connettori (`/mcp`, `/u/camilla-rossi/mcp`, `/u/chicca/mcp`) e la
prova del passo 5 (una notifica vera conferma anche la coppia di chiavi VAPID).

## Flashcard, quiz, ripasso e richieste agli agenti (16 novembre 2026, ramo `claude/flashcards-quiz`)

Nuova sezione **Ripasso** (raccolte, flashcard a blocchi JSON con KaTeX, SVG ripulito e immagini
https, quiz a risposta singola o multipla, ripasso a intervalli tipo SM-2 con Corretta/Sbagliata/
Dubbia/Salta, statistiche, Analisi AI, «Spiegami meglio»), connettore 1.10.0 con 21 strumenti nuovi
(115 in tutto) e sezione di condivisione «Flashcard e quiz». Nessuna chiave di fornitori AI: i testi
li scrivono gli assistenti collegati via MCP. Design:
[../superpowers/specs/2026-11-16-flashcards-quiz-design.md](../superpowers/specs/2026-11-16-flashcards-quiz-design.md).

SQL sul progetto reale (16/11/2026, SQL Editor della dashboard): `sharing.sql`, `people.sql`,
`agent.sql`, poi `agent.sql` di nuovo con la guardia corretta dalla revisione; `verify`,
`sharing-verify`, `people-verify` e `agent-verify` tutti `true` (`security_issues` vuoto,
`revision_guard_ready` con richieste agli assistenti e interi sicuri). Il Worker 1.9.0 ha funzionato
con questo SQL (pull senza `p_types`) fino al deploy del 1.10.0.

Revisione completa dopo l'iniezione (quattro revisori: modello e store, SQL, connettore, UI), tutto
corretto e riprovato:

- quiz con più di 400 domande: punteggio su tutte le risposte e righe di continuazione senza
  punteggio (prima: risposte perse e punteggio sbagliato); id delle opzioni stabili quando se ne
  inserisce una in testa o se ne toglie una; contatori del ripasso mai `NaN`;
- `safeUrl`: rifiutati `localhost.`, `%2e`, host senza punto, IPv4 esadecimali/interi (diventano
  127.0.0.1), CGNAT, 0/8, multicast, `.lan`, `.home.arpa`, `fritz.box`, IPv6 letterali;
- copia di una raccolta: `externalRef` tolta, altezza dell'albero controllata (prima 14 livelli);
  raccolte in un ciclo di genitori mostrate come radici;
- quiz condivisi: chi riceve non cambia raccolta e materia; spostando un quiz la materia segue la
  raccolta (anche nessuna) e le domande si riallineano (anche da `studyos_save_decks`);
- connettore: id stabili mai uguali a quelli di una raccolta condivisa (lo stato di ripasso di una
  scheda finiva sull'altra) e ambito per materia o raccolta madre; indice delle raccolte per array
  (`deckById`) e conteggi in un passaggio (prima 47 ms con 600 raccolte); risposte troppo grandi
  sempre JSON valido (SVG omessi, poi errore); conflitti del database come `status=conflict` per
  elemento; righe inviate in ordine (niente deadlock fra due hub); due prese della stessa richiesta
  nel cloud escluse (`revision` della richiesta e guardia SQL); spiegazioni oltre 96 kB rifiutate;
- SQL: guardia in plpgsql, solo interi sicuri (una revisione `1e300` bloccava la scheda per
  sempre), `hub_rpc_ready` falso se torna il pull a quattro argomenti, prove nuove in
  `scripts/supabase/agent-revision-tests.sql` (dentro `scratch-pg.sh`);
- UI: la scheda successiva non si mostra più girata, tasti ignorati sotto un altro dialogo e se
  tenuti premuti, immagini «tocca per caricare» non ereditate fra domande, pulsante «Mostra la
  risposta» per tastiera e screen reader nel drawer e nell'anteprima, tabelle delle statistiche a
  375 px, formule in linea contenute, doppio invio bloccato (Duplica, Invia, Pubblica, Enter),
  conferma di eliminazione non ereditata dalla sotto-raccolta.

Verifiche eseguite, tutte in locale, sul codice finale del ramo (prima del commit d95a61c):

- dopo la revisione: `npm run lint` pulito, `npm test` 1714/1714, `vite build` ok (ingresso 212,56
  kB gzip), Worker `--dry-run` 584,51 KiB gzip; `scratch-pg.sh` ok con le 21 prove della guardia;
  stack locale con gli script riapplicati: `agent-check` 35/35, `sharing-check` 136/136, verify
  tutti `t`; `learning-stress.mjs` 35/35 (scenario D: 25 `conflict` per elemento, 0 modifiche
  perse, 1 scheda per `externalRef`); `npm run e2e` 10/10 (la prova 09 ora aspetta la chiusura
  del drawer: il drawer in uscita e la sessione hanno lo stesso nome);
- prima della revisione: `npm run lint` pulito; `npm test` 1711/1711 (anche KaTeX vero con LaTeX ostile: `\href`,
  `\htmlStyle`, `\includegraphics`, `<script>`; con `trust: true` il test fallisce); `vite build`
  ok, ingresso 212,56 kB gzip (prima 211,85); Worker `--dry-run` 582,35 KiB gzip (prima 543,8).
- `scratch-pg.sh`: tutte le prove SQL, comprese FC1–FC11 di `learning-share-tests.sql`
  (condivisione: lettura, permessi, 13 attacchi sui tipi dei campi, stati di ripasso non scrivibili,
  revoca). Una mutazione del controllo dei campi o della lista dei tipi fa fallire FC8/FC2/FC4.
- Stack locale, dopo aver riapplicato gli 8 script: `sharing-check` 136/136, `agent-check` 35/35
  (`p_types`, controllo di revisione, creazione simultanea), `people-check` 122/122; verify tutto
  `t`, `security_issues` vuoto, solo `cron_ready` falso (in locale non c'è).
- `npm run e2e` 10/10, con due prove nuove: `09-share-flashcards` (Alice condivide, Bob ripassa in
  sola lettura, la risposta resta sua) e `10-quiz` (quiz in allenamento, punteggio salvato).
  Hanno trovato un difetto: l'editor di una flashcard o di una domanda nuova si apriva senza campo
  di testo (`safeBlocks` scartava il blocco vuoto iniziale); corretto con `keyBlocksOrBlank`.
- `learning-stress.mjs`, scenari A–F, 35/35: 1000 schede in 10 lotti, lotto ripetuto senza
  doppioni; 3000 risposte e statistiche; 22 richieste «Spiegami meglio» con un secondo account che
  non le vede, non le prende e non le chiude, e parametri `ownerId/userId/account` ignorati; due
  assistenti in due processi sulla stessa raccolta (prima: 25 modifiche dette salvate e perse e 2
  schede per la stessa `externalRef`; dopo il controllo di revisione e `stableId`: 0 perse, 1
  scheda, il secondo riceve «Modifica salvata solo in parte… Rileggi i dati e riprova.»); 3
  account insieme in 201 ms; gruppo di 6 con una raccolta condivisa (5 pull in parallelo in 147 ms,
  ~100 ms e 200 kB ciascuno) e progressi separati.
- CPU per chiamata (processo Node, **stima**, non il `cpuTime` del Worker), mediana (p95):
  `learning_stats` calda 4,4 (17,3), a freddo 11,7, prima chiamata ~50; `list_flashcards` a freddo
  con 1000 schede 7,4 (11,6); `save_flashcards` ×100 6,9 (12,3), con 3 account 9,7 (14,7). Le
  chiamate a freddo e i lotti grandi stanno vicino o sopra i 10 ms del piano Free: da misurare con
  `wrangler tail` dopo il deploy.
- Spazio: payload medio per riga flashcard 650 B, stato di ripasso 492 B, domanda 504 B, richiesta
  700 B, sessione di ripasso ~11,5 KB. Un account con 1000 schede ripassate tutte occupa circa
  1,2 MB di payload (indici e overhead di Postgres esclusi).

Pubblicato il 16/11/2026, con il permesso della persona: commit d95a61c su `main` (fast-forward da
47647e3), workflow Pages riuscito (run 43913395021) e sito pubblicato con la nuova sezione Ripasso
(il bundle `LearnView` contiene «Mostra la domanda»). Worker `studyos-agent` distribuito (Version ID
dd16d208-7c3e-42b0-8aea-158740457b14, 100%); `/health` è passato a `"version":"1.10.0"` solo alle
17:05 UTC, circa 10 minuti dopo il deploy, quando Cloudflare ha riavviato il Durable Object (prima
`wrangler tail` mostrava già la versione nuova). Per vedere i 21 strumenti nuovi vanno ricreati i
connettori in ChatGPT e Claude.

Non fatto: misura vera della CPU con `wrangler tail` sulle chiamate nuove (piano Free, 10 ms),
prova con ChatGPT/Claude veri sui 21 strumenti nuovi (provati solo con i test del server MCP, il
runner del connettore remoto in Node e l'app nel browser).

## Ripasso più semplice e icone delle materie (16 novembre 2026, ramo `claude/flashcards-quiz`)

Su richiesta: avviare, terminare e valutare un ripasso doveva essere più immediato. Dettagli in
[../superpowers/specs/2026-11-16-flashcards-quiz-design.md](../superpowers/specs/2026-11-16-flashcards-quiz-design.md) §13.
Un pulsante «Ripassa N schede» (in scadenza poi nuove, al massimo le schede per sessione), raccolte
con un tocco, «Personalizza» con cinque scelte spiegate; nella sessione «Com'è andata?» con «torna tra
…» per ogni risposta e la domanda visibile sul retro; «Termina» porta a un riepilogo che valuta la
sessione (percentuale, conteggi, tempo, da rivedere, continua). Ogni flashcard, raccolta e quiz mostra
l'icona della sua materia (`src/components/SubjectMark.tsx`, catalogo BARB caricato a parte con
`src/lib/useCourseLookup.ts`). Tasti cambiati: 1 sbagliata, 2 dubbia, 3 corretta, 4 salta.

Verifiche: `npm test` 1717/1717 (nuove prove di coda consigliata, difficili o dubbie, esclusione delle
schede viste, attese e prossima scadenza), `npm run lint` pulito, `vite build` ok (ingresso 212,83 kB
gzip). Flusso provato con Playwright sul server di sviluppo a 375 px e 1280 px, anche da tastiera:
nessuno scorrimento orizzontale. `npm run e2e` 10/10 sullo stack locale (09 aggiornata al nuovo flusso:
«Ripassa» diretto, «torna tra 10 min», riepilogo).

Pubblicato il 16 novembre 2026: commit `86029ed` su `main`, workflow Pages riuscito (build e deploy).
Sul sito pubblicato il blocco di LearnView contiene i nuovi testi («Personalizza il ripasso»,
«Ripassa comunque», «torna tra», «Continua con altre», legenda dei tasti). Nessuna modifica a
database o Worker: il connettore resta 1.10.0.

## Tema che torna al predefinito (16 novembre 2026)

Segnalazione: entrando, ogni tanto il tema tornava a «Scuro · Aurora» anche dopo averlo cambiato.
Causa: `themeMode` e `palette` stavano solo nelle impostazioni del browser (IndexedDB
`studyos-local-db`, tabella `settings`), mai nel cloud. Ripartivano dal predefinito su ogni altro
dispositivo o browser, nell'app installata sulla schermata Home (spazio separato dal browser) e quando
il browser libera lo spazio del sito. SQL iniettato, Worker e agenti non toccano questi campi; un
nuovo deploy non svuota IndexedDB (il service worker cancella solo le sue cache).

Correzione: tema e palette stanno anche nell'entità sincronizzata `preferences`
(`src/lib/accountLook.ts`, `updateAppearance` nello store). Le impostazioni del dispositivo ne tengono
una copia, riallineata quando le preferenze arrivano (avvio, sblocco, pull, cambio account). Il tema
già scelto su un dispositivo passa all'account dopo la prima sincronizzazione della sessione, solo se
non è quello predefinito. Densità e sezione all'apertura restano del dispositivo; Impostazioni ›
Aspetto lo dice. Gli altri colori (materie, eventi, colori delle tipologie, tag, widget, raccolte) erano
già nelle entità sincronizzate; le note non hanno un colore proprio. Resta il limite noto delle
preferenze in LWW (vedi GOTCHAS).

Verifiche: `npm test` 1728/1728 (11 nuove in `tests/accountLook.test.mjs`), `npm run lint` pulito,
`vite build` ok (ingresso 213,22 kB gzip). In Chromium headless sul server di sviluppo: scelta dal
pulsante della barra e dalla palette, ricarica, impostazioni locali cancellate (il tema torna
dall'account), cambio arrivato da un altro dispositivo (si applica e resta dopo la ricarica); a 375 px
nessuno scorrimento orizzontale. Non provato con due dispositivi veri sul cloud.

Pubblicato il 16 novembre 2026: commit `05f6376` su `main`, workflow Pages riuscito (build e deploy);
il codice pubblicato contiene `updateAppearance` e la frase in Aspetto. Nessuna modifica a database o
Worker.

## Flashcard e quiz: indietro, tastiera, aspetto e schermi (17 novembre 2026)

Su richiesta: nel ripasso si poteva solo andare avanti. Ora Indietro e Avanti (pulsanti e frecce ← →)
scorrono le schede; una scheda già vista si ritrova girata con la risposta data e se ne può scegliere
un'altra (`changeCardAnswer` in `src/store/learning.ts`: sostituisce l'evento e rifà lo stato di
ripasso da prima della risposta). Schede ridisegnate (colore della materia sul fronte, accento sul
retro, pila dietro, testo breve grande), avanzamento a tacche colorate, «Torna alle schede» dal
riepilogo. Quiz: Indietro anche in allenamento, numeri delle domande per saltare, tasti A–F/1–6 e
Invio, «Segna come dubbia» nella domanda, due colonne su tablet in orizzontale, computer e telefono in
orizzontale, modalità in una griglia 2×2. Dettagli nella specifica
[../superpowers/specs/2026-11-16-flashcards-quiz-design.md](../superpowers/specs/2026-11-16-flashcards-quiz-design.md) §13.

Verifiche: `npm test` 1732/1732 (nuove: cambio di risposta nello store, `tests/learnNav.test.mjs`),
`npm run lint` pulito, `vite build` ok. Con Playwright (Chromium) sul server di sviluppo, 15 schermi:
telefoni 320×568, 360×780, 375×667, 393×852, telefono in orizzontale 844×390 e 667×375, iPad mini
744×1133, iPad 820×1180 e 1180×820, Galaxy Tab S8 800×1280 e 1280×800, iPad Pro 1024×1366, computer
1280×720, 1440×900, 1920×1080 (tocco emulato su telefoni e tablet). Su ognuno: indietro, cambio di
risposta (un solo evento salvato), salta e avanti, riepilogo e ritorno; quiz in allenamento con
indietro e numeri, simulazione con salto alla domanda 12; nessuno scorrimento orizzontale, nessun
pulsante fuori schermo o tagliato, bersagli di almeno 40 px (numeri del quiz 32–36 px). Tema chiaro e
«riduci movimento» provati su 393×852 e 1440×900. Non provati su dispositivi veri né su Safari/WebKit;
`npm run e2e` non eseguito (Docker spento): `10-quiz.spec.ts` aggiornato alla griglia delle modalità e
gli stessi passaggi di interfaccia di 09 e 10 provati sul server di sviluppo.

Pubblicato il 17 novembre 2026: commit `b7aba92` su `main`, workflow Pages riuscito (build e deploy);
il codice pubblicato contiene «Torna alle schede», «La tua risposta» e le due nuove media query in
orizzontale. Nessuna modifica a database o Worker.

## Incidente: dispositivo vuoto dopo la prima sync (Opera, 16–17 novembre 2026)

Su Opera (macOS) l'account Birillo è comparso vuoto dopo il ricaricamento portato dalla
pubblicazione delle 00:11; Chrome (Camilla Rossi) andava. Il cloud era intatto (nessuna eliminazione
in massa); Cmd+R non bastava, «Riscarica tutto dall'account» ha rimesso tutto (materie 14, eventi 63,
flashcard 70). Segni rimasti su Opera: `cloud:merged`/`cloud:migrated` alle 23:27:36 ora italiana
(prima sync da capo), cursore all'ultima riga del cloud delle 23:33, impostazioni riscritte alle 00:14
al ricaricamento.

Causa nel codice (riprodotta): se il browser svuota IndexedDB con la scheda aperta, Dexie riapre da
solo un database vuoto e la scheda continua con tutto in memoria. Spariti anche i segni della sync,
parte una prima sync: il cloud coincide con la memoria, il merge non cambia nulla e quindi non scrive
nulla, poi `migrated` e cursore vengono segnati. Dopo un ricaricamento il disco ha solo ciò che è
cambiato dopo lo svuotamento, e i pull rileggono solo dal cursore meno 60 s. Correzione:
`rewriteLocalCopy()` in `src/lib/persistence.ts`, chiamata da `firstSync` dopo il merge e prima dei
segni, riscrive impostazioni e dati (o la copia cifrata) senza voci in coda. Il motivo per cui Opera
ha svuotato il database alle 23:27 non è noto (spazio liberato dal browser, pulizia dei dati del sito
o un'estensione): dedotto dai segni, non osservato. Le modifiche flashcard di quella sera non c'entrano.

Verifiche: `tests/persistenceRewrite.test.mjs` (5 prove: buco del diff, modifiche in sospeso prima
con la loro coda, bloccato/sospeso, vault, scheda fermata) fallisce senza la funzione;
`tests/e2e/11-storage-cleared.spec.ts` fallisce senza la correzione («Più vecchia …» assente dopo il
ricaricamento) e passa con. `npm test` 1737/1737, `npm run lint` pulito, `npm run build` ok,
`npm run e2e` 11/11 sullo stack Supabase locale. Non provato su Opera vero né su Safari/Firefox.

Aperti: un dispositivo senza account nella stessa situazione perde comunque i dati (nessuna prima
sync che riscriva); l'app non chiede `navigator.storage.persist()`, quindi Chromium può liberare lo
spazio del sito.

Pubblicato il 17 novembre 2026: commit `8bd3341` su `main`, workflow Pages riuscito (build e deploy);
il bundle pubblicato contiene la riscrittura della copia cifrata (transazione su `settings` e `vault`
soli). Nessuna modifica a database o Worker.

## Ripasso: gerarchia nuova, dubbi, pausa e ripresa (18 novembre 2026, ramo `claude/flashcards-quiz`)

Sezione Ripasso rifatta per leggere subito le informazioni principali. Schede nell'ordine d'uso
(Oggi, Dubbi, Raccolte, Quiz, Andamento, Analisi AI) con i numeri di cosa c'è da fare; via il
sottotitolo. **Oggi**: «Da riprendere» in cima, poi il numero grande delle schede di oggi con barra
in ritardo / da ripassare / nuove e un solo pulsante, le raccolte con contatori a colori, le ultime
sessioni con barra dei risultati al posto delle frasi. **Quiz**: ultimo, migliore e domande in tre
riquadri, un solo pulsante principale (Inizia o Riprendi) e il resto nel menu ⋯; regola del
punteggio richiudibile. **Raccolte**: righe senza il livello, «Nuova raccolta» secondaria.

**Dubbi**: pulsante «Dubbio» (o tasto D) su flashcard (sessione e scheda aperta) e domande (durante
e dopo il quiz), reversibile, sincronizzato (`studyMarks`). La scheda Dubbi li raggruppa per materia
e argomento (raccolta `topic` dell'assistente), con filtri a chip, «Ripassa N flashcard», «Quiz su
N domande», ripasso o «Chiarito» per argomento. La valutazione SRS «Dubbia» ora si chiama «Incerta».

**Pausa**: pulsante Pausa, Esc o Indietro del telefono escono da una sessione o da un quiz di
qualsiasi modalità lasciandolo da riprendere (Oggi › Da riprendere, o Riprendi sulla scheda del
quiz), anche da un altro dispositivo dello stesso account: il punto di ripresa sta sulla riga
sincronizzata. La simulazione d'esame riparte con il tempo che restava. Prima uscire da un quiz
perdeva il tentativo. Testo da studiare senza trattini automatici (`.learn-read`, `.learn-blocks`).

**Etichette di ripresa**: ciò che è interrotto porta «Da riprendere» (scheda del quiz, raccolta in
Oggi › Per raccolta e in Raccolte, drawer della raccolta), dove si è fermato («Questo dispositivo» o
«Da iPhone · Safari» con colore diverso) e quando («Interrotta ieri alle 18:30», testo completo nel
suggerimento e per lo screen reader). Ripresa la sessione o il quiz, l'intestazione mostra «Ripresa»
o «Ripresa da Mac · Chrome»; il segno resta anche chiusa, in Ultime sessioni. Una raccolta con una
sessione in pausa riprende quella con il suo pulsante di ripasso e Raccolte apre i rami che ci
portano. Sotto i 380 px l'icona del tipo in «Da riprendere» lascia spazio al titolo; i tasti del quiz
non stanno più in riga sotto i 768 px (andavano a capo parola per parola).

Telefono: la pagina sforava a destra (Raccolte 379 px su 320 e 375, Andamento 324 su 320) per
griglie senza `grid-cols-1`; ora nessuno sforamento su tutte le schede a 320, 360, 375, 390 e 430
px (Chromium, misura di `scrollWidth`). Dati: Dexie 10, `SYNC_SCHEMA` 6, tipo `studyMark`.

Verifiche etichette: `npm test` 1752/1752 (nuovo `tests/learnResumeTags.test.mjs`), lint, build;
prova nel browser (390, 360, 320 px) con pausa su un «dispositivo», ripresa sullo stesso, poi con un
altro id dispositivo sugli stessi dati: etichette in Oggi, Per raccolta, Raccolte, scheda e lettore
del quiz, intestazione della sessione e Ultime sessioni (25 controlli). Non provati due dispositivi
veri con la sync.

Verifiche: `npm test` 1746/1746 (nuovo `tests/learnResumeMarks.test.mjs`), `npm run lint`,
`npm run build`; prova nel browser (390 px) di pausa con Esc, ricaricamento e ripresa alla stessa
scheda e domanda con risposte e dubbio ripristinati (17 controlli); simulazione d'esame da 20 minuti
ripresa a 18:29 dopo 1:30 passati. Non eseguiti: `npm run
e2e` (serve lo stack Supabase locale; `10-quiz` aggiornato ai riquadri del punteggio), Safari/WebKit
e la ripresa vera fra due dispositivi (coperta solo dalla sync generica di `studyRuns`).

## Ripasso: studio UX e correzioni di orientamento (18 novembre 2026, ramo `claude/flashcards-quiz`)

Studio di prodotto della sezione (flussi in tocchi, problemi per gravità, codice colore, gerarchia)
pubblicato come artifact privato «Studio UX del Ripasso». Correzioni applicate:

- **Schede**: cinque (Oggi, Dubbi, Raccolte, Quiz, Andamento) in `LearnTabs`, tutte in vista sul
  telefono (griglia a 5 colonne, icona sopra il nome, numero sull'icona; da 640 px in riga). Prima
  la barra scorreva e Quiz, Andamento e Analisi AI erano fuori schermo. **Analisi AI** non è più una
  scheda: sta in fondo ad Andamento («Analisi degli assistenti»). Nomi accessibili invariati.
- **Un solo pulsante pieno per schermata.** Oggi: prima il ripasso del giorno, poi «Da riprendere»
  con «Riprendi» secondario (principale solo se oggi non c'è niente da ripassare).
- **Risultato del quiz**: «Ripassa i N errori» (modalità errori sulle sole sbagliate o vuote, anche
  per i quiz misti dei dubbi), «Rifai il quiz», «Chiudi»; anello colorato con le soglie dei
  punteggi (`scoreColor`, 60% e 85%), anche nel riepilogo della sessione.
- **Quiz**: filtro per materia (`learn.quizGroup`) e gruppi con titolo; sopra il titolo del quiz solo
  il capitolo se diverso dal gruppo; quiz vuoto con «Aggiungi domande».
- **Raccolta (drawer)**: dati in una riga di testo, niente «0 flashcard in questa raccolta» quando le
  schede sono nelle sotto-raccolte, «Nuova sotto-raccolta» nella sua sezione, quiz collegati che si
  avviano dalla scheda Quiz (`onQuiz`), Elimina in testo rosso a sinistra, Ripassa a tutta larghezza
  sul telefono. Legenda del numero e del pulsante sotto l'albero.
- **Andamento**: «Ripassa queste N» sulle più difficili (`cardsSessionSpec`) e spiegazione della
  percentuale.
- **Dubbi**: «Ripassa» e «Chiarito» con testo anche sul telefono, nome accessibile che contiene il
  testo visibile, riga che spiega la bandierina.
- **Stato delle schede** in testo colorato (`CARD_STATUS_TONE`), non più pillola piena.
- **Testi**: «Domanda (fronte)» / «Risposta (retro)», campi della raccolta in ordine (titolo, dentro,
  materia, che cos'è, descrizione facoltativa), «Ancora da consolidare» al posto del secondo
  significato di «Da riprendere», via i nomi degli strumenti del connettore dai testi.

Non applicati (da decidere per tutta l'app): Ripasso nella barra in basso del telefono, scala dei
pesi tipografici (oggi 70–100% del testo a 800–900 su molte schermate), flashcard/quiz/raccolte nella
ricerca globale (`GlobalSearch` non li cerca), nome del timer «Studio» vicino a «Ripasso».

Verifiche: `npm test` 1752/1752, `npm run lint`, `npm run build`; Playwright su 390, 320 e 1366 px
(schede in vista, ordine di Oggi, legenda, drawer, quiz da raccolta, editor, gruppi dei quiz,
ripasso degli errori, più difficili, nessuno sforamento) e di nuovo le etichette di ripresa;
`09-share-flashcards` aggiornato ai nuovi nomi dei campi della flashcard. `npm run e2e` sullo stack
Supabase locale: 11/11 (al primo avvio a freddo 09, 10 e 11 erano falliti e sono passati rilanciati,
poi la suite intera è passata di seguito).

Pubblicato il 18 novembre 2026: commit `562de5f` su `main` (questa sezione e la precedente: dubbi,
pausa e ripresa, gerarchia nuova), workflow Pages riuscito (build e deploy); il bundle pubblicato
contiene «Ripassa queste», «Rifai il quiz», «Ripassa i N errori» e «Domanda (fronte)». Nessuna
modifica al database: i dubbi (`studyMark`) passano dalla stessa `push_studyos_rows` e restano
privati (non sono in `supabase/sharing.sql`). Il Worker del connettore non è stato ridistribuito:
finché non lo è, il gruppo «states» degli agenti non include i dubbi.
