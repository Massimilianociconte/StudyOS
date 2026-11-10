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

`sharing.sql` (condivisione dei propri dati con altre persone, opzionale) va eseguito
dopo `schema.sql` e `groups.sql`. Incollalo nel SQL Editor come **un unico script** (non ha
una transazione che lo avvolge) e premi Run; si può rieseguire. Poi incolla
[sharing-verify.sql](sharing-verify.sql) in una nuova query: tutti i 13 campi `*_ready`
devono essere `true` (compreso `recipient_values_ready`, la regola sui valori scritti da chi
riceve), `shared_item_policies` deve valere `3` e `own_item_policies` `4`. Sul progetto
reale `sharing.sql` non è mai stato eseguito: non serve alcuna pulizia di valori vecchi.
Senza questa migrazione la sezione Condivisione spiega che la funzione non è attiva e il
resto dell'app non cambia. I link di invito usano `#condividi=` (e `?condividi=` dopo la
conferma email): la regola `https://massimilianociconte.github.io/StudyOS/**` tra i
Redirect URLs copre anche questi. Dettagli in
[docs/groups-sync.md](../docs/groups-sync.md#condivisione-dei-propri-dati-sharingsql).

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
