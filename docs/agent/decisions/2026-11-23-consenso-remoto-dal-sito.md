# ADR: il connettore remoto si conferma dal sito, non da un browser collegato

- Stato: accettata
- Data: 23/11/2026
- Sostituisce: nessuna
- Codice: `src/agent/httpHub.ts` (`/oauth/request`, `/oauth/decide-cloud`, `/authorize/continue`,
  `authorizePage`), `src/agent/oauth.ts` (`CLOUD_REQUEST_TTL_MS`, `REFRESH_GRACE_MS`),
  `src/agent/cloudRunner.ts` (`verify`), `src/lib/agentSiteConsent.ts`,
  `src/lib/siteConsentLink.ts`, `src/components/AgentSiteConsent.tsx`, `worker/index.ts` (`siteUrl`)

## Contesto

ChatGPT e Claude dal telefono, con StudyOS chiuso, non riuscivano a usare StudyOS:

- `/mcp` esegue ogni azione nel browser che ha StudyOS aperto (long polling di 20 s su
  `/bridge/poll`, «collegato» = un poll negli ultimi 45 s). Il telefono sospende la scheda o la PWA
  in background: l'hub risponde `not_connected`, oppure consegna il lavoro a un poll che non
  risponderà più (nessun ack né riconsegna) e dopo 45 s dà `pending_approval`.
- Il connettore remoto (`/u/<nome>/mcp`) lavora già sul cloud dell'account, ma il primo «Consenti»
  arrivava solo a un browser collegato all'hub con la chiave e con l'accesso al cloud, aperto in quel
  momento. `/authorize` dava 404 se l'hub non aveva visto un browser con quel nome negli ultimi 30
  giorni. Il rinnovo dei token ruotava senza tolleranza: due rinnovi insieme davano `invalid_grant` e
  un nuovo consenso.
- CORS e Streamable HTTP erano conformi: non erano la causa.

## Decisione

Il percorso per l'app chiusa è il connettore remoto, e il suo consenso nasce sul sito:

- La pagina di autorizzazione dell'hub ha «Conferma in StudyOS» (`<sito>#collega=<id>`) e un codice
  derivato dall'id, mostrato anche nell'app.
- L'app, con l'accesso all'account e il nome del profilo uguale a quello dell'indirizzo, crea il
  permesso cloud e lo manda a `POST /oauth/decide-cloud` (solo dall'origine del sito). L'hub lo prova
  sul database fuori dalla sua coda e solo dopo decide la richiesta; poi il sito torna a
  `/authorize/continue`, che con il cookie della pagina rimanda all'assistente.
- L'hub usato dal sito è quello della build, mai uno preso dal link; il ritorno si segue solo verso
  quell'hub. Il dialogo avvisa di consentire solo un collegamento avviato da sé.
- Richieste del remoto valide 15 minuti; rinnovo con 60 s di tolleranza (stessa famiglia).
- `/mcp` resta com'è (approvazioni nel browser, più persone sullo stesso connettore); il suo
  messaggio «non collegato» indica il connettore remoto.

## Alternative considerate

- **Keep-alive del browser** (service worker, notifiche, audio silenzioso): vietato dalla richiesta
  e inaffidabile; iOS sospende comunque.
- **Ripiego di `/mcp` sul cloud**: l'account di `/mcp` è un nome dichiarato dal browser e le regole
  di conferma stanno nel localStorage del browser; servirebbe un'identità forte per ogni chiamata.
- **Login Supabase sulla pagina dell'hub**: un secondo client di autenticazione e la chiave pubblica
  nell'hub, quando il sito sa già farlo.
- **Coda persistente con ack per il ponte**: riduce le perdite, non fa funzionare l'app chiusa.

## Conseguenze

- Un collegamento nuovo richiede che Pages sia pubblicato prima del Worker.
- Sul telefono l'autorizzazione si apre nel browser interno dell'app dell'assistente: lì di solito
  serve fare l'accesso a StudyOS.
- Rischio residuo: chi avvia `/authorize` per l'indirizzo di un'altra persona può girarle il link;
  se lei consente, l'assistente di chi ha mandato il link vede i suoi dati. Mitigazioni: avviso nel
  dialogo, host di ritorno mostrato, revoca da «Scollega il connettore remoto».
- Il segreto del permesso resta in chiaro nello storage del Durable Object (Supabase ne ha solo
  l'hash), come prima.
