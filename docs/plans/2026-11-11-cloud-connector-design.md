# Connettore remoto: ChatGPT su StudyOS con l'app chiusa

Data: 11 novembre 2026. Ramo: `claude/people-push-6582b6`.

## Problema

Il connettore MCP attuale non tocca i dati: l'hub Cloudflare passa ogni azione alla
scheda StudyOS collegata, che la esegue sul suo IndexedDB. Con la scheda chiusa ChatGPT
riceve «StudyOS non è collegato». L'utente vuole un connettore per account (per esempio
uno per Camilla) che lavori sui dati anche con l'app chiusa, con lo stesso «Consenti» di
oggi e senza password.

## Soluzione

Un connettore per account all'indirizzo `https://<hub>/u/<nome>/mcp` (es.
`/u/camilla-rossi/mcp`). Stesso hub, stesso OAuth, ma gli strumenti girano sul server
contro i dati personali nel cloud (`studyos_items`).

1. **Consenso.** ChatGPT apre `/authorize` con `resource=/u/camilla-rossi/mcp`. L'hub
   cerca l'account «camilla rossi» tra i browser collegati (stessa regola dei nomi di
   `src/agent/accounts.ts`) e manda la richiesta solo ai suoi browser. Senza account
   corrispondente la pagina lo spiega.
2. **Permesso cloud.** Con «Consenti» l'app di Camilla, che ha già fatto l'accesso al
   suo account, chiama `studyos_create_agent_grant` e riceve un segreto casuale. Nel
   database ne resta solo l'hash. L'app lo manda all'hub insieme al fuso orario del
   browser. L'hub lo lega ai token OAuth di quel connettore.
3. **Esecuzione.** Ogni chiamata del connettore remoto passa a `CloudRunner`:
   - legge le righe dell'account con `studyos_agent_pull`, poi solo le nuove (cache in
     memoria nel Durable Object);
   - carica lo stato nello store, esegue lo stesso `executeAgentTool` dell'app con il
     fuso della persona;
   - confronta prima e dopo e scrive solo le entità cambiate con `studyos_agent_push`,
     con la stessa regola LWW di `push_studyos_rows`.
   L'app di Camilla vede le modifiche al pull successivo.
4. **Niente conferme.** Non c'è un'app aperta a cui chiedere: lettura e scrittura
   dipendono solo dagli scope concessi con «Consenti». Le eliminazioni restano con
   `confirm=true`.

## Decisioni

- **Segreto invece della sessione Supabase.** I refresh token Supabase ruotano: usarne
  uno nell'hub disconnetterebbe il browser. Il segreto vale solo per `studyos_items`
  di quell'utente, si revoca da solo e non dà accesso ad altro.
- **Fuso orario.** Gli strumenti usano l'ora locale del runtime (date-fns, `getHours`,
  `startOfDay`), e il Worker è in UTC. Durante l'esecuzione `globalThis.Date` diventa
  `ZonedDate` (`src/agent/zonedDate.ts`), una sottoclasse di Date con i campi locali
  nel fuso della persona. `clock()` di `execute.ts` riceve lo stesso fuso. I test
  confrontano i risultati con quelli di Node in Europe/Rome.
- **File pesanti.** `studyos_agent_pull` toglie `dataUrl`, `cover` e `avatarDataUrl`
  dalle righe. `studyos_agent_push` li rimette dalla riga attuale se il payload in
  arrivo non li ha: gli strumenti non li leggono né li cambiano.
- **Strumenti esclusi in remoto:**
  - condivisioni, che richiedono la sessione dell'utente;
  - risorse dei gruppi sul server, cronometro e registro locale;
  - stato delle conferme ed elenco account, che non hanno senso senza browser.
- **Concorrenza.** Lo store è unico nel modulo: un lucchetto di modulo serializza le
  esecuzioni. Se una riga viene rifiutata perché Camilla l'ha appena cambiata, l'azione
  risulta non salvata e la cache si ricarica.
- **CPU.** La cache evita di rileggere tutto a ogni chiamata. Sul piano Free di
  Workers il limite per richiesta resta 10 ms: si misura con `wrangler tail`. Un
  secondo account Cloudflare non aiuta, perché il limite vale per richiesta.

## SQL

`supabase/agent.sql`, da eseguire dopo `schema.sql`:
- tabella `studyos_agent_grants`;
- `studyos_create_agent_grant`, `studyos_revoke_agent_grants`;
- `studyos_agent_pull`, `studyos_agent_push`, con `security definer` e segreto obbligatorio.

## Verifica

- Test unitari: `ZonedDate` contro Node in Europe/Rome, diff ed esecuzione del runner
  con un Supabase finto, OAuth con resource per account, consenso instradato.
- Stack locale: un account, «Consenti» nell'app, app chiusa, poi una chiamata MCP che
  crea un'attività. Riaprendo l'app l'attività c'è.
- Worker in `wrangler dev` con lo stesso flusso via script.
