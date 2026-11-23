# ADR: il connettore remoto alla pari del principale

- Stato: accettata
- Data: 23/11/2026
- Sostituisce: nessuna (estende [2026-11-23-consenso-remoto-dal-sito.md](2026-11-23-consenso-remoto-dal-sito.md))
- Codice: `supabase/agent-parity.sql`, `supabase/agent-parity-verify.sql`, `src/agent/cloudRunner.ts`
  (`execute`, `deferred`, `approvalStatus`, `GROUP_TABLE_TOOLS`, `sharedTypesFor`, `TIMER_TOOLS`),
  `src/agent/cloudDeferred.ts`, `src/agent/catalog.ts` (`CLOUD_UNAVAILABLE` vuoto, `cloudText`),
  `src/lib/agentCloudRequests.ts`, `src/lib/agentLink.ts` (`handleRemoteRequest`),
  `src/lib/timerCloud.ts`, `src/lib/timerCloudPlan.ts`, `worker/push.ts` (tipo `agent`)

## Contesto

Il connettore remoto (`/u/<nome>/mcp`) lavora sul cloud personale dell'account con un permesso
(segreto, chiave publishable), senza la sessione Supabase della persona. Fino alla 1.11.0 gli mancavano
gruppi (elenco, bacheca, risorse), scrittura e cronologia degli appelli dei gruppi, correzioni del
catalogo, dati condivisi, cronometro, `studyos_approval_status` e `studyos_list_accounts`:

- gruppi, condivisioni e appelli dei gruppi stanno in tabelle protette dalla RLS e da funzioni che
  leggono `auth.uid()`, che l'hub non ha;
- il connettore principale chiede conferma nell'app per dare o cambiare condivisioni, e il remoto
  non aveva un'app a cui chiederla;
- il timer stava solo nel localStorage del browser.

La richiesta: gli stessi strumenti e le stesse capacità del connettore principale.

## Decisione

- **Identità per transazione.** `studyos_agent_act_as(segreto)` controlla il permesso e imposta i
  claim JWT solo per la transazione (`set_config(…, true)`): le funzioni dell'app dei gruppi e degli
  appelli girano invariate, con le loro regole. Le letture definer (`studyos_agent_groups`,
  `studyos_agent_sharing`, `studyos_agent_group_history`) ripetono i filtri delle policy e non
  restituiscono email né codici di invito. `act_as` e gli aiuti interni non sono chiamabili da fuori.
- **Condivisioni confermate nell'app.** I sei strumenti di condivisione diventano righe di
  `studyos_agent_requests` più una notifica push di tipo `agent`. L'app (qualsiasi dispositivo con
  l'accesso fatto) le legge, mostra lo stesso dialogo del principale, le prende con `decide`
  (atomico: vale la prima decisione), le esegue con la propria sessione e scrive l'esito con
  `finish`. L'hub aspetta circa 20 s, poi risponde `pending_approval`; l'agente usa
  `studyos_approval_status`. Scadenza 30 minuti; una richiesta presa senza esito si chiude come
  fallita dopo 15 minuti, con l'invito a controllare prima di riprovare.
- **Timer dell'account.** `studyos_timer_states` (una riga per persona, LWW su `changedAt`). L'app
  lo allinea (lettura all'avvio, alla visibilità e ogni 30 s; scrittura dopo 1,2 s); ogni
  dispositivo ricorda di quale account è il suo timer, per non mandarlo nel cloud di un altro.
- **Letture facoltative.** Per panoramica, stato, collegamenti e flashcard gruppi e condivisioni
  sono un'aggiunta: se non si leggono la chiamata risponde con i dati personali, come l'app. Per gli
  strumenti dei gruppi e delle condivisioni sono obbligatorie.
- **Una chiamata alla volta.** L'hub esegue le chiamate in fila per tutti gli account e, nel
  `finally`, rimette loader, store condiviso, appelli e timer; richieste da confermare e
  `studyos_approval_status` stanno fuori dalla fila.

## Alternative considerate

- **Chiave `service_role` nell'hub**: tutte le tabelle senza RLS; un errore dell'hub esporrebbe tutti
  gli account. Scartata.
- **Sessione Supabase della persona salvata nell'hub** (refresh token): l'hub avrebbe l'accesso pieno
  all'account, oltre lo scope del permesso, e il token scade o ruota fuori dal suo controllo.
- **Riscrivere in SQL le regole di gruppi e appelli per il permesso**: due copie delle stesse regole
  che divergono. Con `act_as` si usano quelle dell'app.
- **Condivisioni senza conferma sul remoto**: darebbe a un assistente il potere di esporre dati ad
  altre persone senza che la persona lo veda; il principale le conferma sempre.

## Conseguenze

- Ordine di pubblicazione: `agent-parity.sql` (e `schema.sql` per la cancellazione), poi Pages, poi
  il Worker. Senza lo script gli strumenti nuovi rispondono `not_connected`.
- Le condivisioni dal remoto funzionano solo se la persona apre StudyOS (o tocca la notifica) entro
  30 minuti; senza notifiche push attive deve aprire l'app da sé.
- Il timer cambiato dall'assistente arriva all'app entro 30 secondi (subito alla riapertura).
- Due elenchi degli strumenti differiti (SQL e `cloudDeferred.ts`), tenuti uguali da un test.
- Le tabelle nuove hanno RLS di sola lettura delle proprie righe; scrivono solo le funzioni.
