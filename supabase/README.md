# Preparazione Supabase dalla console web

StudyOS usa le funzioni del piano Free: Postgres, Auth, RLS, Database Functions
e Realtime. Il dataset BARB e Firecrawl restano locali; non occorre caricarli
su Supabase.

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

**La revisione del 10/11/2026** (accettare un invito nominale con un'email presente, uguale e
confermata) è superata da quella dell'11/11/2026 qui sotto: con la conferma email spenta un
invito nominale vale solo per l'account destinatario. `groups.sql` si può rieseguire senza
perdere righe.

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

**Ricerca persone, inviti all'account e notifiche push (revisione dell'11/11/2026, `people.sql`).**
`groups.sql` e `sharing.sql` contengono le stesse regole di `people.sql` sull'accettazione degli
inviti (stesso testo, controllato da `tests/peopleSql.test.mjs` in `npm test` e da
`scripts/supabase/people-check.mjs` sullo stack locale), così rieseguirne uno
in qualunque ordine non riapre l'accettazione per email. `people.sql` contiene anche la versione
del 12/11/2026 di `accept_group_invite` (una sola voce per ingresso).

Ordine esatto nel SQL Editor, una query alla volta:

1. `schema.sql` (la prima volta o dopo una sua revisione);
2. `groups.sql`;
3. `sharing.sql`;
4. `people.sql`;
5. `verify.sql`;
6. `sharing-verify.sql`;
7. `people-verify.sql` (le colonne `pg_net_ready` e `vault_ready` restano `false` finché non
   fai i passi delle notifiche push più sotto: l'app funziona lo stesso, senza push).

Per il connettore remoto degli agenti, dopo `schema.sql`: `agent.sql` e poi `agent-verify.sql`
(vedi sotto).

**Ordine di pubblicazione:** sul progetto reale esegui `groups.sql`, `sharing.sql` e `people.sql`
(in quest'ordine) e controlla che `people-verify.sql` sia tutto verde (a parte `pg_net_ready` e
`vault_ready` se le push non sono ancora attive) **prima** del push su `main`: il push pubblica il
client. Da questa versione il client legge gli inviti ricevuti solo per account
(`recipient_user_id`): senza la colonna si ferma la sincronizzazione dei gruppi e anche il
caricamento delle condivisioni (`shareSync` seleziona la colonna e, se la richiesta fallisce,
fallisce l'intero caricamento). Gli inviti per email ancora in attesa li lega agli account una
sola volta la migrazione di `people.sql` (`studyos_migrations`, `people_email_invites`); quelli
che non trova un account restano scaduti.

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

`people.sql` (ricerca di persone, inviti legati all'account e notifiche push, opzionale) va
eseguito dopo `schema.sql`, `groups.sql` e `sharing.sql`, come un unico script, e si può
rieseguire. Poi incolla [people-verify.sql](people-verify.sql) in una nuova query: tutte le
colonne `*_ready` devono essere `true`; quelle su `pg_net` e sui segreti restano `false` finché
non fai i passi qui sotto, e in quel caso l'app funziona lo stesso, solo senza notifiche push.
Dettagli in [docs/groups-sync.md](../docs/groups-sync.md#persone-inviti-allaccount-e-notifiche-push-peoplesql).

**Conferma email spenta (11/11/2026).** Sul progetto reale, in **Authentication → Sign In /
Providers → Email**, «Confirm email» è disattivato: un account nuovo è attivo subito. L'email
non prova più chi sei, quindi nessun invito si accetta in base all'email: gli inviti in app
vanno a un account trovato con la ricerca e solo quell'account può accettarli. Non riattivare
«Confirm email» senza rileggere [docs/plans/2026-11-11-people-search-push-design.md](../docs/plans/2026-11-11-people-search-push-design.md).

**Notifiche push: `pg_net`, chiavi, Vault e Worker.** Il database avvisa il Worker
`studyos-agent` con `pg_net`; il Worker cifra e invia la notifica. Nessuna `service_role`.
Per ogni persona che agisce il database manda al massimo 30 notifiche all'ora (tabella
`studyos_push_sends`): oltre, salta la push senza errori e senza bloccare la scrittura; gli
avvisi nella campanella arrivano comunque.

1. **pg_net**: Dashboard → **Database → Extensions** → cerca `pg_net` → **Enable**.
2. **Chiavi**: nella cartella del progetto lancia `node scripts/push-keys.mjs`. Genera la coppia
   VAPID e il segreto condiviso; la chiave pubblica sta in `src/lib/pushKeys.ts` (è pubblica,
   si committa), la privata e il segreto non vanno mai in un file del repository.
3. **Vault** (SQL Editor, una volta; se un segreto esiste già, vedi sotto):

```sql
select vault.create_secret('<SEGRETO stampato da push-keys.mjs>', 'studyos_push_secret');
select vault.create_secret('https://studyos-agent.nexify-api.workers.dev/push', 'studyos_push_url');
```

   Per cambiare un valore esistente:

```sql
select vault.update_secret((select id from vault.secrets where name = 'studyos_push_secret'), '<nuovo segreto>');
```

4. **Worker**: quattro secret e un deploy (vedi [docs/agent-mcp.md](../docs/agent-mcp.md#notifiche-push-route-push-del-worker)).
   `STUDYOS_SUPABASE_URL` e `STUDYOS_SUPABASE_KEY` sono gli stessi del connettore remoto: se
   li hai già messi per `agent.sql`, mancano solo `STUDYOS_PUSH_SECRET` e
   `STUDYOS_VAPID_PRIVATE_KEY`.
5. Ripeti `people-verify.sql`: ora anche le colonne su `pg_net` e sui segreti devono essere `true`.

Il segreto del Vault e `STUDYOS_PUSH_SECRET` del Worker devono essere lo stesso valore. Se una
push non arriva: `select id, status_code, left(content, 120) from net._http_response order by id desc limit 5;`
mostra le ultime risposte del Worker (401 = segreti diversi, 404 = URL sbagliato in Vault).

**Revisione del 12/11/2026 (connettore 1.8.0): riesegui `agent.sql`, poi `agent-verify.sql`.**
Ogni modifica del connettore remoto finisce in un registro sul server
(`studyos_agent_audit`): cosa è cambiato, prima e dopo, con quale strumento. Lo scrive
`studyos_agent_push` stessa, quindi l'hub non può saltarlo. Le voci restano 90 giorni, al
massimo le ultime 2000 per account. Da **Impostazioni → Agenti → Modifiche del connettore**
(o con `studyos_restore_change` dal connettore) una modifica si annulla, solo se l'elemento non è
cambiato dopo. Ordine, una query alla volta:

1. `agent.sql` (dopo `schema.sql`; toglie la vecchia `studyos_agent_push` a tre argomenti e crea
   quella con `p_tool`: un hub di prima la chiama ancora uguale);
2. `agent-verify.sql`: tutte le colonne `*_ready` `true`, comprese le nuove `audit_table_ready`,
   `audit_rpc_ready` e `audit_internal_private_ready`; `audit_entries` conta le voci.

Poi serve il deploy del Worker 1.8.0 (vedi [docs/agent-mcp.md](../docs/agent-mcp.md)). Senza la
revisione SQL il Worker 1.8.0 scrive come prima e risponde che il registro non è ancora attivo;
senza il deploy il registro si riempie lo stesso (con lo strumento vuoto) e l'app lo mostra.
Prova su un Postgres usa e getta con lo stub di auth (mai sul progetto reale), dopo `schema.sql`
e `agent.sql`: `psql "$URL" -v ON_ERROR_STOP=1 -f scripts/supabase/agent-audit-check.sql` (ogni
riga deve finire con `|t`).

`university.sql` è opzionale e la PWA attuale non legge né scrive la sua
tabella. Non serve eseguirlo per il deploy.

Il piano Free mette in pausa i progetti inattivi (vedi sotto); per i dati importanti
mantieni comunque un backup esportato dall'app. La sincronizzazione cloud attuale invia
JSON non cifrato: RLS limita l'accesso, ma il vault protegge solo la copia
locale.

Gli allegati incorporati sono Base64 dentro `studyos_items.payload` e quindi
consumano la quota del **database**, non la quota Supabase Storage. La PWA
limita i nuovi file incorporati a 600 KiB; per quelli più grandi usa un link.
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
