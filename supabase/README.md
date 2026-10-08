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

`university.sql` è opzionale e la PWA attuale non legge né scrive la sua
tabella. Non serve eseguirlo per il deploy.

Il piano Free può mettere in pausa i progetti inattivi; per i dati importanti
mantieni un backup esportato dall'app. La sincronizzazione cloud attuale invia
JSON non cifrato: RLS limita l'accesso, ma il vault protegge solo la copia
locale.

Gli allegati incorporati sono Base64 dentro `studyos_items.payload` e quindi
consumano la quota del **database**, non la quota Supabase Storage. La PWA
limita i nuovi file incorporati a 600 KiB; per quelli più grandi usa un link.
Controlla sempre i [limiti aggiornati del piano Free](https://supabase.com/pricing).
