# Preparazione Supabase dalla console web

StudyOS usa le funzioni del piano Free: Postgres, Auth, RLS, Database Functions,
Realtime e Storage (file dei materiali, `storage.sql`). Il dataset BARB e Firecrawl
restano locali; non occorre caricarli su Supabase.

1. Apri il progetto giusto nel Dashboard Supabase → **SQL Editor** → **New query**.
   Incolla l'intero [schema.sql](schema.sql) e premi **Run**. Puoi rieseguirlo
   dopo un aggiornamento: conserva le righe esistenti di `studyos_items`.
   **Rieseguilo dopo la revisione del 28/09/2026**: la funzione di confronto non
   usa più blocchi EXCEPTION (una subtransaction per chiamata), l'RPC rifiuta
   payload con `id` diverso dall'entità e due indici ridondanti vengono rimossi.
2. In una nuova query incolla [verify.sql](verify.sql). Tutti i campi `*_ready`
   devono essere `true` e `own_item_policies` deve valere `4`.
3. In **Authentication → URL Configuration** imposta **Site URL** e **Redirect
   URLs** per `https://massimilianociconte.github.io/StudyOS/`. Per prove locali,
   aggiungi anche `http://localhost:5173/` ai Redirect URLs.
4. In GitHub → repository **StudyOS** → **Settings → Secrets and variables →
   Actions → Variables**, aggiungi `VITE_SUPABASE_URL` e
   `VITE_SUPABASE_PUBLISHABLE_KEY` copiandole dal progetto Supabase. Sono valori
   pubblici del client; non inserire mai `service_role` o una secret key.

Il workflow Pages richiede entrambe le variabili prima della build. La `.env`
locale non viene caricata da GitHub Actions.

`groups.sql` (gruppi condivisi, opzionale) va eseguito dopo `schema.sql`; se lo
avevi già applicato, **rieseguilo dopo la revisione dell'08/10/2026** (vedi
[docs/groups-sync.md](../docs/groups-sync.md)). Per gli inviti via link che
passano dalla conferma email, tra i Redirect URLs aggiungi anche
`https://massimilianociconte.github.io/StudyOS/**`.

**Rieseguilo anche dopo la revisione del 10/11/2026**: accettare o rifiutare un invito
nominale richiede ora un'email presente, uguale a quella dell'invito e confermata.
`groups.sql` si può rieseguire senza perdere righe.

**Revisione del 12/11/2026: riesegui `schema.sql`, `groups.sql`, `sharing.sql`, poi
`verify.sql` e `sharing-verify.sql`** (stesso ordine qui sotto). Cosa cambia:

- `schema.sql`: nuova funzione `erase_studyos_account_items`. «Cancella anche dall'account»
  elimina anche i dati mai arrivati sul dispositivo che cancella (prima tornavano). In
  `verify.sql` la nuova colonna `erase_rpc_ready` deve essere `true`.
- `groups.sql`: `updated_at` di gruppi, inviti e risorse lo scrive il server (un telefono con
  l'orologio avanti nascondeva le modifiche degli altri membri); una sola voce «è entrato nel
  gruppo» per ingresso; «ha lasciato il gruppo» e «ha tolto … dal gruppo» le scrive il server
  solo se l'uscita riesce.
- `sharing.sql`: la modifica di chi riceve non perde più contro un timbro del proprietario
  nel futuro (orologio avanti) e chi modifica un elemento appena eliminato dal proprietario
  riceve un avviso chiaro invece di «Non hai più il permesso».

Senza questa revisione l'app funziona come prima: le cancellazioni dall'account valgono solo
per ciò che c'è sul dispositivo e le voci di uscita dai gruppi non vengono scritte.

Ordine esatto nel SQL Editor, una query alla volta:

1. `schema.sql` (la prima volta o dopo una sua revisione);
2. `groups.sql`;
3. `sharing.sql`;
4. `sharing-verify.sql`.

`sharing.sql` (condivisione dei propri dati con altre persone, opzionale) va eseguito
dopo `schema.sql` e `groups.sql`. Incollalo nel SQL Editor come **un unico script** (non ha
una transazione che lo avvolge) e premi Run; si può rieseguire. Poi incolla
[sharing-verify.sql](sharing-verify.sql) in una nuova query: tutte le 12 colonne `*_ready`
devono essere `true` (compresi `recipient_values_ready`, la regola sui valori scritti da chi
riceve, `triggers_ready`, che controlla anche i trigger su condivisioni e membri dei
gruppi, e `light_history_ready`: la cronologia tiene copertine e file solo nelle eliminazioni, anche nel trigger), `shared_item_policies` deve valere `3` e `own_item_policies` `4`. Sul progetto
reale `sharing.sql` non è mai stato eseguito: non serve alcuna pulizia di valori vecchi.
Senza questa migrazione la sezione Condivisione spiega che la funzione non è attiva e il
resto dell'app non cambia. I link di invito usano `#condividi=` (e `?condividi=` dopo la
conferma email): la regola `https://massimilianociconte.github.io/StudyOS/**` tra i
Redirect URLs copre anche questi. Dettagli in
[docs/groups-sync.md](../docs/groups-sync.md#condivisione-dei-propri-dati-sharingsql).

**Connettore remoto degli agenti (`agent.sql`, opzionale).** Serve solo per il connettore
`/u/<nome>/mcp`, che lavora sui dati cloud di un account con StudyOS chiuso (vedi
[docs/agent-mcp.md](../docs/agent-mcp.md#connettore-remoto-di-un-solo-account-studyos-chiuso)).
Va eseguito dopo `schema.sql`, come un unico script, e si può rieseguire. Poi incolla
[agent-verify.sql](agent-verify.sql) in una nuova query: tutte le colonne `*_ready` devono essere
`true`; `active_grants` conta i permessi attivi (zero finché nessuno preme «Consenti»). Crea la
tabella `studyos_agent_grants` (solo l'hash del segreto di ogni permesso) e le funzioni che l'hub
chiama con la chiave publishable. Il Worker legge URL del progetto e chiave publishable dai secret
`STUDYOS_SUPABASE_URL` e `STUDYOS_SUPABASE_KEY`. Senza questa migrazione il primo connettore `/mcp`
funziona come prima e la richiesta di un connettore remoto spiega nell'app che manca `agent.sql`.
Si prova in locale con `scripts/supabase/agent-check.mjs` (solo stack locale, vedi
[scripts/supabase/local-stack.md](../scripts/supabase/local-stack.md)).

**File dei materiali (`storage.sql`, revisione del 12/11/2026).** I file caricati nei
Materiali non viaggiano più come Base64 dentro `studyos_items.payload`: vanno nel bucket
privato `studyos-files` di Supabase Storage, un file per materiale nel percorso
`<uid>/<id del materiale>`. Ordine nel SQL Editor, una query alla volta:

1. `schema.sql` (se non è già aggiornato);
2. [storage.sql](storage.sql), come un unico script (si può rieseguire): crea il bucket
   (privato, 25 MB per file, solo PDF, immagini, documenti, audio e video), la funzione
   `studyos_can_read_file` e le 4 policy su `storage.objects`;
3. se usi la condivisione, riesegui `sharing.sql` e poi `sharing-verify.sql`: `storedFile`
   (il segno «file nello spazio file») diventa una chiave che chi riceve non può togliere;
4. se usi il connettore remoto, riesegui `agent.sql` e poi `agent-verify.sql`: la nuova colonna
   `stored_file_kept_ready` deve essere `true` (l'agente non vede `storedFile` e non lo perde);
5. `verify.sql`: `files_bucket_ready` e `file_read_ready` devono essere `true` e
   `file_policies` deve valere `4`.

`storage.sql` va eseguito dopo `schema.sql`; rispetto a `groups.sql` e `sharing.sql` l'ordine
non conta. Chi riceve un materiale condiviso ne scarica il file finché può leggere la riga (la
revoca vale subito); scrivere e cancellare file è solo del proprietario. Senza `storage.sql`
l'app funziona: i file nuovi restano sul dispositivo dove sono stati aggiunti (l'app lo dice) e
quelli incorporati di prima restano dove sono; dopo l'esecuzione si caricano da soli. Dettagli:
[docs/superpowers/specs/2026-11-12-attachments-storage-design.md](../docs/superpowers/specs/2026-11-12-attachments-storage-design.md).

`university.sql` è opzionale e la PWA attuale non legge né scrive la sua
tabella. Non serve eseguirlo per il deploy.

Il piano Free mette in pausa i progetti inattivi (vedi sotto); per i dati importanti
mantieni comunque un backup esportato dall'app (il backup completo include i file dei
materiali). La sincronizzazione cloud attuale invia JSON non cifrato: RLS limita l'accesso, ma
il vault protegge solo la copia locale (compresi i file dei materiali sul dispositivo).

I file dei materiali consumano la quota **Storage** del progetto (1 GB sul piano Free al
momento della revisione), non più quella del database. I file incorporati di prima (Base64 in
`studyos_items.payload`, fino a 600 KiB) si spostano da soli nel bucket la prima volta che
l'app è aperta con l'account e la rete; la riga perde i byte solo a caricamento confermato.
Controlla sempre i [limiti aggiornati del piano Free](https://supabase.com/pricing).

## Tenere attivo il progetto (piano Free)

Supabase mette in pausa un progetto Free dopo 7 giorni senza attività del
database. Due cron gratuiti lo impediscono con una vera scrittura in Postgres:

- **Worker Cloudflare** `studyos-supabase-keepalive`
  ([worker/keepalive.ts](../worker/keepalive.ts)): ogni giorno alle 03:17 e alle
  15:17 UTC. È il cron principale: Cloudflare non lo spegne mai per inattività.
- **GitHub Actions** [supabase-keepalive.yml](../.github/workflows/supabase-keepalive.yml):
  lunedì e giovedì alle 06:41 UTC. È la riserva e il controllo: se l'ultimo
  battito ha più di 2 giorni avvisa che il Worker si è fermato; se Supabase non
  risponde il job fallisce e GitHub manda un'email. GitHub disattiva i cron dei
  repository pubblici dopo 60 giorni senza commit: in quel caso riattivalo da
  **Actions → Supabase keep-alive → Enable workflow**.

Passo da fare una volta: nel **SQL Editor** incolla [keepalive.sql](keepalive.sql)
e premi **Run** (si può rieseguire). Crea la tabella `studyos_keepalive` (una
sola riga con l'orario dell'ultimo battito, invisibile ai client) e la funzione
`studyos_keepalive()`. Finché manca, i cron ripiegano su una query di lettura e
segnalano l'avviso nei log. Per controllare:

```sql
select pinged_at, source from public.studyos_keepalive;
```

Il Worker usa solo URL e chiave publishable del progetto, salvate come secret.
Per ridistribuirlo o cambiare progetto:

```bash
npx wrangler secret put SUPABASE_URL -c worker/keepalive.jsonc
npx wrangler secret put SUPABASE_PUBLISHABLE_KEY -c worker/keepalive.jsonc
npx wrangler deploy -c worker/keepalive.jsonc
```
