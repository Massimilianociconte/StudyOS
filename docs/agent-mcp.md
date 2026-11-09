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
link), note, obiettivi, preferenze di studio, notifiche, bacheca dei gruppi e
appelli BARB. Le letture, di base, passano. Modifiche ed eliminazioni chiedono
conferma nell'app. Si può consentire le sole modifiche per 15 minuti. Le
eliminazioni chiedono comunque conferma, e un agente non può cambiare queste
regole.

Ogni eliminazione deve arrivare con `confirm: true` e va comunque approvata,
salvo una policy impostata da te su «Consenti».

Non sono esposti il vault, il reset, l'import di backup, l'ingresso nei gruppi,
i codici di invito e il caricamento di file. Le risposte non includono file,
foto, email dei membri o passphrase. Le note si possono leggere e scrivere, ma
non hanno ancora una schermata dedicata nell'app.

Se una conferma tarda, l'agente riceve `pending_approval` e deve rileggere
l'esito con `studyos_approval_status`, senza ripetere l'azione. Il registro
delle azioni resta in questo browser.

A vault bloccato l'app risponde che i dati non sono disponibili e non mostra
conteggi vuoti come se fossero veri.

## ChatGPT sul web e app per Mac

ChatGPT, sia sul web sia nell'app Mac, parla con i connettori dell'account.
Quei connettori raggiungono solo un indirizzo HTTPS pubblico. Non parlano con
`localhost` e l'app Mac non avvia il programma sul computer.

Il sito pubblicato (`https://massimilianociconte.github.io/StudyOS/`) usa un
hub sempre acceso. Non serve `npm run dev`, `npm run agent` né un tunnel.
Apri il sito, anche dal telefono, e in **Impostazioni → Agenti** incolla la
chiave di collegamento una volta. Poi in ChatGPT aggiungi il server MCP
all'indirizzo mostrato in quella schermata (finisce con `/mcp`).

L'accesso è OAuth: la conferma compare in Impostazioni → Agenti del browser
che è collegato. ChatGPT poi chiede l'elenco delle azioni con `server/discover`
(protocollo 2026-07-28). Se quel passo era già fallito, in ChatGPT apri il
connettore e scegli Aggiorna; se resta l'errore, eliminalo e crealo di nuovo
con lo stesso indirizzo. Tieni quella pagina aperta. I dati restano nel suo IndexedDB:
un telefono appena aperto vede lo studio solo se è lo stesso browser già usato
oppure se è entrato con lo stesso account cloud.

`npm run agent` resta per la finestra di sviluppo e per Claude, Cursor e gli
altri client locali. Il tunnel `trycloudflare` non serve più al sito pubblicato.

## Claude, Cursor e gli altri client locali

Con l'hub già avviato da `npm run agent`, il comando stdio è:

```bash
node --import ./scripts/lib/register-ts.mjs ./scripts/agent.ts --stdio
```

La directory di lavoro deve essere la cartella di StudyOS. In alternativa,
`npm run agent:stdio`. Lo stdout è riservato al protocollo MCP.

Esempio per Claude Desktop o Cursor:

```json
{
  "mcpServers": {
    "studyos": {
      "command": "node",
      "args": ["--import", "./scripts/lib/register-ts.mjs", "./scripts/agent.ts", "--stdio"],
      "cwd": "/percorso/assoluto/StudyOS"
    }
  }
}
```

Se l'hub non è già in esecuzione, lo stdio ne avvia uno e ne inoltra il
messaggio sul terminale, compreso il codice. Il modo chiaro per leggerlo resta
`npm run agent`.

## Build pubblicata

localhost e GitHub Pages non condividono i dati: ognuno ha il suo IndexedDB.
ChatGPT, collegato all'hub pubblico, modifica solo la scheda pubblicata aperta
e collegata. La finestra di sviluppo non riceve quelle azioni.

La build pubblicata non chiama `127.0.0.1`. L'origine dell'hub arriva da
`VITE_AGENT_HUB_ORIGIN` al momento del deploy. La CSP di quella build deve
includere quell'origine esatta: `https://*.workers.dev` non copre un nome con
due etichette. Dopo una modifica alla CSP serve una nuova build, pubblicata
dal workflow su `main`.
