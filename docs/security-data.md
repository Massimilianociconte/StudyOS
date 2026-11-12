# Protezione dei dati

Revisione del 12/11/2026. Questa pagina dice dove finiscono i dati di StudyOS, chi li può
leggere e cosa fare se perdi un dispositivo.

**La scelta.** I dati sincronizzati non sono cifrati dall'app prima di partire: arrivano a
Supabase come testo JSON leggibile. Li proteggono tre cose:

- le regole di accesso del database (RLS), che lasciano leggere a ogni account solo le proprie
  righe e quelle che altri gli hanno condiviso;
- la cifratura a riposo del fornitore (dischi e copie di backup di Supabase);
- HTTPS per tutto ciò che viaggia in rete.

Una cifratura fatta dall'app renderebbe impossibili la condivisione, i gruppi, il connettore
remoto degli assistenti e i promemoria mandati dal server, che devono leggere i dati.
La «Password dell'app» cifra solo la copia sul dispositivo (vedi sotto).

## Cosa si salva e dove

| Cosa | Dove | Come |
| --- | --- | --- |
| Materie, esami, attività, eventi, note, obiettivi, sessioni, profilo dell'app | Supabase, tabella `studyos_items` | Una riga JSON per elemento, in chiaro (`encrypted = false`) |
| File dei materiali | Supabase Storage, spazio privato `studyos-files`, cartella del tuo account | Privato: solo tu e chi riceve una condivisione dei materiali |
| Copia di lavoro | Browser del dispositivo (IndexedDB) | Con la «Password dell'app»: cifrata (AES-GCM, chiave dalla password). Senza: in chiaro nel browser |
| Gruppi | `studyos_groups`, `studyos_group_members`, `studyos_group_invites`, `studyos_group_resources`, `studyos_group_activity` | Nome scelto e ruolo dei membri, risorse e attività. L'email dei membri non si salva più |
| Condivisioni | `studyos_shares`, `studyos_share_invites`, `studyos_item_revisions` | Chi riceve cosa e con quale permesso; dei link solo l'impronta (hash). Le versioni precedenti delle modifiche fatte da altri ai tuoi dati restano 90 giorni |
| Profilo online | `studyos_profiles` | Nome, @nome e «Gli altri possono trovarmi» |
| Notifiche | `studyos_push_subscriptions`, `studyos_push_reminders` | Indirizzo del servizio di notifiche del browser e le sue chiavi; titolo e testo dei promemoria finché non partono (poi un giorno) |
| Registri dei limiti | `studyos_person_lookups`, `studyos_push_sends`, `studyos_push_reminder_sends` | Account e ora (per le ricerche anche l'indirizzo IP), cancellati dopo un'ora. Nessun contenuto |
| Connettore remoto degli assistenti | `studyos_agent_grants`, `studyos_agent_audit` | Del segreto solo l'impronta (hash). Il registro tiene le versioni prima e dopo di ogni modifica dell'assistente per 90 giorni, per poterla annullare |
| Account | Supabase Auth (`auth.users`, `auth.sessions`) | Email, impronta della password, sessioni aperte |
| Copia di sicurezza scaricata | File sul tuo dispositivo | Cifrata solo se scegli una password quando la scarichi |

## Chi può leggere

- **Tu**, da ogni dispositivo dove sei connesso al tuo account.
- **Chi riceve una condivisione**: solo le sezioni che hai condiviso, con il permesso scelto,
  finché non la togli. Vede il nome con cui condividi.
- **I membri di un gruppo**: il gruppo, i nomi scelti e i ruoli dei membri, risorse, attività
  e inviti del gruppo. Non vedono le email dei membri né di chi accetta un link di
  condivisione. Eccezione: un vecchio invito per email, di prima dell'11/11/2026, mostra ai membri
  l'indirizzo a cui era stato mandato finché l'invito resta.
- **Chi ti cerca**: con l'email intera esatta o con il tuo @nome trova nome e @nome, solo se
  «Gli altri possono trovarmi» è attivo. Non vede mai la tua email.
- **Gli assistenti AI che colleghi**:
  - il connettore principale legge attraverso l'app aperta;
  - il connettore remoto legge i dati del tuo account nel cloud, con un segreto che passa
    dall'hub Cloudflare di StudyOS.

  In entrambi i casi quello che l'assistente legge arriva al suo fornitore (OpenAI, Anthropic e
  altri). Non riceve mai email, @nome, token, codici di invito, iscrizioni alle notifiche, file
  dei materiali o la chiave di collegamento.
- **Il Worker delle notifiche** (Cloudflare) vede titolo e testo delle notifiche che manda.
  I promemoria dei dispositivi con «Mostra il titolo nelle notifiche» spento non hanno il titolo.
- **L'amministratore del progetto Supabase**, cioè chi entra nel Dashboard del progetto (oggi
  il proprietario di StudyOS). Dal SQL Editor legge tutto in chiaro, comprese le email e i dati
  di ogni account: le regole RLS non valgono per lui. Lo stesso vale per chiunque ottenga la
  password del database o la chiave `service_role`. Per questo quella chiave non va mai nel
  client, nella CI o nel Worker.
- **Il personale di Supabase** può accedere al database solo nei casi previsti dai suoi termini
  (assistenza, obblighi di legge).

## Cosa protegge la cifratura a riposo

Supabase cifra i dischi del database, lo Storage e i backup. Questo protegge da chi ruba un
disco o una copia di backup.

Non protegge da:

- chi entra nel tuo account o usa una tua sessione aperta;
- l'amministratore del progetto, o chi ha la chiave `service_role`;
- un errore nelle regole di accesso;
- una richiesta delle autorità al fornitore.

Contro le regole sbagliate servono i controlli di `verify.sql` (vedi l'ultima sezione).

## Cosa toglie «Cancella anche dall'account»

In Impostazioni → Spazio e dati. Non si può annullare.

| Dato | Cosa succede |
| --- | --- |
| Materie, esami, attività, eventi, note, obiettivi, profilo dell'app | Diventano eliminazioni: spariscono da tutti i tuoi dispositivi, anche quelli mai sincronizzati da quello che cancella |
| File dei materiali | Tolti dallo spazio file dall'app; se è offline, appena si ricollega |
| Promemoria con l'app chiusa | Tolti |
| Versioni precedenti delle modifiche fatte da altri | Tolte |
| Condivisioni e link di condivisione che hai mandato | Tolti: chi li riceveva non vede più nulla |
| Connettore remoto: permessi e registro | Tolti: l'assistente collegato smette di funzionare |
| Profilo online | Nome e @nome svuotati. «Gli altri possono trovarmi» resta com'era |
| Resoconti della sincronizzazione BARB (`university.sql`, oggi non usato) | Tolti |
| Gruppi: tuo nome di membro, risorse e attività che hai scritto | **Restano**: sono anche degli altri membri. Il nome resta quello che avevi scelto (mai l'email). Per andartene usa «Esci dal gruppo» |
| Condivisioni e inviti che altri ti hanno mandato | **Restano**: sono di chi li ha mandati |
| Dispositivi con le notifiche | Questo dispositivo smette di riceverle; gli altri restano finché non esci da lì o non li togli con «Rimuovi» |
| Registri dei limiti (un'ora, senza contenuti) | Restano e si cancellano da soli: toglierli permetterebbe di aggirare i limiti |
| L'account stesso (email e password) | Resta: puoi ancora accedere. Per eliminarlo chiedi all'amministratore del progetto |

«Svuota solo questo dispositivo» non tocca l'account: i dati si riscaricano.

## Se perdi un dispositivo

Da un altro dispositivo connesso al tuo account:

1. **Notifiche.** Impostazioni → Profilo e obiettivi → «Dispositivi con le notifiche»: premi
   «Rimuovi» accanto al dispositivo perso. Smette subito di ricevere le notifiche dell'account.
2. **Assistenti.** In Impostazioni → Agenti AI:
   - «Scollega il connettore remoto» toglie il connettore remoto del tuo account;
   - se dal dispositivo perso avevi approvato degli assistenti, usa «Scollega gli assistenti di
     tutti» in «Avanzate». «Revoca gli accessi di questo browser» toglie solo quelli approvati
     dal browser dove la premi.
3. **Sessioni.** L'app esce solo dal dispositivo su cui premi «Esci», quindi la sessione del
   dispositivo perso va chiusa dal Dashboard Supabase. Apri Authentication → Users e copia lo
   User UID del tuo account. Poi, nel SQL Editor:

   ```sql
   delete from auth.sessions where user_id = 'USER-UID-COPIATO';
   ```

   Chiude le sessioni di tutti i tuoi dispositivi: dovrai rientrare anche sugli altri. Il
   dispositivo perso può ancora sincronizzare per al massimo la durata di un token d'accesso
   (di solito un'ora), poi non più. Se `session_cleanup_ready` di `people-verify.sql` è
   `true`, spariscono anche le sue iscrizioni alle notifiche.
4. **Password.** Se il browser del dispositivo perso ricordava la password, cambiala. L'app
   non ha ancora un comando per farlo: chiedi all'amministratore del progetto.
5. **Copia sul dispositivo.** Con la «Password dell'app» attiva, chi trova il dispositivo non
   legge i dati senza quella password. Senza, chi apre il browser li vede. Da lontano non si
   possono cancellare: chiudere le sessioni impedisce soltanto che arrivino dati nuovi.

## Controlli sul database

`supabase/verify.sql` controlla in modo generico ogni tabella `public.studyos_*` e ogni
funzione `SECURITY DEFINER` di `public`, anche quelle che verranno aggiunte. Va rieseguito dopo
ogni script nuovo.

- **`tables_rls_ready`**: ogni tabella ha la RLS attiva e non appartiene ad `anon` o
  `authenticated`. Nessuno dei due ruoli ha `TRUNCATE`, che svuota una tabella ignorando la RLS.
  Una vista si legge solo con `security_invoker`.
- **`anon_closed_ready`**: `anon` (chi usa la chiave pubblica senza accesso) non ha privilegi
  su quelle tabelle e nessuna policy vale per `anon` o `public`, nemmeno sui file.
- **`definer_functions_ready`**: ogni funzione definer fissa il `search_path`, e `anon` non la
  può chiamare. Le eccezioni sono sette:
  - i cinque ingressi del connettore remoto e `push_gone`, che controllano un segreto;
  - `studyos_keepalive`, che non tocca dati.
- **`security_issues`**: vuota se va tutto bene, altrimenti l'elenco degli oggetti da sistemare
  (solo nomi).
- **`emails_hidden_ready`** ed **`erase_all_ready`**: email nascoste ai membri e cancellazione
  completa.

`people-verify.sql` controlla con **`email_names_ready`** che nessun nome salvato sia la
parte dell'email prima della @.

**Niente FORCE ROW LEVEL SECURITY.** Le tabelle appartengono a `postgres`, che non viene mai
usato dai client: lo usano solo il SQL Editor e le funzioni `SECURITY DEFINER`. Queste ultime
sono il passaggio voluto oltre la RLS, e ognuna controlla chi chiama:

- l'account (`auth.uid()`);
- oppure, per il connettore remoto e il Worker, il segreto.

Forzare la RLS romperebbe proprio queste funzioni. Il connettore remoto non ha un `auth.uid()`,
e le funzioni dei gruppi richiamerebbero le policy che le usano. Al posto di FORCE, `verify.sql`
controlla che nessun ruolo dei client sia proprietario di una tabella.

**Per ogni tabella o funzione nuova.** I privilegi predefiniti di Supabase danno tutto ad `anon`
e `authenticated` su ogni oggetto nuovo di `public`. Ogni script deve quindi:

- attivare la RLS;
- togliere tutto ad `anon` e `TRUNCATE` ad `authenticated`, dando solo i privilegi che servono;
- per ogni funzione definer, fissare il `search_path` e togliere l'esecuzione a `public` e
  `anon`.

Poi riesegui `verify.sql`.

## Limiti noti

- Nell'app non ci sono «Esci da tutti i dispositivi» né il cambio password: per ora passano dal
  Dashboard Supabase (vedi «Se perdi un dispositivo»).
- I vecchi inviti di gruppo per email mostrano ai membri l'indirizzo del destinatario finché
  restano.
- Le voci di attività «ha tolto … dal gruppo» scritte prima della revisione possono contenere un
  nome preso dall'email: il testo della voce non dice di chi è, quindi la pulizia non lo cambia.
