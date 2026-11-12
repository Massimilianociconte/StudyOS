# Ricerca persone, inviti all'account e notifiche push: design

Stato: approvato in chat l'11/11/2026. Scelte: ricerca per email esatta o `@nome`;
profilo trovabile di default (si spegne); push per inviti ricevuti, inviti accettati e
permessi cambiati; inviti in app solo ad account esistenti; conferma email disattivata in
Supabase (fatto l'11/11/2026 dalla dashboard).
Parte da: [condivisione](2026-11-10-sharing-design.md), [gruppi](../groups-sync.md).

## Obiettivo

Invitare una persona senza passare dall'email: la cerchi per email esatta o `@nome`,
la inviti in un gruppo o a vedere i tuoi dati, lei riceve una notifica push e un avviso
in app, tocca **Accetta** ed è subito dentro, con l'invito legato al suo account. Chi non
ha un account si invita come oggi con link, QR o codice.

## Contesto che cambia

- **Conferma email spenta.** Gli account nuovi sono attivi subito
  (`email_confirmed_at` viene impostato alla registrazione). L'email non è più una
  prova di identità: chiunque può registrarsi con l'indirizzo di un altro. Il vero
  proprietario può riprenderselo solo con il recupero password (email dal mittente
  integrato, 2 all'ora).
- Quindi **nessun invito si accetta più in base all'email**: gli inviti in app vanno a un
  account (id utente) trovato con la ricerca e non si creano più inviti per sola email.

## Requisiti

1. **Profilo**: nome visibile e `@nome` facoltativo, unico, minuscolo,
   `^[a-z0-9_.]{3,24}$`. Il nome è quello che già esiste in Impostazioni → Profilo
   (`preferences.displayName`, 1–60 caratteri) e si copia nel profilo online quando
   cambia. Interruttore **"Gli altri possono trovarmi"**, acceso di default anche per gli
   account esistenti.
2. **Avviso una tantum** agli account esistenti al primo avvio dopo l'aggiornamento:
   "Ora chi conosce la tua email o il tuo @nome può trovarti per invitarti. Puoi
   spegnerlo in Impostazioni → Profilo." con **Ok** e **Apri il profilo**.
3. **Ricerca**: solo corrispondenza esatta di email (senza maiuscole) o `@nome`.
   Nessun elenco, nessuna ricerca parziale, mai sé stessi. Il risultato mostra nome e
   `@nome` (o "Nome non impostato"), **mai l'email**. Limite: 30 ricerche al minuto per
   account e 60 al minuto per indirizzo IP; oltre: "Troppe ricerche, riprova tra un
   minuto". Un account non trovabile e uno inesistente danno la stessa risposta
   ("Nessuna persona trovata").
4. **Inviti all'account** dal risultato della ricerca:
   - in un **gruppo** (proprietario e amministratori, come oggi);
   - a **vedere o modificare i tuoi dati** (stesso cassetto Condividi di oggi, con le
     stesse sezioni, materie e permessi).
   L'invito compare a chi lo riceve in **Notifiche** (in tempo reale se l'app è aperta)
   e come notifica push. **Accetta** lo fa entrare subito nel gruppo o attiva subito la
   condivisione; **Rifiuta** chiude l'invito. Solo l'account destinatario può accettarlo.
5. **Inviti per email**: non si creano più (UI e server). Quelli pendenti si legano una
   volta sola, quando si esegue lo script, all'account registrato con quell'indirizzo; i
   restanti non sono più accettabili e chi li ha mandati li vede come "Scaduto: cerca la
   persona per invitarla di nuovo". Link, QR e codice restano come oggi.
6. **Notifiche push** (browser desktop, Android, iPhone/iPad solo con StudyOS aggiunto
   alla schermata Home), mai a chi ha compiuto l'azione:
   - **Invito ricevuto** (gruppo o dati) → al destinatario, apre l'invito.
   - **Invito accettato** → per i dati, a chi ha invitato (anche con link e QR); per i
     gruppi, quando qualcuno entra (invito, codice o QR) → proprietario, amministratori
     e chi l'aveva invitato, con una sola notifica a testa.
   - **Permessi cambiati** → a chi riceve una condivisione quando passa da "Può vedere"
     a "Può modificare" o viceversa, o quando l'accesso viene tolto; per le condivisioni
     a un gruppo, ai membri (al massimo 50).
   Interruttore **"Notifiche su questo dispositivo"** in Impostazioni → Profilo; il
   permesso del browser si chiede solo dopo un tocco della persona (interruttore o
   proposta dopo il primo invito ricevuto). Toccare la notifica apre la pagina giusta.
7. Agenti MCP: nessuno strumento nuovo; non ricevono email, `@nome` cercati o
   iscrizioni push.

## Server: `supabase/people.sql`

Nuovo script, rieseguibile, da lanciare dopo `schema.sql`, `groups.sql` e `sharing.sql`.

- `studyos_profiles (user_id uuid pk → auth.users on delete cascade, display_name,
  handle unique, discoverable boolean default true, created_at, updated_at)`. RLS: ogni
  account legge, crea e modifica solo la propria riga. Nessuna lettura pubblica. Una riga
  mancante vale "trovabile, senza nome né `@nome`".
- `find_person(p_query text)` (`security definer`, solo `authenticated`): normalizza; con
  `@` iniziale cerca l'`@nome`, con un `@` interno cerca l'email in `auth.users`; scarta
  sé stessi e i non trovabili; restituisce al massimo una riga
  `(person_id uuid, display_name, handle)`. Registra la ricerca in
  `studyos_person_lookups (user_id, ip, at)` (IP da `request.headers`: solo `cf-connecting-ip`;
  rivisto il 12/11/2026: il primo valore di `x-forwarded-for` lo sceglie il client e azzerava il
  limite), applica i limiti del requisito 3 e
  cancella le righe più vecchie di un'ora.
- **Inviti di gruppo** (oggi il client li inserisce direttamente nella tabella):
  - colonna `recipient_user_id text` su `studyos_group_invites` (come `from_user_id`);
  - la policy di inserimento accetta solo righe senza destinatario
    (`recipient_email is null and recipient_user_id is null`): gli inviti con codice
    restano come oggi;
  - RPC `invite_person_to_group(p_group_id text, p_person_id uuid)`: proprietario o
    amministratore, persona trovabile, non già membro, un solo invito pendente per
    persona e gruppo; copia nome e descrizione del gruppo e il nome di chi invita;
  - `accept_group_invite` / `decline_group_invite` (stessa firma) accettano solo se
    `recipient_user_id = auth.uid()::text`;
  - lettura per il destinatario su `recipient_user_id`; la lettura per email si toglie.
- **Inviti di condivisione**:
  - colonna `recipient_user_id uuid` su `studyos_share_invites`;
  - `create_share_invite` (stessa firma) crea solo inviti con link: con
    `p_recipient_email` non vuota risponde "Gli inviti per email non ci sono più: cerca
    la persona";
  - RPC `invite_person_to_share(p_person_id uuid, p_owner_name text, p_offers jsonb,
    p_requests jsonb)`: persona trovabile, non sé stessi, stesso limite di 50 inviti
    pendenti, stessa scadenza di 14 giorni; restituisce l'id, senza token;
  - `studyos_claim_share_invite` accetta senza token solo se
    `recipient_user_id = auth.uid()`; con un destinatario impostato il token non basta.
    `accept_share_invite` / `decline_share_invite` mantengono la firma.
- **Migrazione una tantum** (rieseguibile senza effetti): gli inviti pendenti di gruppo e
  di condivisione con solo `recipient_email` ricevono `recipient_user_id` dell'account con
  quell'email, se esiste. Rivisto il 12/11/2026: solo se quell'account aveva confermato
  l'indirizzo prima dell'11/11/2026 (quando la conferma era obbligatoria); gli altri legami ancora
  in attesa si sciolgono a ogni esecuzione.
- Le funzioni e le policy di `groups.sql` e `sharing.sql` toccate qui si aggiornano anche
  in quei due file, così rieseguire uno qualsiasi dei tre non riapre l'accettazione per
  email.
- **Push**:
  - `studyos_push_subscriptions (id, user_id → auth.users on delete cascade, endpoint
    unique, p256dh, auth, created_at, last_seen_at)`; RLS: solo le proprie righe; al
    massimo 10 per account (le più vecchie si cancellano).
  - `studyos_push_notify(p_user_ids uuid[], p_kind, p_title, p_body, p_url, p_tag)`
    (`security definer`, non eseguibile da `anon` e `authenticated`): toglie chi ha
    compiuto l'azione e i doppioni, raccoglie le iscrizioni e chiama con `pg_net`
    `POST <worker>/push` con l'intestazione `x-studyos-push-secret`. Segreto e URL del
    Worker stanno in Vault (`studyos_push_secret`, `studyos_push_url`). Senza segreto o
    senza `pg_net` non fa nulla: mai un errore che blocca la scrittura che l'ha chiamata.
  - Trigger `AFTER` che chiamano `studyos_push_notify`:
    - insert di un invito di gruppo con destinatario → destinatario;
    - insert di un invito di condivisione con destinatario → destinatario;
    - invito di condivisione che passa ad `accepted` → proprietario;
    - insert in `studyos_group_members` con ruolo diverso da `owner` → proprietario,
      amministratori e autore dell'invito accettato, se c'è (l'accettazione di un invito di
      gruppo non ha un suo trigger);
    - update di `permission` e delete su `studyos_shares` → chi riceve.
  - `push_gone(p_secret text, p_endpoints text[])` (`security definer`, eseguibile da
    `anon`): se il segreto coincide con Vault cancella quelle iscrizioni. La chiama il
    Worker per gli endpoint che rispondono 404/410.
- `people-verify.sql`: colonne `*_ready` (tabelle, RLS, RPC, privilegi chiusi ad `anon`
  tranne `push_gone`, policy di inserimento degli inviti di gruppo, trigger, `pg_net`
  presente, segreti presenti in Vault).

## Worker: `POST /push` su `studyos-agent`

- Accetta solo con `x-studyos-push-secret` uguale al secret `STUDYOS_PUSH_SECRET`;
  corpo al massimo 64 kB, al massimo 50 iscrizioni per richiesta.
- Per ogni iscrizione invia una Web Push cifrata (`aes128gcm`, RFC 8291) firmata VAPID
  (RFC 8292, ES256) con WebCrypto; chiave privata nel secret `STUDYOS_VAPID_PRIVATE_KEY`,
  contatto VAPID generico (l'URL del sito, nessun dato personale). TTL 24 h, urgenza
  `normal`, `Topic` = tag dell'evento (una notifica nuova sostituisce la vecchia).
- Raccoglie gli endpoint 404/410 e chiama `push_gone` con la chiave pubblicabile e il
  segreto. Non legge né scrive altro nel database; nessuna `service_role`.
- Risponde `{ sent, gone }`; registra solo conteggi, mai contenuti o endpoint.

## Client

- **Profilo** (Impostazioni → Profilo): `@nome` con controllo di disponibilità,
  "Gli altri possono trovarmi", "Notifiche su questo dispositivo"; il nome resta quello
  di "Profilo e obiettivi". Creazione lazy della riga profilo al primo accesso dopo
  l'aggiornamento.
- **Trova una persona**: un campo unico (email o `@nome`) con risultato a scheda (nome,
  `@nome`, "Invita"). Sostituisce l'invito nominale per email nel pannello Invita dei
  gruppi e si aggiunge nel cassetto Condividi come destinatario "Una persona".
- **Inviti ricevuti**: caricamento e Realtime dei gruppi filtrati su `recipient_user_id`
  invece che sull'email; le condivisioni restano sul canale di oggi (solo segnale).
  Accetta e Rifiuta come oggi.
- **Push**: chiave pubblica VAPID come costante nel codice (è pubblica);
  `pushManager.subscribe` e salvataggio della riga solo dopo un tocco; al riavvio
  dell'app si riallinea l'iscrizione (endpoint cambiato → sostituito). Su iPhone non
  installato: "Aggiungi StudyOS alla schermata Home per ricevere le notifiche".
- **Service worker** (`public/sw.js`): eventi `push` (mostra la notifica con `tag`,
  icona dell'app, `data.url`) e `notificationclick` (porta in primo piano una scheda
  aperta e la fa navigare, altrimenti ne apre una).
- Vincoli invariati: testi in `src/lib/labels.ts` in italiano semplice; niente import
  statici di `lib/supabase`, `lib/groupSync`, `lib/shareSync` nel bundle iniziale (anche il
  codice push e profilo si carica lazy); niente dati altrui nelle collezioni personali.

## Sicurezza e privacy

- Email non verificate: la ricerca per email può trovare chi si è registrato con
  l'indirizzo di un altro. La scheda mostra `@nome` e nome e l'interfaccia invita a
  controllarli con la persona; l'invito resta comunque da accettare. La migrazione lega un
  invito pendente solo a chi aveva confermato l'indirizzo prima dell'11/11/2026 (rivisto il
  12/11/2026: prima lo legava a chi aveva l'indirizzo il giorno dell'esecuzione).
- Enumerazione: solo corrispondenze esatte, risposta identica per inesistente e non
  trovabile, limiti per account e per IP (gli account si creano senza conferma, quindi il
  limite per IP serve).
- Il contenuto delle push (nomi, nome del gruppo) è cifrato fino al dispositivo: i
  servizi push di Google, Apple e Mozilla non lo leggono.
- Segreti: `STUDYOS_PUSH_SECRET` (Worker e Vault), `STUDYOS_VAPID_PRIVATE_KEY` (solo
  Worker). Le chiavi le genera uno script locale; la persona le imposta con comandi
  pronti (Vault dal SQL Editor, Worker con `wrangler secret put`).

## Errori e casi limite

- Persona già membro o con un invito pendente: "È già nel gruppo" / "Ha già un invito".
- Invito a una persona che poi diventa non trovabile: resta valido (è già legato
  all'account).
- Account eliminato: inviti e iscrizioni spariscono per cascata.
- Push non supportate o permesso negato: l'interruttore spiega perché e le notifiche
  in app funzionano comunque.
- `pg_net` assente o segreti non impostati: nessuna push, tutto il resto funziona;
  `people-verify.sql` lo segnala.

## Verifica

- Test unitari: normalizzazione di `@nome`/email, regole del profilo, costruzione del
  payload push, cifratura `aes128gcm` con i vettori di prova dell'RFC 8291, firma VAPID.
- Stack locale (porte 5542x): `people.sql` due volte, `people-verify.sql`, script
  `people-check.mjs` (ricerca esatta, non trovabile = inesistente, limiti, inviti solo
  al destinatario, email rifiutate, inserimento diretto con destinatario rifiutato,
  migrazione, trigger push che chiamano un Worker locale, nessuna push a chi agisce).
- Browser con due account sullo stack locale: ricerca, invito, notifica in app e push,
  Accetta → dentro subito; profilo non trovabile; permesso cambiato → push.
- `npm test`, `npm run lint`, `npm run build`; chunk iniziale senza `supabase`.

## Fasi

1. `people.sql` + `people-verify.sql` + `people-check.mjs` (profili, ricerca, inviti
   all'account, chiusura degli inviti per email, migrazione) e aggiornamento di
   `groups.sql` e `sharing.sql`.
2. Worker `/push` (VAPID, cifratura, `push_gone`) + script di generazione chiavi.
3. Client: profilo, avviso una tantum, "Trova una persona", inviti all'account.
4. Client: iscrizione push e service worker.
5. Documentazione (README Supabase con ordine degli script, `pg_net`, segreti; gruppi;
   GOTCHAS e stato attuale con "conferma email spenta") e verifica completa.

## Fuori ambito

Accesso con Google, SMTP personalizzato, notifiche email, push per modifiche ai dati
condivisi, strumenti agente per la ricerca, chat tra persone.
