# Agenti MCP

StudyOS può essere usato da ChatGPT, Claude, Cursor e da qualunque client MCP.
I dati restano nel browser. Il programma locale non legge IndexedDB: porta le
richieste all'app aperta, che le esegue con le stesse funzioni dell'interfaccia.

## Avvio

Nella cartella del progetto:

```bash
npm run dev
npm run agent
```

`npm run agent` ascolta solo su `127.0.0.1:47321`. Nel terminale compare un codice
di 8 caratteri, valido 15 minuti e usabile una volta. In StudyOS apri
**Impostazioni → Agenti** e incollalo. Il codice non viene salvato.

Il token che resta nel browser serve solo a ricevere le richieste. Non autorizza
da solo le chiamate MCP. I token OAuth e il token del client locale stanno in
`~/.studyos/` con permessi ristretti, mai nel repository.

## Cosa può fare un agente

Gli strumenti coprono lo stato, la panoramica, la ricerca e la gestione di
materie, task, eventi, esami personali, sessioni, ripasso, materiali (solo
link), note, obiettivi, preferenze di studio, notifiche, bacheca dei gruppi,
libretto con medie e proiezione di laurea, insegnamenti e appelli BARB. Gli
eventi ripetuti compaiono come singole occorrenze. «Tutta la serie» fa come «Tutti» nel
calendario: eliminando una serie senza indicare il giorno spariscono anche le parti divise
prima con «Questo e i successivi»; modificandola (senza giorno o con `scope=all`) quelle parti
restano come sono e la risposta le elenca in `keptParts`. I link della bacheca dei gruppi
arrivano all'agente solo se sono http, https o mailto. Ogni risposta riporta il nome
della materia accanto all'id, e `studyos_status` e `studyos_overview` danno data,
ora e fuso orario della persona. Le letture, di base, passano. Modifiche ed eliminazioni chiedono
conferma nell'app. Si può consentire le sole modifiche per 15 minuti. Le
eliminazioni chiedono comunque conferma, e un agente non può cambiare queste
regole. Valgono per il connettore `/mcp`, non per il connettore remoto (vedi sotto), che non
chiede conferme.

In **Impostazioni → Agenti** c'è prima l'essenziale: «Collega ChatGPT o Claude» con un solo
stato («Non ancora collegato» finché non provi a collegarti, poi «Collegato» o «Collegamento
non raggiungibile»), la chiave (o il codice di `npm run agent`) e l'indirizzo `/mcp` da
copiare, poi il connettore remoto e le revoche. Regole di conferma, i 15 minuti, più persone
sullo stesso connettore e ultime azioni sono in «Avanzate»; i dettagli per lo sviluppo in
«Istruzioni tecniche».

Con un account e `supabase/sharing.sql` attivo, l'agente vede anche i dati che altre
persone condividono con te (`studyos_list_shares`, `studyos_list_shared_items`) e, solo
dove hai «Può modificare», li aggiunge, modifica o elimina
(`studyos_create_shared_item`, `studyos_update_shared_item`,
`studyos_delete_shared_item`). Può condividere sezioni dei tuoi dati con persone già
collegate o con un gruppo (`studyos_share_with`), cambiare o togliere una condivisione
(`studyos_update_share`, `studyos_revoke_share`). `studyos_share_with` e
`studyos_update_share` chiedono sempre conferma nell'app, anche con «Modifiche senza
conferma»; le eliminazioni hanno solo `id` e `confirm`. Le persone compaiono con un
`personId` opaco (`person_` più 16 cifre esadecimali), mai con email o id dell'account, e gli
elementi di persone nascoste non si vedono nemmeno all'agente. Le risposte sui dati
condivisi contengono solo campi consentiti: niente file, copertine, cronometri,
`sourceUid` né link non sicuri. Gli strumenti condivisi si caricano solo quando servono.
Gli elenchi personali (attività, eventi, esami…) restano solo tuoi. Il server è alla
versione 1.7.0 (`/health` la mostra dopo il deploy): negli elenchi di attività, eventi,
sessioni, argomenti e obiettivi descrizioni e note oltre 300 caratteri arrivano accorciate con
«…» e il campo compare in `truncated`; `fullText: true` (o il dettaglio, es. `studyos_get_task`)
le dà intere. Una modifica che riscrive il testo partendo dalla copia accorciata viene
rifiutata (`invalid`, niente salvato): cancellerebbe la parte dopo il taglio. Prima l'agente
non sapeva del taglio e contava le pagine scritte in fondo alla descrizione su metà testo.
Dalla 1.6.0 la revoca in
Impostazioni → Agenti toglie solo gli accessi approvati da quel browser (vedi «Revocare gli
accessi»). La 1.5.0 aveva corretto fuso orario, serie ripetute, link della bacheca e limiti di
`/register` e `/authorize`; la 1.4.0 aveva aggiunto il connettore remoto di un solo account
(vedi sotto). La 1.7.0 aggiunge il parametro `fullText` agli elenchi e cambia le descrizioni
di elenchi e modifiche di attività, eventi e obiettivi: ricrea il connettore perché
l'assistente le legga (vedi «Ripubblicare dopo una modifica»).

Ogni eliminazione deve arrivare con `confirm: true` e va comunque approvata,
salvo una policy impostata da te su «Consenti».

Non sono esposti il vault, il reset, l'import di backup, l'ingresso nei gruppi,
i codici di invito, gli inviti alla condivisione (creazione, link, accettazione), la ricerca di persone, le iscrizioni push e il caricamento di file. Le risposte non includono file,
foto, email dei membri o passphrase. Le note si possono leggere e scrivere, ma
non hanno ancora una schermata dedicata nell'app.

Se una conferma tarda, l'agente riceve `pending_approval` e deve rileggere
l'esito con `studyos_approval_status`, senza ripetere l'azione. Il registro
delle azioni resta in questo browser.

A vault bloccato l'app risponde che i dati non sono disponibili e non mostra
conteggi vuoti come se fossero veri.

## Indirizzo da usare

Ogni client remoto usa lo stesso indirizzo, mostrato in **Impostazioni → Agenti**
del sito pubblicato: `https://studyos-agent.<account>.workers.dev/mcp`. È l'hub
Cloudflare sempre acceso. Non serve `npm run dev`, `npm run agent` né un tunnel.
Apri il sito pubblicato (`https://massimilianociconte.github.io/StudyOS/`),
anche dal telefono, incolla la chiave di collegamento una volta e tieni la
pagina aperta mentre l'agente lavora: i dati restano nel suo IndexedDB. La chiave è il
secret `STUDYOS_PAIR_KEY` del Worker: la dà chi gestisce StudyOS, ed è la stessa per tutte le
persone che usano lo stesso connettore.

L'accesso è OAuth 2.1 con PKCE e registrazione dinamica del client. Al primo
collegamento la conferma compare in Impostazioni → Agenti del browser
collegato. Sono accettati redirect https, loopback con qualsiasi porta
(`http://127.0.0.1:…`, `http://localhost:…`) e schemi delle app native come
`cursor://`. La registrazione è aperta a chiunque, quindi ha dei limiti: al massimo 50
client; oltre, l'hub toglie quelli senza token, consensi o codici validi, dal più vecchio, ma
mai uno registrato da meno di 2 minuti, e una registrazione mai usata scade dopo 24 ore. Una
richiesta di consenso vale 5 minuti; ne restano aperte al massimo 5 per client (la nuova prende
il posto della più vecchia) e 20 in tutto: oltre, la nuova prende il posto della più vecchia,
prima tra quelle di client che non hanno mai ottenuto un accesso, così chi si collega davvero
non resta fuori. Il server risponde ai protocolli MCP dal 2024-11-05 al 2026-07-28
(`initialize` per i client precedenti, `server/discover` per il 2026), sempre in
JSON e mai in stream.

## Revocare gli accessi

In **Impostazioni → Agenti** ci sono tre revoche, tutte con il browser collegato:

- **«Revoca gli accessi di questo browser»** toglie gli assistenti approvati con «Consenti» in
  questo browser, anche il connettore remoto approvato qui, e i permessi remoti del tuo account
  nel cloud. Gli assistenti approvati da altri browser restano, anche quelli tuoi su un altro
  dispositivo: revocali da lì, oppure usa «Scollega gli assistenti di tutti». Un client che
  resta senza accessi viene tolto: per ridare l'accesso, togli il connettore StudyOS
  nell'assistente e aggiungilo di nuovo.
- **«Scollega il connettore remoto»** toglie solo il connettore remoto del tuo account (vedi
  sotto); il connettore principale resta.
- **«Scollega gli assistenti di tutti»**, in «Avanzate» e dopo una conferma che lo dice, toglie
  token, consensi e client di tutte le persone: ognuno dovrà ricollegare il connettore.

### Il segreto del browser

L'hub riconosce chi ha approvato un accesso da un segreto del browser, non dal nome del profilo
(che chiunque può scrivere uguale o cambiare):

- `/pair` restituisce, oltre al token del ponte, un segreto casuale di 256 bit (`secret`, 43
  caratteri base64url). Un browser collegato prima lo chiede da solo all'avvio con
  `/bridge/secret` (serve il token del ponte), senza ricollegarsi. Il browser lo tiene in
  `localStorage` accanto al collegamento, e lo tiene anche dopo «Scollega questo browser», così
  quello che ha approvato resta revocabile da lì.
- `/oauth/decide` con «Consenti» manda `secret`. L'hub ne salva solo lo SHA-256 (`approver`) su
  consenso, codice, token di accesso e di rinnovo. Il segreto in chiaro non viene salvato, non
  va mai agli agenti MCP né in un URL: viaggia solo nel corpo delle richieste dal browser all'hub.
- `/oauth/revoke` limitato (senza `scope`, o `scope: "cloud"` per i soli remoti) richiede
  `secret` e toglie solo ciò che quel segreto ha approvato. Senza segreto valido risponde 400 e
  non tocca niente: un'app di prima non scollega più tutti per sbaglio. La risposta conta solo
  le concessioni di chi chiede (`revoked`) e quelle senza approvatore (`legacy`).
- Gli accessi approvati prima, o da un'app senza segreto, non hanno approvatore: la revoca
  limitata non li tocca, li conta in `legacy` e l'app spiega che per toglierli serve «Scollega
  gli assistenti di tutti».

Cosa protegge: chi conosce la chiave di collegamento (la stessa per tutti) non può revocare gli
assistenti degli altri scrivendo il loro nome nel profilo, e rinominare il proprio profilo non
fa perdere la revoca. Cosa non è: non è un'identità cloud né un account. Vale per un solo
browser: un altro dispositivo della stessa persona ha un altro segreto, e chi cancella i dati
del sito ne riceve uno nuovo (gli accessi approvati con il vecchio si tolgono solo con
«Scollega gli assistenti di tutti»). Chi ha la chiave può comunque scollegare tutti con `scope:
"all"`, come prima.

Un hub di prima della 1.6.0 tratta qualunque `/oauth/revoke` come «scollega tutti». Per questo
l'app rilegge `/health` prima di «Revoca gli accessi di questo browser»: se la versione è sotto la
1.6.0 o manca, non manda una revoca limitata, ma apre la stessa conferma di «Scollega gli
assistenti di tutti», con una riga che dice che questo collegamento, finché non è aggiornato, sa
solo scollegare tutti. Allo stesso modo manda «Scollega il connettore remoto» all'hub solo dalla
1.6.0: prima toglie solo il permesso nel cloud, che basta a fermare il connettore.

## Più account sullo stesso connettore

Più persone possono usare lo stesso connettore, anche dallo stesso account ChatGPT.
Ognuna apre il sito pubblicato nel proprio browser, scrive il suo nome in
**Impostazioni → Profilo e obiettivi** e collega il browser in **Impostazioni →
Agenti** con la stessa chiave. Il nome del profilo è il nome dell'account in chat.
Browser con lo stesso nome, per esempio il telefono e il computer della stessa persona,
sono lo stesso account.

In chat basta dire di chi è l'account: «nel planning di Camilla Rossi aggiungi…».
ChatGPT passa `account` con quel nome e l'hub manda l'azione solo ai browser di
quell'account. La richiesta di conferma compare in quello StudyOS, e la risposta
riporta `account` con il nome usato.

- Ogni strumento ha il parametro facoltativo `account`. L'hub lo toglie prima di
  passare l'azione all'app, che non cambia.
- `studyos_list_accounts` elenca gli account collegati, con il nome e se il loro StudyOS è
  aperto ora.
- Con un solo account `account` si può omettere, come prima. Con più account è
  obbligatorio: senza nome la risposta elenca gli account e chiede quale usare. Un nome
  che non corrisponde dà errore e non esegue niente.
- Il confronto ignora maiuscole, accenti e ordine delle parole. «Camilla» trova
  «Camilla Rossi», e «Camilla Rossi» trova un profilo chiamato solo «Camilla». Se il
  nome corrisponde a più account, serve il nome completo.
- I dati di ogni account restano nel suo browser: per lavorare sull'account di Camilla,
  il suo StudyOS deve essere aperto. Altrimenti la risposta è `not_connected` con il
  suo nome.
- «Scollega questo browser» toglie subito il browser dall'elenco. L'hub dimentica da
  solo i browser che non vede da 30 giorni.
- Chi usa il connettore può agire su tutti gli account collegati. Il limite sono le
  conferme di ogni StudyOS, che seguono le regole scelte da quella persona in
  Impostazioni → Agenti.

## Connettore remoto di un solo account (StudyOS chiuso)

Un secondo connettore, distinto dal primo, lavora su un solo account e non ha bisogno di
StudyOS aperto: legge e scrive direttamente i dati cloud di quell'account. L'indirizzo è

`https://studyos-agent.<account>.workers.dev/u/<nome>/mcp`

dove `<nome>` è il nome del profilo con i trattini al posto degli spazi, per esempio
`/u/camilla-rossi/mcp`. Il nome segue le regole della sezione precedente (maiuscole,
accenti e ordine delle parole non contano).

In **Impostazioni → Agenti** del sito pubblicato il riquadro «Connettore remoto (app chiusa)»
dice cosa fa, avvisa che non chiede conferme nell'app, mostra questo indirizzo con il nome
del profilo, pronto da copiare, e ha «Scollega il connettore remoto». Senza nome nel profilo
chiede di scriverlo; se `/health` dice `cloud: false` spiega che chi gestisce StudyOS deve
attivarlo; nella finestra di sviluppo rimanda al sito pubblicato.

Una volta sola, prima del primo collegamento:

1. Esegui `supabase/agent.sql` nel SQL Editor del progetto (vedi `supabase/README.md`).
2. Imposta sul Worker l'URL del progetto Supabase e la chiave publishable (`sb_publishable_…`,
   mai `service_role`). `wrangler` chiede il valore a terminale, mai nella riga di comando:

   ```bash
   npx wrangler secret put STUDYOS_SUPABASE_URL -c worker/wrangler.jsonc
   npx wrangler secret put STUDYOS_SUPABASE_KEY -c worker/wrangler.jsonc
   ```

   Senza, `/u/<nome>/mcp` risponde che il connettore remoto non è attivo.
3. `npx wrangler deploy -c worker/wrangler.jsonc`.

Collegamento, come per il primo connettore e senza password:

- In ChatGPT aggiungi un connettore con l'indirizzo `/u/<nome>/mcp`. ChatGPT apre la
  pagina di autorizzazione dell'hub.
- La richiesta compare solo nello StudyOS di quell'account (browser collegato in
  Impostazioni → Agenti, con quel nome nel profilo), con l'etichetta «Connettore remoto».
  Il browser deve aver fatto l'accesso al cloud (Impostazioni → Account e
  sincronizzazione).
- «Consenti» crea su Supabase un permesso per l'assistente e ne passa il segreto all'hub.
  Nel database resta solo l'hash SHA-256 del segreto. Lettura e scrittura si scelgono
  nella stessa richiesta, come per il primo connettore.

Da quel momento StudyOS può restare chiuso. L'hub legge le righe dell'account con
`studyos_agent_pull` e scrive con `studyos_agent_push`, con le stesse regole della
sincronizzazione (vince la modifica più recente). Le date usano il fuso del browser che
ha dato il consenso, anche il fuso che le serie nuove e le divisioni si portano dietro: una
lezione alle 9 resta alle 9 dopo il cambio d'ora. L'app vede le modifiche alla sincronizzazione successiva.

Differenze dal primo connettore:

- Nessuna conferma nell'app: il consenso iniziale vale per tutte le azioni dello scope
  scelto. Le eliminazioni chiedono comunque `confirm: true`.
- Gli strumenti non hanno il parametro `account`: il connettore è già legato a un account.
- Non ci sono gli strumenti dei dati condivisi, i gruppi (elenco, bacheca e risorse), il
  cronometro, il registro delle azioni, `studyos_approval_status` e `studyos_list_accounts`.
  I gruppi condivisi stanno nelle tabelle dei gruppi e non nel cloud personale che l'hub legge:
  da lì si vedrebbe una copia vecchia. Panoramica e ricerca remote non contano i gruppi.
- File, copertine e foto non arrivano all'hub. Quando l'hub modifica un elemento, il
  database li rimette dalla riga attuale.
- Se l'app ha cambiato lo stesso elemento dopo l'ultima lettura dell'hub, la scrittura è
  rifiutata: la risposta è un errore di conflitto, l'hub rilegge i dati e l'azione si può
  ripetere.

«Scollega il connettore remoto» e «Revoca gli accessi di questo browser» in Impostazioni →
Agenti revocano tutti i permessi remoti dell'account (anche senza browser collegato, con
l'accesso all'account fatto) e i token remoti dell'hub approvati da questo browser: da lì il
connettore risponde che il collegamento non è più valido, e per riaverlo serve un nuovo
«Consenti».

Limite di CPU del piano Free: 10 ms per richiesta. Su un account di prova con 1340 righe
(935 KB) ogni chiamata a Worker caldo costa 0,2–6 ms, la prima lettura completa
dell'account circa 5 ms. La prima richiesta di un Worker appena avviato può arrivare a
25–50 ms per la compilazione del codice: se Cloudflare la ferma, la chiamata fallisce e
si può ripetere. Il piano Workers Paid alza il limite a 30 secondi. Un secondo account
Cloudflare non aiuta, perché il limite vale per ogni singola richiesta.

## Collegare i client

**ChatGPT** (web, app desktop e mobile): Impostazioni → App e connettori →
Avanzate → attiva la modalità sviluppatore, poi Crea connettore con l'indirizzo
`/mcp` e autenticazione OAuth. In una chat nuova premi + e aggiungi StudyOS.
Una chat già aperta non lo vede. Se l'elenco azioni era già fallito o è
cambiato, elimina il connettore e crealo di nuovo: Aggiorna riusa l'elenco
vecchio.

**Claude** (web, desktop, mobile): Impostazioni → Connettori → Aggiungi
connettore personalizzato con l'indirizzo `/mcp`. L'app mobile usa i connettori
aggiunti dal web.

**Claude Code**:

```bash
claude mcp add --transport http studyos https://studyos-agent.<account>.workers.dev/mcp
```

Poi in Claude Code esegui `/mcp` e completa il login.

**Codex** (CLI, app e estensione IDE) in `~/.codex/config.toml`, poi
`codex mcp login studyos`:

```toml
[mcp_servers.studyos]
url = "https://studyos-agent.<account>.workers.dev/mcp"
```

**Cursor** in `~/.cursor/mcp.json`. **Antigravity** in
`~/.gemini/antigravity/mcp_config.json`, con `serverUrl` al posto di `url`.
**Gemini CLI** in `~/.gemini/settings.json`, con `httpUrl` al posto di `url`,
poi `/mcp auth studyos`:

```json
{
  "mcpServers": {
    "studyos": { "url": "https://studyos-agent.<account>.workers.dev/mcp" }
  }
}
```

**VS Code** (Copilot) in `.vscode/mcp.json` o nel profilo utente:

```json
{
  "servers": {
    "studyos": { "type": "http", "url": "https://studyos-agent.<account>.workers.dev/mcp" }
  }
}
```

**Grok**: su grok.com apri Connettori, aggiungi un connettore personalizzato con
l'indirizzo `/mcp` e completa l'OAuth.

## Tempi delle conferme

Le conferme rispondono entro 45 secondi, sotto il timeout di 60 secondi della
maggior parte dei client. Se la persona non ha ancora deciso, l'agente riceve
`pending_approval` e richiama `studyos_approval_status`, che aspetta fino a 40
secondi la decisione. Le letture non aspettano le conferme in corso: più
modifiche si mettono in coda nel riquadro di conferma. Un'azione che nessun
browser ritira entro 2 minuti non parte più. Una conferma lasciata aperta 30
minuti scade senza eseguire nulla.

## Client locali con stdio (sviluppo)

`npm run agent` serve la finestra di sviluppo (`npm run dev`), che ha un
IndexedDB suo, distinto da quello del sito pubblicato. Per un client che avvia
un comando, con percorsi assoluti:

```json
{
  "mcpServers": {
    "studyos-locale": {
      "command": "node",
      "args": [
        "--import", "/percorso/assoluto/StudyOS/scripts/lib/register-ts.mjs",
        "/percorso/assoluto/StudyOS/scripts/agent.ts", "--stdio"
      ]
    }
  }
}
```

Per Claude Code:

```bash
claude mcp add studyos-locale -- node --import /percorso/assoluto/StudyOS/scripts/lib/register-ts.mjs /percorso/assoluto/StudyOS/scripts/agent.ts --stdio
```

Lo stdio usa un messaggio JSON per riga, come vuole MCP, e accetta ancora il
vecchio framing `Content-Length`. Le richieste partono in parallelo. Legge la
chiave da `~/.studyos/agent.json` senza riscriverla. Se l'hub non è avviato lo
avvia; il codice di collegamento si legge meglio con `npm run agent`. Dopo un
aggiornamento chiudi l'hub vecchio e riavvia `npm run agent`.

## Build pubblicata

localhost e GitHub Pages non condividono i dati: ognuno ha il suo IndexedDB.
ChatGPT, collegato all'hub pubblico, modifica solo la scheda pubblicata aperta
e collegata. La finestra di sviluppo non riceve quelle azioni.

La build pubblicata non chiama `127.0.0.1`. L'origine dell'hub arriva da
`VITE_AGENT_HUB_ORIGIN` al momento del deploy. La CSP di quella build deve
includere quell'origine esatta: `https://*.workers.dev` non copre un nome con
due etichette. Dopo una modifica alla CSP serve una nuova build, pubblicata
dal workflow su `main`.

## Notifiche push: route `/push` del Worker

Lo stesso Worker `studyos-agent` espone `POST /push`: non è uno strumento MCP e gli agenti non
lo vedono. Lo chiama solo il database (`pg_net`) con l'intestazione `x-studyos-push-secret`; il
Worker cifra e invia le notifiche push e non legge né scrive altro. Accetta al massimo 49
iscrizioni per richiesta (49 push più una `push_gone` sono 50 sottorichieste sul piano Free);
il database ne manda al massimo 40 per volta. Servono quattro secret, da
impostare una volta (ognuno dopo il via dell'utente; `wrangler` chiede il valore a terminale,
mai nella riga di comando):

```bash
npx wrangler secret put STUDYOS_PUSH_SECRET -c worker/wrangler.jsonc
npx wrangler secret put STUDYOS_VAPID_PRIVATE_KEY -c worker/wrangler.jsonc
npx wrangler secret put STUDYOS_SUPABASE_URL -c worker/wrangler.jsonc
npx wrangler secret put STUDYOS_SUPABASE_KEY -c worker/wrangler.jsonc
npx wrangler deploy -c worker/wrangler.jsonc
```

- `STUDYOS_PUSH_SECRET`: lo stesso valore del segreto `studyos_push_secret` in Vault.
- `STUDYOS_VAPID_PRIVATE_KEY`: la chiave privata stampata da `node scripts/push-keys.mjs`
  (la pubblica sta in `src/lib/pushKeys.ts`).
- `STUDYOS_SUPABASE_URL` e `STUDYOS_SUPABASE_KEY`: URL del progetto e chiave publishable
  (`sb_publishable_…`): gli stessi secret del connettore remoto (`/u/<nome>/mcp`); se ci sono già,
  non vanno rimessi. La route `/push` li usa solo per chiamare `push_gone`. Mai `service_role`. Se
  mancano, la pulizia degli endpoint spenti si salta e le notifiche partono lo stesso.

I secret `STUDYOS_PAIR_KEY` e lo stato del Durable Object non cambiano. Il Worker registra solo
i conteggi `{ sent, gone }`, mai contenuti o endpoint.

## Ripubblicare dopo una modifica

1. Verifica: `npm test`, `npm run lint`, `npm run build`.
2. Hub: `npx wrangler deploy -c worker/wrangler.jsonc` (la prima volta
   `npx wrangler login`). I secret (`STUDYOS_PAIR_KEY` e quelli delle push) e lo stato
   del Durable Object restano: client OAuth e collegamento del browser non cambiano.
3. Sito: push su `main`. Il workflow Pages costruisce con
   `VITE_AGENT_HUB_ORIGIN` delle variabili Actions.
4. Ricarica la scheda del sito pubblicato collegata: è lei a eseguire gli
   strumenti, e una scheda vecchia esegue il codice vecchio.
5. Se l'elenco strumenti è cambiato: in ChatGPT elimina e ricrea il connettore;
   negli altri client riconnetti il server o apri una sessione nuova.
