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
Quei connettori raggiungono un indirizzo HTTPS pubblico, non `localhost` e non
un processo avviato in automatico sul Mac. L'app Mac non va quindi descritta
come un client che lancia da solo il programma locale.

1. Tieni aperti `npm run dev` e `npm run agent`, e collega il codice.
2. Esponi la porta 47321 con un tunnel HTTPS, per esempio
   `cloudflared tunnel --url http://127.0.0.1:47321`.
3. Riavvia l'hub con l'origine pubblica, senza slash finale:

   ```bash
   STUDYOS_PUBLIC_ORIGIN=https://il-tuo-nome.trycloudflare.com npm run agent
   ```

4. In ChatGPT aggiungi un server MCP personalizzato all'URL
   `https://il-tuo-nome.trycloudflare.com/mcp`.
5. L'accesso è OAuth. La pagina di conferma resta sul tunnel; in StudyOS
   compare la richiesta, in Impostazioni → Agenti o nel riquadro in basso.
   Approvi lì. Il codice di autorizzazione torna solo al browser di ChatGPT.

Senza `STUDYOS_PUBLIC_ORIGIN` l'hub accetta solo Host `127.0.0.1` e
`localhost`. Non usa `X-Forwarded-*`.

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
Se la scheda `https://massimilianociconte.github.io/StudyOS/` è aperta e
collegata, ChatGPT modifica quella. La finestra di sviluppo riceve le azioni
solo quando la scheda pubblicata è chiusa da almeno 45 secondi.

La build prova prima `http://127.0.0.1:47321`. Se il browser blocca il
loopback da un sito https, in Impostazioni → Agenti incolla l'indirizzo
`https://….trycloudflare.com` (senza `/mcp`) e salva. La CSP di build consente
il loopback sulla porta 47321 e `https://*.trycloudflare.com`. Dopo una modifica
alla CSP serve una nuova build, pubblicata dal workflow su `main`.
