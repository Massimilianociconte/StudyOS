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

**Pubblicazione di questa versione (revisione finale, 13/11/2026): in quest'ordine.** Le
notifiche push si accendono per ultime. Se `pg_net`, i segreti nel Vault e `pg_cron` sono attivi
prima del Worker nuovo, i promemoria e gli avvisi di quel momento vanno al Worker vecchio, che non
ha `/push`: il database li segna come mandati e si perdono.

0. Prima di tutto scegli la strada delle chiavi (passo 1 di «Notifiche push» più sotto). Con la
   strada B committa `src/lib/pushKeys.ts` prima del passo 2, altrimenti pubblichi due volte.
1. **SQL.** Nel SQL Editor, una query per script, ognuno incollato per intero: `schema.sql`,
   `groups.sql`, `sharing.sql`, `people.sql`, `storage.sql`, `agent.sql`, `push-reminders.sql`
   (senza `pg_cron` finisce con un avviso: va bene), `group-exams.sql` e, solo se l'avevi
   eseguito, `university.sql` (toglie `TRUNCATE` a `university_sync_reports`). Prendi gli
   script da questo ramo, non da una copia vecchia: con un `groups.sql` vecchio
   `group-exams.sql` si ferma con «Esegui prima groups.sql». Poi i verify:
   - `verify.sql`: ogni `*_ready` `true`, `security_issues` vuoto, `own_item_policies` = 4 e
     `file_policies` = 4. Se il progetto attiva da solo la RLS sulle tabelle nuove, Supabase
     crea `rls_auto_enable()` e `security_issues` la segnala «eseguibile da anon»: non si può
     chiamare direttamente, ma togli il permesso con
     `revoke execute on function public.rls_auto_enable() from public, anon, authenticated;`;
   - `sharing-verify.sql`: ogni `*_ready` `true` (`group_exams_realtime_ready` vuole la
     pubblicazione `supabase_realtime`);
   - `people-verify.sql`: tutto `true` tranne `pg_net_ready` e `vault_ready` (fino al passo 4);
     `session_cleanup_ready` può restare `false`. Se `pg_net` era già attivo va bene, ma i
     segreti nel Vault si mettono solo al passo 4;
   - `agent-verify.sql`: tutto `true`;
   - `push-reminders-verify.sql`: `pg_net_ready`, `vault_ready` e `cron_ready` restano `false`
     fino al passo 4.

   Rieseguili anche se li avevi già eseguiti: `people.sql` ora manda solo «Hai una nuova
   notifica.» ai dispositivi con il titolo nascosto (colonna `push_private_ready` di
   `people-verify.sql`), in lotti più piccoli; `schema.sql` tiene il segno del file salvato quando
   una scheda vecchia lo omette (`stored_file_guard_ready` di `verify.sql`). Se uno script si ferma
   con un errore non ha applicato niente: correggi la causa e rieseguilo prima di andare avanti.
2. **Client, subito.** Pubblica il sito (push su `main`) appena i verify sono a posto, poi
   **ricarica o chiudi le schede vecchie dopo la pubblicazione**, su ogni dispositivo: una scheda
   rimasta aperta con la versione di prima continua a scrivere con le sue regole. La prima apertura
   su ogni dispositivo rifà una lettura completa e sposta i file incorporati nello spazio file
   (1 GB sul piano Free).
3. **Worker.** I secret e `npx wrangler deploy -c worker/wrangler.jsonc` (passo 2 di «Notifiche
   push» più sotto).
4. **Solo dopo il Worker: le push.** Attiva `pg_net`, metti i due segreti nel Vault (passi 3 e 4
   di «Notifiche push»), attiva `pg_cron` e riesegui `push-reminders.sql` (passi 2 e 4 di
   «Promemoria con l'app chiusa»). Poi riesegui `people-verify.sql` e
   `push-reminders-verify.sql`: tutto `true`, tranne al più `session_cleanup_ready`.
5. **Prova.** Da un secondo account invita un dispositivo con le notifiche attive; se non arriva,
   vedi le risposte del Worker in `net._http_response` (più sotto). Dopo la prima notifica a un
   gruppo grande guarda `wrangler tail` per errori di CPU.

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

1. `schema.sql` (la prima volta o dopo una sua revisione; la revisione del 12/11/2026 fa
   togliere a «Cancella tutti i dati» anche i promemoria con l'app chiusa);
2. `groups.sql`;
3. `sharing.sql`;
4. `people.sql` (prima di `push-reminders.sql`, che ne usa le colonne `private` e `session_id`);
5. `push-reminders.sql` (promemoria con l'app chiusa, opzionale, vedi sotto);
6. `group-exams.sql` (appelli condivisi dei gruppi, vedi «Appelli condivisi dei gruppi» in fondo;
   dopo `groups.sql`, `sharing.sql` e `people.sql`, anche dopo `push-reminders.sql`);
7. `verify.sql`;
8. `sharing-verify.sql` (le sei colonne `group_exams_*` restano `false` finché non hai eseguito
   `group-exams.sql`; `group_exams_realtime_ready` dipende dalla pubblicazione `supabase_realtime`
   e `group_exams_agent_ready` anche da `agent.sql`);
9. `people-verify.sql` (le colonne `pg_net_ready` e `vault_ready` restano `false` finché non
   fai i passi delle notifiche push più sotto: l'app funziona lo stesso, senza push);
10. `push-reminders-verify.sql` (`pg_net_ready`, `vault_ready` e `cron_ready` restano `false`
   finché non fai i passi delle push e di `pg_cron` più sotto).

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

**Revisione del 12/11/2026 (sera): riesegui `groups.sql`, `people.sql`, poi `people-verify.sql`.**
Anche se avevi già eseguito `people.sql`. Le nuove colonne di `people-verify.sql` devono essere
`true`:

- `member_name_private_ready`: chi entra in un gruppo senza nome nel profilo si chiama come il suo
  profilo online, altrimenti «Studente». Prima prendeva la parte dell'email prima della @, che
  vedevano tutti i membri, le notifiche e i loro agenti.
- `invite_code_hidden_ready`: un invito a una persona non porta più il codice del gruppo. Prima chi
  lo riceveva poteva leggerlo ed entrare con il codice anche dopo aver rifiutato o dopo il ritiro
  dell'invito. `people.sql` toglie il codice anche dagli inviti già scritti.
- `legacy_invites_safe_ready`: un vecchio invito per email si lega a un account solo se quell'account
  aveva confermato l'indirizzo prima dell'11/11/2026, quando la conferma email era obbligatoria.
  Dopo, chiunque può registrarsi con l'indirizzo di un altro. Se `people.sql` era già stato eseguito,
  i legami verso account più recenti si sciolgono (solo inviti ancora in attesa): chi li aveva mandati
  invita di nuovo con la ricerca. Un invito già accettato non si tocca: controlla i membri del gruppo.
- `request_ip_ready`: il limite di 60 ricerche al minuto per indirizzo IP usa solo
  `cf-connecting-ip`, che scrive Cloudflare. Prima, senza quell'intestazione, usava il primo valore di
  `x-forwarded-for`, che sceglie chi chiama: un valore finto a ogni richiesta azzerava il limite.

Il limite per IP funziona solo se Supabase passa `cf-connecting-ip` al database. Per controllarlo,
fai una ricerca di una persona dall'app, poi nel SQL Editor:
`select count(*) filter (where ip is not null) as con_ip, count(*) as ricerche from public.studyos_person_lookups where at > now() - interval '10 minutes';`.
Se `con_ip` è 0, il limite per IP è spento e resta solo quello per account (30 ricerche al
minuto). La ricerca resta esatta (email intera o @nome): chi prova indirizzi a caso deve
indovinarli interi, uno per ricerca.

**Protezione dei dati (revisione B4 del 12/11/2026).** Cosa si salva dove, chi lo legge e cosa
fare se perdi un dispositivo: [docs/security-data.md](../docs/security-data.md). Nel SQL Editor,
una query alla volta e solo gli script che usi (tutti si possono rieseguire):

1. `schema.sql`;
2. `groups.sql`;
3. `sharing.sql`;
4. `people.sql`;
5. `university.sql`, solo se l'avevi eseguito;
6. `verify.sql`: tutte le colonne `*_ready` `true` (tranne quelle dei file, se non usi
   `storage.sql`) e `security_issues` vuota (`NULL`). Se non è vuota, elenca gli oggetti da
   sistemare;
7. `people-verify.sql`: anche `email_names_ready` `true`.

Cosa cambia:

- **Privilegi.** Il controllo ha trovato 15 problemi. Nove funzioni dei gruppi e delle
  condivisioni erano chiamabili anche senza account (non facevano nulla, ma non devono
  esserlo). Gli account avevano `TRUNCATE`, che svuota una tabella ignorando la RLS, su
  `studyos_items` e sulle cinque tabelle dei gruppi. Ora sono tolti. Le funzioni dei trigger non
  si possono chiamare direttamente.
- **Email.** L'email dei membri dei gruppi non si salva più: la leggevano tutti i membri. Un
  trigger la toglie anche se un'app vecchia la manda, e lo script svuota quelle già salvate.
  Lo stesso vale per l'email di chi accetta un link di condivisione, che vedeva chi
  condivideva. `people.sql` toglie anche l'indirizzo dei vecchi inviti di gruppo per email (prima
  dell'11/11/2026), che leggeva ogni membro: quelli non legati a un account spariscono.
- **Nomi.** `people.sql` sostituisce, una volta sola, i nomi presi dalla parte dell'email prima
  della @ (membri, proprietari, inviti, risorse, attività, condivisioni) con il nome del profilo
  online, altrimenti con «Studente». Il segno `names_from_email` in `studyos_migrations` ferma le
  esecuzioni successive: un nome scelto apposta uguale a quella parte resta. Non legge né
  scrive email: le confronta soltanto.
- **Cancellazione dall'account.** «Cancella anche dall'account» (`erase_studyos_account_items`)
  ora toglie anche:
  - la cronologia delle modifiche fatte da altri;
  - le condivisioni e i link mandati;
  - permessi e registro del connettore remoto;
  - nome e @nome del profilo online;
  - i resoconti BARB.

  I gruppi restano. La colonna `erase_all_ready` di `verify.sql` lo controlla.
- **Controlli generici.** Le nuove colonne di `verify.sql` valgono per ogni tabella di `public`
  e ogni funzione `SECURITY DEFINER`, anche quelle aggiunte dopo:
  - `tables_rls_ready`;
  - `anon_closed_ready`;
  - `definer_functions_ready`;
  - `security_issues`;
  - `emails_hidden_ready`;
  - `erase_all_ready`.

  Riesegui `verify.sql` dopo ogni script nuovo.

Esegui gli script **prima** del push su `main`: il testo di «Cancella anche dall'account»
nell'app descrive già la nuova cancellazione. Il resto dell'app funziona anche senza questa
revisione.

`sharing.sql` (condivisione dei propri dati con altre persone, opzionale) va eseguito
dopo `schema.sql` e `groups.sql`. Incollalo nel SQL Editor come **un unico script** (non ha
una transazione che lo avvolge) e premi Run; si può rieseguire. Poi incolla
[sharing-verify.sql](sharing-verify.sql) in una nuova query: le colonne `*_ready` (12 di
sharing, più le 6 `group_exams_*`, in tutto 18 dopo `group-exams.sql`) devono essere `true` (compresi `recipient_values_ready`, la regola sui valori scritti da chi
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

Servono due valori segreti, che non stanno mai in un file del repository: la **chiave privata
VAPID** (`STUDYOS_VAPID_PRIVATE_KEY`, coppia della chiave pubblica in `src/lib/pushKeys.ts`) e il
**segreto condiviso** (`STUDYOS_PUSH_SECRET`, uguale nel Vault e nel Worker). La chiave pubblica
in `src/lib/pushKeys.ts` è già stata generata l'11/11/2026, quindi `node scripts/push-keys.mjs`
senza opzioni si ferma e non la sostituisce. Al passo 1 scegli una delle due strade.

L'ordine conta: prima il Worker nuovo (passo 2), solo dopo `pg_net` e il Vault (passi 3 e 4). Con
`pg_net` e i segreti attivi e il Worker vecchio, le notifiche vanno a un indirizzo che risponde 404
e si perdono.

1. **Chiavi.**
   - **Strada A: hai ancora i due valori stampati l'11/11/2026** (chiave privata e segreto).
     Non rigenerare niente: li usi ai passi 2 e 4.
   - **Strada B: te ne manca anche solo uno.** Nella cartella del progetto lancia
     `node scripts/push-keys.mjs --rigenera`. Lo script riscrive `src/lib/pushKeys.ts` con una
     chiave pubblica nuova e stampa nel terminale la chiave privata, il segreto, i comandi
     `wrangler` e il blocco SQL per il Vault. Poi:
     1. committa `src/lib/pushKeys.ts` e pubblica il sito (push su `main`). I dispositivi che
        avevano già le notifiche attive si iscrivono di nuovo da soli alla prima apertura dopo
        l'aggiornamento.
     2. Al passo 2 rimetti **tutti e due** i secret e **ripubblica il Worker**: il Worker contiene la
        chiave pubblica e la usa con la privata. Chiave privata nuova con un Worker vecchio, o il
        contrario, vuol dire che ogni push viene rifiutata dal servizio push.
2. **Worker** (terminale, nella cartella del progetto). `wrangler` chiede ogni valore a terminale:
   incollalo lì, mai nella riga di comando.

```bash
npx wrangler secret put STUDYOS_PUSH_SECRET -c worker/wrangler.jsonc
npx wrangler secret put STUDYOS_VAPID_PRIVATE_KEY -c worker/wrangler.jsonc
npx wrangler secret put STUDYOS_SUPABASE_URL -c worker/wrangler.jsonc
npx wrangler secret put STUDYOS_SUPABASE_KEY -c worker/wrangler.jsonc
npx wrangler deploy -c worker/wrangler.jsonc
```

   - `STUDYOS_PUSH_SECRET`: lo stesso valore che metti nel Vault al passo 4.
   - `STUDYOS_VAPID_PRIVATE_KEY`: la chiave privata (strada A: quella dell'11/11; strada B: quella
     appena stampata).
   - `STUDYOS_SUPABASE_URL` (lo stesso valore di `VITE_SUPABASE_URL`) e `STUDYOS_SUPABASE_KEY` (la
     chiave `sb_publishable_…`, mai la `service_role`): sono gli stessi del connettore remoto. Se li
     hai già messi per `agent.sql`, salta quei due comandi.
   - `wrangler deploy` serve sempre: la route `/push` c'è solo nel Worker nuovo.
3. **pg_net**, solo dopo il passo 2: Dashboard → **Database → Extensions** → cerca `pg_net` →
   **Enable**.
4. **Vault** (SQL Editor), solo dopo il passo 2. Strada B: incolla il blocco stampato da
   `push-keys.mjs`. Strada A: usa questo blocco, mettendo il tuo segreto al posto di `<SEGRETO>`
   (due volte). Si può rieseguire: crea i due segreti o ne aggiorna il valore.

```sql
do $$
declare
  v_id uuid;
begin
  select id into v_id from vault.secrets where name = 'studyos_push_secret';
  if v_id is null then
    perform vault.create_secret('<SEGRETO>', 'studyos_push_secret', 'StudyOS: segreto condiviso con il Worker /push');
  else
    perform vault.update_secret(v_id, '<SEGRETO>');
  end if;
  select id into v_id from vault.secrets where name = 'studyos_push_url';
  if v_id is null then
    perform vault.create_secret('https://studyos-agent.nexify-api.workers.dev/push', 'studyos_push_url', 'StudyOS: indirizzo del Worker /push');
  else
    perform vault.update_secret(v_id, 'https://studyos-agent.nexify-api.workers.dev/push');
  end if;
end
$$;
```

5. **Controllo.** Riesegui `people-verify.sql`: ora anche `pg_net_ready` e `vault_ready` devono
   essere `true`. Poi prova: su un dispositivo accendi **Impostazioni → Profilo → Notifiche su
   questo dispositivo**; da un altro account invita quella persona in un gruppo. La notifica arriva
   in pochi secondi.

Se la notifica non arriva, nel SQL Editor:
`select id, status_code, left(content, 120) from net._http_response order by id desc limit 5;`
mostra le ultime risposte del Worker.

- **401**: il segreto nel Vault e `STUDYOS_PUSH_SECRET` sono diversi. Rifai i passi 2 e 4 con lo
  stesso valore.
- **404**: l'URL nel Vault è sbagliato, oppure il Worker non è stato ripubblicato (passo 2).
- **200 con `"sent":0`**: il Worker ha risposto ma il servizio push ha rifiutato. Quasi sempre la
  chiave privata del Worker non è la coppia di quella in `src/lib/pushKeys.ts`: rifai la strada B
  per intero (commit, sito, secret, deploy).
- **Nessuna riga nuova**: `pg_net` è spento o il Vault non ha i due segreti (`people-verify.sql`
  lo dice), chi riceve non ha acceso le notifiche su nessun dispositivo, oppure chi ha invitato ha
  già mandato 30 notifiche nell'ultima ora.

**Revisione del 12/11/2026 (connettore 1.8.0): riesegui `agent.sql`, poi `agent-verify.sql`.**
Ogni modifica del connettore remoto finisce in un registro sul server
(`studyos_agent_audit`): cosa è cambiato, prima e dopo, con quale strumento e in quale richiesta.
Lo scrive `studyos_agent_push` stessa, quindi l'hub non può saltarlo. Le modifiche nate dalla
stessa richiesta (per esempio «elimina la sessione», che la toglie anche da obiettivi e note)
stanno insieme e si annullano insieme, tutto o niente. Le voci restano 90 giorni, circa le ultime
2000 per account. Da **Impostazioni → Agenti → Modifiche del connettore** (o con
`studyos_restore_change` dal connettore) una richiesta si annulla, solo se nessuno dei suoi
elementi è cambiato dopo. Ordine, una query alla volta:

1. `agent.sql` (dopo `schema.sql`; si può rieseguire, anche sopra la prima revisione della 1.8.0:
   aggiunge la colonna `call_id`, toglie le versioni vecchie di `studyos_agent_push` e delle
   funzioni del registro e crea quelle nuove; un hub di prima chiama la push ancora uguale);
2. `agent-verify.sql`: tutte le colonne `*_ready` `true`, comprese `audit_table_ready`,
   `audit_rpc_ready` e `audit_internal_private_ready`; `audit_entries` conta le voci.

Spazio occupato: le voci non contengono file, tranne quelle di un'eliminazione, che tengono a
parte i file dell'elemento eliminato per poterlo rimettere intero. Oggi i file sono dentro le
righe (fino a 600 KiB l'uno): eliminare molti materiali con un agente tiene quei file per 90
giorni, e un account molto attivo può arrivare a decine di MB di registro. Sul piano Free (500 MB)
controllalo ogni tanto con `audit_entries` e lo spazio del database. Quando gli allegati passeranno
a Supabase Storage, il registro terrà solo il riferimento al file e tornerà leggero.

Poi serve il deploy del Worker 1.8.0 (vedi [docs/agent-mcp.md](../docs/agent-mcp.md)). Senza la
revisione SQL il Worker 1.8.0 scrive come prima (e ogni 10 minuti riprova la scrittura nuova) e
risponde che il registro non è ancora attivo; senza il deploy il registro si riempie lo stesso
(con lo strumento vuoto, ogni modifica come richiesta a sé) e l'app lo mostra.
Prova su un Postgres usa e getta con lo stub di auth (mai sul progetto reale), dopo `schema.sql`
e `agent.sql`: `psql "$URL" -v ON_ERROR_STOP=1 -f scripts/supabase/agent-audit-check.sql` (ogni
riga deve finire con `|t`).

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

Revisione dei file (fix 1, 12/11/2026): riesegui `schema.sql` (e `agent.sql` se usi il
connettore remoto). `push_studyos_rows` e `studyos_agent_push` non riportano più un materiale
da «file nello spazio file» (`storedFile: "cloud"`) a «solo sul dispositivo» (`"local"`): una
copia vecchia lo rendeva irraggiungibile a chi lo riceve. In `verify.sql` la nuova colonna
`stored_file_guard_ready` deve essere `true`. Un file di un materiale eliminato resta nel bucket
per 90 giorni (come la cronologia), poi lo toglie l'app del proprietario. Nessuno script nuovo.

`storage.sql` va eseguito dopo `schema.sql`; rispetto a `groups.sql` e `sharing.sql` l'ordine
non conta. Chi riceve un materiale condiviso ne scarica il file finché può leggere la riga (la
revoca vale subito); scrivere e cancellare file è solo del proprietario. Senza `storage.sql`
l'app funziona: i file nuovi restano sul dispositivo dove sono stati aggiunti (l'app lo dice) e
quelli incorporati di prima restano dove sono; dopo l'esecuzione si caricano da soli. Dettagli:
[docs/superpowers/specs/2026-11-12-attachments-storage-design.md](../docs/superpowers/specs/2026-11-12-attachments-storage-design.md).

**Promemoria con l'app chiusa (`push-reminders.sql`, opzionale, 12/11/2026).** I promemoria
di eventi ed esami arrivano come notifica push anche senza una scheda di StudyOS aperta, su
ogni dispositivo con le notifiche attive. L'app scrive i promemoria dei prossimi 7 giorni in
`studyos_push_reminders` (solo l'account stesso, RLS); ogni minuto `pg_cron` esegue
`studyos_push_due_reminders()`, che manda al Worker quelli scaduti (tipo `reminder`) con le
iscrizioni di quell'account soltanto. Dettagli in
[docs/push-reminders.md](../docs/push-reminders.md).

1. Prima i passi delle notifiche push qui sopra, nel loro ordine (Worker con il deploy che
   accetta il tipo `reminder` e l'`account` di ogni iscrizione, poi `pg_net` e Vault).
2. **pg_cron**, solo dopo il deploy del Worker: Dashboard → **Database → Extensions** → cerca `pg_cron` → **Enable**.
3. Riesegui `people.sql` (anche se l'avevi già eseguito): aggiunge alle iscrizioni `private`
   (promemoria senza titolo con la password dell'app) e `session_id` (iscrizione tolta quando la
   sessione finisce), e l'account di ogni iscrizione nelle notifiche. `push-reminders.sql` si
   ferma con un messaggio se `people.sql` non è aggiornato.
4. Esegui `push-reminders.sql` dopo `people.sql`, come un unico script; si può rieseguire (il
   job `studyos-push-reminders` resta uno solo). Senza `pg_cron` lo script va a buon fine e
   avvisa: rieseguilo dopo averlo attivato. Rieseguilo anche se l'avevi già eseguito il
   12/11/2026: tetto di 400 righe per account (anche mandate), righe mandate che un client non
   rimette in coda, turni tra account e al più 60 promemoria all'ora per account, colonna `zone`.
5. Riesegui `schema.sql` (la funzione di «Cancella tutti i dati» toglie anche queste righe).
6. Incolla [push-reminders-verify.sql](push-reminders-verify.sql) e
   [people-verify.sql](people-verify.sql): tutte le colonne `*_ready` devono essere `true`, tranne
   `session_cleanup_ready`, che può restare `false` se il progetto non permette un trigger su
   `auth.sessions` (lo script avvisa e va avanti; restano «Rimuovi» nelle Impostazioni e la
   pulizia alla prima notifica respinta).

Senza questo script l'app funziona come prima: i promemoria arrivano solo con StudyOS aperto.
Per controllare: `select jobname, schedule from cron.job;` e
`select count(*) filter (where sent_at is null) as in_attesa, count(*) filter (where skipped) as saltati from public.studyos_push_reminders;`.

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

## Appelli condivisi dei gruppi (12/11/2026)

Esegui nel SQL Editor, in quest'ordine, dopo `schema.sql`, `groups.sql` (versione del 12/11 o
successiva: la revisione di questo giro aggiunge un controllo sulle righe dei membri), `sharing.sql`,
`people.sql` e, se lo usi, `push-reminders.sql` (l'ordine completo è nell'elenco numerato in cima):

1. `group-exams.sql` — appelli del gruppo, correzioni al catalogo BARB e cronologia. Rieseguibile.
   Se manca `groups.sql` aggiornato si ferma con «Esegui prima groups.sql (versione del 12/11 o successiva)».
   Aggiunge anche un controllo sulla forma degli id dei nuovi gruppi (lettere, cifre, `_` e `-`): i gruppi
   già salvati restano come sono. Agli agenti il connettore dà i testi dei membri senza nessuna email.
   Il nome di un gruppo nuovo o rinominato può avere al massimo 120 caratteri (trigger
   `studyos_groups_name_limit`, stesso limite nell'app); i nomi più lunghi già salvati restano.
   Aggiunge alle righe di appelli e correzioni le copie oscurate per gli agenti (colonne `agent_*`, scritte da un
   trigger a ogni scrittura) e le calcola per le righe che già ci sono: la prima esecuzione aggiorna tutte le
   righe una volta (senza cambiare `updated_at` né `version`), le successive nessuna. Se cambia la regola sulle
   email si aumenta `studyos_email_rule_version()` e si riesegue: si ricalcolano solo le righe vecchie (dettagli
   in `docs/group-exams.md`, «Copie per gli agenti»).
2. `verify.sql`: `definer_functions_ready` deve restare `true` (l'ingresso del connettore
   `studyos_agent_group_snapshot` è tra quelli permessi); poi `sharing-verify.sql`: le colonne
   `group_exams_*` devono essere tutte `true`.

`group-exams.sql` può girare prima o dopo `agent.sql`: la funzione per il connettore remoto
(`studyos_agent_group_snapshot`) usa `studyos_agent_user` solo quando viene chiamata.

Il client nuovo vuole `people.sql` e `group-exams.sql` (vedi anche «Ordine di pubblicazione» sopra): esegui l'SQL e pubblica il client subito dopo.
Prima di pubblicare il sito che legge gli appelli: senza lo script l'app mostra «Gli appelli del gruppo
non sono ancora attivi.» e non perde nulla, ma la persona non può aggiungerne.
