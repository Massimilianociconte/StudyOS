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
eventi ripetuti compaiono come singole occorrenze. Ogni risposta riporta il nome
della materia accanto all'id, e `studyos_status` e `studyos_overview` danno data,
ora e fuso orario della persona. Le letture, di base, passano. Modifiche ed eliminazioni chiedono
conferma nell'app. Si può consentire le sole modifiche per 15 minuti. Le
eliminazioni chiedono comunque conferma, e un agente non può cambiare queste
regole.

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
versione 1.2.0: dopo l'aggiornamento ricrea il connettore (vedi «Ripubblicare dopo una
modifica»).

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
pagina aperta mentre l'agente lavora: i dati restano nel suo IndexedDB.

L'accesso è OAuth 2.1 con PKCE e registrazione dinamica del client. Al primo
collegamento la conferma compare in Impostazioni → Agenti del browser
collegato. Sono accettati redirect https, loopback con qualsiasi porta
(`http://127.0.0.1:…`, `http://localhost:…`) e schemi delle app native come
`cursor://`. Il server risponde ai protocolli MCP dal 2024-11-05 al 2026-07-28
(`initialize` per i client precedenti, `server/discover` per il 2026), sempre in
JSON e mai in stream.

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
  (`sb_publishable_…`), usate solo per chiamare `push_gone`. Mai `service_role`. Se mancano, la
  pulizia degli endpoint spenti si salta e le notifiche partono lo stesso.

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
