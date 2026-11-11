# Ricerca persone, inviti all'account e notifiche push: piano di implementazione

> **Per chi esegue:** usa la skill `subagent-driven-development` (un sotto-agente per task,
> consigliata) o `executing-plans`. I passi usano le caselle (`- [ ]`). Prima di dichiarare
> concluso: skill `verify-change`.

**Obiettivo:** trovare una persona per email esatta o `@nome`, invitarla in un gruppo o a
vedere i propri dati con un invito legato al suo account, e avvisarla con una notifica push
(invito ricevuto, invito accettato, permessi cambiati).

**Architettura:** un nuovo script `supabase/people.sql` aggiunge profili, ricerca esatta con
limiti, inviti per id utente (gruppi e condivisione) e chiude l'accettazione per email in tutti
e tre gli script. I trigger del database raccolgono le iscrizioni push dei destinatari e le
inviano con `pg_net` al Worker `studyos-agent` (`POST /push`, segreto condiviso letto da
Vault); il Worker cifra (RFC 8291) e firma (VAPID, RFC 8292) con WebCrypto, senza leggere il
database e senza `service_role`. Nel client `src/lib/peopleSync.ts` e `src/lib/push.ts` si
caricano con `import()`; il service worker mostra le notifiche e apre la vista giusta con
`?apri=`.

**Stack:** React 19 + Vite, Tailwind 3, zustand, Dexie, framer-motion (`LazyMotion`, `m.`),
supabase-js v2, Postgres 17 (Supabase) con `pg_net` e Vault, Cloudflare Workers (WebCrypto),
test con `node --test` sui `.ts` (type stripping: niente `enum`, niente parameter properties).

**Spec:** [2026-11-11-people-search-push-design.md](2026-11-11-people-search-push-design.md) ·
**ADR:** scritto nel Task 10 in `docs/agent/decisions/`.

## Vincoli globali

- Nel client, in CI e nel Worker solo la chiave `sb_publishable_`, mai `service_role`.
- `.env` non va committato. Non cancellare mai `.claude/` nel repository.
- Ogni SQL sul progetto reale `kobmoygkwzlprhgfkzwh` lo esegue l'utente nel SQL Editor. Le
  prove avvengono sullo stack Supabase locale con porte proprie (55421–55429, vedi
  `scripts/supabase/local-stack.md`); lo stack `sessa-erp` (54321–54324) non si tocca.
- Etichette solo in `src/lib/labels.ts`, in italiano semplice (`peopleLabels` nei Task 5–7,
  `pushLabels` nel Task 8).
- Ogni `grid` ha `grid-cols-*`. Testo accento con `var(--accent-ink)`. Dettagli in `Drawer`.
  Animazioni solo con `m.` sotto `LazyMotion`.
- Le chiavi esistenti di `useUiState` non si rinominano; le nuove (`peopleNoticeSeen`,
  `pushPromptSeen`) passano dal validatore.
- Bundle iniziale: niente import statici di `lib/supabase`, `lib/groupSync`, `lib/shareSync`,
  `lib/peopleSync`, `lib/push` o dati BARB da store, shell o componenti sempre montati.
- Link e colori da dati di altri: `safeHref` / `normalizeExternalUrl`, `safeCssColor`.
- Agli agenti MCP mai email, `@nome` cercati, iscrizioni push, token o codici di invito.
- Nomi, firme e messaggi d'errore delle RPC sono quelli della tabella "Interfacce" sotto:
  ogni task li usa alla lettera.
- Mai `wrangler deploy` o `wrangler secret put` senza il via esplicito dell'utente (i passi che
  li eseguono dicono "chiedi il via"); niente merge o push senza il suo via.
- Commit: uno per task, messaggi in inglese stile `feat(people): …` / `feat(push): …`, chiusi
  da `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Git nel worktree con comandi
  semplici e separati (niente `cd … &&`, niente `git -C`, niente `$(…)`).
- Verifiche di ogni task: `npm test`, `npm run lint`; dal Task 5 in poi anche `npm run build`.

## Interfacce

| Nome | Firma / forma | Chi la produce → chi la usa |
| --- | --- | --- |
| `studyos_profiles` | `user_id uuid pk`, `display_name`, `handle unique` (`^[a-z0-9_.]{3,24}$`), `discoverable default true` | Task 1 → 6 |
| `find_person` | `(p_query text) → table(person_id uuid, display_name text, handle text)`, 0 o 1 riga; errore `Troppe ricerche, riprova tra un minuto` | Task 1 → 6 |
| `is_handle_available` | `(p_handle text) → boolean` | Task 1 → 6 |
| `invite_person_to_group` | `(p_group_id text, p_person_id uuid, p_display_name text default null) → text`; errori `Nessuna persona trovata`, `È già nel gruppo`, `Ha già un invito`, `Solo proprietario e amministratori possono invitare` | Task 1 → 6 |
| `invite_person_to_share` | `(p_person_id uuid, p_owner_name text, p_offers jsonb, p_requests jsonb default '[]') → jsonb {id}`; errori `Nessuna persona trovata`, `Non puoi invitare te stesso`, `Troppi inviti in attesa: annullane qualcuno` | Task 1 → 6 |
| `create_share_invite` | firma invariata; email non vuota → `Gli inviti per email non ci sono più: cerca la persona` | Task 1 → 6 |
| `studyos_push_subscriptions` | `endpoint unique`, `p256dh`, `auth`, `user_id default auth.uid()`; upsert su `endpoint` | Task 1 → 8 |
| `push_gone` | `(p_secret text, p_endpoints text[]) → integer`, eseguibile da `anon` | Task 1 → 4 |
| Vault | `studyos_push_secret`, `studyos_push_url` (URL completo con `/push`) | Task 1, 4 → 11 |
| `POST /push` | header `x-studyos-push-secret`; corpo `{ notification: { kind, title, body, url, tag }, subscriptions: [{ endpoint, p256dh, auth }] }` → `{ sent, gone }` | Task 1 → 4 |
| `url` delle notifiche | `?apri=notifiche`, `?apri=condivisione`, `?apri=gruppi` (relativi allo scope del service worker) | Task 1 → 8, 9 |
| Secret del Worker | `STUDYOS_PUSH_SECRET`, `STUDYOS_VAPID_PRIVATE_KEY`, `STUDYOS_SUPABASE_URL`, `STUDYOS_SUPABASE_KEY` | Task 4 → 11 |
| `src/lib/pushKeys.ts` | `export const VAPID_PUBLIC_KEY` (base64url, punto non compresso di 65 byte) | Task 4 → 8 |
| `worker/webPush.ts` | `encryptPayload`, `vapidAuthorization`, `sendWebPush` | Task 3 → 4 |
| `src/lib/people.ts` | `HANDLE_PATTERN`, `normalizeHandle`, `classifyPersonQuery`, `FoundPerson` | Task 5 → 6, 7 |
| `src/lib/peopleSync.ts` | `findPerson`, `isHandleAvailable`, `loadMyProfile`, `saveMyProfile`, `invitePersonToGroup`, `invitePersonToShare`, `MyProfile` | Task 6 → 7 |
| `ProfileOnlineCard` | prop `extra?: React.ReactNode`; il Task 7 inserisce `<ProfileOnlineCard />`, il Task 8 lo cambia in `<ProfileOnlineCard extra={<PushToggle />} />` | Task 7 → 8 |
| `src/lib/push.ts` | `pushSupport`, `enablePush`, `disablePush`, `syncPushSubscription` | Task 8 → 9, 11 |

## Mappa dei file

| File | Ruolo | Task |
| --- | --- | --- |
| `supabase/people.sql` (nuovo) | profili, ricerca, inviti all'account, migrazione, iscrizioni e trigger push | 1 |
| `supabase/people-verify.sql` (nuovo) | controllo in sola lettura (`*_ready`) | 1 |
| `supabase/groups.sql`, `supabase/sharing.sql` | stesse regole di `people.sql`: niente accettazione per email | 1 |
| `scripts/supabase/sharing-check.mjs` | il controllo dell'invito per email passa al nuovo errore | 1 |
| `scripts/supabase/people-check.mjs` (nuovo), `scripts/supabase/local-stack.md` | prova API sullo stack locale con un Worker finto | 2 |
| `worker/webPush.ts` (nuovo), `tests/webPush.test.mjs`, `tests/fixtures/pushReceiver.mjs` | cifratura RFC 8291 e firma VAPID | 3 |
| `worker/push.ts` (nuovo), `worker/index.ts`, `tests/pushRoute.test.mjs` | route `POST /push` | 4 |
| `scripts/push-keys.mjs` (nuovo), `src/lib/pushKeys.ts` (nuovo) | chiavi VAPID e segreto (privati solo nel terminale dell'utente) | 4 |
| `src/lib/people.ts` (nuovo), `tests/people.test.mjs`, `src/lib/labels.ts`, `src/types.ts`, `src/lib/sharing.ts` | regole pure, `peopleLabels`, tipi degli inviti | 5 |
| `src/lib/peopleSync.ts` (nuovo, lazy), `src/lib/groupSync.ts`, `src/lib/shareSync.ts`, `src/components/ShareDrawer.tsx`, `src/App.tsx` | RPC, inviti su `recipient_user_id`, niente inviti per email | 6 |
| `src/components/FindPerson.tsx`, `ProfileOnlineCard.tsx`, `PeopleNotice.tsx` (nuovi); `GroupInvite.tsx`, `ShareDrawer.tsx`, `SettingsView.tsx`, `AppShell.tsx`, `GroupsView.tsx`, `SharingView.tsx` | interfaccia: ricerca, profilo online, avviso, inviti scaduti | 7 |
| `src/lib/push.ts` (nuovo, lazy), `src/lib/openLink.ts`, `src/hooks/useOpenLink.ts`, `src/components/PushToggle.tsx`, `PushPrompt.tsx` (nuovi), `tests/push.test.mjs`; `labels.ts`, `App.tsx`, `AppShell.tsx`, `SettingsView.tsx`, `CloudPanel.tsx` | iscrizione push, interruttore, proposta, `?apri=` | 8 |
| `public/sw.js`, `tests/swPush.test.mjs` | eventi `push` e `notificationclick` | 9 |
| `supabase/README.md`, `docs/groups-sync.md`, `docs/agent-mcp.md`, `docs/agent/{CURRENTSTATE,GOTCHAS,INDEX}.md`, `docs/agent/decisions/2026-11-11-push-pg-net-worker.md` | documentazione e ADR | 10 |
| — | verifica completa e passi dell'utente sul progetto reale | 11 |

## Ordine e dipendenze

Task 1 → 2 (database), 3 → 4 (Worker), 5 → 6 → 7 (client persone), 8 → 9 (client push),
10 → 11. Il Task 8 richiede i Task 4 (`pushKeys.ts`) e 7 (`ProfileOnlineCard`). I Task 6 e 7
si pubblicano insieme: dopo il solo Task 6 il campo email del pannello dei gruppi resta ma
non manda nulla.

## Decisioni del coordinatore (valgono per tutti i task)

1. **Test della route:** quelli di `worker/push.ts` stanno in `tests/pushRoute.test.mjs`;
   `tests/push.test.mjs` è del client (Task 8).
2. **Lotti di push:** al massimo 40 iscrizioni per chiamata `pg_net`, timeout 15 s: sul piano
   Free un Worker ha 50 sottorichieste, una serve a `push_gone`. Testi tagliati nel database
   (titolo 120, corpo 240, tag 200 caratteri) e `url` solo tra i tre ammessi; il Worker accetta
   fino a 400 caratteri di corpo, quindi i limiti del database sono quelli che contano.
3. **Progetto reale:** l'utente esegue nel SQL Editor `groups.sql`, `sharing.sql`, `people.sql`
   e poi `people-verify.sql`. `people.sql` da solo basterebbe (contiene la versione finale di
   ogni funzione e policy che cambia), gli altri due tengono allineati i file. Il SQL va
   eseguito **prima** di pubblicare il client: dal Task 6 il client legge `recipient_user_id`.
4. **Controllo del bundle:** il worktree non ha `.env`, quindi le build di controllo usano
   valori finti (`VITE_SUPABASE_URL=http://127.0.0.1:55421`,
   `VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_build_check`), mai chiavi vere, e dopo si
   rifà la build normale.
5. **`?apri=notifiche`:** "Notifiche" è un cassetto, non una vista; lo apre l'evento DOM
   `studyos:open-notifications` (`src/lib/openLink.ts`) ascoltato in `AppShell`.
   `?apri=condivisione` e `?apri=gruppi` cambiano vista.
6. **Aggiunte accettate rispetto alla spec:** tabella-segnaposto `studyos_migrations`;
   `default auth.uid()` su `studyos_profiles.user_id`; un solo invito pendente per persona e
   gruppo (indice unico); un secondo invito di condivisione alla stessa persona aggiorna quello
   pendente (stesso id, nessuna nuova push); `find_person` accetta anche `@nome` senza `@`
   (come `classifyPersonQuery`); i vecchi inviti solo-email rispondono
   `Invito scaduto: chiedine uno nuovo` (condivisione) o `Invito destinato a un altro account`
   (gruppi); `accept_group_invite` chiude l'invito prima di aggiungere il membro; il `Topic`
   della push è l'hash SHA-256 del tag (32 caratteri base64url); `isPushEnabled(userId)`;
   `disablePush()` prima dell'uscita dall'account; `invite_person_to_group` non scrive
   nell'attività del gruppo (lo fa già il client).
7. **Limiti noti accettati:** `is_handle_available` rivela che un `@nome` è preso anche da un
   profilo non trovabile (inevitabile con nomi unici; conta nei limiti di ricerca); il limite
   per IP si basa su `cf-connecting-ip`; un invito di gruppo a un account poi eliminato resta
   come riga che nessuno può accettare (`recipient_user_id` è testo, senza chiave esterna); il
   tetto di 50 membri per le push delle condivisioni a un gruppo non ha un test; la consegna
   vera a un browser si prova solo sul progetto reale; `pushsubscriptionchange` non è gestito
   (lo copre il riallineamento all'avvio).
8. **Segreti:** `node scripts/push-keys.mjs`, il SQL di Vault e i quattro `wrangler secret put`
   li esegue l'utente nel suo terminale e nel SQL Editor; chi esegue il piano non vede mai la
   chiave privata né il segreto. Il Task 4 si ferma su quel passo finché l'utente non ha
   generato `src/lib/pushKeys.ts`.
9. **Totale di `sharing-check.mjs`:** non è fisso; il Task 1 lo fa annotare prima delle
   modifiche e lo confronta dopo.

## Fase 1 — Database: profili, ricerca esatta, inviti all'account e trigger delle notifiche

Con la conferma email spenta un indirizzo non prova più chi lo usa. Da questa fase un invito
nominale vale solo per l'account destinatario (`recipient_user_id`), e non si creano più inviti
per email. Il nuovo `supabase/people.sql` aggiunge:

- profili online;
- ricerca esatta con limiti;
- inviti all'account per gruppi e condivisione;
- iscrizioni push;
- i trigger che passano le notifiche al Worker con `pg_net`.

Le policy e le funzioni di `groups.sql` e `sharing.sql` che riguardano gli inviti nominali cambiano
allo stesso modo, con testo identico byte per byte nei tre file. Così rieseguire uno qualsiasi dei
tre, in qualunque ordine, non riapre l'accettazione per email. `people-check.mjs` (Task 2)
controlla che i blocchi siano uguali.

Vincoli per i Task 1–2 (il resto è nell'intestazione del piano):

- Il progetto reale `kobmoygkwzlprhgfkzwh` non si tocca qui: `people.sql` lo esegue l'utente nel
  SQL Editor nel Task 11.
- Le prove usano solo lo stack locale `studyos-sharing` (porte 55421–55429). Lo stack `sessa-erp`
  (54321–54324) non si tocca.
- Gli script di prova usano la chiave publishable locale e `psql` sul database locale. Mai
  `SERVICE_ROLE_KEY`.
- Git nel worktree con comandi semplici e separati (niente `cd … &&`, `git -C`, `$(…)`).

Ordine: il Task 2 usa il Task 1. Il Task 4 (Worker) consuma il formato di `POST /push` prodotto
qui. Il Task 6 consuma RPC, colonne e messaggi d'errore.

Sul progetto reale, dove `groups.sql` e `sharing.sql` sono già applicati, basta eseguire
`people.sql`: contiene la versione finale di ogni funzione e policy di quei due file che cambia.
Rieseguire più avanti `groups.sql` o `sharing.sql` modificati resta sicuro.

Le modifiche ai file esistenti sono scritte come "In `file` cerca: … Sostituisci con: …":

- il testo da cercare è copiato alla lettera dal file al commit `c6b6688`;
- compare una sola volta;
- i blocchi di uno stesso file vanno applicati nell'ordine in cui sono scritti.

### Task 1: `supabase/people.sql`, `supabase/people-verify.sql` e fine degli inviti per email in `groups.sql` / `sharing.sql`

**File:**
- Create: `supabase/people.sql`
- Create: `supabase/people-verify.sql`
- Modify: `supabase/groups.sql`:
  - intestazione;
  - colonna `recipient_user_id`;
  - policy di lettura e inserimento degli inviti;
  - `accept_group_invite`, `decline_group_invite`.
- Modify: `supabase/sharing.sql`:
  - intestazione;
  - colonna `recipient_user_id`;
  - `grant select` per colonna;
  - policy di lettura degli inviti;
  - `create_share_invite`, `preview_share_invite`, `studyos_claim_share_invite`.
- Modify: `scripts/supabase/sharing-check.mjs`: il blocco dell'invito per email, che dopo questo
  task fallirebbe.

**Interfacce:**
- Produces (nomi, firme e messaggi della tabella Interfacce, alla lettera):
  - **Tabelle:**
    - `studyos_profiles(user_id uuid pk default auth.uid(), display_name text ≤ 60, handle text unique ^[a-z0-9_.]{3,24}$, discoverable boolean default true, created_at, updated_at)`: RLS solo sulla propria riga (select, insert, update).
    - `studyos_person_lookups(id, user_id, ip, at)`: RLS attiva, nessuna policy.
    - `studyos_push_subscriptions(id, user_id default auth.uid(), endpoint unique, p256dh, auth, created_at, last_seen_at)`: RLS sulle proprie righe (select, insert, update, delete). Il client fa upsert su `endpoint`.
    - `studyos_migrations(name pk, done_at)`: RLS attiva, nessuna policy.
  - **Colonne nuove:**
    - `studyos_group_invites.recipient_user_id text`, indice `(recipient_user_id, status)`;
    - `studyos_share_invites.recipient_user_id uuid references auth.users on delete cascade`, indice `(recipient_user_id, status)`, leggibile da `authenticated`.
  - **RPC per `authenticated`:**
    - `find_person(p_query text) → table(person_id uuid, display_name text, handle text)`;
    - `is_handle_available(p_handle text) → boolean`;
    - `invite_person_to_group(p_group_id text, p_person_id uuid, p_display_name text default null) → text`;
    - `invite_person_to_share(p_person_id uuid, p_owner_name text, p_offers jsonb, p_requests jsonb default '[]'::jsonb) → jsonb {"id"}`.
  - **RPC per `anon` e `authenticated`:** `push_gone(p_secret text, p_endpoints text[]) → integer`.
  - **Funzione interna, senza grant:** `studyos_push_notify(p_user_ids uuid[], p_kind text, p_title text, p_body text, p_url text, p_tag text) → void`.
  - **Messaggi d'errore:**
    - `Troppe ricerche, riprova tra un minuto`;
    - `Nessuna persona trovata`;
    - `È già nel gruppo`;
    - `Ha già un invito`;
    - `Solo proprietario e amministratori possono invitare`;
    - `Non puoi invitare te stesso`;
    - `Troppi inviti in attesa: annullane qualcuno`;
    - `Gli inviti per email non ci sono più: cerca la persona`;
    - `Invito destinato a un altro account`;
    - `Invito scaduto: chiedine uno nuovo` (vecchio invito per email non legato a un account).
  - **`POST <studyos_push_url>`:**
    - header `content-type: application/json` e `x-studyos-push-secret`;
    - corpo `{ "notification": { kind, title, body, url, tag }, "subscriptions": [{ endpoint, p256dh, auth }] }`;
    - al massimo 40 iscrizioni per richiesta, timeout di `pg_net` 15 000 ms;
    - testi già nei limiti del Worker: `kind` tra `invite`, `accepted`, `permission`; `url` tra `?apri=notifiche`, `?apri=condivisione`, `?apri=gruppi`; titolo ≤ 120, corpo ≤ 240, tag ≤ 200 caratteri.
- Consumes:
  - `schema.sql`, `groups.sql`, `sharing.sql` di oggi: `studyos_group_role`, `studyos_is_group_member`, `studyos_member_name`, `studyos_validate_share_items`, `studyos_share_name`, `studyos_share_invites`, `studyos_shares`;
  - le estensioni `pg_net` e Vault del progetto Supabase.

Scelte fissate qui:

- **Testo duplicato, non incluso.** Il SQL Editor non sa includere file, quindi i blocchi comuni
  sono copiati identici in `people.sql` e nei due file vecchi. `people-verify.sql` controlla il
  risultato nel database (policy e corpi delle funzioni senza `recipient_email`).
  `people-check.mjs` controlla l'uguaglianza dei testi.
- **Migrazione una sola volta.** È segnata in `studyos_migrations` (`people_email_invites`) e lega
  gli inviti pendenti per email agli account che esistono in quel momento, confrontando
  `lower(email)`:
  - gruppi: uno per coppia gruppo/persona, saltando chi è già membro o ha già un invito per
    account;
  - condivisione: escluso il proprietario.

  Chi si registra dopo non viene legato: gli inviti rimasti slegati diventano "scaduti" (anteprima
  `expired`, accettazione rifiutata). La migrazione non manda notifiche: scrive con `update` e i
  trigger delle push sono `after insert`.
- **Ricerca.** Il testo viene ridotto in minuscolo e senza spazi ai bordi, al massimo 320
  caratteri:
  - `@nome` o un nome nudo che rispetta il formato si cerca come `@nome`;
  - un testo con una `@` interna si cerca come email esatta;
  - qualunque altra cosa dà 0 righe.

  Mai sé stessi. "Non trovabile" e "inesistente" danno la stessa risposta (0 righe). Il risultato
  non contiene mai l'email. Senza profilo una persona è trovabile, con nome `''` e `@nome` null.
- **Limiti delle ricerche.** Ogni chiamata a `find_person` e `is_handle_available` lascia una riga
  in `studyos_person_lookups`, anche quando non trova nulla. Limiti: 30 al minuto per account e 60
  al minuto per IP. L'IP è `cf-connecting-ip`; se manca, il primo valore di `x-forwarded-for`. A
  ogni chiamata si cancellano le righe più vecchie di un'ora. Il registro non è leggibile da nessun
  client.
- **Invito di gruppo all'account:**
  - id `groupInvite_<32 cifre esadecimali>`, nel formato dell'app (`groupInvite_…`);
  - `code` = codice del gruppo in maiuscolo, come in `groupSync.ts`;
  - nome di chi invita = `p_display_name`, altrimenti il suo nome di membro, altrimenti `Studente`.

  Un solo invito pendente per persona e gruppo (indice unico parziale). La RPC non scrive attività
  nel gruppo: la cronologia la scrive il client (Task 6).
- **Invito di condivisione all'account.** Se c'è già un invito pendente e non scaduto dello stesso
  proprietario alla stessa persona, lo si aggiorna: stesso id, nuovi contenuti, nuova scadenza,
  nessuna nuova push, nessun posto in più nel limite di 50. Risponde solo `{"id"}`: il token resta
  nel database e non serve, perché solo quell'account può accettare.
- **Notifiche.** `studyos_push_notify` non solleva mai errori: tutto il corpo sta in
  `begin … exception when others` e un problema diventa un `warning`.
  - Destinatari: toglie chi agisce (`auth.uid()`), i `null` e i doppioni.
  - Si ferma in silenzio senza `pg_net`, senza i due segreti in Vault o con un URL non `http(s)`.
  - Raggruppa le iscrizioni a 40 per richiesta: il Worker sul piano Free ha 50 sottorichieste e
    una serve a `push_gone`. Timeout di `pg_net` 15 s.
  - Taglia i testi ai limiti del Worker (titolo 120, corpo 240, tag 200 caratteri). Un `url` fuori
    dai tre ammessi diventa `?apri=notifiche`, un `kind` diverso non parte: il Worker risponderebbe
    400 e non manderebbe nulla.
  - Le richieste partono solo dopo il commit: una scrittura annullata non manda nulla.
- **Iscrizioni push:**
  - solo `https://`;
  - chiavi nel formato base64url di Web Push;
  - al massimo 10 per account (restano le 10 con `last_seen_at` più recente);
  - lo stesso endpoint registrato da un altro account passa a quell'account (stesso browser, altro
    utente).

  `push_gone` confronta lo SHA-256 del segreto con quello in Vault, accetta al massimo 500
  endpoint e restituisce quante righe ha cancellato.

Eventi e testi (titolo ≤ 120, corpo ≤ 240, tag ≤ 200 caratteri):

| Evento | Trigger | Chi riceve | `kind` | Titolo | Corpo (esempio) | `url` | `tag` |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Invito di gruppo all'account | `studyos_group_invites_push` (after insert, destinatario presente) | il destinatario | `invite` | Invito a un gruppo | Alice ti invita nel gruppo Fisica 2 | `?apri=notifiche` | `group-invite:<id>` |
| Invito di condivisione all'account | `studyos_share_invites_push` (after insert, destinatario presente) | il destinatario | `invite` | Invito a condividere | Alice vuole condividere con te: Calendario, Attività | `?apri=notifiche` | `share-invite:<id>` |
| Invito di condivisione accettato | `studyos_share_invites_accepted_push` (after update of status → `accepted`) | il proprietario | `accepted` | Invito accettato | Bob ha accettato il tuo invito | `?apri=condivisione` | `share-accepted:<id>` |
| Nuovo membro (invito o codice) | `studyos_group_members_push` (after insert, ruolo non `owner`) | proprietario, amministratori e chi ha mandato l'invito accettato, una volta a testa, mai il nuovo membro | `accepted` | Nuovo membro | Carla ora fa parte del gruppo Fisica 2 | `?apri=gruppi` | `group-join:<gruppo>:<utente>` |
| Permesso cambiato | `studyos_shares_permission_push` (after update, per istruzione) | la persona o i membri del gruppo (al massimo 50), mai il proprietario né chi agisce | `permission` | Permessi cambiati | Alice ora ti permette di modificare: Calendario · Alice ora permette al gruppo Fisica 2 di modificare: Obiettivi | `?apri=condivisione` | `share-permission:<primo id>` |
| Accesso tolto | `studyos_shares_removed_push` (after delete, per istruzione) | come sopra | `permission` | Accesso tolto | Alice ha smesso di condividere con te: Calendario | `?apri=condivisione` | `share-permission:<primo id>` |

I nomi delle sezioni sono quelli di `SHARE_SCOPE_LABEL` (`studyos_scope_label`). Permesso cambiato
e accesso tolto raccolgono in una notifica, per ogni persona, tutte le righe toccate dalla stessa
istruzione.

- [ ] **Passo 1: avvia lo stack locale e annota il conteggio di `sharing-check.mjs` di oggi**

Se `.cache/ai/supabase-sharing` non esiste, crealo prima con il primo blocco di
`scripts/supabase/local-stack.md`. Poi, dalla radice del worktree:

```bash
supabase start --workdir .cache/ai/supabase-sharing -x studio,imgproxy,edge-runtime,analytics,vector,storage,functions,inbucket
supabase status --workdir .cache/ai/supabase-sharing -o env
```

Atteso: `API_URL="http://127.0.0.1:55421"`, `DB_URL="postgresql://postgres:postgres@127.0.0.1:55422/postgres"`.
Copia `PUBLISHABLE_KEY` (o `ANON_KEY`). `SERVICE_ROLE_KEY` non si usa.

```bash
export PGURL=postgresql://postgres:postgres@127.0.0.1:55422/postgres
psql "$PGURL" -X -q -v ON_ERROR_STOP=1 -f supabase/schema.sql
psql "$PGURL" -X -q -v ON_ERROR_STOP=1 -f supabase/groups.sql
psql "$PGURL" -X -q -v ON_ERROR_STOP=1 -f supabase/sharing.sql
SUPABASE_URL=http://127.0.0.1:55421 SUPABASE_KEY=<PUBLISHABLE_KEY di supabase status> node scripts/supabase/sharing-check.mjs
```

Atteso: l'ultima riga è `<N> controlli superati, 0 falliti.`. Annota `<N>`: era 85 il 10/11/2026
(`docs/groups-sync.md`), ma i commit successivi possono averlo cambiato. Il Passo 9 deve dare lo
stesso numero. Se fallisce già qui, fermati: il problema è precedente a questo task.

- [ ] **Passo 2: modifica `supabase/groups.sql`**

Cinque blocchi, in quest'ordine. I blocchi 2–5 sono identici a quelli di `people.sql`
(Passo 4).

**Blocco 1 — intestazione.** In `supabase/groups.sql` cerca:

```sql
-- Si può rieseguire: tabelle e righe esistenti restano, policy, trigger e funzioni si
-- aggiornano. Rieseguilo dopo la revisione del 10/11/2026 (accettare o rifiutare un invito
-- nominale richiede un'email presente, uguale e confermata); se usi la condivisione dei dati,
-- poi riesegui sharing.sql e sharing-verify.sql, in quest'ordine.
```

Sostituisci con:

```sql
-- Si può rieseguire: tabelle e righe esistenti restano, policy, trigger e funzioni si
-- aggiornano. Dalla revisione dell'11/11/2026 (conferma email spenta) un invito nominale vale
-- solo per l'account destinatario (recipient_user_id): non si creano né si accettano più inviti
-- per email. Le stesse policy e funzioni sono in people.sql, quindi rieseguire questo file non
-- riapre l'accettazione per email. Se usi anche la condivisione dei dati e la ricerca persone,
-- dopo questo file riesegui sharing.sql e people.sql, in quest'ordine.
```

**Blocco 2 — colonna recipient_user_id.** In `supabase/groups.sql` cerca:

```sql
create index if not exists studyos_group_invites_code_idx
  on public.studyos_group_invites (code);
```

Sostituisci con:

```sql
create index if not exists studyos_group_invites_code_idx
  on public.studyos_group_invites (code);

-- Destinatario di un invito nominale: l'id dell'account (testo, come from_user_id). Gli inviti per
-- sola email restano solo come storico: non si creano né si accettano più.
alter table public.studyos_group_invites add column if not exists recipient_user_id text;
create index if not exists studyos_group_invites_recipient_user_idx
  on public.studyos_group_invites (recipient_user_id, status);
```

**Blocco 3 — policy di lettura e inserimento degli inviti.** In `supabase/groups.sql` cerca:

```sql
-- Inviti: il destinatario legge i propri; i membri vedono gli inviti del gruppo;
-- la creazione è riservata a proprietario/amministratore.
drop policy if exists studyos_group_invites_select on public.studyos_group_invites;
create policy studyos_group_invites_select on public.studyos_group_invites for select to authenticated
  using (
    (recipient_email is not null and lower(recipient_email) = lower(auth.jwt() ->> 'email'))
    or public.studyos_is_group_member(group_id)
    or from_user_id = auth.uid()::text
  );
drop policy if exists studyos_group_invites_insert on public.studyos_group_invites;
create policy studyos_group_invites_insert on public.studyos_group_invites for insert to authenticated
  with check (
    public.studyos_group_role(group_id) in ('owner', 'admin')
    and from_user_id = auth.uid()::text
    and status = 'pending'
  );
```

Sostituisci con:

```sql
-- Inviti: il destinatario (per account, mai per email) legge i propri; i membri vedono gli inviti
-- del gruppo; chi invita vede quelli che ha mandato.
drop policy if exists studyos_group_invites_select on public.studyos_group_invites;
create policy studyos_group_invites_select on public.studyos_group_invites for select to authenticated
  using (
    recipient_user_id = auth.uid()::text
    or public.studyos_is_group_member(group_id)
    or from_user_id = auth.uid()::text
  );
-- Inserimento diretto (proprietario o amministratore) solo per gli inviti con codice, senza
-- destinatario. L'invito a una persona passa da invite_person_to_group (people.sql), che controlla
-- che sia trovabile e non già nel gruppo.
drop policy if exists studyos_group_invites_insert on public.studyos_group_invites;
create policy studyos_group_invites_insert on public.studyos_group_invites for insert to authenticated
  with check (
    public.studyos_group_role(group_id) in ('owner', 'admin')
    and from_user_id = auth.uid()::text
    and status = 'pending'
    and recipient_email is null
    and recipient_user_id is null
  );
```

**Blocco 4 — accept_group_invite.** In `supabase/groups.sql` cerca:

```sql
-- Accetta un invito nominale: solo il destinatario; aggiunge il membro e storicizza.
create or replace function public.accept_group_invite(p_invite_id text, p_display_name text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite public.studyos_group_invites%rowtype;
  v_email text := lower(auth.jwt() ->> 'email');
  v_name text := public.studyos_member_name(p_display_name, lower(auth.jwt() ->> 'email'));
begin
  if auth.uid() is null then
    raise exception 'Accesso richiesto';
  end if;
  select * into v_invite from public.studyos_group_invites where id = p_invite_id;
  if not found then
    raise exception 'Invito non trovato';
  end if;
  if v_invite.status <> 'pending' then
    raise exception 'Invito già gestito';
  end if;
  -- is distinct from: con il claim email mancante (null) non si passa mai. L'email deve essere anche
  -- confermata (auth.users): il claim del JWT da solo non lo dice. Da qui si entra nel gruppo, e un
  -- gruppo può ricevere condivisioni di dati personali.
  if v_invite.recipient_email is null
     or lower(v_invite.recipient_email) is distinct from v_email
     or not exists (
       select 1 from auth.users u
       where u.id = auth.uid() and u.email_confirmed_at is not null and lower(u.email) = lower(v_invite.recipient_email)
     ) then
    raise exception 'Invito destinato a un altro account';
  end if;
  insert into public.studyos_group_members (group_id, user_id, email, display_name, role)
  values (v_invite.group_id, auth.uid()::text, v_email, v_name, 'member')
  on conflict (group_id, user_id) do nothing;
  update public.studyos_group_invites
    set status = 'accepted', updated_at = now()
    where id = p_invite_id;
  insert into public.studyos_group_activity (id, group_id, actor_display_name, text)
  values ('activity-' || p_invite_id, v_invite.group_id, v_name, 'è entrato nel gruppo')
  on conflict (id) do nothing;
end;
$$;
```

Sostituisci con:

```sql
-- Accetta un invito nominale: solo l'account destinatario (recipient_user_id). Con la conferma email
-- spenta l'indirizzo non prova chi lo usa e non conta più. Prima si chiude l'invito, poi entra il
-- membro: il trigger delle notifiche (people.sql) trova così chi aveva invitato.
create or replace function public.accept_group_invite(p_invite_id text, p_display_name text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite public.studyos_group_invites%rowtype;
  v_email text := lower(auth.jwt() ->> 'email');
  v_name text := public.studyos_member_name(p_display_name, lower(auth.jwt() ->> 'email'));
begin
  if auth.uid() is null then
    raise exception 'Accesso richiesto';
  end if;
  select * into v_invite from public.studyos_group_invites where id = p_invite_id for update;
  if not found then
    raise exception 'Invito non trovato';
  end if;
  -- is distinct from: un invito senza destinatario (null) non si accetta mai da qui.
  if v_invite.recipient_user_id is distinct from auth.uid()::text then
    raise exception 'Invito destinato a un altro account';
  end if;
  if v_invite.status <> 'pending' then
    raise exception 'Invito già gestito';
  end if;
  update public.studyos_group_invites
    set status = 'accepted', updated_at = now()
    where id = p_invite_id;
  insert into public.studyos_group_members (group_id, user_id, email, display_name, role)
  values (v_invite.group_id, auth.uid()::text, v_email, v_name, 'member')
  on conflict (group_id, user_id) do nothing;
  insert into public.studyos_group_activity (id, group_id, actor_display_name, text)
  values ('activity-' || p_invite_id, v_invite.group_id, v_name, 'è entrato nel gruppo')
  on conflict (id) do nothing;
end;
$$;
```

**Blocco 5 — decline_group_invite.** In `supabase/groups.sql` cerca:

```sql
-- Rifiuta un invito nominale: solo il destinatario.
create or replace function public.decline_group_invite(p_invite_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite public.studyos_group_invites%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Accesso richiesto';
  end if;
  select * into v_invite from public.studyos_group_invites where id = p_invite_id;
  if not found then
    raise exception 'Invito non trovato';
  end if;
  if v_invite.status <> 'pending' then
    raise exception 'Invito già gestito';
  end if;
  -- Come accept_group_invite: email presente, uguale e confermata.
  if v_invite.recipient_email is null
     or lower(v_invite.recipient_email) is distinct from lower(auth.jwt() ->> 'email')
     or not exists (
       select 1 from auth.users u
       where u.id = auth.uid() and u.email_confirmed_at is not null and lower(u.email) = lower(v_invite.recipient_email)
     ) then
    raise exception 'Invito destinato a un altro account';
  end if;
  update public.studyos_group_invites
    set status = 'declined', updated_at = now()
    where id = p_invite_id;
end;
$$;
```

Sostituisci con:

```sql
-- Rifiuta un invito nominale: solo l'account destinatario, come accept_group_invite.
create or replace function public.decline_group_invite(p_invite_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite public.studyos_group_invites%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Accesso richiesto';
  end if;
  select * into v_invite from public.studyos_group_invites where id = p_invite_id for update;
  if not found then
    raise exception 'Invito non trovato';
  end if;
  if v_invite.recipient_user_id is distinct from auth.uid()::text then
    raise exception 'Invito destinato a un altro account';
  end if;
  if v_invite.status <> 'pending' then
    raise exception 'Invito già gestito';
  end if;
  update public.studyos_group_invites
    set status = 'declined', updated_at = now()
    where id = p_invite_id;
end;
$$;
```

- [ ] **Passo 3: modifica `supabase/sharing.sql`**

Sette blocchi, in quest'ordine. I blocchi 2, 4, 5, 6 e 7 sono identici a quelli di `people.sql`
(Passo 4). Il blocco 3 aggiunge `recipient_user_id` alle colonne leggibili:

- il client del Task 6 la chiede in `INVITE_COLUMNS`;
- senza, la select delle condivisioni fallisce.

**Blocco 1 — intestazione.** In `supabase/sharing.sql` cerca:

```sql
-- quelle nuove si aggiungono e consultano studyos_shares. Vedi docs/groups-sync.md.
```

Sostituisci con:

```sql
-- quelle nuove si aggiungono e consultano studyos_shares. Vedi docs/groups-sync.md.
--
-- Dalla revisione dell'11/11/2026 (conferma email spenta) un invito nominale vale solo per
-- l'account destinatario (recipient_user_id, inviti creati da people.sql) e create_share_invite
-- non crea più inviti per email. Le stesse funzioni e policy sono in people.sql: rieseguire
-- questo file non riapre l'accettazione per email. Dopo questo file riesegui people.sql.
```

**Blocco 2 — colonna recipient_user_id.** In `supabase/sharing.sql` cerca:

```sql
create index if not exists studyos_share_invites_recipient_idx
  on public.studyos_share_invites (recipient_email, status) where recipient_email is not null;
```

Sostituisci con:

```sql
create index if not exists studyos_share_invites_recipient_idx
  on public.studyos_share_invites (recipient_email, status) where recipient_email is not null;

-- Destinatario di un invito all'account (invite_person_to_share in people.sql). Gli inviti per sola
-- email restano solo come storico: non si creano né si accettano più.
alter table public.studyos_share_invites
  add column if not exists recipient_user_id uuid references auth.users (id) on delete cascade;
create index if not exists studyos_share_invites_recipient_user_idx
  on public.studyos_share_invites (recipient_user_id, status);
```

**Blocco 3 — colonne leggibili degli inviti.** In `supabase/sharing.sql` cerca:

```sql
grant select (id, owner_id, owner_name, offers, requests, recipient_email, status, accepted_by, expires_at, created_at)
  on table public.studyos_share_invites to authenticated;
```

Sostituisci con:

```sql
grant select (id, owner_id, owner_name, offers, requests, recipient_email, recipient_user_id, status, accepted_by, expires_at, created_at)
  on table public.studyos_share_invites to authenticated;
```

**Blocco 4 — policy di lettura degli inviti.** In `supabase/sharing.sql` cerca:

```sql
drop policy if exists studyos_share_invites_select on public.studyos_share_invites;
create policy studyos_share_invites_select on public.studyos_share_invites
for select to authenticated
using (
  owner_id = (select auth.uid())
  or (
    status = 'pending'
    and recipient_email is not null
    and recipient_email = (select public.studyos_account_email())
  )
);
```

Sostituisci con:

```sql
drop policy if exists studyos_share_invites_select on public.studyos_share_invites;
create policy studyos_share_invites_select on public.studyos_share_invites
for select to authenticated
using (
  owner_id = (select auth.uid())
  or (status = 'pending' and recipient_user_id = (select auth.uid()))
);
```

**Blocco 5 — create_share_invite.** In `supabase/sharing.sql` cerca:

```sql
create or replace function public.create_share_invite(
  p_owner_name text,
  p_offers jsonb,
  p_requests jsonb default '[]'::jsonb,
  p_recipient_email text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  v_email text := nullif(lower(btrim(coalesce(p_recipient_email, ''))), '');
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Accesso richiesto';
  end if;
  perform public.studyos_validate_share_items(p_offers, true);
  perform public.studyos_validate_share_items(coalesce(p_requests, '[]'::jsonb), false);
  if v_email is not null and v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'Email non valida';
  end if;
  -- Confronto sull'email dell'account (anche non confermata) con exists: un valore mancante non salta il controllo.
  if v_email is not null and exists (
    select 1 from auth.users u where u.id = auth.uid() and lower(u.email) = v_email
  ) then
    raise exception 'Non puoi invitare te stesso';
  end if;
  if (
    select count(*) from public.studyos_share_invites
    where owner_id = auth.uid() and status = 'pending' and expires_at > now()
  ) >= 50 then
    raise exception 'Troppi inviti in attesa: annullane qualcuno';
  end if;
  insert into public.studyos_share_invites (owner_id, owner_name, offers, requests, recipient_email, token_hash)
  values (
    auth.uid(),
    public.studyos_share_name(p_owner_name),
    p_offers,
    coalesce(p_requests, '[]'::jsonb),
    v_email,
    sha256(convert_to(v_token, 'UTF8'))
  )
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'token', v_token);
end;
$$;
```

Sostituisci con:

```sql
-- Invito via link (token). Gli inviti per email non si creano più: con la conferma email spenta un
-- indirizzo non prova chi lo usa. Per un account c'è invite_person_to_share (people.sql).
-- p_recipient_email resta nella firma per i client vecchi: se non è vuoto la richiesta è rifiutata.
create or replace function public.create_share_invite(
  p_owner_name text,
  p_offers jsonb,
  p_requests jsonb default '[]'::jsonb,
  p_recipient_email text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Accesso richiesto';
  end if;
  if nullif(btrim(coalesce(p_recipient_email, '')), '') is not null then
    raise exception 'Gli inviti per email non ci sono più: cerca la persona';
  end if;
  perform public.studyos_validate_share_items(p_offers, true);
  perform public.studyos_validate_share_items(coalesce(p_requests, '[]'::jsonb), false);
  if (
    select count(*) from public.studyos_share_invites
    where owner_id = auth.uid() and status = 'pending' and expires_at > now()
  ) >= 50 then
    raise exception 'Troppi inviti in attesa: annullane qualcuno';
  end if;
  insert into public.studyos_share_invites (owner_id, owner_name, offers, requests, token_hash)
  values (
    auth.uid(),
    public.studyos_share_name(p_owner_name),
    p_offers,
    coalesce(p_requests, '[]'::jsonb),
    sha256(convert_to(v_token, 'UTF8'))
  )
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'token', v_token);
end;
$$;
```

**Blocco 6 — preview_share_invite.** In `supabase/sharing.sql` cerca:

```sql
create or replace function public.preview_share_invite(p_token text)
returns table (
  invite_id uuid,
  owner_name text,
  offers jsonb,
  requests jsonb,
  expires_at timestamptz,
  status text,
  for_other_account boolean,
  is_own boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    i.id,
    i.owner_name,
    i.offers,
    i.requests,
    i.expires_at,
    case when i.status = 'pending' and i.expires_at <= now() then 'expired' else i.status end,
    i.recipient_email is not null and i.recipient_email is distinct from public.studyos_account_email(),
    i.owner_id = auth.uid()
  from public.studyos_share_invites i
  where auth.uid() is not null
    and p_token ~ '^[0-9a-f]{64}$'
    and i.token_hash = sha256(convert_to(p_token, 'UTF8'))
$$;
```

Sostituisci con:

```sql
-- Anteprima di un invito via link. Un vecchio invito per sola email che la migrazione non ha legato
-- a un account risulta scaduto; for_other_account vale per gli inviti legati a un altro account.
create or replace function public.preview_share_invite(p_token text)
returns table (
  invite_id uuid,
  owner_name text,
  offers jsonb,
  requests jsonb,
  expires_at timestamptz,
  status text,
  for_other_account boolean,
  is_own boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    i.id,
    i.owner_name,
    i.offers,
    i.requests,
    i.expires_at,
    case
      when i.status = 'pending'
        and (i.expires_at <= now() or (i.recipient_user_id is null and i.recipient_email is not null))
        then 'expired'
      else i.status
    end,
    i.recipient_user_id is not null and i.recipient_user_id is distinct from auth.uid(),
    i.owner_id = auth.uid()
  from public.studyos_share_invites i
  where auth.uid() is not null
    and p_token ~ '^[0-9a-f]{64}$'
    and i.token_hash = sha256(convert_to(p_token, 'UTF8'))
$$;
```

**Blocco 7 — studyos_claim_share_invite.** In `supabase/sharing.sql` cerca:

```sql
-- Verifica l'invito per chi lo apre: email destinataria, oppure token per gli inviti via link.
create or replace function public.studyos_claim_share_invite(p_invite_id uuid, p_token text)
returns public.studyos_share_invites
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite public.studyos_share_invites%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Accesso richiesto';
  end if;
  select * into v_invite from public.studyos_share_invites where id = p_invite_id for update;
  if not found then
    raise exception 'Invito non trovato';
  end if;
  if v_invite.owner_id = auth.uid() then
    raise exception 'È un tuo invito: mandalo a un''altra persona';
  end if;
  if v_invite.status <> 'pending' then
    raise exception 'Invito già usato';
  end if;
  if v_invite.expires_at <= now() then
    raise exception 'Invito scaduto: chiedine uno nuovo';
  end if;
  if v_invite.recipient_email is not null then
    -- is distinct from: con email mancante o non confermata non si passa mai (null <> x non solleva nulla).
    if v_invite.recipient_email is distinct from public.studyos_account_email() then
      raise exception 'Invito destinato a un altro account';
    end if;
  elsif p_token is null or v_invite.token_hash <> sha256(convert_to(p_token, 'UTF8')) then
    raise exception 'Link di invito non valido';
  end if;
  return v_invite;
end;
$$;
```

Sostituisci con:

```sql
-- Verifica l'invito per chi lo apre. Invito all'account (recipient_user_id): vale solo per quell'account
-- e il token da solo non basta. Vecchio invito per sola email non legato a un account: non si accetta
-- più. Invito via link: serve il token.
create or replace function public.studyos_claim_share_invite(p_invite_id uuid, p_token text)
returns public.studyos_share_invites
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite public.studyos_share_invites%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Accesso richiesto';
  end if;
  select * into v_invite from public.studyos_share_invites where id = p_invite_id for update;
  if not found then
    raise exception 'Invito non trovato';
  end if;
  if v_invite.owner_id = auth.uid() then
    raise exception 'È un tuo invito: mandalo a un''altra persona';
  end if;
  if v_invite.status <> 'pending' then
    raise exception 'Invito già usato';
  end if;
  if v_invite.expires_at <= now() then
    raise exception 'Invito scaduto: chiedine uno nuovo';
  end if;
  if v_invite.recipient_user_id is not null then
    if v_invite.recipient_user_id is distinct from auth.uid() then
      raise exception 'Invito destinato a un altro account';
    end if;
  elsif v_invite.recipient_email is not null then
    raise exception 'Invito scaduto: chiedine uno nuovo';
  elsif p_token is null or v_invite.token_hash <> sha256(convert_to(p_token, 'UTF8')) then
    raise exception 'Link di invito non valido';
  end if;
  return v_invite;
end;
$$;
```

- [ ] **Passo 4: crea `supabase/people.sql`**

Si esegue tutto insieme, come un unico script, dopo `schema.sql`, `groups.sql` e `sharing.sql`.

```sql
-- StudyOS: ricerca persone, inviti all'account e notifiche push (migrazione opzionale).
--
-- Da eseguire nel SQL Editor DOPO schema.sql, groups.sql e sharing.sql, come un unico script.
-- Rieseguibile: tabelle e righe restano, funzioni, policy e trigger si aggiornano; la migrazione
-- degli inviti per email gira una volta sola.
--
-- Conferma email spenta (11/11/2026): un indirizzo non prova più chi lo usa. Gli inviti nominali
-- valgono solo per l'account destinatario (recipient_user_id) e non se ne creano più per email.
-- Le policy e le funzioni di groups.sql e sharing.sql toccate qui sono identiche in quei due file:
-- rieseguire uno qualsiasi dei tre non riapre l'accettazione per email.
--
-- Notifiche push: servono pg_net e due segreti in Vault (studyos_push_secret, studyos_push_url).
-- Senza, nessuna notifica parte e tutto il resto funziona. Vedi supabase/README.md.

do $$
begin
  if to_regclass('public.studyos_items') is null then
    raise exception 'Esegui prima supabase/schema.sql';
  end if;
  if to_regclass('public.studyos_group_invites') is null then
    raise exception 'Esegui prima supabase/groups.sql';
  end if;
  if to_regclass('public.studyos_share_invites') is null then
    raise exception 'Esegui prima supabase/sharing.sql';
  end if;
end $$;

-- pg_net: richieste HTTP asincrone, spedite solo dopo il commit. Se l'estensione non si può
-- attivare lo script prosegue senza notifiche push; people-verify.sql lo segnala.
do $$
begin
  create extension if not exists pg_net with schema extensions;
exception when others then
  raise notice 'pg_net non disponibile, notifiche push spente: %', sqlerrm;
end $$;

-- ─── Tabelle ────────────────────────────────────────────────────────────────

-- Profilo online: nome visibile, @nome facoltativo e "Gli altri possono trovarmi". Una riga mancante
-- vale "trovabile, senza nome né @nome". Nessuna lettura pubblica: la ricerca passa da find_person.
create table if not exists public.studyos_profiles (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  display_name text not null default '',
  handle text,
  discoverable boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.studyos_profiles drop constraint if exists studyos_profiles_display_name_check;
alter table public.studyos_profiles add constraint studyos_profiles_display_name_check
  check (char_length(display_name) <= 60);
alter table public.studyos_profiles drop constraint if exists studyos_profiles_handle_check;
alter table public.studyos_profiles add constraint studyos_profiles_handle_check
  check (handle ~ '^[a-z0-9_.]{3,24}$');
create unique index if not exists studyos_profiles_handle_key on public.studyos_profiles (handle);

-- Registro delle ricerche (find_person e is_handle_available) per i limiti: 30 al minuto per account,
-- 60 al minuto per indirizzo IP. Le righe più vecchie di un'ora si cancellano a ogni ricerca.
create table if not exists public.studyos_person_lookups (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  ip text,
  at timestamptz not null default now()
);
create index if not exists studyos_person_lookups_user_idx on public.studyos_person_lookups (user_id, at);
create index if not exists studyos_person_lookups_ip_idx on public.studyos_person_lookups (ip, at) where ip is not null;
create index if not exists studyos_person_lookups_at_idx on public.studyos_person_lookups (at);

-- Iscrizioni Web Push, una per browser. Il client fa upsert su endpoint.
create table if not exists public.studyos_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

alter table public.studyos_push_subscriptions drop constraint if exists studyos_push_subscriptions_values_check;
alter table public.studyos_push_subscriptions add constraint studyos_push_subscriptions_values_check
  check (
    endpoint ~ '^https://' and char_length(endpoint) <= 2048
    and p256dh ~ '^[A-Za-z0-9_-]{80,100}={0,2}$'
    and auth ~ '^[A-Za-z0-9_-]{16,32}={0,2}$'
  );
create index if not exists studyos_push_subscriptions_user_idx
  on public.studyos_push_subscriptions (user_id, last_seen_at desc);

-- Interventi una tantum già eseguiti (per ora la migrazione degli inviti per email).
create table if not exists public.studyos_migrations (
  name text primary key,
  done_at timestamptz not null default now()
);

-- Destinatario di un invito nominale: l'id dell'account (testo, come from_user_id). Gli inviti per
-- sola email restano solo come storico: non si creano né si accettano più.
alter table public.studyos_group_invites add column if not exists recipient_user_id text;
create index if not exists studyos_group_invites_recipient_user_idx
  on public.studyos_group_invites (recipient_user_id, status);
-- Un solo invito in attesa per persona e gruppo, anche con due richieste contemporanee.
create unique index if not exists studyos_group_invites_pending_person_key
  on public.studyos_group_invites (group_id, recipient_user_id)
  where status = 'pending' and recipient_user_id is not null;

-- Destinatario di un invito all'account (invite_person_to_share in people.sql). Gli inviti per sola
-- email restano solo come storico: non si creano né si accettano più.
alter table public.studyos_share_invites
  add column if not exists recipient_user_id uuid references auth.users (id) on delete cascade;
create index if not exists studyos_share_invites_recipient_user_idx
  on public.studyos_share_invites (recipient_user_id, status);

-- ─── RLS e privilegi delle nuove tabelle ────────────────────────────────────

alter table public.studyos_profiles enable row level security;
alter table public.studyos_person_lookups enable row level security;
alter table public.studyos_push_subscriptions enable row level security;
alter table public.studyos_migrations enable row level security;

-- I privilegi predefiniti del progetto danno tutto ad anon e authenticated: si tolgono e si concede
-- solo il necessario. Registro e migrazioni non hanno policy: li toccano solo le funzioni DEFINER.
revoke all on table public.studyos_profiles from anon, authenticated;
revoke all on table public.studyos_person_lookups from anon, authenticated;
revoke all on table public.studyos_push_subscriptions from anon, authenticated;
revoke all on table public.studyos_migrations from anon, authenticated;
grant select, insert, update on table public.studyos_profiles to authenticated;
grant select, insert, update, delete on table public.studyos_push_subscriptions to authenticated;

drop policy if exists studyos_profiles_select on public.studyos_profiles;
create policy studyos_profiles_select on public.studyos_profiles for select to authenticated
  using (user_id = (select auth.uid()));
drop policy if exists studyos_profiles_insert on public.studyos_profiles;
create policy studyos_profiles_insert on public.studyos_profiles for insert to authenticated
  with check (user_id = (select auth.uid()));
drop policy if exists studyos_profiles_update on public.studyos_profiles;
create policy studyos_profiles_update on public.studyos_profiles for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists studyos_push_subscriptions_select on public.studyos_push_subscriptions;
create policy studyos_push_subscriptions_select on public.studyos_push_subscriptions for select to authenticated
  using (user_id = (select auth.uid()));
drop policy if exists studyos_push_subscriptions_insert on public.studyos_push_subscriptions;
create policy studyos_push_subscriptions_insert on public.studyos_push_subscriptions for insert to authenticated
  with check (user_id = (select auth.uid()));
drop policy if exists studyos_push_subscriptions_update on public.studyos_push_subscriptions;
create policy studyos_push_subscriptions_update on public.studyos_push_subscriptions for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
drop policy if exists studyos_push_subscriptions_delete on public.studyos_push_subscriptions;
create policy studyos_push_subscriptions_delete on public.studyos_push_subscriptions for delete to authenticated
  using (user_id = (select auth.uid()));

-- Proprietario e data di creazione di un profilo non cambiano; updated_at lo scrive il server.
create or replace function public.studyos_profiles_touch()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  new.user_id := old.user_id;
  new.created_at := old.created_at;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists studyos_profiles_touch on public.studyos_profiles;
create trigger studyos_profiles_touch
before update on public.studyos_profiles
for each row execute function public.studyos_profiles_touch();

-- Un browser ha un solo endpoint: se un altro account lo registra (stesso dispositivo, account
-- cambiato), la riga del precedente sparisce e le sue notifiche non arrivano più lì. Conoscere
-- l'endpoint vuol dire avere quel browser: nessun altro lo legge.
create or replace function public.studyos_push_subscriptions_claim()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.studyos_push_subscriptions
  where endpoint = new.endpoint and user_id is distinct from new.user_id;
  return new;
end;
$$;

drop trigger if exists studyos_push_subscriptions_claim on public.studyos_push_subscriptions;
create trigger studyos_push_subscriptions_claim
before insert on public.studyos_push_subscriptions
for each row execute function public.studyos_push_subscriptions_claim();

-- Al massimo 10 iscrizioni per account: le più vecchie (ultimo uso) si cancellano.
create or replace function public.studyos_push_subscriptions_cap()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.studyos_push_subscriptions
  where id in (
    select s.id from public.studyos_push_subscriptions s
    where s.user_id = new.user_id
    order by s.last_seen_at desc, s.created_at desc, s.id
    offset 10
  );
  return null;
end;
$$;

drop trigger if exists studyos_push_subscriptions_cap on public.studyos_push_subscriptions;
create trigger studyos_push_subscriptions_cap
after insert on public.studyos_push_subscriptions
for each row execute function public.studyos_push_subscriptions_cap();

-- ─── Funzioni di appoggio (interne) ─────────────────────────────────────────

-- Testo → uuid, null se non è un uuid (gli id dei gruppi e dei membri sono testo).
create or replace function public.studyos_uuid(p_value text)
returns uuid
language sql
immutable
set search_path = pg_catalog
as $$
  select case
    when p_value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then p_value::uuid
  end
$$;

-- IP di chi chiama, dalle intestazioni che PostgREST espone in request.headers:
-- cf-connecting-ip, altrimenti il primo valore di x-forwarded-for. Null fuori da una richiesta API.
create or replace function public.studyos_request_ip()
returns text
language sql
stable
set search_path = pg_catalog
as $$
  select left(nullif(btrim(coalesce(
    nullif(btrim(request.headers ->> 'cf-connecting-ip'), ''),
    split_part(coalesce(request.headers ->> 'x-forwarded-for', ''), ',', 1)
  )), ''), 64)
  from (
    select case
      when coalesce(current_setting('request.headers', true), '') like '{%'
        then current_setting('request.headers', true)::jsonb
      else '{}'::jsonb
    end as headers
  ) as request
$$;

-- Account esistente e trovabile (una riga di profilo mancante vale "trovabile").
create or replace function public.studyos_person_discoverable(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from auth.users u where u.id = p_user and u.deleted_at is null)
    and coalesce((select p.discoverable from public.studyos_profiles p where p.user_id = p_user), true)
$$;

-- Limiti delle ricerche: registra la ricerca o risponde "Troppe ricerche". Una ricerca rifiutata
-- non si registra (l'errore annulla tutto), quindi dopo un minuto si riparte.
create or replace function public.studyos_person_lookup_guard()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ip text := public.studyos_request_ip();
begin
  if auth.uid() is null then
    raise exception 'Accesso richiesto';
  end if;
  delete from public.studyos_person_lookups l where l.at < now() - interval '1 hour';
  if (
    select count(*) from public.studyos_person_lookups l
    where l.user_id = auth.uid() and l.at > now() - interval '1 minute'
  ) >= 30 or (
    v_ip is not null and (
      select count(*) from public.studyos_person_lookups l
      where l.ip = v_ip and l.at > now() - interval '1 minute'
    ) >= 60
  ) then
    raise exception 'Troppe ricerche, riprova tra un minuto';
  end if;
  insert into public.studyos_person_lookups (user_id, ip) values (auth.uid(), v_ip);
end;
$$;

-- Nomi delle sezioni nelle notifiche: specchio di SHARE_SCOPE_LABEL in src/lib/labels.ts.
create or replace function public.studyos_scope_label(p_scope text)
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select case p_scope
    when 'calendar' then 'Calendario'
    when 'barb_exams' then 'Appelli ufficiali'
    when 'tasks' then 'Attività'
    when 'study' then 'Studio'
    when 'progress' then 'Progressi'
    when 'materials' then 'Materiali'
    when 'goals' then 'Obiettivi'
    else 'Dati'
  end
$$;

-- Chi riceve una condivisione: la persona, oppure i membri del gruppo (al massimo 50, mai il
-- proprietario).
create or replace function public.studyos_share_audience(p_owner uuid, p_user uuid, p_group text)
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_user is not null then array[p_user]
    when p_group is null then '{}'::uuid[]
    else array(
      select public.studyos_uuid(m.user_id)
      from public.studyos_group_members m
      where m.group_id = p_group and m.user_id is distinct from p_owner::text
      order by m.joined_at, m.user_id
      limit 50
    )
  end
$$;

-- ─── Ricerca ────────────────────────────────────────────────────────────────

-- Una persona per email esatta (senza maiuscole) o @nome esatto. Mai sé stessi, mai l'email nel
-- risultato. Inesistente e non trovabile danno la stessa risposta: nessuna riga.
create or replace function public.find_person(p_query text)
returns table (person_id uuid, display_name text, handle text)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_query text := lower(btrim(coalesce(p_query, '')));
  v_id uuid;
begin
  perform public.studyos_person_lookup_guard();
  if char_length(v_query) > 320 then
    return;
  end if;
  if v_query ~ '^@?[a-z0-9_.]{3,24}$' then
    select p.user_id into v_id from public.studyos_profiles p where p.handle = ltrim(v_query, '@');
  elsif v_query ~ '^[^@[:space:]]+@[^@[:space:]]+$' then
    select u.id into v_id from auth.users u
    where lower(u.email) = v_query and u.deleted_at is null
    limit 1;
  else
    return;
  end if;
  if v_id is null or v_id = auth.uid() or not public.studyos_person_discoverable(v_id) then
    return;
  end if;
  return query
    select v_id, coalesce(p.display_name, ''), p.handle
    from (select 1) as one
    left join public.studyos_profiles p on p.user_id = v_id;
end;
$$;

-- @nome libero (o già mio). Conta nei limiti delle ricerche: senza, servirebbe a sondare i nomi.
create or replace function public.is_handle_available(p_handle text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_handle text := ltrim(lower(btrim(coalesce(p_handle, ''))), '@');
begin
  perform public.studyos_person_lookup_guard();
  if v_handle !~ '^[a-z0-9_.]{3,24}$' then
    return false;
  end if;
  return not exists (
    select 1 from public.studyos_profiles p
    where p.handle = v_handle and p.user_id <> auth.uid()
  );
end;
$$;

-- ─── Inviti di gruppo all'account ───────────────────────────────────────────
-- Policy e funzioni identiche a groups.sql (rieseguire l'uno o l'altro dà lo stesso risultato).

-- Inviti: il destinatario (per account, mai per email) legge i propri; i membri vedono gli inviti
-- del gruppo; chi invita vede quelli che ha mandato.
drop policy if exists studyos_group_invites_select on public.studyos_group_invites;
create policy studyos_group_invites_select on public.studyos_group_invites for select to authenticated
  using (
    recipient_user_id = auth.uid()::text
    or public.studyos_is_group_member(group_id)
    or from_user_id = auth.uid()::text
  );
-- Inserimento diretto (proprietario o amministratore) solo per gli inviti con codice, senza
-- destinatario. L'invito a una persona passa da invite_person_to_group (people.sql), che controlla
-- che sia trovabile e non già nel gruppo.
drop policy if exists studyos_group_invites_insert on public.studyos_group_invites;
create policy studyos_group_invites_insert on public.studyos_group_invites for insert to authenticated
  with check (
    public.studyos_group_role(group_id) in ('owner', 'admin')
    and from_user_id = auth.uid()::text
    and status = 'pending'
    and recipient_email is null
    and recipient_user_id is null
  );

-- Accetta un invito nominale: solo l'account destinatario (recipient_user_id). Con la conferma email
-- spenta l'indirizzo non prova chi lo usa e non conta più. Prima si chiude l'invito, poi entra il
-- membro: il trigger delle notifiche (people.sql) trova così chi aveva invitato.
create or replace function public.accept_group_invite(p_invite_id text, p_display_name text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite public.studyos_group_invites%rowtype;
  v_email text := lower(auth.jwt() ->> 'email');
  v_name text := public.studyos_member_name(p_display_name, lower(auth.jwt() ->> 'email'));
begin
  if auth.uid() is null then
    raise exception 'Accesso richiesto';
  end if;
  select * into v_invite from public.studyos_group_invites where id = p_invite_id for update;
  if not found then
    raise exception 'Invito non trovato';
  end if;
  -- is distinct from: un invito senza destinatario (null) non si accetta mai da qui.
  if v_invite.recipient_user_id is distinct from auth.uid()::text then
    raise exception 'Invito destinato a un altro account';
  end if;
  if v_invite.status <> 'pending' then
    raise exception 'Invito già gestito';
  end if;
  update public.studyos_group_invites
    set status = 'accepted', updated_at = now()
    where id = p_invite_id;
  insert into public.studyos_group_members (group_id, user_id, email, display_name, role)
  values (v_invite.group_id, auth.uid()::text, v_email, v_name, 'member')
  on conflict (group_id, user_id) do nothing;
  insert into public.studyos_group_activity (id, group_id, actor_display_name, text)
  values ('activity-' || p_invite_id, v_invite.group_id, v_name, 'è entrato nel gruppo')
  on conflict (id) do nothing;
end;
$$;

-- Rifiuta un invito nominale: solo l'account destinatario, come accept_group_invite.
create or replace function public.decline_group_invite(p_invite_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite public.studyos_group_invites%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Accesso richiesto';
  end if;
  select * into v_invite from public.studyos_group_invites where id = p_invite_id for update;
  if not found then
    raise exception 'Invito non trovato';
  end if;
  if v_invite.recipient_user_id is distinct from auth.uid()::text then
    raise exception 'Invito destinato a un altro account';
  end if;
  if v_invite.status <> 'pending' then
    raise exception 'Invito già gestito';
  end if;
  update public.studyos_group_invites
    set status = 'declined', updated_at = now()
    where id = p_invite_id;
end;
$$;

-- Invita una persona trovata con find_person: proprietario o amministratore, persona trovabile, non
-- già nel gruppo, un solo invito in attesa. Codice = codice del gruppo, come gli inviti del client.
create or replace function public.invite_person_to_group(
  p_group_id text,
  p_person_id uuid,
  p_display_name text default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group public.studyos_groups%rowtype;
  v_from text;
  v_id text := 'groupInvite_' || replace(gen_random_uuid()::text, '-', '');
begin
  if auth.uid() is null then
    raise exception 'Accesso richiesto';
  end if;
  if coalesce(public.studyos_group_role(p_group_id), '') not in ('owner', 'admin') then
    raise exception 'Solo proprietario e amministratori possono invitare';
  end if;
  select * into v_group from public.studyos_groups where id = p_group_id;
  if p_person_id is null or not public.studyos_person_discoverable(p_person_id) then
    raise exception 'Nessuna persona trovata';
  end if;
  if exists (
    select 1 from public.studyos_group_members m
    where m.group_id = p_group_id and m.user_id = p_person_id::text
  ) then
    raise exception 'È già nel gruppo';
  end if;
  if exists (
    select 1 from public.studyos_group_invites i
    where i.group_id = p_group_id and i.recipient_user_id = p_person_id::text and i.status = 'pending'
  ) then
    raise exception 'Ha già un invito';
  end if;
  select left(coalesce(nullif(btrim(p_display_name), ''), nullif(btrim(m.display_name), ''), 'Studente'), 80)
  into v_from
  from public.studyos_group_members m
  where m.group_id = p_group_id and m.user_id = auth.uid()::text;
  begin
    insert into public.studyos_group_invites
      (id, group_id, group_name, group_description, from_user_id, from_display_name,
       recipient_email, recipient_user_id, code, status)
    values (
      v_id, p_group_id, v_group.name, nullif(v_group.description, ''), auth.uid()::text, v_from,
      null, p_person_id::text, upper(v_group.invite_code), 'pending'
    );
  exception when unique_violation then
    raise exception 'Ha già un invito';
  end;
  return v_id;
end;
$$;

-- ─── Inviti di condivisione all'account ─────────────────────────────────────
-- Policy e funzioni identiche a sharing.sql.

drop policy if exists studyos_share_invites_select on public.studyos_share_invites;
create policy studyos_share_invites_select on public.studyos_share_invites
for select to authenticated
using (
  owner_id = (select auth.uid())
  or (status = 'pending' and recipient_user_id = (select auth.uid()))
);

grant select (recipient_user_id) on table public.studyos_share_invites to authenticated;

-- Invito via link (token). Gli inviti per email non si creano più: con la conferma email spenta un
-- indirizzo non prova chi lo usa. Per un account c'è invite_person_to_share (people.sql).
-- p_recipient_email resta nella firma per i client vecchi: se non è vuoto la richiesta è rifiutata.
create or replace function public.create_share_invite(
  p_owner_name text,
  p_offers jsonb,
  p_requests jsonb default '[]'::jsonb,
  p_recipient_email text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Accesso richiesto';
  end if;
  if nullif(btrim(coalesce(p_recipient_email, '')), '') is not null then
    raise exception 'Gli inviti per email non ci sono più: cerca la persona';
  end if;
  perform public.studyos_validate_share_items(p_offers, true);
  perform public.studyos_validate_share_items(coalesce(p_requests, '[]'::jsonb), false);
  if (
    select count(*) from public.studyos_share_invites
    where owner_id = auth.uid() and status = 'pending' and expires_at > now()
  ) >= 50 then
    raise exception 'Troppi inviti in attesa: annullane qualcuno';
  end if;
  insert into public.studyos_share_invites (owner_id, owner_name, offers, requests, token_hash)
  values (
    auth.uid(),
    public.studyos_share_name(p_owner_name),
    p_offers,
    coalesce(p_requests, '[]'::jsonb),
    sha256(convert_to(v_token, 'UTF8'))
  )
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'token', v_token);
end;
$$;

-- Anteprima di un invito via link. Un vecchio invito per sola email che la migrazione non ha legato
-- a un account risulta scaduto; for_other_account vale per gli inviti legati a un altro account.
create or replace function public.preview_share_invite(p_token text)
returns table (
  invite_id uuid,
  owner_name text,
  offers jsonb,
  requests jsonb,
  expires_at timestamptz,
  status text,
  for_other_account boolean,
  is_own boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    i.id,
    i.owner_name,
    i.offers,
    i.requests,
    i.expires_at,
    case
      when i.status = 'pending'
        and (i.expires_at <= now() or (i.recipient_user_id is null and i.recipient_email is not null))
        then 'expired'
      else i.status
    end,
    i.recipient_user_id is not null and i.recipient_user_id is distinct from auth.uid(),
    i.owner_id = auth.uid()
  from public.studyos_share_invites i
  where auth.uid() is not null
    and p_token ~ '^[0-9a-f]{64}$'
    and i.token_hash = sha256(convert_to(p_token, 'UTF8'))
$$;

-- Verifica l'invito per chi lo apre. Invito all'account (recipient_user_id): vale solo per quell'account
-- e il token da solo non basta. Vecchio invito per sola email non legato a un account: non si accetta
-- più. Invito via link: serve il token.
create or replace function public.studyos_claim_share_invite(p_invite_id uuid, p_token text)
returns public.studyos_share_invites
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite public.studyos_share_invites%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Accesso richiesto';
  end if;
  select * into v_invite from public.studyos_share_invites where id = p_invite_id for update;
  if not found then
    raise exception 'Invito non trovato';
  end if;
  if v_invite.owner_id = auth.uid() then
    raise exception 'È un tuo invito: mandalo a un''altra persona';
  end if;
  if v_invite.status <> 'pending' then
    raise exception 'Invito già usato';
  end if;
  if v_invite.expires_at <= now() then
    raise exception 'Invito scaduto: chiedine uno nuovo';
  end if;
  if v_invite.recipient_user_id is not null then
    if v_invite.recipient_user_id is distinct from auth.uid() then
      raise exception 'Invito destinato a un altro account';
    end if;
  elsif v_invite.recipient_email is not null then
    raise exception 'Invito scaduto: chiedine uno nuovo';
  elsif p_token is null or v_invite.token_hash <> sha256(convert_to(p_token, 'UTF8')) then
    raise exception 'Link di invito non valido';
  end if;
  return v_invite;
end;
$$;

-- Invita una persona trovata con find_person a vedere o modificare i propri dati. Nessun token nella
-- risposta: accetta solo l'account destinatario. Un nuovo invito alla stessa persona, mentre il
-- precedente è ancora in attesa, ne aggiorna il contenuto (niente doppioni né notifiche ripetute).
create or replace function public.invite_person_to_share(
  p_person_id uuid,
  p_owner_name text,
  p_offers jsonb,
  p_requests jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Accesso richiesto';
  end if;
  if p_person_id = auth.uid() then
    raise exception 'Non puoi invitare te stesso';
  end if;
  if p_person_id is null or not public.studyos_person_discoverable(p_person_id) then
    raise exception 'Nessuna persona trovata';
  end if;
  perform public.studyos_validate_share_items(p_offers, true);
  perform public.studyos_validate_share_items(coalesce(p_requests, '[]'::jsonb), false);
  select i.id into v_id
  from public.studyos_share_invites i
  where i.owner_id = auth.uid() and i.recipient_user_id = p_person_id
    and i.status = 'pending' and i.expires_at > now()
  order by i.created_at desc
  limit 1
  for update;
  if found then
    update public.studyos_share_invites
    set owner_name = public.studyos_share_name(p_owner_name),
        offers = p_offers,
        requests = coalesce(p_requests, '[]'::jsonb),
        expires_at = now() + interval '14 days'
    where id = v_id;
    return jsonb_build_object('id', v_id);
  end if;
  if (
    select count(*) from public.studyos_share_invites
    where owner_id = auth.uid() and status = 'pending' and expires_at > now()
  ) >= 50 then
    raise exception 'Troppi inviti in attesa: annullane qualcuno';
  end if;
  -- token_hash è obbligatorio e unico: un token casuale che nessuno riceve.
  insert into public.studyos_share_invites (owner_id, owner_name, offers, requests, recipient_user_id, token_hash)
  values (
    auth.uid(),
    public.studyos_share_name(p_owner_name),
    p_offers,
    coalesce(p_requests, '[]'::jsonb),
    p_person_id,
    sha256(convert_to(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 'UTF8'))
  )
  returning id into v_id;
  return jsonb_build_object('id', v_id);
end;
$$;

-- ─── Migrazione una tantum: inviti pendenti per sola email → account ────────
-- Gira una volta sola (segno in studyos_migrations): un account registrato dopo con quell'indirizzo
-- non riceve inviti vecchi. Gli inviti legati qui restano da accettare; gli altri non sono più
-- accettabili. Nessuna notifica push: si aggiornano righe esistenti, i trigger guardano gli insert.
do $$
begin
  if exists (select 1 from public.studyos_migrations where name = 'people_email_invites') then
    return;
  end if;

  update public.studyos_group_invites i
  set recipient_user_id = pick.user_id, updated_at = now()
  from (
    select distinct on (gi.group_id, u.id) gi.id, u.id::text as user_id
    from public.studyos_group_invites gi
    join auth.users u on lower(u.email) = lower(gi.recipient_email) and u.deleted_at is null
    where gi.status = 'pending' and gi.recipient_user_id is null and gi.recipient_email is not null
      and not exists (
        select 1 from public.studyos_group_invites other
        where other.group_id = gi.group_id and other.recipient_user_id = u.id::text and other.status = 'pending'
      )
      and not exists (
        select 1 from public.studyos_group_members m
        where m.group_id = gi.group_id and m.user_id = u.id::text
      )
    order by gi.group_id, u.id, gi.created_at desc
  ) as pick
  where i.id = pick.id;

  update public.studyos_share_invites i
  set recipient_user_id = u.id
  from auth.users u
  where i.status = 'pending' and i.recipient_user_id is null and i.recipient_email is not null
    and lower(u.email) = lower(i.recipient_email) and u.deleted_at is null and u.id <> i.owner_id;

  insert into public.studyos_migrations (name) values ('people_email_invites');
end $$;

-- ─── Notifiche push ─────────────────────────────────────────────────────────

-- Manda una notifica agli account indicati, tranne chi compie l'azione (auth.uid()) e senza
-- doppioni: raccoglie le loro iscrizioni e chiama il Worker (POST studyos_push_url, intestazione
-- x-studyos-push-secret) con pg_net, al massimo 40 iscrizioni per richiesta: il Worker sul piano
-- Free ha 50 sottorichieste, una serve a push_gone. Testi tagliati ai limiti del Worker (titolo 120,
-- corpo 240, tag 200 caratteri; url solo tra i tre ammessi), altrimenti risponderebbe 400. pg_net
-- spedisce solo dopo il commit. Senza pg_net, senza segreti o con qualsiasi errore non fa nulla: mai
-- un errore che blocca la scrittura che l'ha chiamata. Non eseguibile dai client.
create or replace function public.studyos_push_notify(
  p_user_ids uuid[],
  p_kind text,
  p_title text,
  p_body text,
  p_url text,
  p_tag text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_users uuid[];
  v_secret text;
  v_url text;
  v_notification jsonb;
  v_batch jsonb;
begin
  begin
    v_users := array(
      select distinct t.u from unnest(coalesce(p_user_ids, '{}'::uuid[])) as t (u)
      where t.u is not null and t.u is distinct from auth.uid()
    );
    if cardinality(v_users) = 0 or coalesce(p_kind, '') not in ('invite', 'accepted', 'permission') then
      return;
    end if;
    if not exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'net' and p.proname = 'http_post'
    ) or to_regclass('vault.decrypted_secrets') is null then
      return;
    end if;
    select s.decrypted_secret into v_secret from vault.decrypted_secrets s
    where s.name = 'studyos_push_secret' order by s.created_at desc limit 1;
    select s.decrypted_secret into v_url from vault.decrypted_secrets s
    where s.name = 'studyos_push_url' order by s.created_at desc limit 1;
    if coalesce(v_secret, '') = '' or coalesce(v_url, '') !~ '^https?://' then
      return;
    end if;
    v_notification := jsonb_build_object(
      'kind', p_kind,
      'title', left(coalesce(p_title, ''), 120),
      'body', left(coalesce(p_body, ''), 240),
      'url', case when p_url in ('?apri=notifiche', '?apri=condivisione', '?apri=gruppi') then p_url else '?apri=notifiche' end,
      'tag', left(coalesce(nullif(p_tag, ''), p_kind), 200)
    );
    for v_batch in
      select jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth) order by s.rn)
      from (
        select sub.endpoint, sub.p256dh, sub.auth,
          row_number() over (order by sub.user_id, sub.created_at, sub.id) as rn
        from public.studyos_push_subscriptions sub
        where sub.user_id = any (v_users)
      ) as s
      group by (s.rn - 1) / 40
      order by (s.rn - 1) / 40
    loop
      perform net.http_post(
        url := v_url,
        body := jsonb_build_object('notification', v_notification, 'subscriptions', v_batch),
        params := '{}'::jsonb,
        headers := jsonb_build_object('content-type', 'application/json', 'x-studyos-push-secret', v_secret),
        timeout_milliseconds := 15000
      );
    end loop;
  exception when others then
    raise warning 'studyos_push_notify: %', sqlerrm;
  end;
end;
$$;

-- Il Worker comunica gli endpoint che rispondono 404/410: se il segreto coincide con Vault, quelle
-- iscrizioni si cancellano. Chiamabile con la chiave publishable (anon): il segreto è la protezione.
create or replace function public.push_gone(p_secret text, p_endpoints text[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_secret text;
  v_count integer;
begin
  if to_regclass('vault.decrypted_secrets') is not null then
    select s.decrypted_secret into v_secret from vault.decrypted_secrets s
    where s.name = 'studyos_push_secret' order by s.created_at desc limit 1;
  end if;
  -- Confronto tra hash: il tempo non dipende da quanti caratteri iniziali coincidono.
  if coalesce(v_secret, '') = '' or p_secret is null
     or sha256(convert_to(p_secret, 'UTF8')) <> sha256(convert_to(v_secret, 'UTF8')) then
    raise exception 'Non autorizzato';
  end if;
  if p_endpoints is null or cardinality(p_endpoints) = 0 then
    return 0;
  end if;
  if cardinality(p_endpoints) > 500 then
    raise exception 'Troppi indirizzi';
  end if;
  delete from public.studyos_push_subscriptions where endpoint = any (p_endpoints);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Invito di gruppo a una persona → il destinatario.
create or replace function public.studyos_push_group_invite()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    perform public.studyos_push_notify(
      array[public.studyos_uuid(new.recipient_user_id)],
      'invite',
      'Invito a un gruppo',
      left(coalesce(nullif(btrim(new.from_display_name), ''), 'Qualcuno'), 60)
        || ' ti invita nel gruppo ' || left(coalesce(nullif(btrim(new.group_name), ''), 'senza nome'), 80),
      '?apri=notifiche',
      'group-invite:' || new.id
    );
  exception when others then
    raise warning 'studyos_push_group_invite: %', sqlerrm;
  end;
  return null;
end;
$$;

drop trigger if exists studyos_group_invites_push on public.studyos_group_invites;
create trigger studyos_group_invites_push
after insert on public.studyos_group_invites
for each row when (new.recipient_user_id is not null)
execute function public.studyos_push_group_invite();

-- Invito di condivisione a una persona → il destinatario, con le sezioni offerte.
create or replace function public.studyos_push_share_invite()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    perform public.studyos_push_notify(
      array[new.recipient_user_id],
      'invite',
      'Invito a condividere',
      left(coalesce(nullif(btrim(new.owner_name), ''), 'Qualcuno'), 60) || ' vuole condividere con te: '
        || coalesce((
          select string_agg(public.studyos_scope_label(o.value ->> 'scope'), ', ' order by o.ordinality)
          from jsonb_array_elements(new.offers) with ordinality as o (value, ordinality)
        ), 'i suoi dati'),
      '?apri=notifiche',
      'share-invite:' || new.id
    );
  exception when others then
    raise warning 'studyos_push_share_invite: %', sqlerrm;
  end;
  return null;
end;
$$;

drop trigger if exists studyos_share_invites_push on public.studyos_share_invites;
create trigger studyos_share_invites_push
after insert on public.studyos_share_invites
for each row when (new.recipient_user_id is not null)
execute function public.studyos_push_share_invite();

-- Invito di condivisione accettato (con link, QR o all'account) → chi ha invitato.
create or replace function public.studyos_push_share_accepted()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
begin
  begin
    select s.grantee_name into v_name
    from public.studyos_shares s
    where s.owner_id = new.owner_id and s.grantee_user_id = new.accepted_by
    order by s.updated_at desc
    limit 1;
    v_name := coalesce(
      nullif(btrim(v_name), ''),
      (select nullif(btrim(p.display_name), '') from public.studyos_profiles p where p.user_id = new.accepted_by),
      'Una persona'
    );
    perform public.studyos_push_notify(
      array[new.owner_id],
      'accepted',
      'Invito accettato',
      left(v_name, 60) || ' ha accettato il tuo invito',
      '?apri=condivisione',
      'share-accepted:' || new.id
    );
  exception when others then
    raise warning 'studyos_push_share_accepted: %', sqlerrm;
  end;
  return null;
end;
$$;

drop trigger if exists studyos_share_invites_accepted_push on public.studyos_share_invites;
create trigger studyos_share_invites_accepted_push
after update of status on public.studyos_share_invites
for each row when (old.status is distinct from new.status and new.status = 'accepted')
execute function public.studyos_push_share_accepted();

-- Qualcuno entra in un gruppo (invito accettato, codice o QR) → proprietario, amministratori e chi
-- aveva mandato l'invito accettato in questa stessa transazione (updated_at = now()), una volta a
-- testa. Il membro che entra non riceve nulla.
create or replace function public.studyos_push_group_join()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group_name text;
  v_users uuid[];
begin
  begin
    select g.name into v_group_name from public.studyos_groups g where g.id = new.group_id;
    v_users := array(
      select public.studyos_uuid(g.owner_id) from public.studyos_groups g where g.id = new.group_id
      union
      select public.studyos_uuid(m.user_id) from public.studyos_group_members m
      where m.group_id = new.group_id and m.role = 'admin'
      union
      select public.studyos_uuid(i.from_user_id) from public.studyos_group_invites i
      where i.group_id = new.group_id and i.recipient_user_id = new.user_id
        and i.status = 'accepted' and i.updated_at = now()
    );
    v_users := array_remove(v_users, public.studyos_uuid(new.user_id));
    perform public.studyos_push_notify(
      v_users,
      'accepted',
      'Nuovo membro',
      left(coalesce(nullif(btrim(new.display_name), ''), 'Una persona'), 60)
        || ' ora fa parte del gruppo ' || left(coalesce(nullif(btrim(v_group_name), ''), 'senza nome'), 80),
      '?apri=gruppi',
      'group-join:' || new.group_id || ':' || new.user_id
    );
  exception when others then
    raise warning 'studyos_push_group_join: %', sqlerrm;
  end;
  return null;
end;
$$;

drop trigger if exists studyos_group_members_push on public.studyos_group_members;
create trigger studyos_group_members_push
after insert on public.studyos_group_members
for each row when (new.role <> 'owner')
execute function public.studyos_push_group_join();

-- Permesso cambiato ("Può vedere" ↔ "Può modificare") → chi riceve. Trigger per istruzione: un
-- aggiornamento di più sezioni verso la stessa persona o lo stesso gruppo dà una sola notifica.
create or replace function public.studyos_push_share_permission()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  begin
    for r in
      select n.owner_id, n.grantee_user_id, n.grantee_group_id, n.permission,
        left(coalesce(nullif(btrim(max(n.owner_name)), ''), 'Qualcuno'), 60) as owner_name,
        left(coalesce(nullif(btrim(max(n.grantee_name)), ''), 'senza nome'), 80) as grantee_name,
        string_agg(public.studyos_scope_label(n.scope), ', ' order by n.scope) as scopes,
        (array_agg(n.id order by n.scope))[1] as share_id
      from new_rows n
      join old_rows o on o.id = n.id
      where o.permission is distinct from n.permission
      group by n.owner_id, n.grantee_user_id, n.grantee_group_id, n.permission
    loop
      perform public.studyos_push_notify(
        public.studyos_share_audience(r.owner_id, r.grantee_user_id, r.grantee_group_id),
        'permission',
        'Permessi cambiati',
        r.owner_name
          || case when r.grantee_group_id is null then ' ora ti permette '
             else ' ora permette al gruppo ' || r.grantee_name || ' ' end
          || case when r.permission = 'edit' then 'di modificare: ' else 'solo di vedere: ' end
          || r.scopes,
        '?apri=condivisione',
        'share-permission:' || r.share_id
      );
    end loop;
  exception when others then
    raise warning 'studyos_push_share_permission: %', sqlerrm;
  end;
  return null;
end;
$$;

drop trigger if exists studyos_shares_permission_push on public.studyos_shares;
create trigger studyos_shares_permission_push
after update on public.studyos_shares
referencing old table as old_rows new table as new_rows
for each statement execute function public.studyos_push_share_permission();

-- Accesso tolto (revoca del proprietario, uscita da un gruppo, account eliminato) → chi riceveva.
-- Chi esce da sé è chi agisce e non riceve nulla.
create or replace function public.studyos_push_share_removed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  begin
    for r in
      select o.owner_id, o.grantee_user_id, o.grantee_group_id,
        left(coalesce(nullif(btrim(max(o.owner_name)), ''), 'Qualcuno'), 60) as owner_name,
        left(coalesce(nullif(btrim(max(o.grantee_name)), ''), 'senza nome'), 80) as grantee_name,
        string_agg(public.studyos_scope_label(o.scope), ', ' order by o.scope) as scopes,
        (array_agg(o.id order by o.scope))[1] as share_id
      from old_rows o
      group by o.owner_id, o.grantee_user_id, o.grantee_group_id
    loop
      perform public.studyos_push_notify(
        public.studyos_share_audience(r.owner_id, r.grantee_user_id, r.grantee_group_id),
        'permission',
        'Accesso tolto',
        r.owner_name
          || case when r.grantee_group_id is null then ' ha smesso di condividere con te: '
             else ' ha smesso di condividere con il gruppo ' || r.grantee_name || ': ' end
          || r.scopes,
        '?apri=condivisione',
        'share-permission:' || r.share_id
      );
    end loop;
  exception when others then
    raise warning 'studyos_push_share_removed: %', sqlerrm;
  end;
  return null;
end;
$$;

drop trigger if exists studyos_shares_removed_push on public.studyos_shares;
create trigger studyos_shares_removed_push
after delete on public.studyos_shares
referencing old table as old_rows
for each statement execute function public.studyos_push_share_removed();

-- ─── Privilegi delle funzioni ───────────────────────────────────────────────
-- "revoke ... from public" non toglie i privilegi predefiniti dati ad anon e authenticated: si
-- tolgono in modo esplicito. Le funzioni interne le chiamano solo funzioni e trigger DEFINER.

revoke all on function public.find_person(text) from public, anon;
revoke all on function public.is_handle_available(text) from public, anon;
revoke all on function public.invite_person_to_group(text, uuid, text) from public, anon;
revoke all on function public.invite_person_to_share(uuid, text, jsonb, jsonb) from public, anon;
revoke all on function public.push_gone(text, text[]) from public;
grant execute on function public.find_person(text) to authenticated;
grant execute on function public.is_handle_available(text) to authenticated;
grant execute on function public.invite_person_to_group(text, uuid, text) to authenticated;
grant execute on function public.invite_person_to_share(uuid, text, jsonb, jsonb) to authenticated;
grant execute on function public.push_gone(text, text[]) to anon, authenticated;

revoke all on function public.studyos_push_notify(uuid[], text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.studyos_person_lookup_guard() from public, anon, authenticated;
revoke all on function public.studyos_person_discoverable(uuid) from public, anon, authenticated;
revoke all on function public.studyos_request_ip() from public, anon, authenticated;
revoke all on function public.studyos_uuid(text) from public, anon, authenticated;
revoke all on function public.studyos_scope_label(text) from public, anon, authenticated;
revoke all on function public.studyos_share_audience(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.studyos_profiles_touch() from public, anon, authenticated;
revoke all on function public.studyos_push_subscriptions_claim() from public, anon, authenticated;
revoke all on function public.studyos_push_subscriptions_cap() from public, anon, authenticated;
revoke all on function public.studyos_push_group_invite() from public, anon, authenticated;
revoke all on function public.studyos_push_share_invite() from public, anon, authenticated;
revoke all on function public.studyos_push_share_accepted() from public, anon, authenticated;
revoke all on function public.studyos_push_group_join() from public, anon, authenticated;
revoke all on function public.studyos_push_share_permission() from public, anon, authenticated;
revoke all on function public.studyos_push_share_removed() from public, anon, authenticated;
```

- [ ] **Passo 5: crea `supabase/people-verify.sql`**

In sola lettura: va bene anche nel SQL Editor del progetto reale (Task 11).

```sql
-- Controllo in sola lettura dopo aver eseguito people.sql nel SQL Editor.
-- Atteso: ogni colonna *_ready è true. pg_net_ready e vault_ready diventano true solo con pg_net
-- attivo e i due segreti in Vault (studyos_push_secret, studyos_push_url): senza, le notifiche
-- push restano spente e il resto funziona. I privilegi si controllano perché i valori predefiniti
-- del progetto possono riaprirli; i valori mancanti (funzione o tabella assente) contano come
-- "non pronto".
select
  to_regclass('public.studyos_profiles') is not null
    and to_regclass('public.studyos_person_lookups') is not null
    and to_regclass('public.studyos_push_subscriptions') is not null
    and to_regclass('public.studyos_migrations') is not null
    and exists (select 1 from information_schema.columns where table_schema = 'public'
      and table_name = 'studyos_group_invites' and column_name = 'recipient_user_id' and data_type = 'text')
    and exists (select 1 from information_schema.columns where table_schema = 'public'
      and table_name = 'studyos_share_invites' and column_name = 'recipient_user_id' and data_type = 'uuid')
    as tables_ready,
  (select count(*) from pg_class where relrowsecurity and oid in (
    to_regclass('public.studyos_profiles'), to_regclass('public.studyos_person_lookups'),
    to_regclass('public.studyos_push_subscriptions'), to_regclass('public.studyos_migrations'))) = 4 as rls_ready,
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'studyos_profiles') = 3
    and (select count(*) from pg_policies where schemaname = 'public' and tablename = 'studyos_push_subscriptions') = 4
    and not exists (select 1 from pg_policies where schemaname = 'public'
      and tablename in ('studyos_person_lookups', 'studyos_migrations')) as policies_ready,
  to_regprocedure('public.find_person(text)') is not null
    and to_regprocedure('public.is_handle_available(text)') is not null
    and to_regprocedure('public.invite_person_to_group(text,uuid,text)') is not null
    and to_regprocedure('public.invite_person_to_share(uuid,text,jsonb,jsonb)') is not null
    and to_regprocedure('public.push_gone(text,text[])') is not null
    and to_regprocedure('public.studyos_push_notify(uuid[],text,text,text,text,text)') is not null as rpc_ready,
  coalesce(has_function_privilege('authenticated', to_regprocedure('public.find_person(text)'), 'EXECUTE')
    and has_function_privilege('authenticated', to_regprocedure('public.is_handle_available(text)'), 'EXECUTE')
    and has_function_privilege('authenticated', to_regprocedure('public.invite_person_to_group(text,uuid,text)'), 'EXECUTE')
    and has_function_privilege('authenticated', to_regprocedure('public.invite_person_to_share(uuid,text,jsonb,jsonb)'), 'EXECUTE'),
    false) as authenticated_rpc_ready,
  -- Chiuse ad anon tutte le RPC nuove tranne push_gone (la chiama il Worker con la chiave publishable).
  not coalesce(
    has_function_privilege('anon', to_regprocedure('public.find_person(text)'), 'EXECUTE')
    or has_function_privilege('anon', to_regprocedure('public.is_handle_available(text)'), 'EXECUTE')
    or has_function_privilege('anon', to_regprocedure('public.invite_person_to_group(text,uuid,text)'), 'EXECUTE')
    or has_function_privilege('anon', to_regprocedure('public.invite_person_to_share(uuid,text,jsonb,jsonb)'), 'EXECUTE')
    or has_function_privilege('anon', to_regprocedure('public.studyos_push_notify(uuid[],text,text,text,text,text)'), 'EXECUTE')
    or has_function_privilege('anon', to_regprocedure('public.studyos_person_lookup_guard()'), 'EXECUTE'),
    true) as anon_rpc_closed_ready,
  coalesce(has_function_privilege('anon', to_regprocedure('public.push_gone(text,text[])'), 'EXECUTE')
    and has_function_privilege('authenticated', to_regprocedure('public.push_gone(text,text[])'), 'EXECUTE'), false)
    as push_gone_ready,
  not coalesce(
    has_function_privilege('authenticated', to_regprocedure('public.studyos_push_notify(uuid[],text,text,text,text,text)'), 'EXECUTE')
    or has_function_privilege('authenticated', to_regprocedure('public.studyos_person_lookup_guard()'), 'EXECUTE')
    or has_function_privilege('authenticated', to_regprocedure('public.studyos_person_discoverable(uuid)'), 'EXECUTE'),
    true) as internal_rpc_private_ready,
  not coalesce(
    has_any_column_privilege('anon', to_regclass('public.studyos_profiles'), 'SELECT')
    or has_any_column_privilege('anon', to_regclass('public.studyos_push_subscriptions'), 'SELECT')
    or has_any_column_privilege('anon', to_regclass('public.studyos_person_lookups'), 'SELECT')
    or has_any_column_privilege('authenticated', to_regclass('public.studyos_person_lookups'), 'SELECT')
    or has_any_column_privilege('authenticated', to_regclass('public.studyos_migrations'), 'SELECT'),
    true) as tables_closed_ready,
  coalesce(has_column_privilege('authenticated', to_regclass('public.studyos_share_invites'), 'recipient_user_id', 'SELECT'), false)
    and not coalesce(has_column_privilege('authenticated', to_regclass('public.studyos_share_invites'), 'token_hash', 'SELECT'), true)
    as share_columns_ready,
  -- Inserimento diretto degli inviti di gruppo: solo senza destinatario (inviti con codice).
  coalesce((select with_check like '%(recipient_email IS NULL)%' and with_check like '%(recipient_user_id IS NULL)%'
    from pg_policies where schemaname = 'public' and tablename = 'studyos_group_invites'
      and policyname = 'studyos_group_invites_insert'), false) as group_invite_insert_ready,
  -- Accettazione solo per account: policy di lettura e funzioni non guardano più l'email.
  coalesce((select qual like '%recipient_user_id%' and qual not like '%recipient_email%' from pg_policies
      where schemaname = 'public' and tablename = 'studyos_group_invites' and policyname = 'studyos_group_invites_select'), false)
    and coalesce((select qual like '%recipient_user_id%' and qual not like '%recipient_email%' from pg_policies
      where schemaname = 'public' and tablename = 'studyos_share_invites' and policyname = 'studyos_share_invites_select'), false)
    and coalesce(pg_get_functiondef(to_regprocedure('public.accept_group_invite(text,text)'))
      like '%v_invite.recipient_user_id is distinct from auth.uid()::text%', false)
    and coalesce(pg_get_functiondef(to_regprocedure('public.accept_group_invite(text,text)')) not like '%recipient_email%', false)
    and coalesce(pg_get_functiondef(to_regprocedure('public.decline_group_invite(text)'))
      like '%v_invite.recipient_user_id is distinct from auth.uid()::text%', false)
    and coalesce(pg_get_functiondef(to_regprocedure('public.decline_group_invite(text)')) not like '%recipient_email%', false)
    and coalesce(pg_get_functiondef(to_regprocedure('public.studyos_claim_share_invite(uuid,text)'))
      like '%v_invite.recipient_user_id is distinct from auth.uid()%', false)
    and coalesce(pg_get_functiondef(to_regprocedure('public.create_share_invite(text,jsonb,jsonb,text)'))
      like '%Gli inviti per email non ci sono più%', false) as email_acceptance_closed_ready,
  coalesce((select count(distinct t.tgname) = 9 from pg_trigger t where not t.tgisinternal and (
    (t.tgrelid = to_regclass('public.studyos_profiles') and t.tgname = 'studyos_profiles_touch')
    or (t.tgrelid = to_regclass('public.studyos_push_subscriptions')
      and t.tgname in ('studyos_push_subscriptions_claim', 'studyos_push_subscriptions_cap'))
    or (t.tgrelid = to_regclass('public.studyos_group_invites') and t.tgname = 'studyos_group_invites_push')
    or (t.tgrelid = to_regclass('public.studyos_share_invites')
      and t.tgname in ('studyos_share_invites_push', 'studyos_share_invites_accepted_push'))
    or (t.tgrelid = to_regclass('public.studyos_group_members') and t.tgname = 'studyos_group_members_push')
    or (t.tgrelid = to_regclass('public.studyos_shares')
      and t.tgname in ('studyos_shares_permission_push', 'studyos_shares_removed_push')))), false) as triggers_ready,
  -- Le notifiche non bloccano mai la scrittura che le chiama.
  coalesce(pg_get_functiondef(to_regprocedure('public.studyos_push_notify(uuid[],text,text,text,text,text)'))
    like '%exception when others%', false) as push_safe_ready,
  exists (select 1 from public.studyos_migrations where name = 'people_email_invites') as migration_ready,
  exists (select 1 from pg_extension where extname = 'pg_net')
    and exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'net' and p.proname = 'http_post') as pg_net_ready,
  -- Lettura dinamica: senza lo schema vault la query resta valida e risponde false.
  case when to_regclass('vault.decrypted_secrets') is null then false
    else (xpath('/row/n/text()', query_to_xml(
      'select count(distinct name) as n from vault.decrypted_secrets
        where name in (''studyos_push_secret'', ''studyos_push_url'') and coalesce(decrypted_secret, '''') <> ''''',
      false, true, '')))[1]::text = '2'
  end as vault_ready;
```

- [ ] **Passo 6: aggiorna `scripts/supabase/sharing-check.mjs`**

La prova di oggi crea un invito per email e lo fa accettare a Carla senza token. Dopo questo task
il server rifiuta l'invito per email, quindi la prova controlla il rifiuto con il messaggio esatto.
Carla entra poi con un invito via link: prima un tentativo senza token, rifiutato, poi quello con il
token. I controlli restano quattro, prima e dopo: il conteggio totale non cambia.

**Blocco 1 — invito a Carla.** In `scripts/supabase/sharing-check.mjs` cerca:

```js
  // Invito per email: vale solo per l'account indicato, anche senza token.
  const { data: emailInvite, error: emailInviteError } = await alice.client.rpc("create_share_invite", {
    p_owner_name: "Alice", p_offers: [{ scope: "goals", permission: "view" }], p_requests: [], p_recipient_email: carla.email.toUpperCase()
  });
  need("Alice crea un invito per email", !emailInviteError && Boolean(emailInvite?.id), emailInviteError?.message ?? "risposta senza id");
  const { data: carlaInbox } = await carla.client.from("studyos_share_invites").select("id, owner_name, offers").eq("status", "pending");
  check("Carla vede l'invito per email", carlaInbox?.some((item) => item.id === emailInvite.id));
  await rejects("Bob non accetta un invito per Carla", bob.client.rpc("accept_share_invite", {
    p_invite_id: emailInvite.id, p_token: emailInvite.token, p_display_name: "Bob", p_reciprocal: []
  }));
  const { error: carlaAcceptError } = await carla.client.rpc("accept_share_invite", {
    p_invite_id: emailInvite.id, p_token: null, p_display_name: "Carla", p_reciprocal: []
  });
  check("Carla accetta senza token", !carlaAcceptError, carlaAcceptError?.message);
```

Sostituisci con:

```js
  // Gli inviti per email non ci sono più (conferma email spenta): il server li rifiuta. Gli inviti
  // all'account li prova scripts/supabase/people-check.mjs; qui Carla entra con un invito via link.
  const { error: emailInviteError } = await alice.client.rpc("create_share_invite", {
    p_owner_name: "Alice", p_offers: [{ scope: "goals", permission: "view" }], p_requests: [], p_recipient_email: carla.email
  });
  check("Invito per email rifiutato", emailInviteError?.message === "Gli inviti per email non ci sono più: cerca la persona",
    emailInviteError?.message ?? "nessun errore");
  const { data: goalsInvite, error: goalsInviteError } = await alice.client.rpc("create_share_invite", {
    p_owner_name: "Alice", p_offers: [{ scope: "goals", permission: "view" }], p_requests: [], p_recipient_email: null
  });
  need("Alice crea un invito via link per Carla", !goalsInviteError && Boolean(goalsInvite?.id) && /^[0-9a-f]{64}$/.test(goalsInvite?.token ?? ""),
    goalsInviteError?.message ?? "risposta senza id o token");
  await rejects("Carla senza token non accetta un invito via link", carla.client.rpc("accept_share_invite", {
    p_invite_id: goalsInvite.id, p_token: null, p_display_name: "Carla", p_reciprocal: []
  }));
  const { error: carlaAcceptError } = await carla.client.rpc("accept_share_invite", {
    p_invite_id: goalsInvite.id, p_token: goalsInvite.token, p_display_name: "Carla", p_reciprocal: []
  });
  check("Carla accetta con il link", !carlaAcceptError, carlaAcceptError?.message);
```

- [ ] **Passo 7: applica i file sullo stack locale, `people.sql` due volte**

```bash
psql "$PGURL" -X -q -v ON_ERROR_STOP=1 -f supabase/groups.sql
psql "$PGURL" -X -q -v ON_ERROR_STOP=1 -f supabase/sharing.sql
psql "$PGURL" -X -q -v ON_ERROR_STOP=1 -f supabase/people.sql
psql "$PGURL" -X -q -v ON_ERROR_STOP=1 -f supabase/people.sql
psql "$PGURL" -X -A -x -f supabase/people-verify.sql
```

Atteso:

- nessuna riga `ERROR` (le righe `NOTICE` su oggetti già presenti vanno bene);
- la seconda esecuzione di `people.sql` è identica alla prima;
- `people-verify.sql` stampa esattamente:

```text
tables_ready|t
rls_ready|t
policies_ready|t
rpc_ready|t
authenticated_rpc_ready|t
anon_rpc_closed_ready|t
push_gone_ready|t
internal_rpc_private_ready|t
tables_closed_ready|t
share_columns_ready|t
group_invite_insert_ready|t
email_acceptance_closed_ready|t
triggers_ready|t
push_safe_ready|t
migration_ready|t
pg_net_ready|t
vault_ready|f
```

`vault_ready` diventa `t` solo con i due segreti in Vault: il Task 2 li imposta sullo stack locale,
il Task 11 sul progetto reale.

Se `pg_net_ready` è `f`, nello stack manca `pg_net`. Lo script ha stampato
`NOTICE: pg_net non disponibile, notifiche push spente: …`: riporta il messaggio e fermati.

- [ ] **Passo 8: riesegui `groups.sql` e `sharing.sql` dopo `people.sql`**

È il caso da cui il task protegge: chi riesegue un file vecchio non deve riaprire l'accettazione
per email.

```bash
psql "$PGURL" -X -q -v ON_ERROR_STOP=1 -f supabase/groups.sql
psql "$PGURL" -X -q -v ON_ERROR_STOP=1 -f supabase/sharing.sql
psql "$PGURL" -X -A -x -f supabase/people-verify.sql
psql "$PGURL" -X -A -x -f supabase/sharing-verify.sql
```

Atteso: nessuna riga `ERROR`. `people-verify.sql` stampa le stesse 17 righe del Passo 7, in
particolare `group_invite_insert_ready|t` e `email_acceptance_closed_ready|t`. `sharing-verify.sql`
stampa:

```text
tables_ready|t
rls_ready|t
rpc_ready|t
authenticated_rpc_ready|t
token_hidden_ready|t
claim_private_ready|t
anon_rpc_closed_ready|t
anon_tables_closed_ready|t
shared_item_policies|3
own_item_policies|4
triggers_ready|t
recipient_values_ready|t
light_history_ready|t
realtime_ready|t
pg_net_ready|t
```

Se `email_acceptance_closed_ready` o `group_invite_insert_ready` è `f`, un blocco dei Passi 2–3
non è identico a quello di `people.sql`: confronta il testo e correggilo.

- [ ] **Passo 9: esegui `sharing-check.mjs`**

```bash
SUPABASE_URL=http://127.0.0.1:55421 SUPABASE_KEY=<PUBLISHABLE_KEY di supabase status> node scripts/supabase/sharing-check.mjs
```

Atteso: `<N> controlli superati, 0 falliti.`, con lo stesso `<N>` del Passo 1. Le righe nuove sono:

- `✓ Invito per email rifiutato`;
- `✓ Alice crea un invito via link per Carla`;
- `✓ Carla senza token non accetta un invito via link`;
- `✓ Carla accetta con il link`.

- [ ] **Passo 10: test e typecheck del repository**

```bash
npm test
npm run lint
```

Atteso: tutto passa come prima. Questo task non tocca file TypeScript né test.

- [ ] **Passo 11: commit** (dopo il via dell'utente)

```bash
git add supabase/people.sql supabase/people-verify.sql supabase/groups.sql supabase/sharing.sql scripts/supabase/sharing-check.mjs
git commit -m "feat(people): profiles, exact person search, account-bound invites and push triggers in SQL" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 2: prova sullo stack locale `scripts/supabase/people-check.mjs` con un Worker finto per le push

**File:**
- Create: `scripts/supabase/people-check.mjs`
- Modify: `scripts/supabase/local-stack.md` (comandi dalla radice e nota sul Worker finto)

**Interfacce:**
- Consumes: tutto ciò che il Task 1 produce. Il formato di `POST /push` è quello della tabella Interfacce. Il
  Worker finto risponde `{ sent, gone }` come quello vero del Task 4.
- Produces: `node scripts/supabase/people-check.mjs` con le variabili d'ambiente:
  - `SUPABASE_URL`, `SUPABASE_KEY` (publishable locale) e `PGURL`, tutte obbligatorie;
  - `PUSH_STUB_HOST` (predefinito `127.0.0.1`) e `PUSH_STUB_TARGET` (predefinito
    `host.docker.internal`), facoltative.

  Rifiuta con uscita 2 tutto ciò che non è `127.0.0.1`/`localhost` sulle porte 55421–55429. Il Task
  11 lo riusa.

Cosa prova (106 controlli, sei account di prova; ogni account cerca da un suo IP, passato con
`cf-connecting-ip` tramite `setHeader` di supabase-js):

- **Uguaglianza dei testi:** i 10 blocchi comuni sono uguali in `groups.sql`/`sharing.sql` e
  `people.sql`.
- **Profili:**
  - salvataggio;
  - formato e unicità dell'`@nome`;
  - nome ≤ 60;
  - ognuno legge e modifica solo la propria riga;
  - `is_handle_available` (mio = libero, di un altro = occupato).
- **Ricerca:**
  - esatta per `@nome` ed email (maiuscole e spazi ignorati), con il risultato senza email;
  - niente ricerche parziali;
  - mai sé stessi;
  - non trovabile = inesistente (stessa risposta, confrontata intera);
  - senza profilo: nome vuoto;
  - `anon` rifiutato.
- **Inviti di gruppo:**
  - ingresso con codice: push solo alla proprietaria;
  - inserimento diretto con destinatario o email rifiutato, quello con codice come prima;
  - i quattro errori della RPC;
  - un solo invito pendente;
  - il destinatario lo vede filtrando su `recipient_user_id`, un estraneo no;
  - push «invito» solo al destinatario;
  - un estraneo non accetta né rifiuta;
  - accettazione: push «nuovo membro» a proprietaria e amministratrice, una volta a testa, anche
    quando chi invita è anche amministratrice;
  - rifiuto e nuovo invito.
- **Inviti di condivisione:**
  - email rifiutata, link ancora valido;
  - sé stessi e non trovabile rifiutati;
  - un secondo invito alla stessa persona aggiorna quello pendente (una sola push);
  - accettazione senza token solo per il destinatario, con push ad Alice;
  - push «permessi cambiati» e «accesso tolto» al destinatario;
  - nessuna push a chi agisce;
  - condivisione con il gruppo: push ai membri, mai alla proprietaria.
- **Migrazione:** inviti vecchi per email scritti con `psql`, poi `people.sql` rieseguito senza il
  segno:
  - gli inviti per l'email di Bob passano al suo account e Bob li accetta;
  - il token da solo non basta più;
  - Erin, che si registra dopo, resta slegata: accettazione rifiutata con `Invito scaduto: chiedine
    uno nuovo`, anteprima `expired`;
  - nessuna push dalla migrazione.
- **Iscrizioni:**
  - massimo 10 per account;
  - lo stesso endpoint passa all'altro account;
  - ognuno vede solo le proprie;
  - solo `https`;
  - `push_gone` con segreto sbagliato o giusto, chiamata con la chiave publishable;
  - `studyos_push_notify` e il registro delle ricerche chiusi ai client.
- **Limiti:**
  - 30 ricerche al minuto per account, poi `Troppe ricerche, riprova tra un minuto`;
  - 60 al minuto per IP, anche da tre account diversi;
  - un altro IP passa ancora;
  - `is_handle_available` conta;
  - le righe vecchie di oltre un'ora si cancellano;
  - lettura dell'IP da `cf-connecting-ip` o dal primo valore di `x-forwarded-for`, provata in una
    sessione `psql`.

Il Worker finto ascolta su `127.0.0.1:55428`. È una porta del blocco 5542x che lo stack non usa:
55421 API, 55422 database, 55423 studio, 55424 inbucket, 55427 analytics, 55429 pooler. `pg_net`
gira nel container del database e lo raggiunge come `host.docker.internal:55428`. Lo script mette
in Vault un segreto casuale e l'URL del Worker finto. Prima di tutto controlla con un `ping` che
`pg_net` arrivi davvero al Worker finto: se non arriva si ferma con un messaggio chiaro, invece di
far fallire tutte le prove delle push.

- [ ] **Passo 1: crea `scripts/supabase/people-check.mjs`**

```js
#!/usr/bin/env node
// Prova API di people.sql con le stesse chiamate del client: profili, ricerca, inviti all'account,
// chiusura degli inviti per email, migrazione, iscrizioni e trigger delle notifiche push.
// Account: Alice (proprietaria), Bob (destinatario), Carla (amministratrice), Dario (non trovabile),
// Mallory (estranea), Erin (si registra dopo la migrazione).
// Le push arrivano a un Worker finto su questo computer (porta 55428): pg_net, nel container del
// database, lo raggiunge come host.docker.internal:55428.
// Solo contro lo stack Supabase LOCALE (porte 55421-55429): vedi scripts/supabase/local-stack.md.
import { createClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";

const url = process.env.SUPABASE_URL ?? "";
const key = process.env.SUPABASE_KEY ?? "";
const pgUrl = process.env.PGURL ?? "";
const parse = (value) => {
  try {
    const { hostname, port } = new URL(value);
    return { host: hostname, port: Number(port) };
  } catch {
    return null;
  }
};
const describe = (target) => (target ? `${target.host}:${target.port || "porta predefinita"}` : "URL non valido");
// Solo le porte 55421-55429 dello stack `studyos-sharing`: altri stack locali (5432x e simili) non si toccano.
const isLocal = (target) =>
  Boolean(target) && ["127.0.0.1", "localhost", "[::1]"].includes(target.host) && target.port >= 55421 && target.port <= 55429;
const api = parse(url);
const db = parse(pgUrl);
if (!url || !pgUrl) {
  console.error("SUPABASE_URL e PGURL servono entrambi: http://127.0.0.1:55421 e postgresql://postgres:postgres@127.0.0.1:55422/postgres (vedi scripts/supabase/local-stack.md).");
  process.exit(2);
}
if (!isLocal(api) || !isLocal(db)) {
  console.error(`Solo stack locale: SUPABASE_URL e PGURL devono puntare a 127.0.0.1 o localhost sulle porte 55421-55429 (trovati: ${describe(api)}, ${describe(db)}).`);
  process.exit(2);
}
if (!key) {
  console.error("SUPABASE_KEY mancante: copiala da `supabase status -o env`.");
  process.exit(2);
}

let passed = 0;
const failures = [];
const check = (name, condition, detail = "") => {
  if (condition) passed += 1;
  else failures.push(detail ? `${name} — ${detail}` : name);
  console.log(`${condition ? "✓" : "✗"} ${name}${!condition && detail ? ` (${detail})` : ""}`);
};
// Un controllo da cui dipendono tutti i successivi: se fallisce si interrompe con un esito pulito, senza stack.
class Abort extends Error {}
const need = (name, condition, detail = "") => {
  check(name, condition, detail);
  if (!condition) throw new Abort(name);
};
const rejects = async (name, request) => {
  const { error } = await request;
  check(name, Boolean(error), error ? "" : "nessun errore");
};
// Il messaggio esatto conta: il client lo mostra così com'è.
const errorIs = async (name, request, message) => {
  const { error } = await request;
  check(name, error?.message === message, error?.message ?? "nessun errore");
};
const summary = () => {
  console.log(`\n${passed} controlli superati, ${failures.length} falliti.`);
  if (failures.length) console.log(failures.map((item) => `- ${item}`).join("\n"));
};

const run = Date.now().toString(36);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const root = fileURLToPath(new URL("../../", import.meta.url));
const peopleSql = `${root}supabase/people.sql`;
const STUB_PORT = 55428;
const stubHost = process.env.PUSH_STUB_HOST ?? "127.0.0.1";
const stubTarget = process.env.PUSH_STUB_TARGET ?? "host.docker.internal";
const secret = randomBytes(24).toString("hex");

// psql per ciò che un client non può fare: segreti in Vault, inviti vecchi per email, rilancio di people.sql.
const lit = (value) => `'${String(value).replaceAll("'", "''")}'`;
const psql = (args) => {
  try {
    return execFileSync("psql", [pgUrl, "-X", "-q", "-v", "ON_ERROR_STOP=1", ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    }).trim();
  } catch (error) {
    throw new Error(`psql: ${String(error.stderr || error.message).trim()}`);
  }
};
const sql = (query) => psql(["-At", "-c", query]);
const runPeopleSql = () => psql(["-f", peopleSql]);
const setSecret = (name, value) => sql(`do $$
begin
  if exists (select 1 from vault.secrets where name = ${lit(name)}) then
    perform vault.update_secret((select id from vault.secrets where name = ${lit(name)}), ${lit(value)});
  else
    perform vault.create_secret(${lit(value)}, ${lit(name)});
  end if;
end $$;`);

// Worker finto: registra ogni richiesta e risponde come il Worker vero ({ sent, gone }).
const pushes = [];
const owners = new Map();
const stub = createServer((request, response) => {
  const chunks = [];
  request.on("data", (chunk) => chunks.push(chunk));
  request.on("end", () => {
    let body = null;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      body = null;
    }
    pushes.push({ path: request.url, secret: request.headers["x-studyos-push-secret"], type: request.headers["content-type"] ?? "", body });
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ sent: Array.isArray(body?.subscriptions) ? body.subscriptions.length : 0, gone: 0 }));
  });
});
const withTag = (tag) => pushes.filter((push) => push.body?.notification?.tag === tag);
// Chi riceve: etichette dei proprietari degli endpoint, in ordine, con i doppioni (una notifica a testa).
const receivers = (tag) =>
  withTag(tag)
    .flatMap((push) => push.body?.subscriptions ?? [])
    .map((subscription) => owners.get(subscription.endpoint) ?? "?")
    .sort()
    .join(",");
const notification = (tag) => withTag(tag)[0]?.body?.notification ?? null;
const waitFor = async (predicate, ms = 10_000) => {
  const until = Date.now() + ms;
  while (!predicate() && Date.now() < until) await sleep(100);
  return predicate();
};
const waitTag = (tag) => waitFor(() => withTag(tag).length > 0);

const account = async (label, ip, email = `${label}-${run}@studyos.test`) => {
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await client.auth.signUp({ email, password: `Prova-${run}-${label}!` });
  if (error || !data.session) throw new Error(`Registrazione di ${label}: ${error?.message ?? "conferma email attiva nello stack"}`);
  return { client, email, id: data.user.id, label, ip };
};
// Ogni account cerca da un suo IP (cf-connecting-ip, come dietro Cloudflare): i limiti per IP non si
// mescolano tra le prove, tranne in quella che li verifica.
const find = (who, query, ip = who.ip) => who.client.rpc("find_person", { p_query: query }).setHeader("cf-connecting-ip", ip);
const handleFree = (who, handle) => who.client.rpc("is_handle_available", { p_handle: handle }).setHeader("cf-connecting-ip", who.ip);
const saveProfile = (who, patch) => who.client.from("studyos_profiles").upsert({ user_id: who.id, ...patch }, { onConflict: "user_id" });
const pushKeys = () => ({ p256dh: randomBytes(65).toString("base64url"), auth: randomBytes(16).toString("base64url") });
const subscribe = async (who, endpoint = `https://push.example.test/${who.label}-${run}-${randomBytes(4).toString("hex")}`) => {
  const { error } = await who.client.from("studyos_push_subscriptions").upsert({ endpoint, ...pushKeys() }, { onConflict: "endpoint" });
  if (!error) owners.set(endpoint, who.label);
  return { endpoint, error };
};
const ownRows = async (who, table, columns = "id") => {
  const { data, error } = await who.client.from(table).select(columns);
  return { rows: data ?? [], error: error?.message };
};

// Le policy e le funzioni toccate da people.sql devono essere identiche in groups.sql e sharing.sql:
// rieseguire uno qualsiasi dei tre file non deve riaprire l'accettazione per email.
const sameBlocks = () => {
  const read = (name) => readFileSync(`${root}supabase/${name}`, "utf8");
  const people = read("people.sql");
  const sources = { "groups.sql": read("groups.sql"), "sharing.sql": read("sharing.sql") };
  const blocks = [
    ["groups.sql", "colonna recipient_user_id degli inviti di gruppo", "alter table public.studyos_group_invites add column if not exists recipient_user_id", "\n"],
    ["groups.sql", "policy studyos_group_invites_select", "create policy studyos_group_invites_select ", ";\n"],
    ["groups.sql", "policy studyos_group_invites_insert", "create policy studyos_group_invites_insert ", ";\n"],
    ["groups.sql", "accept_group_invite", "create or replace function public.accept_group_invite(", "\n$$;\n"],
    ["groups.sql", "decline_group_invite", "create or replace function public.decline_group_invite(", "\n$$;\n"],
    ["sharing.sql", "colonna recipient_user_id degli inviti di condivisione", "alter table public.studyos_share_invites\n  add column if not exists recipient_user_id", ";\n"],
    ["sharing.sql", "policy studyos_share_invites_select", "create policy studyos_share_invites_select ", ";\n"],
    ["sharing.sql", "create_share_invite", "create or replace function public.create_share_invite(", "\n$$;\n"],
    ["sharing.sql", "preview_share_invite", "create or replace function public.preview_share_invite(", "\n$$;\n"],
    ["sharing.sql", "studyos_claim_share_invite", "create or replace function public.studyos_claim_share_invite(", "\n$$;\n"]
  ];
  for (const [file, label, start, end] of blocks) {
    const text = sources[file];
    const from = text.indexOf(start);
    const to = from < 0 ? -1 : text.indexOf(end, from + start.length);
    const block = to < 0 ? "" : text.slice(from, to + end.length);
    check(`Uguale in ${file} e people.sql: ${label}`, block !== "" && people.includes(block), block ? "testi diversi" : `blocco non trovato in ${file}`);
  }
};

const main = async () => {
  sameBlocks();

  // Worker finto e segreti di prova in Vault: le notifiche dello stack locale arrivano qui.
  await new Promise((resolve, reject) => {
    stub.once("error", reject);
    stub.listen(STUB_PORT, stubHost, resolve);
  });
  setSecret("studyos_push_secret", secret);
  setSecret("studyos_push_url", `http://${stubTarget}:${STUB_PORT}/push`);
  sql(`select net.http_post(url := ${lit(`http://${stubTarget}:${STUB_PORT}/ping`)}, body := '{}'::jsonb)`);
  need("pg_net raggiunge il Worker finto", await waitFor(() => pushes.some((push) => push.path === "/ping")),
    `nessuna richiesta in 10 s su ${stubTarget}:${STUB_PORT}; con Docker su Linux riprova con PUSH_STUB_HOST=0.0.0.0`);

  const alice = await account("alice", "198.51.100.1");
  const bob = await account("bob", "198.51.100.2");
  const carla = await account("carla", "198.51.100.3");
  const dario = await account("dario", "198.51.100.4");
  const mallory = await account("mallory", "198.51.100.5");
  const anon = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  // ─── Profili ──────────────────────────────────────────────────────────────
  const bobHandle = `bob_${run}`;
  const aliceHandle = `alice_${run}`;
  const darioHandle = `dario_${run}`;
  const { error: bobProfileError } = await saveProfile(bob, { display_name: "Bob", handle: bobHandle });
  need("Bob salva nome e @nome", !bobProfileError, bobProfileError?.message);
  const { data: mine } = await handleFree(bob, `@${bobHandle}`);
  const { data: taken } = await handleFree(alice, bobHandle);
  const { data: free } = await handleFree(alice, aliceHandle);
  check("@nome: già mio = libero, di un altro = occupato, nuovo = libero", mine === true && taken === false && free === true,
    JSON.stringify({ mine, taken, free }));
  await rejects("@nome con maiuscole o simboli rifiutato", saveProfile(alice, { display_name: "Alice", handle: "Alice!" }));
  await rejects("@nome già preso rifiutato", saveProfile(alice, { display_name: "Alice", handle: bobHandle }));
  await rejects("Nome oltre 60 caratteri rifiutato", saveProfile(alice, { display_name: "A".repeat(61) }));
  const { error: aliceProfileError } = await saveProfile(alice, { display_name: "Alice", handle: aliceHandle });
  check("Alice salva il profilo", !aliceProfileError, aliceProfileError?.message);
  const aliceView = await ownRows(alice, "studyos_profiles", "user_id");
  check("Ognuno legge solo il proprio profilo", aliceView.rows.length === 1 && aliceView.rows[0].user_id === alice.id,
    aliceView.error ?? `${aliceView.rows.length} righe`);
  const { data: hijack } = await alice.client.from("studyos_profiles").update({ display_name: "Preso" }).eq("user_id", bob.id).select();
  check("Alice non modifica il profilo di Bob", Array.isArray(hijack) && hijack.length === 0);
  const { error: darioProfileError } = await saveProfile(dario, { display_name: "Dario", handle: darioHandle, discoverable: false });
  check("Dario spegne «Gli altri possono trovarmi»", !darioProfileError, darioProfileError?.message);

  // ─── Ricerca ──────────────────────────────────────────────────────────────
  const byHandle = await find(alice, `@${bobHandle}`);
  check("Ricerca esatta per @nome", byHandle.data?.length === 1 && byHandle.data[0].person_id === bob.id
    && byHandle.data[0].display_name === "Bob" && byHandle.data[0].handle === bobHandle, byHandle.error?.message ?? JSON.stringify(byHandle.data));
  const byEmail = await find(alice, `  ${bob.email.toUpperCase()} `);
  check("Ricerca esatta per email (maiuscole e spazi ignorati), mai l'email nel risultato",
    byEmail.data?.[0]?.person_id === bob.id && Object.keys(byEmail.data[0]).sort().join(",") === "display_name,handle,person_id",
    byEmail.error?.message ?? JSON.stringify(byEmail.data));
  const partialEmail = await find(alice, bob.email.slice(0, -2));
  const partialHandle = await find(alice, `@${bobHandle.slice(0, -1)}`);
  check("Nessuna ricerca parziale", partialEmail.data?.length === 0 && partialHandle.data?.length === 0,
    JSON.stringify([partialEmail.data, partialHandle.data]));
  const self = await find(bob, bob.email);
  check("Mai sé stessi", !self.error && self.data?.length === 0, self.error?.message ?? JSON.stringify(self.data));
  const hiddenEmail = await find(alice, dario.email);
  const hiddenHandle = await find(alice, `@${darioHandle}`);
  const missing = await find(alice, `nessuno-${run}@studyos.test`);
  const answer = (result) => JSON.stringify({ status: result.status, data: result.data, error: result.error });
  check("Non trovabile e inesistente danno la stessa risposta",
    missing.data?.length === 0 && answer(hiddenEmail) === answer(missing) && answer(hiddenHandle) === answer(missing),
    `${answer(hiddenEmail)} / ${answer(hiddenHandle)} / ${answer(missing)}`);
  const noProfile = await find(alice, carla.email);
  check("Senza profilo: trovabile, nome vuoto e nessun @nome",
    noProfile.data?.[0]?.person_id === carla.id && noProfile.data[0].display_name === "" && noProfile.data[0].handle === null,
    noProfile.error?.message ?? JSON.stringify(noProfile.data));
  await rejects("Senza accesso la ricerca è negata", anon.rpc("find_person", { p_query: bob.email }));

  // ─── Iscrizioni push di prova ─────────────────────────────────────────────
  const subscriptions = [await subscribe(alice), await subscribe(bob), await subscribe(carla), await subscribe(mallory)];
  need("Iscrizioni push salvate (upsert su endpoint)", subscriptions.every((item) => !item.error),
    subscriptions.map((item) => item.error?.message).filter(Boolean).join("; "));
  const mallorySubscription = subscriptions[3];

  // ─── Inviti di gruppo ─────────────────────────────────────────────────────
  const groupId = `group-people-${run}`;
  const code = `GRP-${run.slice(-4).toUpperCase()}-PPLE`;
  const { error: groupError } = await alice.client.from("studyos_groups")
    .insert({ id: groupId, name: "Fisica 2", owner_id: alice.id, owner_display_name: "Alice", invite_code: code });
  const { error: ownerError } = await alice.client.from("studyos_group_members")
    .insert({ group_id: groupId, user_id: alice.id, email: alice.email, display_name: "Alice", role: "owner" });
  need("Alice crea il gruppo Fisica 2", !groupError && !ownerError, groupError?.message ?? ownerError?.message);

  const { error: joinError } = await carla.client.rpc("join_group_by_code", { p_code: code, p_display_name: "Carla" });
  check("Carla entra con il codice", !joinError, joinError?.message);
  const carlaJoin = `group-join:${groupId}:${carla.id}`;
  await waitTag(carlaJoin);
  check("Push «nuovo membro» (codice) solo alla proprietaria", receivers(carlaJoin) === "alice", receivers(carlaJoin) || "nessuna push");
  check("La push arriva con segreto, JSON e percorso /push",
    withTag(carlaJoin).length > 0 && withTag(carlaJoin).every((push) => push.secret === secret && push.type.startsWith("application/json") && push.path === "/push"));
  const joinText = notification(carlaJoin);
  check("Testo «nuovo membro» in italiano semplice",
    joinText?.kind === "accepted" && joinText.title === "Nuovo membro" && joinText.body === "Carla ora fa parte del gruppo Fisica 2"
      && joinText.url === "?apri=gruppi", JSON.stringify(joinText));
  const { error: promoteError } = await alice.client.from("studyos_group_members")
    .update({ role: "admin" }).eq("group_id", groupId).eq("user_id", carla.id);
  check("Alice nomina Carla amministratrice", !promoteError, promoteError?.message);

  const directInvite = (extra) => alice.client.from("studyos_group_invites").insert({
    id: `groupInvite_direct_${randomBytes(4).toString("hex")}`, group_id: groupId, group_name: "Fisica 2",
    from_user_id: alice.id, from_display_name: "Alice", code, status: "pending", ...extra
  });
  await rejects("Inserimento diretto con destinatario rifiutato", directInvite({ recipient_user_id: bob.id }));
  await rejects("Inserimento diretto per email rifiutato", directInvite({ recipient_email: bob.email }));
  const { error: codeInviteError } = await directInvite({});
  check("Invito con codice (senza destinatario) come prima", !codeInviteError, codeInviteError?.message);

  const inviteToGroup = (who, personId, name) =>
    who.client.rpc("invite_person_to_group", { p_group_id: groupId, p_person_id: personId, p_display_name: name });
  await errorIs("Un estraneo non invita", inviteToGroup(mallory, bob.id, "Mallory"), "Solo proprietario e amministratori possono invitare");
  await errorIs("Persona non trovabile: «Nessuna persona trovata»", inviteToGroup(alice, dario.id, "Alice"), "Nessuna persona trovata");
  await errorIs("Account inesistente: stessa risposta", inviteToGroup(alice, randomUUID(), "Alice"), "Nessuna persona trovata");
  await errorIs("Persona già nel gruppo", inviteToGroup(alice, carla.id, "Alice"), "È già nel gruppo");
  const groupInvite = await inviteToGroup(alice, bob.id, "Alice");
  need("Alice invita Bob nel gruppo", !groupInvite.error && typeof groupInvite.data === "string" && groupInvite.data.startsWith("groupInvite_"),
    groupInvite.error?.message ?? JSON.stringify(groupInvite.data));
  await errorIs("Un solo invito in attesa per persona", inviteToGroup(carla, bob.id, "Carla"), "Ha già un invito");
  const { data: bobInbox } = await bob.client.from("studyos_group_invites")
    .select("id, group_name, from_display_name, recipient_user_id, recipient_email, code, status")
    .eq("recipient_user_id", bob.id).eq("status", "pending");
  check("Bob vede l'invito filtrando su recipient_user_id",
    bobInbox?.length === 1 && bobInbox[0].id === groupInvite.data && bobInbox[0].group_name === "Fisica 2"
      && bobInbox[0].from_display_name === "Alice" && bobInbox[0].recipient_email === null && bobInbox[0].code === code,
    JSON.stringify(bobInbox));
  const { data: malloryPeek } = await mallory.client.from("studyos_group_invites").select("id").eq("id", groupInvite.data);
  check("Mallory non vede l'invito di Bob", malloryPeek?.length === 0);
  const inviteTag = `group-invite:${groupInvite.data}`;
  await waitTag(inviteTag);
  check("Push «invito» solo a Bob, mai ad Alice che invita", receivers(inviteTag) === "bob", receivers(inviteTag) || "nessuna push");
  const inviteText = notification(inviteTag);
  check("Testo «invito a un gruppo»",
    inviteText?.kind === "invite" && inviteText.title === "Invito a un gruppo" && inviteText.body === "Alice ti invita nel gruppo Fisica 2"
      && inviteText.url === "?apri=notifiche", JSON.stringify(inviteText));
  await errorIs("Mallory non accetta l'invito di Bob",
    mallory.client.rpc("accept_group_invite", { p_invite_id: groupInvite.data, p_display_name: "Mallory" }), "Invito destinato a un altro account");
  await errorIs("Mallory non rifiuta l'invito di Bob",
    mallory.client.rpc("decline_group_invite", { p_invite_id: groupInvite.data }), "Invito destinato a un altro account");
  const { error: bobAcceptError } = await bob.client.rpc("accept_group_invite", { p_invite_id: groupInvite.data, p_display_name: "Bob" });
  const { data: bobMember } = await bob.client.from("studyos_group_members").select("user_id").eq("group_id", groupId).eq("user_id", bob.id);
  check("Bob accetta ed è subito nel gruppo", !bobAcceptError && bobMember?.length === 1, bobAcceptError?.message);
  const bobJoin = `group-join:${groupId}:${bob.id}`;
  await waitTag(bobJoin);
  check("Push «nuovo membro»: proprietaria (anche autrice dell'invito) e amministratrice, una a testa, mai a Bob",
    receivers(bobJoin) === "alice,carla", receivers(bobJoin) || "nessuna push");

  // Carla (amministratrice) invita Mallory: Mallory rifiuta, Carla la invita di nuovo, Mallory accetta.
  const firstForMallory = await inviteToGroup(carla, mallory.id, "Carla");
  const { error: declineError } = await mallory.client.rpc("decline_group_invite", { p_invite_id: firstForMallory.data });
  check("Mallory rifiuta l'invito di Carla", !firstForMallory.error && !declineError, firstForMallory.error?.message ?? declineError?.message);
  const secondForMallory = await inviteToGroup(carla, mallory.id, "Carla");
  const { error: malloryAcceptError } = await mallory.client.rpc("accept_group_invite", { p_invite_id: secondForMallory.data, p_display_name: "Mallory" });
  check("Dopo un rifiuto si può invitare di nuovo, e Mallory accetta", !secondForMallory.error && !malloryAcceptError,
    secondForMallory.error?.message ?? malloryAcceptError?.message);
  const malloryJoin = `group-join:${groupId}:${mallory.id}`;
  await waitTag(malloryJoin);
  check("Push «nuovo membro»: Carla, amministratrice e autrice dell'invito, la riceve una volta sola",
    receivers(malloryJoin) === "alice,carla", receivers(malloryJoin) || "nessuna push");

  // ─── Inviti di condivisione ───────────────────────────────────────────────
  const offer = (scope, permission = "view") => ({ scope, permission, subject_ids: [], subject_names: [] });
  await errorIs("create_share_invite con email rifiutato",
    alice.client.rpc("create_share_invite", { p_owner_name: "Alice", p_offers: [offer("calendar")], p_requests: [], p_recipient_email: bob.email }),
    "Gli inviti per email non ci sono più: cerca la persona");
  const linkInvite = await alice.client.rpc("create_share_invite", { p_owner_name: "Alice", p_offers: [offer("calendar")], p_requests: [], p_recipient_email: null });
  check("Gli inviti via link restano", !linkInvite.error && /^[0-9a-f]{64}$/.test(linkInvite.data?.token ?? ""), linkInvite.error?.message);
  const inviteToShare = (who, personId, offers, name = "Alice") =>
    who.client.rpc("invite_person_to_share", { p_person_id: personId, p_owner_name: name, p_offers: offers, p_requests: [] });
  await errorIs("Invito a sé stessi rifiutato", inviteToShare(alice, alice.id, [offer("calendar")]), "Non puoi invitare te stesso");
  await errorIs("Invito a chi non è trovabile rifiutato", inviteToShare(alice, dario.id, [offer("calendar")]), "Nessuna persona trovata");
  const shareInvite = await inviteToShare(alice, bob.id, [offer("calendar"), offer("tasks")]);
  need("Alice invita Bob a vedere calendario e attività", !shareInvite.error && Object.keys(shareInvite.data ?? {}).join(",") === "id",
    shareInvite.error?.message ?? JSON.stringify(shareInvite.data));
  const repeated = await inviteToShare(alice, bob.id, [offer("calendar"), offer("tasks")]);
  check("Un secondo invito alla stessa persona aggiorna quello in attesa", repeated.data?.id === shareInvite.data.id,
    repeated.error?.message ?? JSON.stringify(repeated.data));
  const { data: bobShareInbox } = await bob.client.from("studyos_share_invites")
    .select("id, owner_name, recipient_user_id, status").eq("recipient_user_id", bob.id).eq("status", "pending");
  check("Bob vede l'invito di condivisione", bobShareInbox?.length === 1 && bobShareInbox[0].id === shareInvite.data.id, JSON.stringify(bobShareInbox));
  const shareTag = `share-invite:${shareInvite.data.id}`;
  await waitTag(shareTag);
  check("Push «invito a condividere» a Bob, una sola anche con l'invito aggiornato",
    receivers(shareTag) === "bob" && withTag(shareTag).length === 1, `${receivers(shareTag)} in ${withTag(shareTag).length} richieste`);
  check("Testo «invito a condividere» con le sezioni",
    notification(shareTag)?.body === "Alice vuole condividere con te: Calendario, Attività" && notification(shareTag)?.url === "?apri=notifiche",
    JSON.stringify(notification(shareTag)));
  await errorIs("Mallory non accetta un invito per Bob",
    mallory.client.rpc("accept_share_invite", { p_invite_id: shareInvite.data.id, p_token: null, p_display_name: "Mallory", p_reciprocal: [] }),
    "Invito destinato a un altro account");
  const bobShareAccept = await bob.client.rpc("accept_share_invite", { p_invite_id: shareInvite.data.id, p_token: null, p_display_name: "Bob", p_reciprocal: [] });
  check("Bob accetta senza token", !bobShareAccept.error && bobShareAccept.data?.granted === 2, bobShareAccept.error?.message);
  const acceptedTag = `share-accepted:${shareInvite.data.id}`;
  await waitTag(acceptedTag);
  check("Push «invito accettato» ad Alice, mai a Bob", receivers(acceptedTag) === "alice", receivers(acceptedTag) || "nessuna push");
  check("Testo «invito accettato»",
    notification(acceptedTag)?.body === "Bob ha accettato il tuo invito" && notification(acceptedTag)?.url === "?apri=condivisione",
    JSON.stringify(notification(acceptedTag)));

  const { data: bobShares } = await alice.client.from("studyos_shares").select("id, scope, permission").eq("owner_id", alice.id).eq("grantee_user_id", bob.id);
  const calendarShare = bobShares?.find((item) => item.scope === "calendar");
  const tasksShare = bobShares?.find((item) => item.scope === "tasks");
  need("Bob riceve calendario e attività", Boolean(calendarShare && tasksShare), JSON.stringify(bobShares));
  // Nuovo invito con «Può modificare» sulle attività: accettandolo Bob cambia il proprio permesso, ma è
  // lui che agisce e non riceve nulla.
  const upgrade = await inviteToShare(alice, bob.id, [offer("tasks", "edit")]);
  const { error: upgradeError } = await bob.client.rpc("accept_share_invite", { p_invite_id: upgrade.data?.id, p_token: null, p_display_name: "Bob", p_reciprocal: [] });
  check("Bob accetta «Può modificare» sulle attività", !upgrade.error && !upgradeError, upgrade.error?.message ?? upgradeError?.message);
  await waitTag(`share-accepted:${upgrade.data?.id}`);
  const { error: permissionError } = await alice.client.from("studyos_shares").update({ permission: "edit" }).eq("id", calendarShare.id);
  check("Alice passa il calendario a «Può modificare»", !permissionError, permissionError?.message);
  const calendarTag = `share-permission:${calendarShare.id}`;
  await waitTag(calendarTag);
  check("Push «permessi cambiati» a Bob", receivers(calendarTag) === "bob", receivers(calendarTag) || "nessuna push");
  check("Testo «permessi cambiati»", notification(calendarTag)?.title === "Permessi cambiati"
    && notification(calendarTag)?.body === "Alice ora ti permette di modificare: Calendario", JSON.stringify(notification(calendarTag)));
  const { error: leaveError } = await bob.client.from("studyos_shares").delete().eq("id", tasksShare.id);
  check("Bob esce dalla condivisione delle attività", !leaveError, leaveError?.message);
  const { error: revokeError } = await alice.client.from("studyos_shares").delete().eq("id", calendarShare.id);
  check("Alice toglie il calendario a Bob", !revokeError, revokeError?.message);
  await waitFor(() => withTag(calendarTag).length > 1);
  const removed = withTag(calendarTag).map((push) => push.body.notification).find((item) => item.title === "Accesso tolto");
  check("Push «accesso tolto» a Bob", removed?.body === "Alice ha smesso di condividere con te: Calendario"
    && receivers(calendarTag) === "bob,bob", `${JSON.stringify(removed)} → ${receivers(calendarTag)}`);
  check("Nessuna push a chi agisce: Bob che si alza «Può modificare» o esce non riceve nulla",
    withTag(`share-permission:${tasksShare.id}`).length === 0, `${withTag(`share-permission:${tasksShare.id}`).length} richieste`);

  // Condivisione con il gruppo: un cambio di permesso arriva ai membri, mai alla proprietaria.
  const { data: groupShare, error: groupShareError } = await alice.client.from("studyos_shares")
    .insert({ owner_id: alice.id, owner_name: "Alice", scope: "goals", permission: "view", grantee_group_id: groupId, grantee_name: "Fisica 2" })
    .select("id").single();
  check("Alice condivide gli obiettivi con il gruppo", !groupShareError, groupShareError?.message);
  await alice.client.from("studyos_shares").update({ permission: "edit" }).eq("id", groupShare?.id);
  const groupTag = `share-permission:${groupShare?.id}`;
  await waitTag(groupTag);
  check("Push «permessi cambiati» ai membri del gruppo, non ad Alice", receivers(groupTag) === "bob,carla,mallory", receivers(groupTag) || "nessuna push");
  check("Testo per il gruppo", notification(groupTag)?.body === "Alice ora permette al gruppo Fisica 2 di modificare: Obiettivi",
    JSON.stringify(notification(groupTag)));

  // ─── Migrazione degli inviti per email ────────────────────────────────────
  // Inviti per email creati prima dell'aggiornamento: li scrive psql, come se fossero vecchi.
  const chemistry = `group-chem-${run}`;
  const chemistryCode = `GRP-${run.slice(-4).toUpperCase()}-CHEM`;
  await alice.client.from("studyos_groups").insert({ id: chemistry, name: "Chimica", owner_id: alice.id, owner_display_name: "Alice", invite_code: chemistryCode });
  await alice.client.from("studyos_group_members").insert({ group_id: chemistry, user_id: alice.id, email: alice.email, display_name: "Alice", role: "owner" });
  const erinEmail = `erin-${run}@studyos.test`;
  const legacyGroup = (label, email) => {
    const id = `groupInvite_legacy_${label}_${run}`;
    sql(`insert into public.studyos_group_invites (id, group_id, group_name, from_user_id, from_display_name, recipient_email, code, status)
      values (${lit(id)}, ${lit(chemistry)}, 'Chimica', ${lit(alice.id)}, 'Alice', ${lit(email)}, ${lit(chemistryCode)}, 'pending')`);
    return id;
  };
  const legacyShare = (email, token) => sql(`insert into public.studyos_share_invites (owner_id, owner_name, offers, recipient_email, token_hash)
    values (${lit(alice.id)}, 'Alice', '[{"scope":"goals","permission":"view"}]', ${lit(email)}, sha256(convert_to(${lit(token)}, 'UTF8')))
    returning id`);
  const tokenBob = randomBytes(32).toString("hex");
  const tokenErin = randomBytes(32).toString("hex");
  const groupForBob = legacyGroup("bob", bob.email.toUpperCase());
  const groupForErin = legacyGroup("erin", erinEmail);
  const shareForBob = legacyShare(bob.email, tokenBob);
  const shareForErin = legacyShare(erinEmail, tokenErin);
  sql("delete from public.studyos_migrations where name = 'people_email_invites'");
  runPeopleSql();
  const boundTo = (table, id) => sql(`select coalesce(recipient_user_id::text, '-') from public.${table} where id = ${lit(id)}`);
  check("Migrazione: l'invito di gruppo per l'email di Bob passa al suo account", boundTo("studyos_group_invites", groupForBob) === bob.id,
    boundTo("studyos_group_invites", groupForBob));
  check("Migrazione: l'invito di condivisione per l'email di Bob passa al suo account", boundTo("studyos_share_invites", shareForBob) === bob.id,
    boundTo("studyos_share_invites", shareForBob));
  check("Migrazione: senza account con quell'email l'invito resta slegato",
    boundTo("studyos_group_invites", groupForErin) === "-" && boundTo("studyos_share_invites", shareForErin) === "-");
  const { data: migratedInbox } = await bob.client.from("studyos_group_invites").select("id").eq("recipient_user_id", bob.id).eq("status", "pending");
  check("Bob vede l'invito migrato", migratedInbox?.some((item) => item.id === groupForBob), JSON.stringify(migratedInbox));
  await errorIs("Con un destinatario il token non basta",
    mallory.client.rpc("accept_share_invite", { p_invite_id: shareForBob, p_token: tokenBob, p_display_name: "Mallory", p_reciprocal: [] }),
    "Invito destinato a un altro account");
  const migratedAccept = await bob.client.rpc("accept_share_invite", { p_invite_id: shareForBob, p_token: null, p_display_name: "Bob", p_reciprocal: [] });
  check("Bob accetta l'invito migrato senza token", !migratedAccept.error, migratedAccept.error?.message);

  const erin = await account("erin", "198.51.100.6", erinEmail);
  runPeopleSql();
  check("Rieseguire people.sql non lega un account registrato dopo",
    boundTo("studyos_group_invites", groupForErin) === "-" && boundTo("studyos_share_invites", shareForErin) === "-");
  await errorIs("Vecchio invito per email: non si accetta nemmeno con il token",
    erin.client.rpc("accept_share_invite", { p_invite_id: shareForErin, p_token: tokenErin, p_display_name: "Erin", p_reciprocal: [] }),
    "Invito scaduto: chiedine uno nuovo");
  await errorIs("Vecchio invito di gruppo per email: non si accetta",
    erin.client.rpc("accept_group_invite", { p_invite_id: groupForErin, p_display_name: "Erin" }), "Invito destinato a un altro account");
  const { data: erinPreview } = await erin.client.rpc("preview_share_invite", { p_token: tokenErin });
  check("Anteprima del vecchio invito: «scaduto»", erinPreview?.[0]?.status === "expired" && erinPreview[0].for_other_account === false,
    JSON.stringify(erinPreview));
  check("La migrazione non manda notifiche", withTag(`group-invite:${groupForBob}`).length === 0 && withTag(`share-invite:${shareForBob}`).length === 0);

  // ─── Iscrizioni push ──────────────────────────────────────────────────────
  const darioEndpoints = [];
  for (let index = 0; index < 11; index += 1) {
    const { endpoint, error } = await subscribe(dario);
    if (!error) darioEndpoints.push(endpoint);
  }
  const darioRows = await ownRows(dario, "studyos_push_subscriptions", "endpoint");
  check("Al massimo 10 iscrizioni per account: la più vecchia sparisce",
    darioEndpoints.length === 11 && darioRows.rows.length === 10 && !darioRows.rows.some((item) => item.endpoint === darioEndpoints[0]),
    darioRows.error ?? `${darioEndpoints.length} salvate, ${darioRows.rows.length} rimaste`);
  const device = await subscribe(bob);
  const { error: claimError } = await carla.client.from("studyos_push_subscriptions").upsert({ endpoint: device.endpoint, ...pushKeys() }, { onConflict: "endpoint" });
  if (!claimError) owners.set(device.endpoint, "carla");
  const bobDevice = await bob.client.from("studyos_push_subscriptions").select("endpoint").eq("endpoint", device.endpoint);
  const carlaDevice = await carla.client.from("studyos_push_subscriptions").select("endpoint").eq("endpoint", device.endpoint);
  check("Stesso browser, altro account: l'iscrizione passa a Carla", !device.error && !claimError
    && bobDevice.data?.length === 0 && carlaDevice.data?.length === 1, claimError?.message ?? device.error?.message);
  const malloryRows = await ownRows(mallory, "studyos_push_subscriptions", "endpoint");
  check("Ognuno vede solo le proprie iscrizioni", malloryRows.rows.length === 1 && malloryRows.rows[0].endpoint === mallorySubscription.endpoint,
    malloryRows.error ?? `${malloryRows.rows.length} righe`);
  await rejects("Endpoint non https rifiutato", mallory.client.from("studyos_push_subscriptions").insert({ endpoint: "http://push.example.test/x", ...pushKeys() }));
  await errorIs("push_gone con un segreto sbagliato", anon.rpc("push_gone", { p_secret: "sbagliato", p_endpoints: [mallorySubscription.endpoint] }), "Non autorizzato");
  const gone = await anon.rpc("push_gone", { p_secret: secret, p_endpoints: [mallorySubscription.endpoint, "https://push.example.test/inesistente"] });
  const malloryAfter = await ownRows(mallory, "studyos_push_subscriptions", "endpoint");
  check("push_gone con il segreto giusto (chiave publishable) cancella l'iscrizione", gone.data === 1 && malloryAfter.rows.length === 0,
    gone.error?.message ?? `${gone.data} cancellate`);
  await rejects("studyos_push_notify non è chiamabile dai client", alice.client.rpc("studyos_push_notify", {
    p_user_ids: [bob.id], p_kind: "invite", p_title: "x", p_body: "x", p_url: "?apri=notifiche", p_tag: "x"
  }));
  const lookups = await alice.client.from("studyos_person_lookups").select("id");
  check("Il registro delle ricerche non è leggibile", lookups.error?.code === "42501", lookups.error ? `${lookups.error.code}: ${lookups.error.message}` : "leggibile");

  // ─── Limiti delle ricerche ────────────────────────────────────────────────
  // Per account: 30 al minuto. Mallory non ha ancora cercato nulla.
  let mallorySearches = 0;
  for (let index = 0; index < 30; index += 1) {
    const { error } = await find(mallory, `nessuno-${index}-${run}@studyos.test`);
    if (!error) mallorySearches += 1;
  }
  check("30 ricerche in un minuto passano", mallorySearches === 30, `${mallorySearches} su 30`);
  await errorIs("La 31ª ricerca dello stesso account è fermata", find(mallory, bob.email, "198.51.100.50"), "Troppe ricerche, riprova tra un minuto");
  // Per IP: 60 al minuto, anche da account diversi (Bob, Carla e Dario sono sotto il loro limite).
  const sharedIp = "198.51.100.77";
  let ipSearches = 0;
  for (const who of [bob, carla, dario]) {
    for (let index = 0; index < 20; index += 1) {
      const { error } = await find(who, `ip-${index}-${run}@studyos.test`, sharedIp);
      if (!error) ipSearches += 1;
    }
  }
  check("60 ricerche dallo stesso IP passano", ipSearches === 60, `${ipSearches} su 60`);
  await errorIs("La 61ª ricerca dallo stesso IP è fermata", find(dario, bob.email, sharedIp), "Troppe ricerche, riprova tra un minuto");
  const otherIp = await find(dario, bob.email, "198.51.100.78");
  check("Lo stesso account da un altro IP cerca ancora", !otherIp.error && otherIp.data?.[0]?.person_id === bob.id, otherIp.error?.message);
  await errorIs("Anche is_handle_available rispetta i limiti", handleFree({ ...mallory, ip: "198.51.100.51" }, `libero_${run}`),
    "Troppe ricerche, riprova tra un minuto");
  // Righe più vecchie di un'ora: cancellate alla ricerca successiva.
  sql(`insert into public.studyos_person_lookups (user_id, ip, at) values (${lit(alice.id)}, '192.0.2.1', now() - interval '2 hours')`);
  await find(alice, bob.email);
  check("Le ricerche più vecchie di un'ora si cancellano", sql("select count(*) from public.studyos_person_lookups where at < now() - interval '1 hour'") === "0");
  // L'IP letto dalle intestazioni, provato direttamente in una sessione psql.
  const forwarded = psql(["-At", "-c", `select set_config('request.headers', '{"x-forwarded-for": "203.0.113.9, 10.0.0.1"}', false)`, "-c", "select public.studyos_request_ip()"]).split("\n").pop();
  const cloudflare = psql(["-At", "-c", `select set_config('request.headers', '{"cf-connecting-ip": "198.51.100.9", "x-forwarded-for": "203.0.113.9"}', false)`, "-c", "select public.studyos_request_ip()"]).split("\n").pop();
  check("IP: cf-connecting-ip, altrimenti il primo valore di x-forwarded-for", cloudflare === "198.51.100.9" && forwarded === "203.0.113.9",
    `${cloudflare} / ${forwarded}`);
};

main()
  .catch((error) => {
    if (!(error instanceof Abort)) console.error(error);
    process.exitCode = 1;
  })
  .then(() => new Promise((resolve) => stub.close(() => resolve())))
  .then(() => {
    summary();
    if (failures.length) process.exitCode = 1;
    process.exit(process.exitCode ?? 0);
  });
```

- [ ] **Passo 2: aggiorna `scripts/supabase/local-stack.md`**

**Blocco 1 — comandi dalla radice.** In `scripts/supabase/local-stack.md` cerca:

````markdown
Dalla radice del repository:

```bash
export PGURL=postgresql://postgres:postgres@127.0.0.1:55422/postgres
psql "$PGURL" -v ON_ERROR_STOP=1 -f supabase/schema.sql
psql "$PGURL" -v ON_ERROR_STOP=1 -f supabase/groups.sql
psql "$PGURL" -v ON_ERROR_STOP=1 -f supabase/sharing.sql
SUPABASE_URL=http://127.0.0.1:55421 SUPABASE_KEY=<ANON_KEY o PUBLISHABLE_KEY di supabase status> \
  node scripts/supabase/sharing-check.mjs
```
````

Sostituisci con:

````markdown
Dalla radice del repository:

```bash
export PGURL=postgresql://postgres:postgres@127.0.0.1:55422/postgres
psql "$PGURL" -v ON_ERROR_STOP=1 -f supabase/schema.sql
psql "$PGURL" -v ON_ERROR_STOP=1 -f supabase/groups.sql
psql "$PGURL" -v ON_ERROR_STOP=1 -f supabase/sharing.sql
psql "$PGURL" -v ON_ERROR_STOP=1 -f supabase/people.sql
SUPABASE_URL=http://127.0.0.1:55421 SUPABASE_KEY=<ANON_KEY o PUBLISHABLE_KEY di supabase status> \
  node scripts/supabase/sharing-check.mjs
SUPABASE_URL=http://127.0.0.1:55421 SUPABASE_KEY=<ANON_KEY o PUBLISHABLE_KEY di supabase status> PGURL="$PGURL" \
  node scripts/supabase/people-check.mjs
```

`people-check.mjs` usa anche `psql` (inviti vecchi per email, segreti in Vault, rilancio di
`people.sql`) e avvia un Worker finto su `127.0.0.1:55428`: pg_net, dentro il container del
database, lo raggiunge come `host.docker.internal:55428`. I segreti di prova restano in Vault
dello stack locale; il Worker finto si chiude alla fine dello script.
````

- [ ] **Passo 3: controllo della sintassi e rifiuto fuori dallo stack locale**

```bash
node --check scripts/supabase/people-check.mjs
SUPABASE_URL=https://kobmoygkwzlprhgfkzwh.supabase.co SUPABASE_KEY=chiave-finta PGURL=postgresql://postgres:postgres@127.0.0.1:55422/postgres node scripts/supabase/people-check.mjs
echo "exit=$?"
SUPABASE_URL=http://127.0.0.1:55421 SUPABASE_KEY=chiave-finta PGURL=postgresql://postgres:postgres@127.0.0.1:54322/postgres node scripts/supabase/people-check.mjs
echo "exit=$?"
```

Atteso: `node --check` non stampa nulla. Le due esecuzioni si fermano prima di qualsiasi
richiesta:

```text
Solo stack locale: SUPABASE_URL e PGURL devono puntare a 127.0.0.1 o localhost sulle porte 55421-55429 (trovati: kobmoygkwzlprhgfkzwh.supabase.co:porta predefinita, 127.0.0.1:55422).
exit=2
Solo stack locale: SUPABASE_URL e PGURL devono puntare a 127.0.0.1 o localhost sulle porte 55421-55429 (trovati: 127.0.0.1:55421, 127.0.0.1:54322).
exit=2
```

- [ ] **Passo 4: esegui la prova sullo stack locale**

Con lo stack del Task 1 avviato e `PGURL` esportato come al Passo 1 del Task 1:

```bash
SUPABASE_URL=http://127.0.0.1:55421 SUPABASE_KEY=<PUBLISHABLE_KEY di supabase status> PGURL="$PGURL" node scripts/supabase/people-check.mjs
```

Atteso:

- tutte le righe con `✓`;
- la prima della parte push è `✓ pg_net raggiunge il Worker finto`;
- l'ultima riga è `106 controlli superati, 0 falliti.`;
- uscita 0;
- l'esecuzione dura meno di un minuto.

Se si ferma su `pg_net raggiunge il Worker finto`, il container non arriva a
`host.docker.internal:55428`.

- Docker Desktop e OrbStack su macOS lo risolvono da soli.
- Su Linux rilancia con `PUSH_STUB_HOST=0.0.0.0` davanti al comando.
- Se `host.docker.internal` non esiste, aggiungi anche `PUSH_STUB_TARGET=<IP del bridge Docker,
  di solito 172.17.0.1>`.

Se la registrazione degli account fallisce con un limite di frequenza (`over_request_rate_limit`),
lo stack conta registrazioni e accessi per 5 minuti: aspetta e rilancia.

- [ ] **Passo 5: verifica completa e riesecuzione degli altri controlli**

```bash
psql "$PGURL" -X -A -x -f supabase/people-verify.sql
SUPABASE_URL=http://127.0.0.1:55421 SUPABASE_KEY=<PUBLISHABLE_KEY di supabase status> node scripts/supabase/sharing-check.mjs
```

Atteso:

- `people-verify.sql`: le 17 righe del Passo 7 del Task 1, con `vault_ready|t`, perché i segreti di
  prova restano nel Vault locale;
- `sharing-check.mjs`: `<N> controlli superati, 0 falliti.` con lo stesso `<N>` del Task 1.

Ora ogni scrittura di `sharing-check.mjs` che fa scattare una push chiama un Worker finto già
chiuso. Le richieste di `pg_net` falliscono dopo il commit e le scritture riescono lo stesso: è la
prova che un Worker irraggiungibile non blocca nulla.

- [ ] **Passo 6: commit** (dopo il via dell'utente)

```bash
git add scripts/supabase/people-check.mjs scripts/supabase/local-stack.md
git commit -m "feat(people): local-stack check for person search, account invites, migration and push triggers" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Alla fine delle prove (anche dopo il Task 11), dalla radice del worktree:

```bash
supabase stop --workdir .cache/ai/supabase-sharing --no-backup
```

## Fase 2 — Worker `POST /push`

Il database non parla direttamente con i servizi push di Google, Apple e Mozilla: chiama con
`pg_net` il Worker `studyos-agent` (`POST /push`, formato fissato nella tabella Interfacce), che cifra ogni
messaggio per il dispositivo (RFC 8291, `aes128gcm`), lo firma con VAPID (RFC 8292, ES256) e lo
consegna. Tutto con la sola WebCrypto: niente librerie npm (`web-push` richiede i moduli di Node,
che il Worker non abilita) e lo stesso codice gira nei test con `node --test`.

Valori di questa fase, mai nel repository (lo script del Task 4 genera i primi due e stampa i
comandi per impostarli tutti):

| Nome | Dove | Contenuto |
| --- | --- | --- |
| `STUDYOS_PUSH_SECRET` | secret del Worker + Vault `studyos_push_secret` | 32 byte casuali in base64url |
| `STUDYOS_VAPID_PRIVATE_KEY` | solo secret del Worker | scalare `d` P-256 (32 byte) in base64url |
| `STUDYOS_SUPABASE_URL` | secret del Worker | `https://kobmoygkwzlprhgfkzwh.supabase.co` |
| `STUDYOS_SUPABASE_KEY` | secret del Worker | chiave `sb_publishable_…` (solo per `push_gone`) |
| `studyos_push_url` | Vault | `https://studyos-agent.nexify-api.workers.dev/push` |

La chiave pubblica VAPID è pubblica: sta in `src/lib/pushKeys.ts` e va nel commit.

### Task 3: cifratura `aes128gcm` (RFC 8291) e firma VAPID (RFC 8292) in `worker/webPush.ts`

**File:**
- Create: `tests/fixtures/pushReceiver.mjs` (lato dispositivo, solo per i test)
- Create: `tests/webPush.test.mjs`
- Create: `worker/webPush.ts`

**Interfaces:**
- Produces (nomi della tabella Interfacce, usati dal Task 4):
  - `encryptPayload(plaintext: Uint8Array, p256dh: string, auth: string): Promise<Uint8Array>` — sale e chiave ECDH nuovi a ogni messaggio, un solo record, delimitatore `0x02`, `rs` 4096; corpo = intestazione di 86 byte + testo cifrato;
  - `vapidAuthorization(endpoint, publicKey, privateKey, subject, nowSeconds?): Promise<string>` → `vapid t=<JWT>, k=<chiave pubblica>`; JWT `{"typ":"JWT","alg":"ES256"}` / `{aud: origine dell'endpoint, exp: now + 12 h, sub}`;
  - `sendWebPush(sub, payload, opts): Promise<{ status: number }>` — intestazioni `TTL: 86400`, `Urgency: normal`, `Topic` (se `opts.topic`), `Content-Encoding: aes128gcm`, `Authorization: vapid …`;
  - interni esportati per test e Worker: `toBase64Url`, `fromBase64Url`, `importEcPrivateKey(publicKey, privateKey, "ECDH" | "ECDSA")`, `encryptPayloadWith(plaintext, p256dh, auth, salt, sender)` (sale e chiavi del mittente iniettati: serve per i vettori dell'RFC), `pushTopic(tag)`; tipi `WebPushSubscription`, `WebPushOptions`, `SenderKeys`; costanti `RECORD_SIZE`, `MAX_PLAINTEXT_BYTES` (3993), `PUSH_TTL_SECONDS`, `VAPID_EXPIRY_SECONDS`, `PUSH_TIMEOUT_MS`.
- Consumes: solo le globali `crypto.subtle`, `btoa`/`atob`, `fetch`, `AbortSignal.timeout` (Workers e Node ≥ 20).

Scelte fissate qui:
- Le chiavi private P-256 arrivano come scalare `d`; WebCrypto non importa chiavi private in
  formato `raw`, quindi si passa da JWK con `x`/`y` presi dalla chiave pubblica di 65 byte.
- `Topic` (RFC 8030) ammette al massimo 32 caratteri base64url, mentre i tag degli eventi hanno `:`
  e sono più lunghi (`group-join:<gruppo>:<utente>`): il Topic è l'inizio dello SHA-256 del tag in
  base64url. Stesso tag, stesso Topic; il `tag` originale resta nel messaggio per il service worker.
- `exp` del JWT a 12 ore (il massimo è 24): margine per orologi sfasati dei servizi push.

- [ ] **Passo 1: crea l'aiuto lato dispositivo `tests/fixtures/pushReceiver.mjs`**

Decifra come farebbe il browser, scritto in modo indipendente da `worker/webPush.ts`: i test non
si limitano a rileggere ciò che il Worker stesso ha calcolato. Non finisce in `npm test` (il glob è
`tests/*.test.mjs`).

```js
// Lato dispositivo di una Web Push (RFC 8291), scritto a parte da worker/webPush.ts:
// serve ai test per decifrare ciò che il Worker invia. Solo WebCrypto.

const encoder = new TextEncoder();

export const b64u = (bytes) => Buffer.from(bytes).toString("base64url");
export const unb64u = (text) => new Uint8Array(Buffer.from(text, "base64url"));

const join = (...parts) => {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
};

const hkdf = async (salt, ikm, info, length) => {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, length * 8));
};

/** Un dispositivo iscritto: chiavi ECDH P-256 e segreto `auth` come li dà `PushSubscription.toJSON()`. */
export async function makeReceiver() {
  const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const publicKey = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  const auth = crypto.getRandomValues(new Uint8Array(16));
  return { privateKey: pair.privateKey, publicKey, p256dh: b64u(publicKey), auth: b64u(auth) };
}

/** Decifra un corpo aes128gcm a record singolo; restituisce il testo e i campi dell'intestazione. */
export async function decryptPush(body, receiver) {
  const bytes = new Uint8Array(body);
  const salt = bytes.slice(0, 16);
  const recordSize = new DataView(bytes.buffer, bytes.byteOffset).getUint32(16);
  const idLength = bytes[20];
  const asPublic = bytes.slice(21, 21 + idLength);
  const record = bytes.slice(21 + idLength);
  const asKey = await crypto.subtle.importKey("raw", asPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: asKey }, receiver.privateKey, 256));
  const ikm = await hkdf(unb64u(receiver.auth), ecdh, join(encoder.encode("WebPush: info\0"), receiver.publicKey, asPublic), 32);
  const cek = await hkdf(salt, ikm, encoder.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, encoder.encode("Content-Encoding: nonce\0"), 12);
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]);
  const padded = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce, tagLength: 128 }, key, record));
  return {
    text: new TextDecoder().decode(padded.slice(0, -1)),
    delimiter: padded[padded.length - 1],
    recordSize,
    idLength,
    headerLength: 21 + idLength
  };
}
```

- [ ] **Passo 2: scrivi il test che fallisce `tests/webPush.test.mjs`**

I vettori vengono da RFC 8291, sezione 5 e appendice A
(<https://www.rfc-editor.org/rfc/rfc8291.txt>), con spazi e a capo tolti. Il corpo atteso è
quello della sezione 5; l'intestazione e il testo cifrato sono quelli dell'appendice A.

```js
import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_PLAINTEXT_BYTES,
  encryptPayload,
  encryptPayloadWith,
  fromBase64Url,
  importEcPrivateKey,
  pushTopic,
  sendWebPush,
  toBase64Url,
  vapidAuthorization
} from "../worker/webPush.ts";
import { b64u, decryptPush, makeReceiver, unb64u } from "./fixtures/pushReceiver.mjs";

// RFC 8291, sezione 5 e appendice A (https://www.rfc-editor.org/rfc/rfc8291.txt), spazi e a capo tolti.
const RFC = {
  plaintext: "When I grow up, I want to be a watermelon",
  authSecret: "BTBZMqHH6r4Tts7J_aSIgg",
  salt: "DGv6ra1nlYgDCS1FRnbzlw",
  uaPublic: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  uaPrivate: "q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94",
  asPublic: "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
  asPrivate: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
  header: "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
  ciphertext: "8pfeW0KbunFT06SuDKoJH9Ql87S1QUrdirN6GcG7sFz1y1sqLgVi1VhjVkHsUoEsbI_0LpXMuGvnzQ",
  body:
    "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml" +
    "mlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPT" +
    "pK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN"
};

const SUBJECT = "https://massimilianociconte.github.io/StudyOS/";

const vapidKeys = async () => {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const publicKey = b64u(new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey)));
  const { d } = await crypto.subtle.exportKey("jwk", pair.privateKey);
  return { publicKey, privateKey: d };
};

test("base64url: andata e ritorno, niente padding, rifiuta caratteri estranei", () => {
  const bytes = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255]);
  assert.equal(toBase64Url(bytes), b64u(bytes));
  assert.deepEqual(fromBase64Url(toBase64Url(bytes)), bytes);
  assert.deepEqual(fromBase64Url("_-8="), unb64u("_-8"));
  assert.equal(toBase64Url(new Uint8Array(70_000)).length, Math.ceil((70_000 * 4) / 3));
  assert.throws(() => fromBase64Url("ab+/"), /base64url non valido/);
  assert.throws(() => fromBase64Url("abcde"), /base64url non valido/);
});

test("RFC 8291 sezione 5: con sale e chiavi dell'esempio il corpo è identico byte per byte", async () => {
  const sender = {
    publicKey: fromBase64Url(RFC.asPublic),
    privateKey: await importEcPrivateKey(RFC.asPublic, RFC.asPrivate, "ECDH")
  };
  const body = await encryptPayloadWith(new TextEncoder().encode(RFC.plaintext), RFC.uaPublic, RFC.authSecret, fromBase64Url(RFC.salt), sender);
  // 86 di intestazione + 41 di testo + 1 delimitatore + 16 di tag. Il "Content-Length: 145"
  // dell'esempio è un refuso dell'RFC: il corpo base64url che riporta decodifica in 144 byte.
  assert.equal(body.length, 144);
  assert.equal(toBase64Url(body.subarray(0, 86)), RFC.header);
  assert.equal(toBase64Url(body.subarray(86)), RFC.ciphertext);
  assert.equal(toBase64Url(body), RFC.body);
});

test("encryptPayload: sale e chiave nuovi a ogni messaggio, il destinatario decifra", async () => {
  const receiver = {
    privateKey: await importEcPrivateKey(RFC.uaPublic, RFC.uaPrivate, "ECDH"),
    publicKey: fromBase64Url(RFC.uaPublic),
    p256dh: RFC.uaPublic,
    auth: RFC.authSecret
  };
  const plaintext = new TextEncoder().encode(JSON.stringify({ kind: "invite", title: "Giulia ti invita", body: "Biochimica", url: "?apri=notifiche", tag: "group-invite:g1" }));
  const first = await encryptPayload(plaintext, RFC.uaPublic, RFC.authSecret);
  const second = await encryptPayload(plaintext, RFC.uaPublic, RFC.authSecret);
  assert.equal(first.length, 86 + plaintext.length + 1 + 16);
  assert.notDeepEqual(first.subarray(0, 16), second.subarray(0, 16));
  assert.notDeepEqual(first.subarray(21, 86), second.subarray(21, 86));
  const opened = await decryptPush(first, receiver);
  assert.equal(opened.recordSize, 4096);
  assert.equal(opened.idLength, 65);
  assert.equal(opened.delimiter, 2);
  assert.equal(opened.text, new TextDecoder().decode(plaintext));
});

test("encryptPayload: rifiuta testi oltre 3993 byte e chiavi malformate", async () => {
  const receiver = await makeReceiver();
  await encryptPayload(new Uint8Array(MAX_PLAINTEXT_BYTES), receiver.p256dh, receiver.auth);
  await assert.rejects(encryptPayload(new Uint8Array(MAX_PLAINTEXT_BYTES + 1), receiver.p256dh, receiver.auth), /3993/);
  await assert.rejects(encryptPayload(new Uint8Array(1), receiver.p256dh.slice(0, 40), receiver.auth), /p256dh/);
  await assert.rejects(encryptPayload(new Uint8Array(1), receiver.p256dh, "AAAA"), /auth/);
  const offCurve = new Uint8Array(65);
  offCurve[0] = 4;
  offCurve[64] = 1;
  await assert.rejects(encryptPayload(new Uint8Array(1), b64u(offCurve), receiver.auth));
});

test("VAPID: JWT ES256 verificabile con la chiave pubblica, aud = origine, exp entro 24 ore", async () => {
  const keys = await vapidKeys();
  const now = 1_800_000_000;
  const header = await vapidAuthorization("https://fcm.googleapis.com/fcm/send/abc:def?x=1", keys.publicKey, keys.privateKey, SUBJECT, now);
  const match = /^vapid t=([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+), k=([A-Za-z0-9_-]+)$/.exec(header);
  assert.ok(match, header);
  const [, rawHeader, rawClaims, rawSignature, k] = match;
  assert.equal(k, keys.publicKey);
  assert.deepEqual(JSON.parse(Buffer.from(rawHeader, "base64url").toString()), { typ: "JWT", alg: "ES256" });
  const claims = JSON.parse(Buffer.from(rawClaims, "base64url").toString());
  assert.deepEqual(claims, { aud: "https://fcm.googleapis.com", exp: now + 43_200, sub: SUBJECT });
  assert.ok(claims.exp - now <= 86_400);

  const signature = unb64u(rawSignature);
  assert.equal(signature.length, 64);
  const verifyKey = await crypto.subtle.importKey("raw", unb64u(keys.publicKey), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  const signed = new TextEncoder().encode(`${rawHeader}.${rawClaims}`);
  assert.equal(await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, verifyKey, signature, signed), true);
  const other = await vapidKeys();
  const otherKey = await crypto.subtle.importKey("raw", unb64u(other.publicKey), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  assert.equal(await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, otherKey, signature, signed), false);
});

test("Topic: al massimo 32 caratteri base64url, stabile per tag, diverso tra tag", async () => {
  const a = await pushTopic("group-join:g-1:7c9e6679-7425-40de-944b-e07fc1f90ae7");
  const b = await pushTopic("group-join:g-1:9b2f7a10-1c3d-4e5f-8a9b-0c1d2e3f4a5b");
  assert.match(a, /^[A-Za-z0-9_-]{32}$/);
  assert.equal(a, await pushTopic("group-join:g-1:7c9e6679-7425-40de-944b-e07fc1f90ae7"));
  assert.notEqual(a, b);
});

test("sendWebPush: intestazioni RFC 8030, VAPID, corpo cifrato e stato del servizio", async (t) => {
  const keys = await vapidKeys();
  const receiver = await makeReceiver();
  const calls = [];
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(null, { status: 201 });
  };
  t.after(() => {
    globalThis.fetch = previousFetch;
  });

  const payload = JSON.stringify({ kind: "accepted", title: "Luca ha accettato", body: "Calendario", url: "?apri=condivisione", tag: "share-accepted:i1" });
  const result = await sendWebPush(
    { endpoint: "https://updates.push.services.mozilla.com/wpush/v2/abc", p256dh: receiver.p256dh, auth: receiver.auth },
    payload,
    { publicKey: keys.publicKey, privateKey: keys.privateKey, subject: SUBJECT, topic: "share-accepted:i1" }
  );
  assert.deepEqual(result, { status: 201 });
  assert.equal(calls.length, 1);
  const { url, init } = calls[0];
  assert.equal(url, "https://updates.push.services.mozilla.com/wpush/v2/abc");
  assert.equal(init.method, "POST");
  assert.equal(init.headers.ttl, "86400");
  assert.equal(init.headers.urgency, "normal");
  assert.equal(init.headers["content-encoding"], "aes128gcm");
  assert.equal(init.headers.topic, await pushTopic("share-accepted:i1"));
  assert.match(init.headers.authorization, new RegExp(`^vapid t=[^,]+, k=${keys.publicKey}$`));
  assert.equal((await decryptPush(init.body, receiver)).text, payload);
});

test("sendWebPush: senza tag niente Topic", async (t) => {
  const keys = await vapidKeys();
  const receiver = await makeReceiver();
  let headers = null;
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    headers = init.headers;
    return new Response(null, { status: 410 });
  };
  t.after(() => {
    globalThis.fetch = previousFetch;
  });
  const result = await sendWebPush({ endpoint: "https://web.push.apple.com/QGx", p256dh: receiver.p256dh, auth: receiver.auth }, "{}", {
    publicKey: keys.publicKey,
    privateKey: keys.privateKey,
    subject: SUBJECT
  });
  assert.deepEqual(result, { status: 410 });
  assert.equal("topic" in headers, false);
});
```

- [ ] **Passo 3: esegui il test e verifica che fallisca**

Run: `node --import ./scripts/lib/register-ts.mjs --test tests/webPush.test.mjs`
Expected: FAIL con `Error [ERR_MODULE_NOT_FOUND]: Cannot find module '.../worker/webPush.ts'`.

- [ ] **Passo 4: crea `worker/webPush.ts`**

```ts
// Web Push con sola WebCrypto (Cloudflare Workers e Node >= 20, nessuna dipendenza).
// - Cifratura del messaggio: RFC 8291 (aes128gcm di RFC 8188, un solo record).
// - Identità del server: RFC 8292 (VAPID, JWT ES256).
// - Intestazioni di consegna: RFC 8030 (TTL, Urgency, Topic).

type Bytes = Uint8Array<ArrayBuffer>;

export type WebPushSubscription = { endpoint: string; p256dh: string; auth: string };
export type WebPushOptions = { publicKey: string; privateKey: string; subject: string; topic?: string };
export type SenderKeys = { publicKey: Uint8Array; privateKey: CryptoKey };

/** Dimensione del record dichiarata nell'intestazione (RFC 8291 §4). */
export const RECORD_SIZE = 4096;
/** 4096 - 86 (intestazione) - 1 (delimitatore) - 16 (tag AES-GCM). */
export const MAX_PLAINTEXT_BYTES = 3993;
/** Le push valgono 24 ore: chi è spento più a lungo non riceve notifiche vecchie. */
export const PUSH_TTL_SECONDS = 86_400;
/** Scadenza del JWT VAPID: 12 ore, metà del massimo ammesso (24 ore) per tollerare orologi sfasati. */
export const VAPID_EXPIRY_SECONDS = 43_200;
/** Una richiesta al servizio push che non risponde entro 10 s conta come fallita. */
export const PUSH_TIMEOUT_MS = 10_000;

const encoder = new TextEncoder();
const BASE64URL = /^[A-Za-z0-9_-]*$/;

export const toBase64Url = (bytes: Uint8Array): string => {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

export const fromBase64Url = (text: string): Bytes => {
  const clean = text.replace(/=+$/, "");
  if (!BASE64URL.test(clean) || clean.length % 4 === 1) throw new Error("base64url non valido");
  const binary = atob(clean.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (clean.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
};

const concat = (...parts: Uint8Array[]): Bytes => {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
};

const p256Point = (value: string, what: string): Bytes => {
  const point = fromBase64Url(value);
  if (point.length !== 65 || point[0] !== 4) throw new Error(`${what}: serve un punto P-256 non compresso di 65 byte`);
  return point;
};

/**
 * Importa una chiave privata P-256 dal solo scalare `d` (base64url, 32 byte) più la sua chiave
 * pubblica: WebCrypto non accetta il formato "raw" per le chiavi private, quindi passa da JWK.
 */
export async function importEcPrivateKey(publicKey: string, privateKey: string, algorithm: "ECDH" | "ECDSA"): Promise<CryptoKey> {
  const point = p256Point(publicKey, "Chiave pubblica");
  const d = fromBase64Url(privateKey);
  if (d.length !== 32) throw new Error("Chiave privata: servono 32 byte");
  const jwk: JsonWebKey = {
    kty: "EC",
    crv: "P-256",
    x: toBase64Url(point.subarray(1, 33)),
    y: toBase64Url(point.subarray(33, 65)),
    d: toBase64Url(d)
  };
  return crypto.subtle.importKey("jwk", jwk, { name: algorithm, namedCurve: "P-256" }, false, algorithm === "ECDSA" ? ["sign"] : ["deriveBits"]);
}

async function hkdf(salt: Bytes, ikm: Bytes, info: Bytes, length: number): Promise<Bytes> {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, length * 8));
}

/**
 * Cifratura RFC 8291 con sale e chiavi del mittente dati. Uso interno e test con i vettori
 * dell'RFC: in produzione passa da `encryptPayload`, che li genera nuovi a ogni messaggio.
 */
export async function encryptPayloadWith(
  plaintext: Uint8Array,
  p256dh: string,
  auth: string,
  salt: Uint8Array,
  sender: SenderKeys
): Promise<Bytes> {
  if (plaintext.length > MAX_PLAINTEXT_BYTES) throw new Error(`Messaggio push oltre ${MAX_PLAINTEXT_BYTES} byte`);
  if (salt.length !== 16) throw new Error("Il sale deve essere di 16 byte");
  const uaPublic = p256Point(p256dh, "p256dh");
  const asPublic = concat(sender.publicKey);
  if (asPublic.length !== 65 || asPublic[0] !== 4) throw new Error("Chiave pubblica del mittente non valida");
  const authSecret = fromBase64Url(auth);
  if (authSecret.length !== 16) throw new Error("auth: servono 16 byte");

  // importKey "raw" verifica che il punto stia sulla curva (RFC 8291 §7).
  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, sender.privateKey, 256));

  // RFC 8291 §3.3-3.4: segreto di autenticazione + ECDH -> IKM; poi CEK e nonce di RFC 8188.
  const keyInfo = concat(encoder.encode("WebPush: info"), new Uint8Array([0]), uaPublic, asPublic);
  const ikm = await hkdf(authSecret, ecdhSecret, keyInfo, 32);
  const saltBytes = concat(salt);
  const cek = await hkdf(saltBytes, ikm, concat(encoder.encode("Content-Encoding: aes128gcm"), new Uint8Array([0])), 16);
  const nonce = await hkdf(saltBytes, ikm, concat(encoder.encode("Content-Encoding: nonce"), new Uint8Array([0])), 12);

  // Un solo record: testo + delimitatore 0x02 (ultimo record), nessun riempimento.
  const aesKey = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const record = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, tagLength: 128 }, aesKey, concat(plaintext, new Uint8Array([2])))
  );

  // Intestazione aes128gcm: salt(16) | rs(4, big endian) | idlen(1) | keyid(65) = 86 byte.
  const header = new Uint8Array(86);
  header.set(saltBytes, 0);
  new DataView(header.buffer).setUint32(16, RECORD_SIZE);
  header[20] = 65;
  header.set(asPublic, 21);
  return concat(header, record);
}

/** Cifra `plaintext` per l'iscrizione (`p256dh`, `auth` in base64url) con chiavi e sale nuovi. */
export async function encryptPayload(plaintext: Uint8Array, p256dh: string, auth: string): Promise<Uint8Array<ArrayBuffer>> {
  const pair = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
  const publicKey = new Uint8Array((await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return encryptPayloadWith(plaintext, p256dh, auth, salt, { publicKey, privateKey: pair.privateKey });
}

/**
 * Valore completo dell'intestazione Authorization VAPID (RFC 8292):
 * `vapid t=<JWT ES256>, k=<chiave pubblica base64url>`; `aud` è l'origine dell'endpoint.
 */
export async function vapidAuthorization(
  endpoint: string,
  publicKey: string,
  privateKey: string,
  subject: string,
  nowSeconds: number = Math.floor(Date.now() / 1000)
): Promise<string> {
  const aud = new URL(endpoint).origin;
  const part = (value: unknown) => toBase64Url(encoder.encode(JSON.stringify(value)));
  const unsigned = `${part({ typ: "JWT", alg: "ES256" })}.${part({ aud, exp: nowSeconds + VAPID_EXPIRY_SECONDS, sub: subject })}`;
  const key = await importEcPrivateKey(publicKey, privateKey, "ECDSA");
  // WebCrypto firma ECDSA nel formato r||s (64 byte), lo stesso che vuole JWS.
  const signature = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, encoder.encode(unsigned)));
  return `vapid t=${unsigned}.${toBase64Url(signature)}, k=${publicKey}`;
}

/**
 * Topic RFC 8030: al massimo 32 caratteri base64url. I tag degli eventi (`group-invite:<id>`)
 * hanno `:` e sono più lunghi: si usa l'inizio del loro SHA-256, stabile e senza collisioni pratiche.
 */
export async function pushTopic(tag: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(tag)));
  return toBase64Url(digest).slice(0, 32);
}

/** Cifra, firma e consegna una push. Restituisce lo stato HTTP del servizio push (201 = accettata). */
export async function sendWebPush(sub: WebPushSubscription, payload: string, opts: WebPushOptions): Promise<{ status: number }> {
  const body = await encryptPayload(encoder.encode(payload), sub.p256dh, sub.auth);
  const headers: Record<string, string> = {
    authorization: await vapidAuthorization(sub.endpoint, opts.publicKey, opts.privateKey, opts.subject),
    "content-encoding": "aes128gcm",
    "content-type": "application/octet-stream",
    ttl: String(PUSH_TTL_SECONDS),
    urgency: "normal"
  };
  if (opts.topic) headers.topic = await pushTopic(opts.topic);
  const response = await fetch(sub.endpoint, {
    method: "POST",
    headers,
    body,
    signal: AbortSignal.timeout(PUSH_TIMEOUT_MS)
  });
  await response.body?.cancel();
  return { status: response.status };
}
```

- [ ] **Passo 5: esegui i test e il typecheck**

Run: `node --import ./scripts/lib/register-ts.mjs --test tests/webPush.test.mjs`
Expected: PASS (8 test). In particolare `RFC 8291 sezione 5: … identico byte per byte` riproduce
`DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z…Qulcy4a-fN` (144 byte).

Run: `npm test && npm run lint`
Expected: PASS (8 test in più rispetto a prima del task: 257 se i Task 1–2 non ne hanno aggiunti),
nessun errore TypeScript. `npm run lint` controlla solo `src/` (`tsconfig.json` include `src`): il
codice di `worker/` usa solo tipi DOM standard e lo bundla wrangler al Task 4.

- [ ] **Passo 6: commit** (dopo il via dell'utente)

```bash
git add worker/webPush.ts tests/webPush.test.mjs tests/fixtures/pushReceiver.mjs
git commit -m "feat(push): Web Push encryption (RFC 8291) and VAPID signing (RFC 8292) with WebCrypto" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 4: route `POST /push`, chiavi VAPID e collegamento al Worker

**File:**
- Create: `tests/pushRoute.test.mjs`
- Create: `scripts/push-keys.mjs`
- Create: `src/lib/pushKeys.ts` (lo scrive `scripts/push-keys.mjs`, eseguito dall'utente)
- Create: `worker/push.ts`
- Modify: `worker/index.ts` (import, `Env`, `fetch` di default)

**Interfaces:**
- Produces:
  - `src/lib/pushKeys.ts`: `export const VAPID_PUBLIC_KEY = "B…"` (base64url, punto P-256 non compresso di 65 byte, 87 caratteri), letto dal Worker e dal client (Task 8);
  - `worker/push.ts`: `handlePush(request: Request, env: PushEnv, publicKey?: string): Promise<Response>` (il terzo argomento, predefinito `VAPID_PUBLIC_KEY`, serve solo ai test), `interface PushEnv { STUDYOS_PUSH_SECRET?; STUDYOS_VAPID_PRIVATE_KEY?; STUDYOS_SUPABASE_URL?; STUDYOS_SUPABASE_KEY? }`, `parseNotification`, `parseSubscription`, `VAPID_SUBJECT`, `MAX_PUSH_BODY_BYTES` (65536), `MAX_PUSH_SUBSCRIPTIONS` (50), `PUSH_CONCURRENCY` (6), `MAX_TITLE_CHARS` (120), `MAX_BODY_CHARS` (400);
  - risposte di `POST /push`: 405 (altro metodo, `allow: POST`), 503 `{"error":"Push non configurate"}` (manca un secret), 401 (segreto assente o errato), 413 (corpo oltre 64 kB), 400 (JSON, notifica o elenco non validi, più di 50 iscrizioni), 200 `{ "sent": n, "gone": m }`;
  - `node scripts/push-keys.mjs [--worker <origine https>] [--rigenera] [--file <percorso>]`.
- Consumes:
  - Task 3: `sendWebPush`, `WebPushSubscription` (e `pushTopic` nei test);
  - Task 1: RPC `push_gone(p_secret text, p_endpoints text[]) returns integer`, eseguibile da `anon`;
  - formato della tabella Interfacce: `{ notification: {kind, title, body, url, tag}, subscriptions: [{endpoint, p256dh, auth}] }` con intestazione `x-studyos-push-secret`.

Regole di `POST /push`:
- prima metodo, configurazione e segreto (confronto a tempo costante sugli SHA-256), poi il corpo,
  letto a pezzi e interrotto oltre 64 kB;
- `kind` fra `invite`, `accepted`, `permission`; `url` come `?apri=<parola>`; `tag` ASCII
  stampabile senza spazi, al massimo 200 caratteri; titolo non vuoto accorciato a 120 caratteri,
  testo a 400 (mai più dei 3993 byte cifrabili). Il messaggio cifrato è
  `JSON.stringify({kind, title, body, url, tag})`, senza altri campi;
- le iscrizioni malformate (endpoint non `https`, con credenziali o oltre 2048 caratteri; `p256dh`
  diverso da 87 caratteri base64url; `auth` diverso da 22) si saltano, i doppioni partono una volta;
- invii in parallelo, 6 alla volta (il limite di connessioni in uscita di Workers), timeout 10 s;
- 2xx = inviata; 404/410 = scaduta → `push_gone`; altro (anche 403, chiave VAPID sbagliata) =
  fallita, senza cancellare nulla;
- `push_gone` solo se `STUDYOS_SUPABASE_URL` e `STUDYOS_SUPABASE_KEY` ci sono, con la sola
  intestazione `apikey` (chiave publishable) e il segreto nel corpo; un suo errore non cambia la
  risposta;
- log: una riga di conteggi (`total`, `sent`, `gone`, `failed`, `skipped`, `removed`, `statuses`
  per codice HTTP), mai titoli, testi, endpoint o segreti.

- [ ] **Passo 1: scrivi il test che fallisce `tests/pushRoute.test.mjs`**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { MAX_BODY_CHARS, MAX_PUSH_BODY_BYTES, MAX_TITLE_CHARS, PUSH_CONCURRENCY, VAPID_SUBJECT, handlePush, parseNotification } from "../worker/push.ts";
import { VAPID_PUBLIC_KEY } from "../src/lib/pushKeys.ts";
import { pushTopic } from "../worker/webPush.ts";
import { b64u, decryptPush, makeReceiver } from "./fixtures/pushReceiver.mjs";

const SECRET = "segreto-di-prova-0123456789abcdefghijklmnop";
const SUPABASE = "http://127.0.0.1:55421";
const NOTIFICATION = {
  kind: "invite",
  title: "Giulia ti ha invitato",
  body: "Gruppo Biochimica",
  url: "?apri=notifiche",
  tag: "group-invite:inv-1"
};

const vapid = (async () => {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const publicKey = b64u(new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey)));
  const { d } = await crypto.subtle.exportKey("jwk", pair.privateKey);
  return { publicKey, privateKey: d };
})();

const envFor = async (extra = {}) => ({
  STUDYOS_PUSH_SECRET: SECRET,
  STUDYOS_VAPID_PRIVATE_KEY: (await vapid).privateKey,
  STUDYOS_SUPABASE_URL: SUPABASE,
  STUDYOS_SUPABASE_KEY: "sb_publishable_prova",
  ...extra
});

const pushRequest = (body, headers = {}) =>
  new Request("https://studyos-agent.esempio.workers.dev/push", {
    method: "POST",
    headers: { "content-type": "application/json", "x-studyos-push-secret": SECRET, ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body)
  });

const subscriptionOf = async (endpoint) => {
  const receiver = await makeReceiver();
  return { receiver, row: { endpoint, p256dh: receiver.p256dh, auth: receiver.auth } };
};

/** Sostituisce fetch: `respond(url, init)` decide la risposta; registra chiamate e parallelismo. */
const stubFetch = (t, respond) => {
  const calls = [];
  const state = { inFlight: 0, maxInFlight: 0 };
  const previous = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    state.inFlight += 1;
    state.maxInFlight = Math.max(state.maxInFlight, state.inFlight);
    try {
      return await respond(String(url), init);
    } finally {
      state.inFlight -= 1;
    }
  };
  t.after(() => {
    globalThis.fetch = previous;
  });
  return { calls, state };
};

const quietConsole = (t) => {
  const lines = [];
  const previousLog = console.log;
  const previousWarn = console.warn;
  console.log = (...args) => lines.push(args.join(" "));
  console.warn = (...args) => lines.push(args.join(" "));
  t.after(() => {
    console.log = previousLog;
    console.warn = previousWarn;
  });
  return lines;
};

test("chiave pubblica VAPID: punto P-256 non compresso di 65 byte", () => {
  const bytes = Buffer.from(VAPID_PUBLIC_KEY, "base64url");
  assert.match(VAPID_PUBLIC_KEY, /^[A-Za-z0-9_-]{87}$/);
  assert.equal(bytes.length, 65);
  assert.equal(bytes[0], 4);
});

test("/push: metodo, segreto e configurazione prima di tutto, senza chiamare la rete", async (t) => {
  const { calls } = stubFetch(t, async () => new Response(null, { status: 201 }));
  const { publicKey } = await vapid;
  const env = await envFor();
  const body = { notification: NOTIFICATION, subscriptions: [] };

  const get = await handlePush(new Request("https://studyos-agent.esempio.workers.dev/push"), env, publicKey);
  assert.equal(get.status, 405);
  assert.equal(get.headers.get("allow"), "POST");

  assert.equal((await handlePush(pushRequest(body, { "x-studyos-push-secret": "" }), env, publicKey)).status, 401);
  assert.equal((await handlePush(pushRequest(body, { "x-studyos-push-secret": `${SECRET}x` }), env, publicKey)).status, 401);
  assert.equal((await handlePush(pushRequest(body, { "x-studyos-push-secret": SECRET.slice(0, -1) }), env, publicKey)).status, 401);
  assert.equal((await handlePush(pushRequest(body), await envFor({ STUDYOS_PUSH_SECRET: "" }), publicKey)).status, 503);
  assert.equal((await handlePush(pushRequest(body), await envFor({ STUDYOS_VAPID_PRIVATE_KEY: undefined }), publicKey)).status, 503);

  const empty = await handlePush(pushRequest(body), env, publicKey);
  assert.equal(empty.status, 200);
  assert.deepEqual(await empty.json(), { sent: 0, gone: 0 });
  assert.equal(calls.length, 0);
});

test("/push: corpo oltre 64 kB, JSON rotto, notifica non valida, più di 50 iscrizioni", async (t) => {
  const { calls } = stubFetch(t, async () => new Response(null, { status: 201 }));
  const { publicKey } = await vapid;
  const env = await envFor();
  const huge = JSON.stringify({ notification: NOTIFICATION, subscriptions: [], pad: "x".repeat(MAX_PUSH_BODY_BYTES) });
  assert.equal((await handlePush(pushRequest(huge), env, publicKey)).status, 413);
  assert.equal((await handlePush(pushRequest("{non json"), env, publicKey)).status, 400);
  for (const notification of [
    { ...NOTIFICATION, kind: "chat" },
    { ...NOTIFICATION, title: " " },
    { ...NOTIFICATION, body: 3 },
    { ...NOTIFICATION, url: "https://evil.example" },
    { ...NOTIFICATION, tag: "con spazi" },
    null
  ]) {
    assert.equal((await handlePush(pushRequest({ notification, subscriptions: [] }), env, publicKey)).status, 400, JSON.stringify(notification));
  }
  assert.equal((await handlePush(pushRequest({ notification: NOTIFICATION }), env, publicKey)).status, 400);
  const { row } = await subscriptionOf("https://fcm.googleapis.com/fcm/send/a");
  const tooMany = Array.from({ length: 51 }, (_, index) => ({ ...row, endpoint: `https://fcm.googleapis.com/fcm/send/${index}` }));
  assert.equal((await handlePush(pushRequest({ notification: NOTIFICATION, subscriptions: tooMany }), env, publicKey)).status, 400);
  assert.equal(calls.length, 0);
});

test("notifica: solo i cinque campi, testi lunghi accorciati senza spezzare le emoji", () => {
  const parsed = parseNotification({ ...NOTIFICATION, title: "😀".repeat(500), body: "b".repeat(5000), extra: "no" });
  assert.deepEqual(Object.keys(parsed), ["kind", "title", "body", "url", "tag"]);
  assert.equal(parsed.title, "😀".repeat(MAX_TITLE_CHARS));
  assert.equal(parsed.body.length, MAX_BODY_CHARS);
  assert.equal(parseNotification({ ...NOTIFICATION, url: "?apri=gruppi" }).url, "?apri=gruppi");
});

test("/push: cifra per ogni dispositivo, conta 201, raccoglie 404/410 e li manda a push_gone", async (t) => {
  const { publicKey } = await vapid;
  const ok = await subscriptionOf("https://fcm.googleapis.com/fcm/send/ok");
  const expired = await subscriptionOf("https://updates.push.services.mozilla.com/wpush/v2/expired");
  const missing = await subscriptionOf("https://web.push.apple.com/missing");
  const broken = await subscriptionOf("https://fcm.googleapis.com/fcm/send/broken");
  const status = {
    "https://fcm.googleapis.com/fcm/send/ok": 201,
    "https://updates.push.services.mozilla.com/wpush/v2/expired": 410,
    "https://web.push.apple.com/missing": 404,
    "https://fcm.googleapis.com/fcm/send/broken": 500
  };
  const { calls } = stubFetch(t, async (url) => {
    if (url === `${SUPABASE}/rest/v1/rpc/push_gone`) return Response.json(2);
    return new Response(null, { status: status[url] });
  });
  const lines = quietConsole(t);

  const response = await handlePush(
    pushRequest({ notification: NOTIFICATION, subscriptions: [ok.row, expired.row, missing.row, broken.row, ok.row] }),
    await envFor(),
    publicKey
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { sent: 1, gone: 2 });

  const pushes = calls.filter((call) => call.url !== `${SUPABASE}/rest/v1/rpc/push_gone`);
  assert.equal(pushes.length, 4, "l'endpoint ripetuto parte una volta sola");
  const first = pushes.find((call) => call.url === ok.row.endpoint);
  assert.equal(first.init.headers.ttl, "86400");
  assert.equal(first.init.headers.urgency, "normal");
  assert.equal(first.init.headers["content-encoding"], "aes128gcm");
  assert.equal(first.init.headers.topic, await pushTopic(NOTIFICATION.tag));
  assert.match(first.init.headers.authorization, new RegExp(`^vapid t=[^,]+, k=${publicKey}$`));
  const claims = JSON.parse(Buffer.from(first.init.headers.authorization.split(" t=")[1].split(".")[1], "base64url").toString());
  assert.equal(claims.sub, VAPID_SUBJECT);
  assert.equal(claims.aud, "https://fcm.googleapis.com");
  assert.equal((await decryptPush(first.init.body, ok.receiver)).text, JSON.stringify(NOTIFICATION));

  const gone = calls.filter((call) => call.url === `${SUPABASE}/rest/v1/rpc/push_gone`);
  assert.equal(gone.length, 1);
  assert.equal(gone[0].init.method, "POST");
  assert.equal(gone[0].init.headers.apikey, "sb_publishable_prova");
  assert.equal("authorization" in gone[0].init.headers, false);
  const goneBody = JSON.parse(gone[0].init.body);
  assert.equal(goneBody.p_secret, SECRET);
  assert.deepEqual([...goneBody.p_endpoints].sort(), [expired.row.endpoint, missing.row.endpoint].sort());

  const log = lines.join("\n");
  assert.match(log, /"sent":1/);
  for (const secretish of [NOTIFICATION.title, NOTIFICATION.body, "fcm.googleapis.com", "mozilla", SECRET]) {
    assert.equal(log.includes(secretish), false, `il log non contiene ${secretish}`);
  }
});

test("/push: senza URL o chiave Supabase niente pulizia; iscrizioni malformate e reti in errore saltate", async (t) => {
  const { publicKey } = await vapid;
  const ok = await subscriptionOf("https://fcm.googleapis.com/fcm/send/ok");
  const offline = await subscriptionOf("https://fcm.googleapis.com/fcm/send/offline");
  const { calls } = stubFetch(t, async (url) => {
    if (url.endsWith("/offline")) throw new TypeError("fetch failed");
    return new Response(null, { status: url.endsWith("/ok") ? 201 : 410 });
  });
  quietConsole(t);
  const gone = await subscriptionOf("https://fcm.googleapis.com/fcm/send/gone");
  const subscriptions = [
    ok.row,
    offline.row,
    gone.row,
    { ...ok.row, endpoint: "http://fcm.googleapis.com/fcm/send/plain" },
    { ...ok.row, endpoint: "https://user:pw@fcm.googleapis.com/x" },
    { ...ok.row, p256dh: "corta" },
    { ...ok.row, auth: "non/base64url+====" },
    "stringa",
    null
  ];
  const response = await handlePush(
    pushRequest({ notification: { ...NOTIFICATION, kind: "permission", url: "?apri=condivisione" }, subscriptions }),
    await envFor({ STUDYOS_SUPABASE_KEY: "" }),
    publicKey
  );
  assert.deepEqual(await response.json(), { sent: 1, gone: 1 });
  assert.deepEqual(calls.map((call) => call.url).sort(), [ok.row.endpoint, offline.row.endpoint, gone.row.endpoint].sort());
});

test(`/push: al massimo ${PUSH_CONCURRENCY} invii in parallelo`, async (t) => {
  const { publicKey } = await vapid;
  const rows = [];
  for (let index = 0; index < 20; index += 1) rows.push((await subscriptionOf(`https://fcm.googleapis.com/fcm/send/${index}`)).row);
  const { calls, state } = stubFetch(t, async () => {
    await new Promise((resolve) => setTimeout(resolve, 5));
    return new Response(null, { status: 201 });
  });
  quietConsole(t);
  const response = await handlePush(pushRequest({ notification: NOTIFICATION, subscriptions: rows }), await envFor(), publicKey);
  assert.deepEqual(await response.json(), { sent: 20, gone: 0 });
  assert.equal(calls.length, 20);
  assert.ok(state.maxInFlight > 1, "invia in parallelo");
  assert.ok(state.maxInFlight <= PUSH_CONCURRENCY, `in volo al massimo ${PUSH_CONCURRENCY}, visti ${state.maxInFlight}`);
});
```

- [ ] **Passo 2: esegui il test e verifica che fallisca**

Run: `node --import ./scripts/lib/register-ts.mjs --test tests/pushRoute.test.mjs`
Expected: FAIL con `Error [ERR_MODULE_NOT_FOUND]: Cannot find module '.../worker/push.ts'`.

- [ ] **Passo 3: crea `scripts/push-keys.mjs`**

Genera la coppia VAPID e il segreto, scrive solo la chiave pubblica nel repository e stampa il
resto nel terminale con i comandi pronti. Si rifiuta di sostituire una chiave esistente senza
`--rigenera`: cambiarla rende inutilizzabili tutte le iscrizioni già fatte.

```js
#!/usr/bin/env node
// Genera le chiavi delle notifiche push di StudyOS:
// - coppia VAPID P-256: la pubblica va in src/lib/pushKeys.ts (nel commit), la privata solo nel
//   secret STUDYOS_VAPID_PRIVATE_KEY del Worker;
// - segreto condiviso di 32 byte tra database (Vault `studyos_push_secret`) e Worker
//   (secret STUDYOS_PUSH_SECRET).
// Chiave privata e segreto si stampano SOLO qui nel terminale, insieme ai comandi pronti.
//
// Uso: node scripts/push-keys.mjs [--worker https://studyos-agent.<account>.workers.dev] [--rigenera] [--file <percorso>]
//   --rigenera  sostituisce una chiave già presente (le iscrizioni esistenti smettono di funzionare
//               finché ogni dispositivo non si iscrive di nuovo)
//   --file      scrive altrove (prove con chiavi usa e getta)

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const DEFAULT_WORKER = "https://studyos-agent.nexify-api.workers.dev";
const SUPABASE_URL = "https://kobmoygkwzlprhgfkzwh.supabase.co";
const EXISTING_KEY = /VAPID_PUBLIC_KEY\s*=\s*"([A-Za-z0-9_-]{87})"/;

const { values } = parseArgs({
  options: {
    worker: { type: "string", default: DEFAULT_WORKER },
    file: { type: "string" },
    rigenera: { type: "boolean", default: false }
  }
});

const fail = (message) => {
  console.error(message);
  process.exit(1);
};

let workerOrigin;
try {
  const url = new URL(values.worker);
  if (url.protocol !== "https:" || (url.pathname !== "/" && url.pathname !== "") || url.search || url.hash || url.username) throw new Error();
  workerOrigin = url.origin;
} catch {
  fail(`--worker deve essere un'origine https senza percorso, per esempio ${DEFAULT_WORKER}`);
}

const target = values.file ?? fileURLToPath(new URL("../src/lib/pushKeys.ts", import.meta.url));
if (existsSync(target) && EXISTING_KEY.test(readFileSync(target, "utf8")) && !values.rigenera) {
  fail(
    `${relative(process.cwd(), target)} contiene già una chiave VAPID. Non la cambio: le iscrizioni esistenti smetterebbero di funzionare.\n` +
      "Per sostituirla davvero (e reimpostare tutti i segreti) rilancia con --rigenera."
  );
}

const b64u = (bytes) => Buffer.from(bytes).toString("base64url");

const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const publicKey = b64u(new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey)));
const { d: privateKey } = await crypto.subtle.exportKey("jwk", pair.privateKey);
const pushSecret = b64u(crypto.getRandomValues(new Uint8Array(32)));
const pushUrl = `${workerOrigin}/push`;

if (publicKey.length !== 87 || privateKey.length !== 43 || pushSecret.length !== 43) fail("Generazione delle chiavi non riuscita.");

mkdirSync(dirname(target), { recursive: true });
writeFileSync(
  target,
  `// Chiave pubblica VAPID di StudyOS (RFC 8292): base64url del punto P-256 non compresso (65 byte).
// È pubblica: il browser la usa per iscriversi alle push, il Worker per firmarle.
// La chiave privata sta solo nel secret STUDYOS_VAPID_PRIVATE_KEY del Worker.
// Generata da \`node scripts/push-keys.mjs\` il ${new Date().toISOString().slice(0, 10)}: cambiarla invalida le iscrizioni esistenti.
export const VAPID_PUBLIC_KEY = "${publicKey}";
`
);

const vaultSql = `do $$
declare
  v_id uuid;
begin
  select id into v_id from vault.secrets where name = 'studyos_push_secret';
  if v_id is null then
    perform vault.create_secret('${pushSecret}', 'studyos_push_secret', 'StudyOS: segreto condiviso con il Worker /push');
  else
    perform vault.update_secret(v_id, '${pushSecret}');
  end if;

  select id into v_id from vault.secrets where name = 'studyos_push_url';
  if v_id is null then
    perform vault.create_secret('${pushUrl}', 'studyos_push_url', 'StudyOS: indirizzo del Worker /push');
  else
    perform vault.update_secret(v_id, '${pushUrl}');
  end if;
end
$$;`;

const wrangler = (name) => `   npx wrangler secret put ${name} -c worker/wrangler.jsonc`;

console.log(`StudyOS: chiavi per le notifiche push

Chiave pubblica VAPID scritta in ${relative(process.cwd(), target)} (va nel commit):
  ${publicKey}

Da qui in giù ci sono segreti: non salvarli in file del repository e non incollarli nella chat con l'agente.

  STUDYOS_VAPID_PRIVATE_KEY  ${privateKey}
  STUDYOS_PUSH_SECRET        ${pushSecret}

1) Worker studyos-agent: chiedi il via prima di eseguirli (ognuno pubblica una nuova versione del Worker).
   Ogni comando chiede il valore: incollalo quando lo chiede, così non resta nella cronologia della shell.

   valore: STUDYOS_PUSH_SECRET qui sopra
${wrangler("STUDYOS_PUSH_SECRET")}
   valore: STUDYOS_VAPID_PRIVATE_KEY qui sopra
${wrangler("STUDYOS_VAPID_PRIVATE_KEY")}
   valore: ${SUPABASE_URL}
${wrangler("STUDYOS_SUPABASE_URL")}
   valore: la chiave sb_publishable_ (VITE_SUPABASE_PUBLISHABLE_KEY nel tuo .env), mai la service_role
${wrangler("STUDYOS_SUPABASE_KEY")}

2) Vault del progetto: SQL Editor di Supabase, chiedi il via. Rieseguibile: se il nome esiste aggiorna il valore.

${vaultSql}

Controlla che il Worker risponda su ${pushUrl}: se l'indirizzo è un altro, correggilo nel blocco SQL prima di eseguirlo.`);
```

- [ ] **Passo 4: prova lo script su un file usa e getta**

Chiavi di prova, buttate subito: l'output con i segreti non serve e va in `/dev/null`.

Run: `node scripts/push-keys.mjs --file /tmp/studyos-push-prova/pushKeys.ts > /dev/null`
Expected: nessun output, uscita 0.

Run: `grep -cE '^export const VAPID_PUBLIC_KEY = "B[A-Za-z0-9_-]{86}";$' /tmp/studyos-push-prova/pushKeys.ts`
Expected: `1`.

Run: `node scripts/push-keys.mjs --file /tmp/studyos-push-prova/pushKeys.ts`
Expected: uscita 1 con `… contiene già una chiave VAPID. Non la cambio: le iscrizioni esistenti smetterebbero di funzionare.` e nessun segreto stampato.

Run: `node scripts/push-keys.mjs --file /tmp/studyos-push-prova/pushKeys.ts --rigenera --worker https://studyos-agent.esempio.workers.dev | grep -c "studyos-agent.esempio.workers.dev/push"`
Expected: `3` (due righe del blocco Vault e la riga finale).

Run: `node scripts/push-keys.mjs --file /tmp/studyos-push-prova/pushKeys.ts --rigenera --worker https://studyos-agent.esempio.workers.dev/mcp`
Expected: uscita 1 con `--worker deve essere un'origine https senza percorso, …`.

Run: `rm -r /tmp/studyos-push-prova`

- [ ] **Passo 5: chiave vera — la genera l'utente nel suo terminale**

Chiedi all'utente di eseguire, dalla radice del worktree e nel **suo** terminale (non dalla chat:
chiave privata e segreto non devono passare dall'agente):

```bash
node scripts/push-keys.mjs
```

L'utente conserva `STUDYOS_VAPID_PRIVATE_KEY`, `STUDYOS_PUSH_SECRET` e il blocco SQL stampati (per
esempio nel portachiavi) fino al Passo 9; se li perde, rilancia con `--rigenera` prima del commit di
questo task. Lo script crea `src/lib/pushKeys.ts` secondo il modello nel suo codice: quattro righe
di commento ed `export const VAPID_PUBLIC_KEY = "…"` con 87 caratteri base64url che iniziano con
`B`. L'agente non scrive questo file a mano: una chiave pubblica senza la sua privata nel Worker rende
ogni push un 403. Poi l'agente controlla il file, senza vedere segreti:

Run: `grep -cE '^export const VAPID_PUBLIC_KEY = "B[A-Za-z0-9_-]{86}";$' src/lib/pushKeys.ts`
Expected: `1`.

- [ ] **Passo 6: crea `worker/push.ts`**

```ts
// POST /push: il database (studyos_push_notify via pg_net) chiede di consegnare una notifica a
// un elenco di iscrizioni. Il Worker cifra e firma ogni push, poi segnala a push_gone gli
// endpoint scaduti (404/410). Nessuna service_role: solo la chiave publishable e il segreto
// condiviso. Nei log solo conteggi, mai titoli, testi o endpoint.
import { VAPID_PUBLIC_KEY } from "../src/lib/pushKeys";
import { sendWebPush, type WebPushSubscription } from "./webPush";

export interface PushEnv {
  STUDYOS_PUSH_SECRET?: string;
  STUDYOS_VAPID_PRIVATE_KEY?: string;
  STUDYOS_SUPABASE_URL?: string;
  STUDYOS_SUPABASE_KEY?: string;
}

export type PushNotification = {
  kind: "invite" | "accepted" | "permission";
  title: string;
  body: string;
  url: string;
  tag: string;
};

/** Contatto VAPID: l'URL del sito, nessun dato personale. */
export const VAPID_SUBJECT = "https://massimilianociconte.github.io/StudyOS/";
export const MAX_PUSH_BODY_BYTES = 64 * 1024;
export const MAX_PUSH_SUBSCRIPTIONS = 50;
/** Workers apre al massimo 6 connessioni in uscita alla volta per richiesta: oltre farebbe solo coda. */
export const PUSH_CONCURRENCY = 6;
export const MAX_TITLE_CHARS = 120;
export const MAX_BODY_CHARS = 400;

const KINDS = new Set(["invite", "accepted", "permission"]);
const OPEN_URL = /^\?apri=[a-z]{1,30}$/;
const TAG = /^[\x21-\x7e]{1,200}$/;
const BASE64URL = /^[A-Za-z0-9_-]+$/;

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

/** Confronto a tempo costante: si confrontano i due SHA-256, così non conta neppure la lunghezza. */
async function sameSecret(given: string, expected: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(given)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected))
  ]);
  const left = new Uint8Array(a);
  const right = new Uint8Array(b);
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) diff |= left[index] ^ right[index];
  return diff === 0;
}

/** Legge il corpo fino a `limit` byte; oltre restituisce null senza leggere il resto. */
async function readLimited(request: Request, limit: number): Promise<string | null> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > limit) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

const isText = (value: unknown, min: number, max: number): value is string =>
  typeof value === "string" && value.length >= min && value.length <= max;

/** Taglia a `max` caratteri senza spezzare emoji o lettere fuori dal piano base. */
const clip = (value: string, max: number) => {
  const chars = Array.from(value);
  return chars.length > max ? chars.slice(0, max).join("") : value;
};

export function parseNotification(value: unknown): PushNotification | null {
  if (!value || typeof value !== "object") return null;
  const { kind, title, body, url, tag } = value as Record<string, unknown>;
  if (typeof kind !== "string" || !KINDS.has(kind)) return null;
  if (typeof title !== "string" || !title.trim() || typeof body !== "string") return null;
  if (typeof url !== "string" || !OPEN_URL.test(url)) return null;
  if (typeof tag !== "string" || !TAG.test(tag)) return null;
  // Solo i cinque campi della tabella Interfacce finiscono nel messaggio cifrato, con testi corti: un nome di
  // gruppo lunghissimo accorcia la notifica invece di farla fallire (limite RFC 8291: 3993 byte).
  return { kind: kind as PushNotification["kind"], title: clip(title, MAX_TITLE_CHARS), body: clip(body, MAX_BODY_CHARS), url, tag };
}

export function parseSubscription(value: unknown): WebPushSubscription | null {
  if (!value || typeof value !== "object") return null;
  const { endpoint, p256dh, auth } = value as Record<string, unknown>;
  if (!isText(endpoint, 1, 2048) || typeof p256dh !== "string" || typeof auth !== "string") return null;
  const key = p256dh.replace(/=+$/, "");
  const secret = auth.replace(/=+$/, "");
  // 65 byte -> 87 caratteri base64url; 16 byte -> 22 caratteri.
  if (key.length !== 87 || !BASE64URL.test(key) || secret.length !== 22 || !BASE64URL.test(secret)) return null;
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password) return null;
  return { endpoint, p256dh: key, auth: secret };
}

async function eachLimited<T>(items: readonly T[], limit: number, run: (item: T) => Promise<void>) {
  let next = 0;
  const lane = async () => {
    while (next < items.length) {
      const item = items[next];
      next += 1;
      await run(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
}

/**
 * Cancella le iscrizioni scadute tramite l'RPC push_gone (chiave publishable + segreto).
 * Un errore qui non tocca la risposta: le iscrizioni restano e si ripulisce al prossimo invio
 * (succede anche sul piano Free con 50 push: push_gone sarebbe la 51ª sottorichiesta).
 */
async function reportGone(env: PushEnv, endpoints: string[]): Promise<number | null> {
  if (!endpoints.length || !env.STUDYOS_SUPABASE_URL || !env.STUDYOS_SUPABASE_KEY) return null;
  try {
    const response = await fetch(`${env.STUDYOS_SUPABASE_URL.replace(/\/+$/, "")}/rest/v1/rpc/push_gone`, {
      method: "POST",
      headers: { apikey: env.STUDYOS_SUPABASE_KEY, "content-type": "application/json" },
      body: JSON.stringify({ p_secret: env.STUDYOS_PUSH_SECRET, p_endpoints: endpoints })
    });
    if (!response.ok) {
      await response.body?.cancel();
      console.warn(JSON.stringify({ push_gone: response.status }));
      return null;
    }
    const removed = await response.json();
    return typeof removed === "number" ? removed : null;
  } catch {
    console.warn(JSON.stringify({ push_gone: "network" }));
    return null;
  }
}

/**
 * `POST /push` con intestazione `x-studyos-push-secret`. Corpo:
 * `{ notification: {kind,title,body,url,tag}, subscriptions: [{endpoint,p256dh,auth}] }`.
 * Risposta `{ sent, gone }`. `publicKey` serve ai test; in produzione è quella di pushKeys.ts.
 */
export async function handlePush(request: Request, env: PushEnv, publicKey: string = VAPID_PUBLIC_KEY): Promise<Response> {
  if (request.method !== "POST") return json(405, { error: "Usa POST" }, { allow: "POST" });
  const secret = env.STUDYOS_PUSH_SECRET ?? "";
  const privateKey = env.STUDYOS_VAPID_PRIVATE_KEY ?? "";
  if (!secret || !privateKey || !publicKey) return json(503, { error: "Push non configurate" });
  if (!(await sameSecret(request.headers.get("x-studyos-push-secret") ?? "", secret))) {
    return json(401, { error: "Segreto mancante o errato" });
  }

  const text = await readLimited(request, MAX_PUSH_BODY_BYTES);
  if (text === null) return json(413, { error: "Corpo oltre 64 kB" });
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return json(400, { error: "JSON non valido" });
  }
  const input = (parsed && typeof parsed === "object" ? parsed : {}) as Record<string, unknown>;
  const notification = parseNotification(input.notification);
  if (!notification) return json(400, { error: "Notifica non valida" });
  if (!Array.isArray(input.subscriptions)) return json(400, { error: "Iscrizioni mancanti" });
  if (input.subscriptions.length > MAX_PUSH_SUBSCRIPTIONS) return json(400, { error: `Al massimo ${MAX_PUSH_SUBSCRIPTIONS} iscrizioni` });

  const unique = new Map<string, WebPushSubscription>();
  let skipped = 0;
  for (const raw of input.subscriptions) {
    const subscription = parseSubscription(raw);
    if (!subscription) skipped += 1;
    else if (!unique.has(subscription.endpoint)) unique.set(subscription.endpoint, subscription);
  }

  const payload = JSON.stringify(notification);
  const options = { publicKey, privateKey, subject: VAPID_SUBJECT, topic: notification.tag };
  const gone: string[] = [];
  const statuses: Record<string, number> = {};
  let sent = 0;
  let failed = 0;
  await eachLimited([...unique.values()], PUSH_CONCURRENCY, async (subscription) => {
    try {
      const { status } = await sendWebPush(subscription, payload, options);
      statuses[status] = (statuses[status] ?? 0) + 1;
      if (status >= 200 && status < 300) sent += 1;
      else if (status === 404 || status === 410) gone.push(subscription.endpoint);
      else failed += 1;
    } catch {
      failed += 1;
    }
  });

  const removed = await reportGone(env, gone);
  console.log(JSON.stringify({ push: { total: unique.size, sent, gone: gone.length, failed, skipped, removed, statuses } }));
  return json(200, { sent, gone: gone.length });
}
```

- [ ] **Passo 7: collega la route in `worker/index.ts`**

Le push non passano dal Durable Object dell'hub MCP (nessun risveglio, nessun controllo di host o
origine dell'hub): il `fetch` di default le intercetta prima.

Sostituisci le righe 1–8:

```ts
import { DurableObject } from "cloudflare:workers";
import { PUBLISHED_HOST } from "../src/agent/hubEndpoint";
import { HttpHub, type HubSnapshot } from "../src/agent/httpHub";

interface Env {
  HUB: DurableObjectNamespace<StudyHubObject>;
  STUDYOS_PAIR_KEY: string;
}
```

con:

```ts
import { DurableObject } from "cloudflare:workers";
import { PUBLISHED_HOST } from "../src/agent/hubEndpoint";
import { HttpHub, type HubSnapshot } from "../src/agent/httpHub";
import { handlePush, type PushEnv } from "./push";

interface Env extends PushEnv {
  HUB: DurableObjectNamespace<StudyHubObject>;
  STUDYOS_PAIR_KEY: string;
}
```

e in fondo al file sostituisci:

```ts
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return env.HUB.getByName("owner").fetch(request);
  }
};
```

con:

```ts
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // POST /push arriva dal database (pg_net): non sveglia il Durable Object dell'hub MCP.
    if (new URL(request.url).pathname === "/push") return handlePush(request, env);
    return env.HUB.getByName("owner").fetch(request);
  }
};
```

`worker/wrangler.jsonc` non cambia: i quattro valori nuovi sono secret, non `vars`.

- [ ] **Passo 8: esegui i test, il typecheck e la build del Worker senza pubblicarlo**

Run: `node --import ./scripts/lib/register-ts.mjs --test tests/pushRoute.test.mjs tests/webPush.test.mjs`
Expected: PASS (15 test: 7 nuovi + gli 8 del Task 3).

Run: `npm test && npm run lint`
Expected: PASS (7 test in più rispetto al Task 3: 264 se i Task 1–2 non ne hanno aggiunti), nessun
errore TypeScript.

Run: `npx wrangler deploy --dry-run -c worker/wrangler.jsonc --outdir .cache/worker-dry-run`
Expected: elenco dei binding (`HUB`), `Total Upload: … KiB`, `--dry-run: exiting now.`, nessun
errore di bundle. Non pubblica nulla. `.cache/` è già in `.gitignore`.

Run: `grep -rl --include="*.js" "aes128gcm" .cache/worker-dry-run`
Expected: `.cache/worker-dry-run/index.js` (la cifratura è nel bundle).

- [ ] **Passo 9: pubblicazione, secret del Worker e Vault** (chiedi il via per ogni punto)

1. Pubblica il Worker (chiedi il via):
   Run: `npx wrangler deploy -c worker/wrangler.jsonc`
   Expected: `Uploaded studyos-agent`, `Deployed studyos-agent triggers` e l'URL
   `https://studyos-agent.nexify-api.workers.dev`.
   `STUDYOS_PAIR_KEY` e lo stato del Durable Object restano.
2. Controlli senza segreti:
   Run: `curl -s -o /dev/null -w "%{http_code}\n" https://studyos-agent.nexify-api.workers.dev/push`
   Expected: `405`.
   Run: `curl -s -X POST https://studyos-agent.nexify-api.workers.dev/push`
   Expected: `{"error":"Push non configurate"}` (i secret non ci sono ancora).
   Run: `curl -s -o /dev/null -w "%{http_code}\n" -H "origin: https://massimilianociconte.github.io" https://studyos-agent.nexify-api.workers.dev/health`
   Expected: `200` (l'hub MCP risponde come prima).
3. Secret del Worker (chiedi il via; li esegue l'utente nel suo terminale, incollando i valori
   quando `wrangler` li chiede): i quattro comandi `npx wrangler secret put … -c worker/wrangler.jsonc`
   stampati al Passo 5 (`STUDYOS_PUSH_SECRET`, `STUDYOS_VAPID_PRIVATE_KEY`, `STUDYOS_SUPABASE_URL`,
   `STUDYOS_SUPABASE_KEY`). Poi l'agente:
   Run: `npx wrangler secret list -c worker/wrangler.jsonc`
   Expected: i nomi `STUDYOS_PAIR_KEY`, `STUDYOS_PUSH_SECRET`, `STUDYOS_SUPABASE_KEY`,
   `STUDYOS_SUPABASE_URL`, `STUDYOS_VAPID_PRIVATE_KEY` (solo nomi, mai valori).
   Run: `curl -s -X POST -H "x-studyos-push-secret: sbagliato" https://studyos-agent.nexify-api.workers.dev/push`
   Expected: `{"error":"Segreto mancante o errato"}`.
4. Vault (chiedi il via; lo esegue l'utente nel SQL Editor del progetto `kobmoygkwzlprhgfkzwh`): il
   blocco `do $$ … $$;` stampato al Passo 5. È rieseguibile: se `studyos_push_secret` o
   `studyos_push_url` esistono ne aggiorna il valore, altrimenti li crea. Controllo, sempre nel SQL
   Editor:

   ```sql
   select name from vault.secrets where name in ('studyos_push_secret', 'studyos_push_url') order by name;
   ```

   Expected: 2 righe, `studyos_push_secret` e `studyos_push_url`. Da qui `people-verify.sql`
   (Task 1) segna pronti i segreti; la prima push vera si prova al Task 11.

- [ ] **Passo 10: commit** (dopo il via dell'utente)

```bash
git add worker/push.ts worker/index.ts scripts/push-keys.mjs src/lib/pushKeys.ts tests/pushRoute.test.mjs
git commit -m "feat(push): POST /push route on the agent Worker and VAPID key script" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

## Fase 3 — Client: profilo online, ricerca persone e inviti all'account

Vincoli che valgono per i Task 5–7 (il resto è nell'intestazione del piano): nel client solo la
chiave `sb_publishable_`; `lib/supabase`, `lib/groupSync`, `lib/shareSync` e `lib/peopleSync` solo
con `import()` da store, shell e componenti sempre montati; etichette solo in `src/lib/labels.ts`
(oggetto `peopleLabels`); ogni `grid` ha `grid-cols-*`; animazioni solo con `m.`; agli agenti MCP
mai email, `@nome` cercati, token o codici di invito; Git nel worktree con comandi semplici e
separati (niente `cd … &&`, `git -C`, `$(…)`).

Ordine: il Task 5 non dipende dalle altre fasi. Il Task 6 compila senza il server, ma le prove
sullo stack locale chiedono `supabase/people.sql` (Task 1) applicato. Il Task 7 usa il Task 6.

Ogni modifica a un file esistente è scritta come "In `file` cerca: … Sostituisci con: …": il testo
da cercare è copiato alla lettera dal file com'è prima del task (per `ShareDrawer.tsx` nel Task 7,
com'è dopo il Task 6) e compare una sola volta. I blocchi di uno stesso file vanno applicati
nell'ordine in cui sono scritti.

### Task 5: regole pure `src/lib/people.ts`, etichette e tipi degli inviti

**Files:**
- Create: `src/lib/people.ts`, `tests/people.test.mjs`
- Modify: `src/lib/labels.ts` (in coda), `src/types.ts`, `src/lib/sharing.ts`

**Interfaces:**
- Consumes: i messaggi d'errore esatti di `supabase/people.sql` (tabella "Interfacce"); `GroupInvite` (`src/types.ts`) e `ShareInviteSummary` / `inviteFromRow` (`src/lib/sharing.ts`) di oggi.
- Produces:
  - `src/lib/people.ts` (puro, nessun import di supabase-js): `HANDLE_PATTERN`, `normalizeHandle(raw): string | null`, `classifyPersonQuery(raw)`, tipo `FoundPerson`, tipo `MyProfile`; in più `DISPLAY_NAME_MAX`, `DEFAULT_PROFILE`, `personQueryParam`, `personFromRow`, `profileFromRow`, `personTitle`, `personHandle`, `personName`, `PeopleUserError`, `peopleErrorText`, `peopleCauseText`, `isExpiredEmailInvite`, `groupInviteRecipient`, `shareInviteRecipient`, `bindInviteRecipients`.
  - `peopleLabels` in `src/lib/labels.ts` (le voci di `errors` da `rateLimited` a `emailInvitesGone` sono alla lettera i messaggi del server).
  - `GroupInvite.recipientUserId?` e `GroupInvite.recipientName?` (solo locale); `ShareInviteSummary.recipientUserId: string | null`, letto da `inviteFromRow`.

`MyProfile` sta in `people.ts` (puro) perché lo usano anche componenti del bundle iniziale;
`peopleSync.ts` (Task 6) lo riesporta con `export type`, così il nome della tabella Interfacce vale da
entrambi i moduli.

- [ ] **Passo 1: crea il test che fallisce `tests/people.test.mjs`**

```js
import test from "node:test";
import assert from "node:assert/strict";
import {
  HANDLE_PATTERN,
  PeopleUserError,
  bindInviteRecipients,
  classifyPersonQuery,
  groupInviteRecipient,
  isExpiredEmailInvite,
  normalizeHandle,
  peopleCauseText,
  peopleErrorText,
  personFromRow,
  personName,
  personQueryParam,
  personTitle,
  profileFromRow,
  shareInviteRecipient
} from "../src/lib/people.ts";
import { inviteFromRow } from "../src/lib/sharing.ts";
import { peopleLabels } from "../src/lib/labels.ts";

test("@nome: minuscolo, 3–24 caratteri, solo lettere, cifre, _ e punto (stesso check di people.sql)", () => {
  assert.equal(HANDLE_PATTERN.source, "^[a-z0-9_.]{3,24}$");
  assert.equal(normalizeHandle("@Giulia.Rossi "), "giulia.rossi");
  assert.equal(normalizeHandle(" mario_99"), "mario_99");
  assert.equal(normalizeHandle("abc"), "abc");
  assert.equal(normalizeHandle("a".repeat(24)), "a".repeat(24));
  assert.equal(normalizeHandle("a".repeat(25)), null);
  assert.equal(normalizeHandle("ab"), null);
  assert.equal(normalizeHandle("@"), null);
  assert.equal(normalizeHandle("mario rossi"), null);
  assert.equal(normalizeHandle("mario-rossi"), null);
  assert.equal(normalizeHandle("@@mario"), null);
  assert.equal(normalizeHandle("màrio"), null);
});

test("ricerca: @ iniziale = @nome, @ interno = email esatta senza maiuscole, il resto non parte", () => {
  assert.deepEqual(classifyPersonQuery("@Giulia.Rossi"), { kind: "handle", value: "giulia.rossi" });
  assert.deepEqual(classifyPersonQuery("giulia.rossi"), { kind: "handle", value: "giulia.rossi" });
  assert.deepEqual(classifyPersonQuery("  Giulia.Rossi@Esempio.IT "), { kind: "email", value: "giulia.rossi@esempio.it" });
  assert.equal(classifyPersonQuery(""), null);
  assert.equal(classifyPersonQuery("   "), null);
  assert.equal(classifyPersonQuery("@ab"), null);
  assert.equal(classifyPersonQuery("giulia@"), null);
  assert.equal(classifyPersonQuery("giulia@esempio"), null);
  assert.equal(classifyPersonQuery("giulia rossi"), null);
  assert.equal(personQueryParam({ kind: "handle", value: "giulia" }), "@giulia");
  assert.equal(personQueryParam({ kind: "email", value: "g@x.it" }), "g@x.it");
});

test("righe del server: persona trovata e profilo, con i valori di riserva", () => {
  assert.deepEqual(personFromRow({ person_id: "u1", display_name: "  Giulia ", handle: "giulia" }), { personId: "u1", displayName: "Giulia", handle: "giulia" });
  assert.deepEqual(personFromRow({ person_id: "u2", display_name: null, handle: "" }), { personId: "u2", displayName: "", handle: null });
  assert.equal(personFromRow({ display_name: "Senza id" }), null);
  assert.equal(personFromRow(undefined), null);
  assert.equal(personFromRow({ person_id: "u3", display_name: "x".repeat(80) }).displayName.length, 60);
  assert.deepEqual(profileFromRow(null), { displayName: "", handle: null, discoverable: true });
  assert.deepEqual(profileFromRow({ display_name: "Bob", handle: "bob_1", discoverable: false }), { displayName: "Bob", handle: "bob_1", discoverable: false });
  assert.equal(profileFromRow({ display_name: "Bob" }).discoverable, true);
  const noName = { personId: "u4", displayName: "", handle: null };
  assert.equal(personTitle(noName), "Nome non impostato");
  assert.equal(personName(noName), "una persona");
  assert.equal(personName({ ...noName, handle: "carla" }), "@carla");
  assert.equal(personName({ ...noName, displayName: "Carla", handle: "carla" }), "Carla");
});

test("errori: i messaggi di people.sql diventano etichette, il resto mai in inglese", () => {
  const server = (message, code = "P0001") => peopleErrorText({ message, code });
  assert.equal(server("Troppe ricerche, riprova tra un minuto"), peopleLabels.errors.rateLimited);
  assert.equal(server("Nessuna persona trovata"), "Nessuna persona trovata");
  assert.equal(server("È già nel gruppo"), peopleLabels.errors.alreadyMember);
  assert.equal(server("Ha già un invito"), peopleLabels.errors.alreadyInvited);
  assert.equal(server("Solo proprietario e amministratori possono invitare"), peopleLabels.errors.notAllowed);
  assert.equal(server("Non puoi invitare te stesso"), peopleLabels.errors.self);
  assert.equal(server("Troppi inviti in attesa: annullane qualcuno"), peopleLabels.errors.tooManyInvites);
  assert.equal(server("Gli inviti per email non ci sono più: cerca la persona"), peopleLabels.errors.emailInvitesGone);
  assert.equal(server("Il gruppo non esiste più"), "Il gruppo non esiste più");
  assert.equal(server('duplicate key value violates unique constraint "studyos_profiles_handle_key"', "23505"), peopleLabels.errors.handleTaken);
  assert.equal(server("new row violates check constraint", "23514"), peopleLabels.errors.badHandle);
  assert.equal(server("Could not find the function public.find_person(p_query)", "PGRST202"), peopleLabels.errors.unavailable);
  assert.equal(server("relation \"public.studyos_profiles\" does not exist", "42P01"), peopleLabels.errors.unavailable);
  assert.equal(server("TypeError: Failed to fetch", ""), peopleLabels.errors.offline);
  assert.equal(server("permission denied for function find_person", "42501"), peopleLabels.errors.noPermission);
  assert.equal(server("internal error", "XX000"), peopleLabels.errors.generic);
  assert.equal(peopleCauseText(new PeopleUserError("Testo pronto")), "Testo pronto");
  assert.equal(peopleCauseText(new TypeError("Failed to fetch dynamically imported module: /assets/peopleSync.js")), peopleLabels.errors.offline);
  assert.equal(peopleCauseText(new Error("Cannot read properties of undefined")), peopleLabels.errors.generic);
  assert.equal(peopleCauseText("boom"), peopleLabels.errors.generic);
});

test("inviti per email di prima: scaduti se nessun account li ha presi", () => {
  assert.equal(isExpiredEmailInvite({ status: "pending", recipientEmail: "bob@x.it" }), true);
  assert.equal(isExpiredEmailInvite({ status: "pending", recipientEmail: "bob@x.it", recipientUserId: "u-bob" }), false);
  assert.equal(isExpiredEmailInvite({ status: "accepted", recipientEmail: "bob@x.it" }), false);
  assert.equal(isExpiredEmailInvite({ status: "pending", recipientUserId: "u-bob" }), false);
  assert.equal(isExpiredEmailInvite({ status: "pending", recipientEmail: null, recipientUserId: null }), false);
  const base = { recipientName: undefined, recipientEmail: undefined, recipientUserId: undefined, code: "GRP-AB12-CD34" };
  assert.equal(groupInviteRecipient(base), "Codice GRP-AB12-CD34");
  assert.equal(groupInviteRecipient({ ...base, recipientEmail: "bob@x.it" }), "bob@x.it");
  assert.equal(groupInviteRecipient({ ...base, recipientUserId: "u-bob" }), "Persona invitata");
  assert.equal(groupInviteRecipient({ ...base, recipientUserId: "u-bob", recipientName: "Bob" }), "Bob");
  const share = inviteFromRow({ id: "i1", owner_id: "alice", status: "pending", expires_at: "2999-01-01T00:00:00Z", recipient_email: null, recipient_user_id: "u-bob" });
  assert.equal(share.recipientUserId, "u-bob");
  assert.equal(shareInviteRecipient(share), "A una persona, nella sua app");
  assert.equal(inviteFromRow({ id: "i2", status: "pending", expires_at: "2999-01-01T00:00:00Z" }).recipientUserId, null);
  assert.equal(shareInviteRecipient({ recipientEmail: null, recipientUserId: null }), "Con link");
});

test("legame degli inviti: arriva dal server, non si toglie, conserva il nome, stesso array se non cambia", () => {
  const invite = (id, extra = {}) => ({ id, createdAt: "c", updatedAt: "u", archived: false, tags: [], groupId: "g1", groupName: "Fisio", fromUserId: "alice", fromDisplayName: "Alice", code: "GRP-AB12-CD34", status: "pending", ...extra });
  const local = [invite("i1", { recipientEmail: "bob@x.it" }), invite("i2", { recipientUserId: "u-carla", recipientName: "Carla" }), invite("i3")];
  const bound = bindInviteRecipients(local, [invite("i1", { recipientEmail: "bob@x.it", recipientUserId: "u-bob" }), invite("i2")]);
  assert.equal(bound[0].recipientUserId, "u-bob");
  assert.equal(bound[1].recipientUserId, "u-carla");
  assert.equal(bound[1].recipientName, "Carla");
  assert.equal(bound[2], local[2]);
  assert.equal(bindInviteRecipients(bound, [invite("i1", { recipientUserId: "u-bob" })]), bound);
  assert.equal(bindInviteRecipients(local, []), local);
});
```

- [ ] **Passo 2: esegui il test e verifica che fallisca**

```bash
node --import ./scripts/lib/register-ts.mjs --test tests/people.test.mjs
```

Expected: `not ok 1 - tests/people.test.mjs` con `ERR_MODULE_NOT_FOUND` per `src/lib/people.ts`,
poi `# pass 0` e `# fail 1`.

- [ ] **Passo 3: `peopleLabels` in coda a `src/lib/labels.ts`**

Il Task 8 aggiunge `pushLabels` allo stesso modo, dopo questo blocco: nessuno dei due cita o
modifica il testo dell'altro.

```bash
cat >> src/lib/labels.ts <<'EOF'

// ——— Persone: ricerca, profilo online, inviti all'account (supabase/people.sql) ———

/**
 * Testi di "Trova una persona", del profilo online e degli inviti all'account. Le voci di `errors`
 * da `rateLimited` a `emailInvitesGone` sono identiche ai messaggi di supabase/people.sql:
 * peopleErrorText (lib/people.ts) le riconosce nel testo del server.
 */
export const peopleLabels = {
  findTitle: "Trova una persona",
  findHint: "Scrivi la sua email esatta o il suo @nome. L'email delle altre persone non compare mai.",
  findFieldLabel: "Email o @nome della persona",
  findPlaceholder: "nome@esempio.it oppure @nome",
  search: "Cerca",
  searching: "Cerco…",
  invite: "Invita",
  inviting: "Invito…",
  noName: "Nome non impostato",
  noHandle: "Senza @nome",
  somebody: "una persona",
  notFound: "Nessuna persona trovata",
  notFoundHint: "Controlla l'email o il @nome. Se non ha ancora un account, mandale il link di invito.",
  checkHint: "Prima di invitare, controlla con la persona che nome e @nome siano proprio i suoi.",
  needsLogin: "Accedi al tuo account per cercare le persone.",
  needsScopes: "Scegli almeno una cosa da condividere.",
  groupSectionTitle: "Invita una persona con il suo account",
  groupSectionHint: "Per chi ha già un account StudyOS: l'invito compare nella sua app (notifiche e Gruppi) e può accettarlo con un tocco.",
  groupNotAllowed:
    "Solo il proprietario e gli amministratori possono invitare una persona con il suo account. Tu puoi mandare il link, il QR o il codice.",
  groupNotOnline: "Il gruppo non è ancora online: riapri questa finestra tra poco.",
  groupInvited: (name: string) => `Invito mandato a ${name}: lo vede nelle notifiche e in Gruppi.`,
  groupActivity: (name: string) => `ha invitato ${name}`,
  adminRoleHint: "come un membro, ma può anche invitare una persona trovata con la ricerca (email o @nome).",
  shareTarget: "Una persona (cerca per email o @nome)",
  shareInvited: (name: string, scopes: string) =>
    `Invito mandato a ${name}: lo vede nelle notifiche e in Condivisione → Inviti. Quando accetta, vede ${scopes}.`,
  withLink: "Con link",
  sentToPerson: "A una persona, nella sua app",
  invitedPerson: "Persona invitata",
  codeInvite: (code: string) => `Codice ${code}`,
  sentInvitesTitle: (count: number) => `Inviti mandati · ${count}`,
  waiting: "in attesa",
  expired: "scaduto",
  expiredEmailInvite: "Scaduto: cerca la persona per invitarla di nuovo",
  profileTitle: "Profilo online",
  profileIntro: "Come ti vedono gli altri quando ti cercano per invitarti.",
  profileNoCloud: "Gli account non sono attivi in questa versione dell'app.",
  profileSignedOut: "Con l'account puoi scegliere un @nome e farti trovare da chi vuole invitarti.",
  profileLoading: "Carico il profilo online…",
  profileVisibleName: (name: string) => `Nome visibile: ${name}`,
  profileNameHint: "È il nome scritto in «Il tuo nome», qui sopra: il profilo online si aggiorna da solo.",
  handleLabel: "Il tuo @nome (facoltativo)",
  handlePlaceholder: "es. giulia.rossi",
  handleRule: "Da 3 a 24 caratteri: lettere minuscole, numeri, _ e punto.",
  handleChecking: "Controllo se è libero…",
  handleAvailable: "Libero: puoi usarlo.",
  handleTaken: "Già preso: scegline un altro.",
  handleCurrent: "È il tuo @nome.",
  handleSave: "Salva @nome",
  handleRemove: "Togli @nome",
  handleSaved: (handle: string) => `Fatto: ora ti trovano anche come @${handle}.`,
  handleRemoved: "@nome tolto: ti trovano solo con l'email esatta.",
  discoverableLabel: "Gli altri possono trovarmi",
  discoverableOn: "Chi conosce la tua email o il tuo @nome può trovarti per invitarti. Non vede mai la tua email.",
  discoverableOff: "Nessuno ti trova con la ricerca. Gli inviti già ricevuti restano e puoi sempre entrare con link, QR o codice.",
  saving: "Salvo…",
  retry: "Riprova",
  notice: "Ora chi conosce la tua email o il tuo @nome può trovarti per invitarti. Puoi spegnerlo in Impostazioni → Profilo.",
  noticeOk: "Ok",
  noticeOpenProfile: "Apri il profilo",
  errors: {
    rateLimited: "Troppe ricerche, riprova tra un minuto",
    notFound: "Nessuna persona trovata",
    alreadyMember: "È già nel gruppo",
    alreadyInvited: "Ha già un invito",
    notAllowed: "Solo proprietario e amministratori possono invitare",
    self: "Non puoi invitare te stesso",
    tooManyInvites: "Troppi inviti in attesa: annullane qualcuno",
    emailInvitesGone: "Gli inviti per email non ci sono più: cerca la persona",
    badQuery: "Scrivi un'email completa (nome@esempio.it) o un @nome.",
    badHandle: "Il @nome va da 3 a 24 caratteri: lettere minuscole, numeri, _ e punto.",
    handleTaken: "Questo @nome è già preso: scegline un altro.",
    unavailable:
      "La ricerca delle persone non è ancora attiva sul server: esegui supabase/people.sql nel SQL Editor di Supabase (vedi supabase/README.md).",
    offline: "Server cloud non raggiungibile: controlla la connessione e riprova.",
    noPermission: "Non hai il permesso per questa operazione.",
    signedOut: "Accedi al tuo account per cercare le persone.",
    noCloud: "Gli account non sono attivi in questa versione dell'app.",
    generic: "Il server ha risposto con un errore. Riprova tra poco."
  }
} as const;
EOF
```

Nello stesso file aggiorna il testo dell'invito destinato a un altro account (l'indirizzo email
non conta più). Cerca:

```ts
  otherAccount: "Questo invito è per un altro indirizzo email: accedi con quell'account e riapri il link.",
```

Sostituisci con:

```ts
  otherAccount: "Questo invito è per un altro account: accedi con quello giusto e riapri il link.",
```

- [ ] **Passo 4: destinatario degli inviti in `src/types.ts` e `src/lib/sharing.ts`**

`recipientUserId` arriva dal server (colonna nuova del Task 1); `recipientName` lo scrive solo chi
invita, sul proprio dispositivo, per riconoscere l'invito nell'elenco (il server non conserva il
nome della persona cercata).

In `src/types.ts` cerca:

```ts
  fromUserId: string;
  fromDisplayName: string;
  /** Email del destinatario, quando l'invito è nominale. */
  recipientEmail?: string;
  /** Codice usato per l'unione (uguale a StudyGroup.inviteCode o singolo). */
  code: string;
```

Sostituisci con:

```ts
  fromUserId: string;
  fromDisplayName: string;
  /** Email del destinatario degli inviti nominali di prima: quelli nuovi vanno a un account (recipientUserId). */
  recipientEmail?: string;
  /** Account destinatario (supabase/people.sql): solo lui può accettare. */
  recipientUserId?: string;
  /** Nome della persona invitata, solo per l'elenco di chi invita (il server non lo conserva). */
  recipientName?: string;
  /** Codice usato per l'unione (uguale a StudyGroup.inviteCode o singolo). */
  code: string;
```

Nel riepilogo degli inviti di condivisione (tipo e lettura della riga):

In `src/lib/sharing.ts` cerca:

```ts
  /** Visibile solo a chi ha creato l'invito (RLS): mai inviata agli agenti. */
  recipientEmail: string | null;
  status: ShareInviteStatus;
  expiresAt: string;
```

Sostituisci con:

```ts
  /** Visibile solo a chi ha creato l'invito (RLS): mai inviata agli agenti. */
  recipientEmail: string | null;
  /** Account destinatario di un invito nell'app (supabase/people.sql); null per gli inviti con link. */
  recipientUserId: string | null;
  status: ShareInviteStatus;
  expiresAt: string;
```

In `src/lib/sharing.ts` cerca:

```ts
      .map(({ scope, permission }) => ({ scope, permission })),
    recipientEmail: (row.recipient_email as string | null) ?? null,
    status: expired ? "expired" : status === "accepted" || status === "declined" || status === "expired" ? status : "pending",
    expiresAt,
```

Sostituisci con:

```ts
      .map(({ scope, permission }) => ({ scope, permission })),
    recipientEmail: (row.recipient_email as string | null) ?? null,
    recipientUserId: typeof row.recipient_user_id === "string" && row.recipient_user_id ? row.recipient_user_id : null,
    status: expired ? "expired" : status === "accepted" || status === "declined" || status === "expired" ? status : "pending",
    expiresAt,
```

- [ ] **Passo 5: crea `src/lib/people.ts`**

Regole uguali a quelle del server: `@nome` minuscolo `^[a-z0-9_.]{3,24}$` (una sola `@` iniziale
ammessa e tolta), email esatta senza maiuscole. Una ricerca che non è né l'una né l'altra non parte
(niente richiesta, niente consumo del limite di 30 al minuto). Gli errori del server diventano
etichette; un errore sconosciuto non mostra mai testo tecnico in inglese.

```ts
// Ricerca delle persone e profilo online: regole pure, senza Supabase (le usano peopleSync.ts, i
// componenti e i test). Specchio di supabase/people.sql: stesso formato del @nome, ricerca solo
// esatta (email intera o @nome), errori del server riconosciuti dal testo.

import type { GroupInvite } from "../types";
import { peopleLabels } from "./labels";

/** @nome: minuscolo, 3–24 caratteri tra lettere, cifre, `_` e `.` (check di studyos_profiles.handle). */
export const HANDLE_PATTERN = /^[a-z0-9_.]{3,24}$/;

/** Lunghezza massima del nome visibile (studyos_profiles.display_name, come preferences.displayName). */
export const DISPLAY_NAME_MAX = 60;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Risultato di find_person: mai l'email. */
export type FoundPerson = { personId: string; displayName: string; handle: string | null };

/** Il proprio profilo online (riga di studyos_profiles). */
export type MyProfile = { displayName: string; handle: string | null; discoverable: boolean };

/** Account senza riga di profilo: trovabile, senza nome né @nome (come lo tratta il server). */
export const DEFAULT_PROFILE: MyProfile = { displayName: "", handle: null, discoverable: true };

/** `@Giulia.Rossi ` → `giulia.rossi`; null se non rispetta HANDLE_PATTERN. */
export const normalizeHandle = (raw: string): string | null => {
  const value = raw.trim().replace(/^@/, "").toLowerCase();
  return HANDLE_PATTERN.test(value) ? value : null;
};

/**
 * Cosa cercare: `@` iniziale = @nome; `@` interno = email (senza maiuscole); senza `@`, un @nome
 * valido (molti lo scrivono senza chiocciola). Tutto il resto: null, nessuna richiesta al server.
 */
export const classifyPersonQuery = (raw: string): { kind: "handle"; value: string } | { kind: "email"; value: string } | null => {
  const query = raw.trim();
  if (!query) return null;
  if (!query.startsWith("@") && query.includes("@")) {
    const email = query.toLowerCase();
    return EMAIL_PATTERN.test(email) ? { kind: "email", value: email } : null;
  }
  const handle = normalizeHandle(query);
  return handle ? { kind: "handle", value: handle } : null;
};

/** Testo per find_person: il server cerca il @nome solo con la chiocciola iniziale. */
export const personQueryParam = (query: { kind: "handle" | "email"; value: string }) => (query.kind === "handle" ? `@${query.value}` : query.value);

const textOf = (value: unknown) => (typeof value === "string" ? value.trim() : "");

/** Riga di find_person → persona; null senza id. Nome e @nome sono dati di un altro: solo testo. */
export const personFromRow = (row: Record<string, unknown> | null | undefined): FoundPerson | null => {
  const personId = textOf(row?.person_id);
  if (!personId) return null;
  return { personId, displayName: textOf(row?.display_name).slice(0, DISPLAY_NAME_MAX), handle: normalizeHandle(textOf(row?.handle)) };
};

/** Riga di studyos_profiles (o nessuna riga) → profilo. */
export const profileFromRow = (row: Record<string, unknown> | null | undefined): MyProfile =>
  row
    ? { displayName: textOf(row.display_name), handle: normalizeHandle(textOf(row.handle)), discoverable: row.discoverable !== false }
    : { ...DEFAULT_PROFILE };

/** Titolo della scheda di una persona: il nome, oppure "Nome non impostato". */
export const personTitle = (person: FoundPerson) => person.displayName || peopleLabels.noName;

/** `@nome` da mostrare, oppure null. */
export const personHandle = (person: FoundPerson) => (person.handle ? `@${person.handle}` : null);

/** Come chiamarla in una frase o in un elenco: nome, altrimenti @nome, altrimenti "una persona". */
export const personName = (person: FoundPerson) => person.displayName || personHandle(person) || peopleLabels.somebody;

// ——— Errori ———

/** Errore con un testo già pronto per l'utente (in italiano): la UI lo mostra com'è. */
export class PeopleUserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PeopleUserError";
  }
}

type ServerError = { message: string; code?: string };

/** Rete assente o pezzo dell'app non scaricabile (stessi casi di sharing.ts). */
const NETWORK_ERROR_RE =
  /failed to fetch|networkerror|load failed|network request failed|timed? ?out|timeout|aborted|err_connection|dynamically imported module|importing a module script failed/i;

/** Tabella o funzione assente: supabase/people.sql non è stato eseguito. */
const MISSING_OBJECT_RE = /42P01|42883|PGRST202|PGRST205|does not exist|Could not find the (table|function)/i;

/** Messaggi di supabase/people.sql (raise exception): identici alle etichette, si riconoscono nel testo. */
const SERVER_MESSAGES: readonly string[] = [
  peopleLabels.errors.rateLimited,
  peopleLabels.errors.notFound,
  peopleLabels.errors.alreadyMember,
  peopleLabels.errors.alreadyInvited,
  peopleLabels.errors.notAllowed,
  peopleLabels.errors.self,
  peopleLabels.errors.tooManyInvites,
  peopleLabels.errors.emailInvitesGone
];

/** Testo per un errore del server (ricerca, profilo, inviti all'account): sempre un'etichetta in italiano. */
export const peopleErrorText = (error: ServerError): string => {
  const known = SERVER_MESSAGES.find((message) => error.message.includes(message));
  if (known) return known;
  if (MISSING_OBJECT_RE.test(`${error.code ?? ""} ${error.message}`)) return peopleLabels.errors.unavailable;
  if (NETWORK_ERROR_RE.test(error.message)) return peopleLabels.errors.offline;
  // Indice unico sul @nome; check sul formato (se il controllo del client è stato aggirato).
  if (error.code === "23505" || /duplicate key/i.test(error.message)) return peopleLabels.errors.handleTaken;
  if (error.code === "23514") return peopleLabels.errors.badHandle;
  if (error.code === "42501" || /row-level security|permission denied/i.test(error.message)) return peopleLabels.errors.noPermission;
  // Altre eccezioni scritte in people.sql (raise exception, SQLSTATE P0001): già in italiano.
  return error.code === "P0001" && error.message.trim() ? error.message.trim() : peopleLabels.errors.generic;
};

/** Testo per qualunque errore di un'azione (anche un import() fallito): mai un messaggio tecnico in inglese. */
export const peopleCauseText = (cause: unknown): string => {
  if (cause instanceof PeopleUserError) return cause.message;
  if (cause instanceof Error && NETWORK_ERROR_RE.test(cause.message)) return peopleLabels.errors.offline;
  return peopleLabels.errors.generic;
};

// ——— Inviti ———

/** Invito per email di prima che la migrazione non ha legato a un account: non si può più accettare. */
export const isExpiredEmailInvite = (invite: { status: string; recipientEmail?: string | null; recipientUserId?: string | null }) =>
  invite.status === "pending" && Boolean(invite.recipientEmail) && !invite.recipientUserId;

/** Destinatario di un invito di gruppo nell'elenco di chi l'ha mandato. */
export const groupInviteRecipient = (invite: Pick<GroupInvite, "recipientName" | "recipientEmail" | "recipientUserId" | "code">) =>
  invite.recipientName || invite.recipientEmail || (invite.recipientUserId ? peopleLabels.invitedPerson : peopleLabels.codeInvite(invite.code));

/** Destinatario di un invito di condivisione in "Inviti che hai creato". */
export const shareInviteRecipient = (invite: { recipientEmail: string | null; recipientUserId: string | null }) =>
  invite.recipientEmail || (invite.recipientUserId ? peopleLabels.sentToPerson : peopleLabels.withLink);

/**
 * Lega agli inviti locali l'account destinatario arrivato dal server, anche se la riga non ha
 * cambiato data (la migrazione di people.sql lega gli inviti per email). Non toglie mai un legame e
 * conserva il nome salvato da chi ha invitato. Stesso array se non cambia nulla.
 */
export const bindInviteRecipients = (local: GroupInvite[], server: readonly GroupInvite[]): GroupInvite[] => {
  const bound = new Map<string, string>();
  for (const invite of server) if (invite.recipientUserId) bound.set(invite.id, invite.recipientUserId);
  if (!bound.size) return local;
  let changed = false;
  const next = local.map((invite) => {
    const recipientUserId = bound.get(invite.id);
    if (!recipientUserId || invite.recipientUserId === recipientUserId) return invite;
    changed = true;
    return { ...invite, recipientUserId };
  });
  return changed ? next : local;
};
```

- [ ] **Passo 6: test, typecheck e build**

```bash
node --import ./scripts/lib/register-ts.mjs --test tests/people.test.mjs
```

Expected: `# tests 6`, `# pass 6`, `# fail 0`.

```bash
npm test
```

Expected: `# fail 0`; il totale cresce di 6 rispetto a prima del task (oggi 249 → 255, più i test
dei Task 3–4 se già fatti).

```bash
npm run lint
```

Expected: `tsc -b --noEmit` senza errori (uscita 0).

```bash
npm run build
```

Expected: termina con `✓ built in …`. `people.ts` non è ancora importato dall'app: il bundle
iniziale non cambia, salvo `peopleLabels` (le etichette stanno già tutte nel chunk iniziale).

- [ ] **Passo 7: commit**

```bash
git add src/lib/people.ts tests/people.test.mjs src/lib/labels.ts src/types.ts src/lib/sharing.ts
```

```bash
git commit -m "feat(people): pure people rules, labels and invite types" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 6: `src/lib/peopleSync.ts` e inviti legati all'account in `groupSync` / `shareSync`

**Files:**
- Create: `src/lib/peopleSync.ts`
- Modify: `src/lib/groupSync.ts`, `src/lib/shareSync.ts`, `src/components/ShareDrawer.tsx`, `src/App.tsx`

**Interfaces:**
- Consumes: Task 1 (`studyos_profiles` con RLS sulla propria riga; RPC `find_person`, `is_handle_available`, `invite_person_to_group`, `invite_person_to_share`; colonne `recipient_user_id` di `studyos_group_invites` e `studyos_share_invites`; `create_share_invite` che rifiuta l'email); Task 5 (`people.ts`, `peopleLabels`).
- Produces:
  - `src/lib/peopleSync.ts` (solo `import()`): `findPerson(query): Promise<FoundPerson | null>`, `isHandleAvailable(handle): Promise<boolean>`, `loadMyProfile(): Promise<MyProfile | null>`, `saveMyProfile(patch): Promise<MyProfile>`, `invitePersonToGroup(groupId, personId): Promise<string>`, `invitePersonToShare(personId, offers: ShareOffer[], requests: ShareRequest[]): Promise<string>`, `export type { FoundPerson, MyProfile }`, più `initPeopleSync()` chiamata da `App.tsx`.
  - `groupSync.ts`: inviti ricevuti e Realtime filtrati su `recipient_user_id`; `pushSharedInvite` invia solo inviti con codice senza destinatario; nuova `rememberInviteRecipient(inviteId, name)`.
  - `shareSync.ts`: `createShareInvite({ offers, requests })` senza email; nuova `createPersonShareInvite(personId, offers, requests): Promise<string>`; `INVITE_COLUMNS` con `recipient_user_id`.

Il nome del profilo online è sempre quello di "Profilo e obiettivi" (`preferences.displayName`):
`initPeopleSync` lo copia sul server 1,5 secondi dopo l'ultima modifica, al cambio di account e al
ritorno della rete, mai con il vault chiuso, durante il caricamento o durante la prima
sincronizzazione di un nuovo dispositivo. Con il nome vuoto crea solo la riga, se manca
(`ignoreDuplicates`), senza cancellare un nome già salvato. Lo store non importa nulla di nuovo:
il collegamento parte da `App.tsx` con `import()`, come `initShareSync`.

- [ ] **Passo 1: crea `src/lib/peopleSync.ts`**

```ts
// Ponte verso supabase/people.sql: profilo online, ricerca delle persone e inviti all'account.
// Caricato solo con import(): supabase-js resta fuori dal bundle iniziale. Gli errori del server
// diventano etichette (peopleErrorText); email e @nome cercati non finiscono mai in log o notifiche.
//
// initPeopleSync (da App, come initShareSync) copia nel profilo online il nome di "Profilo e
// obiettivi" quando cambia, e crea la riga del profilo al primo accesso dopo l'aggiornamento.

import { getCloudSyncState, subscribeCloudSync } from "./cloudSyncState";
import { peopleLabels } from "./labels";
import {
  DISPLAY_NAME_MAX,
  PeopleUserError,
  classifyPersonQuery,
  normalizeHandle,
  peopleErrorText,
  personFromRow,
  personQueryParam,
  profileFromRow,
  type FoundPerson,
  type MyProfile
} from "./people";
import type { ShareOffer, ShareRequest } from "./sharing";
import { supabase } from "./supabase";
import { selectPreferences, useStudyStore } from "../store/useStudyStore";

export type { FoundPerson, MyProfile };

const PROFILE_COLUMNS = "display_name, handle, discoverable";
/** Pausa dopo l'ultima modifica del nome prima di scriverlo sul server. */
const NAME_DEBOUNCE_MS = 1500;

type DbError = { message: string; code?: string } | null;

const fail = (error: DbError) => {
  if (error) throw new PeopleUserError(peopleErrorText(error));
};

const client = () => {
  if (!supabase) throw new PeopleUserError(peopleLabels.errors.noCloud);
  return supabase;
};

const myId = () => {
  const id = getCloudSyncState().session?.user.id;
  if (!id) throw new PeopleUserError(peopleLabels.errors.signedOut);
  return id;
};

/**
 * Nome di "Profilo e obiettivi", al massimo 60 caratteri. Mai la parte locale dell'email come
 * riserva: chi trova qualcuno con il @nome non deve poter dedurre il suo indirizzo.
 */
const profileName = () => selectPreferences(useStudyStore.getState()).displayName.trim().slice(0, DISPLAY_NAME_MAX);

/** Ricerca esatta per email o @nome: al massimo una persona, mai sé stessi, mai l'email. */
export const findPerson = async (query: string): Promise<FoundPerson | null> => {
  const parsed = classifyPersonQuery(query);
  if (!parsed) throw new PeopleUserError(peopleLabels.errors.badQuery);
  myId();
  const { data, error } = await client().rpc("find_person", { p_query: personQueryParam(parsed) });
  fail(error);
  const rows = Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
  return personFromRow(rows[0]);
};

/** Il @nome è libero (o è già il mio)? Conta nel limite di ricerche al minuto: chiamarla con una pausa. */
export const isHandleAvailable = async (handle: string): Promise<boolean> => {
  const value = normalizeHandle(handle);
  if (!value) throw new PeopleUserError(peopleLabels.errors.badHandle);
  myId();
  const { data, error } = await client().rpc("is_handle_available", { p_handle: value });
  fail(error);
  return data === true;
};

/** Il proprio profilo online; null se la riga non c'è ancora (vale "trovabile, senza @nome"). */
export const loadMyProfile = async (): Promise<MyProfile | null> => {
  const me = myId();
  const { data, error } = await client().from("studyos_profiles").select(PROFILE_COLUMNS).eq("user_id", me).maybeSingle();
  fail(error);
  return data ? profileFromRow(data as Record<string, unknown>) : null;
};

/**
 * Salva i campi indicati (crea la riga se manca). Il nome, se non è nel patch, è quello di
 * "Profilo e obiettivi": la riga creata qui non resta senza nome. `handle` vuoto o null lo toglie.
 */
export const saveMyProfile = async (patch: Partial<Pick<MyProfile, "handle" | "discoverable" | "displayName">>): Promise<MyProfile> => {
  const me = myId();
  const row: Record<string, unknown> = {
    user_id: me,
    display_name: (patch.displayName ?? profileName()).trim().slice(0, DISPLAY_NAME_MAX)
  };
  if (patch.handle !== undefined) {
    if (patch.handle === null || !patch.handle.trim()) {
      row.handle = null;
    } else {
      const handle = normalizeHandle(patch.handle);
      if (!handle) throw new PeopleUserError(peopleLabels.errors.badHandle);
      row.handle = handle;
    }
  }
  if (patch.discoverable !== undefined) row.discoverable = patch.discoverable;
  const { data, error } = await client().from("studyos_profiles").upsert(row, { onConflict: "user_id" }).select(PROFILE_COLUMNS).single();
  fail(error);
  return profileFromRow(data as Record<string, unknown>);
};

/** Invito in un gruppo a una persona trovata (proprietario o amministratore). Ritorna l'id dell'invito. */
export const invitePersonToGroup = async (groupId: string, personId: string): Promise<string> => {
  myId();
  const { data, error } = await client().rpc("invite_person_to_group", {
    p_group_id: groupId,
    p_person_id: personId,
    // Vuoto = il server usa il nome di riserva, come accept_group_invite e join_group_by_code.
    p_display_name: profileName()
  });
  fail(error);
  return String(data ?? "");
};

/**
 * Invito a vedere o modificare i propri dati, alla persona trovata: stesse offerte e richieste del
 * pannello Condividi. Passa da shareSync (controllo della migrazione, nome, aggiornamento elenchi).
 */
export const invitePersonToShare = async (personId: string, offers: ShareOffer[], requests: ShareRequest[]): Promise<string> => {
  const sync = await import("./shareSync");
  return sync.createPersonShareInvite(personId, offers, requests);
};

// ——— Nome del profilo online (in differita) ———

let initialized = false;
let nameTimer: ReturnType<typeof setTimeout> | undefined;
/** `${utente}:${nome}` già scritto sul server: niente scritture ripetute. */
let sentName: string | null = null;

const pushName = async () => {
  nameTimer = undefined;
  const state = useStudyStore.getState();
  const sync = getCloudSyncState();
  const me = sync.session?.user.id;
  // Vault chiuso o dati non ancora caricati: le preferenze non sono quelle vere.
  if (!me || !supabase || state.loading || state.locked) return;
  // Prima sincronizzazione in corso (nuovo dispositivo): il nome dell'account deve ancora arrivare.
  if (sync.status === "syncing") return scheduleName(NAME_DEBOUNCE_MS);
  const name = profileName();
  const key = `${me}:${name}`;
  if (sentName === key) return;
  try {
    // Nome vuoto (non ancora scelto): si crea la riga se manca, senza cancellare un nome già salvato.
    const { error } = await supabase
      .from("studyos_profiles")
      .upsert({ user_id: me, display_name: name }, { onConflict: "user_id", ignoreDuplicates: !name });
    if (!error && getCloudSyncState().session?.user.id === me) sentName = key;
  } catch {
    // Rete assente: si riprova alla prossima modifica, al prossimo accesso o quando torna la rete.
  }
};

const scheduleName = (delay: number) => {
  if (nameTimer !== undefined) clearTimeout(nameTimer);
  nameTimer = setTimeout(() => void pushName(), delay);
};

/** Da chiamare una volta dopo init() (App): segue accessi, cambi di account e modifiche del nome. */
export const initPeopleSync = () => {
  if (initialized || !supabase) return;
  initialized = true;
  let viewer: string | null = null;
  subscribeCloudSync((state) => {
    const id = state.session?.user.id ?? null;
    if (id === viewer) return;
    viewer = id;
    sentName = null;
    if (id) scheduleName(NAME_DEBOUNCE_MS);
  });
  useStudyStore.subscribe((curr, prev) => {
    if (curr.preferences === prev.preferences && curr.locked === prev.locked && curr.loading === prev.loading) return;
    if (selectPreferences(curr).displayName !== selectPreferences(prev).displayName || curr.locked !== prev.locked || curr.loading !== prev.loading) {
      scheduleName(NAME_DEBOUNCE_MS);
    }
  });
  if (typeof window !== "undefined") window.addEventListener("online", () => scheduleName(0));
};
```

- [ ] **Passo 2: inviti di gruppo al mio account in `src/lib/groupSync.ts`**

Le richieste e il canale Realtime degli inviti ricevuti passano dall'email all'id dell'account.
Nel merge, `bindInviteRecipients` copia `recipientUserId` anche quando la migrazione di
`people.sql` lo ha scritto senza cambiare `updated_at` (il merge `newerWins` lo ignorerebbe).
`pushSharedInvite` diventa `async` e non invia più inviti con destinatario: la policy di
inserimento del Task 1 li rifiuta, e un invito per email non deve più nascere.

In `src/lib/groupSync.ts` cerca:

```ts
import { makeGroupInviteCode, mergeSharedSnapshot, type SharedSnapshot } from "./groups";
import { GROUP_JOINED_EVENT, clearPendingInvite, readPendingInvite } from "./groupInvite";
import { getSession, isCloudConfigured, supabase } from "./supabase";
import { selectPreferences, useStudyStore } from "../store/useStudyStore";
```

Sostituisci con:

```ts
import { makeGroupInviteCode, mergeSharedSnapshot, type SharedSnapshot } from "./groups";
import { GROUP_JOINED_EVENT, clearPendingInvite, readPendingInvite } from "./groupInvite";
import { bindInviteRecipients } from "./people";
import { getSession, isCloudConfigured, supabase } from "./supabase";
import { selectPreferences, useStudyStore } from "../store/useStudyStore";
```

In `src/lib/groupSync.ts` cerca:

```ts
  fromDisplayName: String(row.from_display_name ?? ""),
  recipientEmail: (row.recipient_email as string | null) ?? undefined,
  code: String(row.code ?? ""),
  status: (row.status as GroupInvite["status"]) ?? "pending"
```

Sostituisci con:

```ts
  fromDisplayName: String(row.from_display_name ?? ""),
  recipientEmail: (row.recipient_email as string | null) ?? undefined,
  recipientUserId: (row.recipient_user_id as string | null) ?? undefined,
  code: String(row.code ?? ""),
  status: (row.status as GroupInvite["status"]) ?? "pending"
```

In `src/lib/groupSync.ts` cerca:

```ts
  await applyShared({
    studyGroups: merged.groups,
    groupInvites: merged.invites,
    groupResources: merged.resources,
    groupActivities: merged.activities
```

Sostituisci con:

```ts
  await applyShared({
    studyGroups: merged.groups,
    // Il legame all'account arriva anche senza un updated_at più recente (migrazione di people.sql).
    groupInvites: bindInviteRecipients(merged.invites, snapshot.invites),
    groupResources: merged.resources,
    groupActivities: merged.activities
```

In `src/lib/groupSync.ts` cerca:

```ts
/**
 * Scarica le novità condivise: inviti nominali, risposte ai miei inviti,
 * membri/risorse/attività dei miei gruppi. Ritorna false se non applicabile.
 */
```

Sostituisci con:

```ts
/**
 * Scarica le novità condivise: inviti al mio account, risposte ai miei inviti,
 * membri/risorse/attività dei miei gruppi. Ritorna false se non applicabile.
 */
```

In `src/lib/groupSync.ts` cerca:

```ts
  if (!session?.user) return false;
  const me = session.user.id;
  const email = (session.user.email ?? "").toLowerCase();
  try {
    const snapshot: SharedSnapshot = { groups: [], invites: [], resources: [], activities: [] };
    if (email) {
      const { data, error } = await supabase.from("studyos_group_invites").select("*").eq("recipient_email", email).eq("status", "pending");
      if (error) throw error;
      snapshot.invites.push(...(data ?? []).map(toInvite));
    }
    const { data: sent, error: sentError } = await supabase.from("studyos_group_invites").select("*").eq("from_user_id", me);
    if (sentError) throw sentError;
```

Sostituisci con:

```ts
  if (!session?.user) return false;
  const me = session.user.id;
  try {
    const snapshot: SharedSnapshot = { groups: [], invites: [], resources: [], activities: [] };
    // Solo gli inviti legati al mio account (supabase/people.sql): l'email non vale più come prova.
    const { data, error } = await supabase.from("studyos_group_invites").select("*").eq("recipient_user_id", me).eq("status", "pending");
    if (error) throw error;
    snapshot.invites.push(...(data ?? []).map(toInvite));
    const { data: sent, error: sentError } = await supabase.from("studyos_group_invites").select("*").eq("from_user_id", me);
    if (sentError) throw sentError;
```

In `src/lib/groupSync.ts` cerca:

```ts
export const deleteSharedResource = (resourceId: string) => deleteRow("studyos_group_resources", resourceId);

export const pushSharedInvite = (invite: GroupInvite) =>
  pushRow("studyos_group_invites", {
    id: invite.id,
    group_id: invite.groupId,
```

Sostituisci con:

```ts
export const deleteSharedResource = (resourceId: string) => deleteRow("studyos_group_resources", resourceId);

/**
 * Solo inviti con codice, senza destinatario (la policy di inserimento rifiuta gli altri): quelli a
 * una persona li crea il server con invite_person_to_group, quelli per email non esistono più.
 */
export const pushSharedInvite = async (invite: GroupInvite) => {
  if (invite.recipientEmail || invite.recipientUserId) return false;
  return pushRow("studyos_group_invites", {
    id: invite.id,
    group_id: invite.groupId,
```

In `src/lib/groupSync.ts` cerca:

```ts
    from_user_id: invite.fromUserId,
    from_display_name: invite.fromDisplayName,
    recipient_email: invite.recipientEmail ?? null,
    code: invite.code,
    status: invite.status,
    updated_at: invite.updatedAt
  });

export const pushSharedResource = async (resource: GroupResource) => {
  const ok = await pushRow("studyos_group_resources", {
```

Sostituisci con:

```ts
    from_user_id: invite.fromUserId,
    from_display_name: invite.fromDisplayName,
    recipient_email: null,
    code: invite.code,
    status: invite.status,
    updated_at: invite.updatedAt
  });
};

/** Nome della persona appena invitata, solo per l'elenco di chi invita (il server non lo conserva). */
export const rememberInviteRecipient = async (inviteId: string, name: string) => {
  const state = useStudyStore.getState();
  if (!state.groupInvites.some((invite) => invite.id === inviteId && invite.recipientName !== name)) return;
  await applyShared({ groupInvites: state.groupInvites.map((invite) => (invite.id === inviteId ? { ...invite, recipientName: name } : invite)) });
};

export const pushSharedResource = async (resource: GroupResource) => {
  const ok = await pushRow("studyos_group_resources", {
```

In `src/lib/groupSync.ts` cerca:

```ts
let inviteChannel: RealtimeChannel | null = null;
let inviteSubscribedEmail = "";

const stopInviteSubscription = () => {
```

Sostituisci con:

```ts
let inviteChannel: RealtimeChannel | null = null;
let inviteSubscribedUser = "";

const stopInviteSubscription = () => {
```

In `src/lib/groupSync.ts` cerca:

```ts
  }
  inviteChannel = null;
  inviteSubscribedEmail = "";
};

const startInviteSubscription = (email: string) => {
  if (!supabase || inviteSubscribedEmail === email) return;
  stopInviteSubscription();
  inviteSubscribedEmail = email;
  inviteChannel = supabase
    .channel(`studyos-invites:${email}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "studyos_group_invites", filter: `recipient_email=eq.${email}` },
      (payload) => {
        const invite = toInvite((payload.new ?? {}) as Record<string, unknown>);
```

Sostituisci con:

```ts
  }
  inviteChannel = null;
  inviteSubscribedUser = "";
};

const startInviteSubscription = (userId: string) => {
  if (!supabase || inviteSubscribedUser === userId) return;
  stopInviteSubscription();
  inviteSubscribedUser = userId;
  inviteChannel = supabase
    .channel(`studyos-invites:${userId}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "studyos_group_invites", filter: `recipient_user_id=eq.${userId}` },
      (payload) => {
        const invite = toInvite((payload.new ?? {}) as Record<string, unknown>);
```

In `src/lib/groupSync.ts` cerca:

```ts
/**
 * Cassetta postale condivisa: pull iniziale + realtime sugli inviti nominali.
 * Silenziosa quando non applicabile (ospite, offline, migrazione assente).
 */
```

Sostituisci con:

```ts
/**
 * Cassetta postale condivisa: pull iniziale + realtime sugli inviti al mio account.
 * Silenziosa quando non applicabile (ospite, offline, migrazione assente).
 */
```

In `src/lib/groupSync.ts` cerca:

```ts
  if (!session?.user) return false;
  const ok = await pullSharedUpdates();
  const email = (session.user.email ?? "").toLowerCase();
  if (ok && email && supabase) startInviteSubscription(email);
  return ok;
};
```

Sostituisci con:

```ts
  if (!session?.user) return false;
  const ok = await pullSharedUpdates();
  if (ok && supabase) startInviteSubscription(session.user.id);
  return ok;
};
```

- [ ] **Passo 3: niente email e invito a una persona in `src/lib/shareSync.ts`**

`recipient_user_id` va letto con la colonna giusta: `studyos_share_invites` ha un grant per colonna,
quindi il Task 1 deve concedere `select (recipient_user_id)` (il Task 1 lo fa).

In `src/lib/shareSync.ts` cerca:

```ts
import { db, getMeta, setMeta } from "./db";
import { COLLECTION_BY_ENTITY_TYPE } from "./collections";
import { RESTORE_TEXT, REVERT_TEXT, SHARE_NOTICE_TEXT, SHARE_SCOPE_LABEL, scopesSummary } from "./labels";
import {
  SHARING_UNAVAILABLE_TEXT,
```

Sostituisci con:

```ts
import { db, getMeta, setMeta } from "./db";
import { COLLECTION_BY_ENTITY_TYPE } from "./collections";
import { RESTORE_TEXT, REVERT_TEXT, SHARE_NOTICE_TEXT, SHARE_SCOPE_LABEL, peopleLabels, scopesSummary } from "./labels";
import {
  SHARING_UNAVAILABLE_TEXT,
```

In `src/lib/shareSync.ts` cerca:

```ts
  grantSignature,
  inviteFromRow,
  missingVisibleKeys,
  offerToRow,
```

Sostituisci con:

```ts
  grantSignature,
  inviteFromRow,
  isMissingSharingObject,
  missingVisibleKeys,
  offerToRow,
```

In `src/lib/shareSync.ts` cerca:

```ts
const SHARE_COLUMNS =
  "id, owner_id, owner_name, scope, subject_ids, permission, grantee_user_id, grantee_group_id, grantee_name, grantee_email, created_at, updated_at";
// token_hash non è leggibile (grant per colonna): mai chiederlo.
const INVITE_COLUMNS = "id, owner_id, owner_name, offers, requests, recipient_email, status, accepted_by, expires_at, created_at";
const ROW_COLUMNS = "entity_type, entity_id, payload, deleted, updated_at";
```

Sostituisci con:

```ts
const SHARE_COLUMNS =
  "id, owner_id, owner_name, scope, subject_ids, permission, grantee_user_id, grantee_group_id, grantee_name, grantee_email, created_at, updated_at";
// token_hash non è leggibile (grant per colonna): mai chiederlo. recipient_user_id arriva con people.sql.
const INVITE_COLUMNS = "id, owner_id, owner_name, offers, requests, recipient_email, recipient_user_id, status, accepted_by, expires_at, created_at";
const ROW_COLUMNS = "entity_type, entity_id, payload, deleted, updated_at";
```

In `src/lib/shareSync.ts` cerca:

```ts
// ——— Azioni (UI e agente) ———

export const createShareInvite = async (input: { offers: ShareOffer[]; requests: ShareRequest[]; recipientEmail?: string }) => {
  await requireSharing();
  const { data, error } = await client().rpc("create_share_invite", {
```

Sostituisci con:

```ts
// ——— Azioni (UI e agente) ———

/** Invito con link (token). Gli inviti per email non esistono più: a chi ha un account si manda createPersonShareInvite. */
export const createShareInvite = async (input: { offers: ShareOffer[]; requests: ShareRequest[] }) => {
  await requireSharing();
  const { data, error } = await client().rpc("create_share_invite", {
```

In `src/lib/shareSync.ts` cerca:

```ts
    p_offers: input.offers.map(offerToRow),
    p_requests: input.requests.map((request) => ({ scope: request.scope, permission: request.permission })),
    p_recipient_email: input.recipientEmail?.trim() || null
  });
  fail(error);
```

Sostituisci con:

```ts
    p_offers: input.offers.map(offerToRow),
    p_requests: input.requests.map((request) => ({ scope: request.scope, permission: request.permission })),
    p_recipient_email: null
  });
  fail(error);
```

In `src/lib/shareSync.ts` cerca:

```ts
};

export const previewShareInvite = async (token: string): Promise<ShareInvitePreview | null> => {
  await requireSharing();
```

Sostituisci con:

```ts
};

/**
 * Invito nell'app a una persona trovata con la ricerca (supabase/people.sql): niente link né token,
 * solo il suo account può accettarlo. Ritorna l'id dell'invito.
 */
export const createPersonShareInvite = async (personId: string, offers: ShareOffer[], requests: ShareRequest[]) => {
  await requireSharing();
  const { data, error } = await client().rpc("invite_person_to_share", {
    p_person_id: personId,
    p_owner_name: myName(),
    p_offers: offers.map(offerToRow),
    p_requests: requests.map((request) => ({ scope: request.scope, permission: request.permission }))
  });
  // Condivisione attiva ma people.sql non ancora eseguito: lo si dice con il nome giusto dello script.
  if (error && isMissingSharingObject(error)) throw new ShareUserError(peopleLabels.errors.unavailable);
  fail(error);
  schedule();
  return String((data as { id?: string } | null)?.id ?? "");
};

export const previewShareInvite = async (token: string): Promise<ShareInvitePreview | null> => {
  await requireSharing();
```

- [ ] **Passo 4: via il campo email dal cassetto Condividi (`src/components/ShareDrawer.tsx`)**

La firma nuova di `createShareInvite` non accetta più `recipientEmail`: senza questo passo
`npm run lint` fallisce con `TS2353`. Il destinatario "Una persona" arriva nel Task 7.

In `src/components/ShareDrawer.tsx` cerca:

```tsx
  const [subjectIds, setSubjectIds] = useState<string[]>([]);
  const [target, setTarget] = useState<Target>("invite");
  const [email, setEmail] = useState("");
  const [askBack, setAskBack] = useState(false);
  const [busy, setBusy] = useState(false);
```

Sostituisci con:

```tsx
  const [subjectIds, setSubjectIds] = useState<string[]>([]);
  const [target, setTarget] = useState<Target>("invite");
  const [askBack, setAskBack] = useState(false);
  const [busy, setBusy] = useState(false);
```

In `src/components/ShareDrawer.tsx` cerca:

```tsx
    if (busy) return;
    if (!scopes.length) return setError("Scegli almeno una cosa da condividere.");
    const recipient = email.trim().toLowerCase();
    if (chosen === "invite" && recipient && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
      return setError("Controlla l'indirizzo email: sembra incompleto (es. nome@esempio.it).");
    }
    setError("");
    setBusy(true);
```

Sostituisci con:

```tsx
    if (busy) return;
    if (!scopes.length) return setError("Scegli almeno una cosa da condividere.");
    setError("");
    setBusy(true);
```

In `src/components/ShareDrawer.tsx` cerca:

```tsx
      if (chosen === "invite") {
        const requests = askBack ? list.map((offer) => ({ scope: offer.scope, permission: offer.permission })) : [];
        const { token } = await sync.createShareInvite({ offers: list, requests, recipientEmail: recipient || undefined });
        setCreated({ link: shareInviteLink(token), offers: list });
      } else {
```

Sostituisci con:

```tsx
      if (chosen === "invite") {
        const requests = askBack ? list.map((offer) => ({ scope: offer.scope, permission: offer.permission })) : [];
        const { token } = await sync.createShareInvite({ offers: list, requests });
        setCreated({ link: shareInviteLink(token), offers: list });
      } else {
```

In `src/components/ShareDrawer.tsx` cerca:

```tsx
          {chosen === "invite" ? (
            <div className="grid grid-cols-1 gap-3">
              <Field label="Email (facoltativa)">
                <input
                  className={inputClass}
                  type="email"
                  inputMode="email"
                  autoComplete="off"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="nome@esempio.it"
                />
              </Field>
              <p className="text-xs font-semibold text-[var(--muted)]">
                Con l'email l'invito compare anche nella sua app quando accede con quell'indirizzo. StudyOS non manda email: il link lo
                mandi tu.
              </p>
              <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-[18px] bg-[var(--surface-soft)] p-3">
                <input
```

Sostituisci con:

```tsx
          {chosen === "invite" ? (
            <div className="grid grid-cols-1 gap-3">
              <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-[18px] bg-[var(--surface-soft)] p-3">
                <input
```

- [ ] **Passo 5: avvio in differita in `src/App.tsx`**

In `src/App.tsx` cerca:

```tsx
      if (cloudConfigured) void import("./lib/cloudSync").then((module) => module.initCloudSync());
      if (cloudConfigured) void import("./lib/shareSync").then((module) => module.initShareSync());
    });
  }, [init]);
```

Sostituisci con:

```tsx
      if (cloudConfigured) void import("./lib/cloudSync").then((module) => module.initCloudSync());
      if (cloudConfigured) void import("./lib/shareSync").then((module) => module.initShareSync());
      // Nome del profilo online (ricerca persone): stesso caricamento in differita.
      if (cloudConfigured) void import("./lib/peopleSync").then((module) => module.initPeopleSync());
    });
  }, [init]);
```

- [ ] **Passo 6: test, typecheck, build e controllo del bundle iniziale**

```bash
npm test
```

Expected: `# fail 0` (stesso totale del Task 5).

```bash
npm run lint
```

Expected: nessun errore.

```bash
npm run build
```

Expected: `✓ built in …`.

Il controllo del bundle chiede una build con il cloud configurato: senza `VITE_SUPABASE_*`
`supabase` vale `null` e Vite toglie il codice cloud, così i `grep` non trovano nulla. I valori in
linea qui sotto sono finti (non sono chiavi, nessun file `.env`; `dist/` non si committa):

```bash
VITE_SUPABASE_URL=http://127.0.0.1:55421 VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_build_check npm run build
```

```bash
grep -l "studyos_profiles" dist/assets/*.js
```

Expected: un solo file, `dist/assets/peopleSync-<hash>.js`. (`find_person` non c'è ancora: le
funzioni di ricerca le usa il Task 7 e Vite toglie gli export non usati di un `import()`.)

```bash
grep -l "invite_person_to_share" dist/assets/*.js
```

Expected: un solo file, `dist/assets/shareSync-<hash>.js`.

```bash
grep -o '<script[^>]*src="[^"]*"' dist/index.html
```

Expected: `<script type="module" crossorigin src="./assets/index-<hash>.js"`, cioè un file diverso
da quelli trovati sopra.

```bash
grep -c -E "find_person|studyos_profiles|invite_person_to|is_handle_available" dist/assets/index-*.js
```

Expected: `0`. (`recipient_user_id` invece compare nel chunk iniziale: lo legge `inviteFromRow` di
`sharing.ts`, modulo puro che ci stava già.)

```bash
npm run build
```

Expected: `✓ built in …` (rifà `dist/` senza i valori finti).

- [ ] **Passo 7: prova sullo stack locale**

Con lo stack del Task 2 attivo e `supabase/people.sql` applicato (rieseguibile:
`psql "$PGURL" -v ON_ERROR_STOP=1 -f supabase/people.sql`), avvia due origini con le variabili in
linea, come in `scripts/supabase/local-stack.md` (niente `.env.local`):

```bash
VITE_SUPABASE_URL=http://127.0.0.1:55421 VITE_SUPABASE_PUBLISHABLE_KEY=<chiave publishable locale> npx vite --port 5180 --strictPort
```

```bash
VITE_SUPABASE_URL=http://127.0.0.1:55421 VITE_SUPABASE_PUBLISHABLE_KEY=<chiave publishable locale> npx vite --port 5181 --strictPort
```

Su `http://localhost:5181` accedi come `bob@studyos.test` (password in `local-stack.md`), scrivi
"Bob Prova" in Impostazioni → Profilo → "Il tuo nome", aspetta 2 secondi e nella console:

```js
const people = await import("/src/lib/peopleSync.ts");
await people.loadMyProfile();
await people.saveMyProfile({ handle: "@Bob.Prova" });
```

Expected: prima `{ displayName: "Bob Prova", handle: null, discoverable: true }` (riga creata e
nome copiato da `initPeopleSync`), poi `{ displayName: "Bob Prova", handle: "bob.prova", discoverable: true }`.

Su `http://localhost:5180` accedi come `alice@studyos.test`, crea un gruppo in Gruppi e nella console:

```js
const people = await import("/src/lib/peopleSync.ts");
const bob = await people.findPerson("@bob.prova");
[bob, await people.findPerson("BOB@studyos.test"), await people.findPerson("@nessuno.qui")];
```

Expected: le prime due voci uguali, `{ personId: "<uuid di Bob>", displayName: "Bob Prova", handle: "bob.prova" }`
(mai l'email), la terza `null`. Poi:

```js
const { useStudyStore } = await import("/src/store/useStudyStore.ts");
const group = useStudyStore.getState().studyGroups[0];
await people.invitePersonToGroup(group.id, bob.personId);
await people.invitePersonToShare(bob.personId, [{ scope: "goals", permission: "view", subjectIds: [] }], []);
```

Expected: due stringhe (id dell'invito di gruppo e uuid dell'invito di condivisione). Su 5181,
entro pochi secondi e senza ricaricare, la campanella mostra l'invito al gruppo (Realtime su
`recipient_user_id`) e Gruppi → "Inviti ricevuti" lo mostra con Accetta e Rifiuta; Condivisione →
Inviti mostra l'invito di Alice. Accetta entrambi: Bob entra nel gruppo e vede gli obiettivi di
Alice. Ripetere `invitePersonToGroup` con lo stesso gruppo dà l'errore `È già nel gruppo`.

Infine, su 5180, dal cassetto Condividi di una sezione crea un invito "Una persona nuova (con un
link di invito)": il link si crea come prima e non c'è più il campo email.

- [ ] **Passo 8: commit**

```bash
git add src/lib/peopleSync.ts src/lib/groupSync.ts src/lib/shareSync.ts src/components/ShareDrawer.tsx src/App.tsx
```

```bash
git commit -m "feat(people): lazy people sync and account-bound invites" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 7: "Trova una persona", profilo online, avviso una tantum e inviti scaduti

**Files:**
- Create: `src/components/FindPerson.tsx`, `src/components/ProfileOnlineCard.tsx`, `src/components/PeopleNotice.tsx`
- Modify: `src/components/GroupInvite.tsx`, `src/components/ShareDrawer.tsx`, `src/views/SettingsView.tsx`, `src/components/AppShell.tsx`, `src/views/GroupsView.tsx`, `src/views/SharingView.tsx`

**Interfaces:**
- Consumes: Task 5 (`people.ts`, `peopleLabels`), Task 6 (`peopleSync.ts` via `import()`, `rememberInviteRecipient`, `pullSharedUpdates`); `useCloudSession`, `useUiState`, `openSettings("profilo")` di `AppShell`, `ownerColor` / `initialsOf` di `sharing.ts`.
- Produces:
  - `FindPerson` (`onInvite(person): Promise<string | null>`: `null` = fatto, una stringa = errore da mostrare).
  - `ProfileOnlineCard` con prop `extra?: React.ReactNode`, resa come ultimo figlio; in Impostazioni → Profilo si inserisce esattamente `<ProfileOnlineCard />` (il Task 8 la cambia in `<ProfileOnlineCard extra={<PushToggle />} />`).
  - `PeopleNotice` in `AppShell`; chiave `useUiState` `peopleNoticeSeen` (booleano, ambito dispositivo, validata dal controllo di tipo predefinito di `useUiState`).

Nessuno di questi componenti importa staticamente `lib/supabase` o `lib/peopleSync`: `PeopleNotice`
sta nel bundle iniziale e legge solo la sessione (`useCloudSession`) e lo stato UI.

- [ ] **Passo 1: crea `src/components/FindPerson.tsx`**

Un campo unico (email o `@nome`), Invio o "Cerca". La ricerca non valida non parte. La scheda
mostra nome e `@nome` (o "Nome non impostato" / "Senza @nome"), mai l'email, e invita a controllarli
con la persona prima di invitarla. Il colore dell'avatar è calcolato dall'id (`ownerColor`), non
viene da dati scritti da altri.

```tsx
import { useState } from "react";
import { m } from "framer-motion";
import { peopleLabels } from "../lib/labels";
import { classifyPersonQuery, peopleCauseText, personHandle, personTitle, type FoundPerson } from "../lib/people";
import { initialsOf, ownerColor } from "../lib/sharing";
import { Button, inputClass } from "./ui";
import { Icon } from "./Icon";

type Result = { status: "idle" } | { status: "found"; person: FoundPerson } | { status: "none" };

/**
 * "Trova una persona": un campo (email esatta o @nome) e al massimo una scheda con nome e @nome,
 * mai l'email. Persona inesistente e non trovabile danno la stessa risposta. La ricerca passa da
 * peopleSync con import(): supabase-js resta fuori dal bundle iniziale. Cosa fa "Invita" lo decide
 * chi usa il componente (gruppo o condivisione).
 */
export function FindPerson({
  onInvite,
  actionLabel = peopleLabels.invite,
  disabled = false,
  disabledHint
}: {
  /** null se l'invito è partito (il campo si svuota), altrimenti il testo dell'errore da mostrare. */
  onInvite: (person: FoundPerson) => Promise<string | null>;
  actionLabel?: string;
  disabled?: boolean;
  disabledHint?: string;
}) {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<Result>({ status: "idle" });
  const [searching, setSearching] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [error, setError] = useState("");

  const search = async () => {
    if (searching || inviting || disabled) return;
    setError("");
    setResult({ status: "idle" });
    // Niente richiesta per un testo che non è né un'email intera né un @nome: non consuma il limite.
    if (!classifyPersonQuery(query)) {
      setError(peopleLabels.errors.badQuery);
      return;
    }
    setSearching(true);
    try {
      const people = await import("../lib/peopleSync");
      const person = await people.findPerson(query);
      setResult(person ? { status: "found", person } : { status: "none" });
    } catch (cause) {
      setError(peopleCauseText(cause));
    } finally {
      setSearching(false);
    }
  };

  const invite = async (person: FoundPerson) => {
    if (inviting || disabled) return;
    setError("");
    setInviting(true);
    try {
      const failure = await onInvite(person);
      if (failure) {
        setError(failure);
      } else {
        setQuery("");
        setResult({ status: "idle" });
      }
    } finally {
      setInviting(false);
    }
  };

  const found = result.status === "found" ? result.person : null;
  const handle = found ? personHandle(found) : null;

  return (
    <div className="grid grid-cols-1 gap-2">
      <p className="text-xs font-semibold text-[var(--muted)]">{peopleLabels.findHint}</p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          className={inputClass}
          type="text"
          inputMode="email"
          autoCapitalize="none"
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            if (result.status !== "idle") setResult({ status: "idle" });
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void search();
            }
          }}
          placeholder={peopleLabels.findPlaceholder}
          aria-label={peopleLabels.findFieldLabel}
          disabled={disabled}
        />
        <Button variant="soft" icon="Search" onClick={() => void search()} disabled={disabled || searching || inviting || !query.trim()}>
          {searching ? peopleLabels.searching : peopleLabels.search}
        </Button>
      </div>
      {disabled && disabledHint ? <p className="text-xs font-bold text-[var(--muted)]">{disabledHint}</p> : null}

      {found ? (
        <m.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
          className="grid grid-cols-1 gap-2 rounded-[18px] border border-[var(--border)] bg-[var(--surface)] p-3"
          aria-live="polite"
        >
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <span
              aria-hidden="true"
              className="grid h-11 w-11 shrink-0 place-items-center rounded-super text-sm font-black text-[#10131d]"
              style={{ background: ownerColor(found.personId) }}
            >
              {initialsOf(found.displayName || found.handle || "")}
            </span>
            <span className="min-w-0 flex-1">
              <span className="safe-text block text-sm font-black">{personTitle(found)}</span>
              <span className="safe-text block text-xs font-bold text-[var(--muted)]">{handle ?? peopleLabels.noHandle}</span>
            </span>
            <Button variant="primary" icon="UserPlus" onClick={() => void invite(found)} disabled={disabled || inviting}>
              {inviting ? peopleLabels.inviting : actionLabel}
            </Button>
          </div>
          <p className="flex items-start gap-1.5 text-xs font-semibold text-[var(--muted)]">
            <Icon name="ShieldCheck" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--accent-ink)]" />
            <span>{peopleLabels.checkHint}</span>
          </p>
        </m.div>
      ) : null}

      {result.status === "none" ? (
        <p role="status" className="flex items-start gap-2 rounded-[18px] bg-[var(--surface)] p-3 text-sm font-bold text-[var(--muted)]">
          <Icon name="Search" className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="min-w-0">
            <span className="block text-[var(--text)]">{peopleLabels.notFound}</span>
            <span className="block text-xs font-semibold">{peopleLabels.notFoundHint}</span>
          </span>
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm font-bold text-[var(--danger-text)]">
          {error}
        </p>
      ) : null}
    </div>
  );
}
```

- [ ] **Passo 2: pannello Invita dei gruppi (`src/components/GroupInvite.tsx`)**

La sezione "Invita per email" diventa "Invita una persona con il suo account": stessa regola di
oggi (proprietario e amministratori), serve l'account e il gruppo già online (`sharedAt`). Dopo
l'invito si scarica l'elenco (l'invito lo crea il server) e si ricorda il nome della persona solo in
locale. Nella cronologia del gruppo, che gli agenti possono leggere, va solo il nome visibile, mai il
`@nome` cercato.

In `src/components/GroupInvite.tsx` cerca:

```tsx
  pullSharedUpdates,
  pushSharedGroup,
  pushSharedInvite,
  pushSharedMembership,
  regenerateInviteCode,
  type Actor,
  type InvitePreviewResult
} from "../lib/groupSync";
import { Button, Drawer, Field, inputClass } from "./ui";
import { Icon } from "./Icon";
import { CloudPanel } from "./CloudPanel";
import { InviteQr, qrPngBlob } from "./InviteQr";
import { InlineConfirm } from "./InlineConfirm";
```

Sostituisci con:

```tsx
  pullSharedUpdates,
  pushSharedGroup,
  pushSharedMembership,
  regenerateInviteCode,
  rememberInviteRecipient,
  type Actor,
  type InvitePreviewResult
} from "../lib/groupSync";
import { peopleLabels } from "../lib/labels";
import { peopleCauseText, personName, type FoundPerson } from "../lib/people";
import { Button, Drawer } from "./ui";
import { Icon } from "./Icon";
import { CloudPanel } from "./CloudPanel";
import { FindPerson } from "./FindPerson";
import { InviteQr, qrPngBlob } from "./InviteQr";
import { InlineConfirm } from "./InlineConfirm";
```

In `src/components/GroupInvite.tsx` cerca:

```tsx
  const myRole = group.members.find((member) => member.userId === actor.userId)?.role;
  const isOwner = group.ownerId === actor.userId;
  const canInviteByEmail = myRole === "owner" || myRole === "admin";
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
```

Sostituisci con:

```tsx
  const myRole = group.members.find((member) => member.userId === actor.userId)?.role;
  const isOwner = group.ownerId === actor.userId;
  const canInvitePerson = myRole === "owner" || myRole === "admin";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
```

In `src/components/GroupInvite.tsx` cerca:

```tsx
  };

  const sendEmailInvite = async () => {
    if (busy) return;
    const recipient = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
      setError("Controlla l'indirizzo email: sembra incompleto (es. nome@esempio.it).");
      return;
    }
    setError("");
    setBusy(true);
    try {
      const store = useStudyStore.getState();
      const id = await store.createGroupInvite({
        groupId: group.id,
        groupName: group.name,
        groupDescription: group.description || undefined,
        fromUserId: actor.userId,
        fromDisplayName: actor.displayName,
        recipientEmail: recipient,
        code
      });
      const created = useStudyStore.getState().groupInvites.find((invite) => invite.id === id);
      if (created) await pushSharedInvite(created);
      await logSharedActivity(group.id, actor.displayName, `ha invitato ${recipient}`).catch(() => undefined);
      setEmail("");
      onNotice(`Invito inviato a ${recipient}: lo trova nella campanella e in Gruppi al prossimo accesso.`);
      setStatus(`Invito inviato a ${recipient}.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Non è stato possibile inviare l'invito. Riprova.");
    } finally {
      setBusy(false);
```

Sostituisci con:

```tsx
  };

  /** Invito all'account trovato: lo crea il server, poi si scarica per vederlo tra gli inviti mandati. */
  const invitePerson = async (person: FoundPerson): Promise<string | null> => {
    setError("");
    setStatus("");
    setBusy(true);
    try {
      const people = await import("../lib/peopleSync");
      const inviteId = await people.invitePersonToGroup(group.id, person.personId);
      const name = personName(person);
      // L'invito è già partito: da qui in poi un errore non lo annulla.
      await pullSharedUpdates();
      await rememberInviteRecipient(inviteId, name).catch(() => undefined);
      // Nella cronologia del gruppo solo il nome visibile, mai il @nome cercato.
      await logSharedActivity(group.id, actor.displayName, peopleLabels.groupActivity(person.displayName || peopleLabels.somebody)).catch(() => undefined);
      const text = peopleLabels.groupInvited(name);
      onNotice(text);
      setStatus(text);
      return null;
    } catch (cause) {
      return peopleCauseText(cause);
    } finally {
      setBusy(false);
```

In `src/components/GroupInvite.tsx` cerca:

```tsx
        </section>

        <section aria-labelledby="invite-email-title">
          <h3 id="invite-email-title" className="text-sm font-black">Invita per email</h3>
          {canInviteByEmail ? (
            <>
              <p className="mt-0.5 text-xs text-[var(--muted)]">Per chi ha già un account StudyOS: l'invito gli compare nell'app (nella campanella e in Gruppi) e può accettarlo con un tocco.</p>
              <Field label="Email del tuo compagno" className="mt-2">
                <div className="flex flex-col gap-2 sm:flex-row">
                  <input className={inputClass} type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Es. nome@esempio.it" inputMode="email" autoComplete="off" />
                  <Button variant="soft" icon="Send" onClick={() => void sendEmailInvite()} disabled={busy || !loggedIn} title={loggedIn ? undefined : "Accedi al tuo account per invitare per email"}>
                    {busy ? "Invio…" : "Invia invito"}
                  </Button>
                </div>
              </Field>
            </>
          ) : (
            <p className="mt-0.5 text-xs text-[var(--muted)]">Solo il proprietario e gli amministratori possono invitare per email. Tu puoi mandare il link, il QR o il codice.</p>
          )}
        </section>
```

Sostituisci con:

```tsx
        </section>

        <section aria-labelledby="invite-person-title">
          <h3 id="invite-person-title" className="text-sm font-black">{peopleLabels.groupSectionTitle}</h3>
          {canInvitePerson ? (
            <>
              <p className="mt-0.5 text-xs text-[var(--muted)]">{peopleLabels.groupSectionHint}</p>
              <div className="mt-2">
                <FindPerson
                  onInvite={invitePerson}
                  disabled={!loggedIn || !group.sharedAt}
                  disabledHint={!loggedIn ? peopleLabels.needsLogin : peopleLabels.groupNotOnline}
                />
              </div>
            </>
          ) : (
            <p className="mt-0.5 text-xs text-[var(--muted)]">{peopleLabels.groupNotAllowed}</p>
          )}
        </section>
```

- [ ] **Passo 3: destinatario "Una persona" nel cassetto Condividi (`src/components/ShareDrawer.tsx`)**

Il testo da cercare è quello dopo il Task 6. Con "Una persona (cerca per email o @nome)" il
cassetto mostra sezioni, permessi, "Chiedi in cambio le stesse cose" e "Trova una persona"; l'invito parte da
"Invita" sulla scheda, quindi il pulsante principale del piè di pagina sparisce.

In `src/components/ShareDrawer.tsx` cerca:

```tsx
import { useCloudSession } from "../hooks/useCloudSession";
import { cloudConfigured } from "../lib/cloudSyncState";
import { SHARE_PERMISSION_LABEL, SHARE_SCOPE_HINT, SHARE_SCOPE_LABEL, SHARE_TEXT, scopesSummary } from "../lib/labels";
import {
  SHARE_SCOPES,
```

Sostituisci con:

```tsx
import { useCloudSession } from "../hooks/useCloudSession";
import { cloudConfigured } from "../lib/cloudSyncState";
import { SHARE_PERMISSION_LABEL, SHARE_SCOPE_HINT, SHARE_SCOPE_LABEL, SHARE_TEXT, peopleLabels, scopesSummary } from "../lib/labels";
import { personName, type FoundPerson } from "../lib/people";
import {
  SHARE_SCOPES,
```

In `src/components/ShareDrawer.tsx` cerca:

```tsx
import { Icon } from "./Icon";
import { CloudPanel } from "./CloudPanel";
import { ShareLinkPanel } from "./ShareLinkPanel";

type Target = "invite" | `user:${string}` | `group:${string}`;

const toggle = <T,>(list: readonly T[], value: T) => (list.includes(value) ? list.filter((entry) => entry !== value) : [...list, value]);
```

Sostituisci con:

```tsx
import { Icon } from "./Icon";
import { CloudPanel } from "./CloudPanel";
import { FindPerson } from "./FindPerson";
import { ShareLinkPanel } from "./ShareLinkPanel";

/** invite: link da mandare; person: invito nell'app a una persona trovata con la ricerca. */
type Target = "invite" | "person" | `user:${string}` | `group:${string}`;

const toggle = <T,>(list: readonly T[], value: T) => (list.includes(value) ? list.filter((entry) => entry !== value) : [...list, value]);
```

In `src/components/ShareDrawer.tsx` cerca:

```tsx
  // server rifiuterebbe: si torna all'invito.
  const chosen: Target =
    target === "invite" || people.some((person) => `user:${person.userId}` === target) || groups.some((group) => `group:${group.id}` === target)
      ? target
      : "invite";
```

Sostituisci con:

```tsx
  // server rifiuterebbe: si torna all'invito.
  const chosen: Target =
    target === "invite" ||
    target === "person" ||
    people.some((person) => `user:${person.userId}` === target) ||
    groups.some((group) => `group:${group.id}` === target)
      ? target
      : "invite";
```

In `src/components/ShareDrawer.tsx` cerca:

```tsx
      : groups.find((group) => `group:${group.id}` === chosen)?.name ?? "Gruppo";

  const submit = async () => {
    if (busy) return;
    if (!scopes.length) return setError("Scegli almeno una cosa da condividere.");
    setError("");
```

Sostituisci con:

```tsx
      : groups.find((group) => `group:${group.id}` === chosen)?.name ?? "Gruppo";

  const requestsFor = (list: ShareOffer[]) => (askBack ? list.map((offer) => ({ scope: offer.scope, permission: offer.permission })) : []);

  /** "Invita" sulla scheda della persona trovata: l'invito compare nella sua app (niente link). */
  const invitePerson = async (person: FoundPerson): Promise<string | null> => {
    if (busy) return null;
    if (!scopes.length) return peopleLabels.needsScopes;
    setError("");
    setBusy(true);
    try {
      const sync = await import("../lib/peopleSync");
      const list = offers();
      await sync.invitePersonToShare(person.personId, list, requestsFor(list));
      setDone(peopleLabels.shareInvited(personName(person), scopesSummary(list)));
      return null;
    } catch (cause) {
      return shareActionErrorText("invite", cause);
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    if (busy || chosen === "person") return;
    if (!scopes.length) return setError("Scegli almeno una cosa da condividere.");
    setError("");
```

In `src/components/ShareDrawer.tsx` cerca:

```tsx
      const list = offers();
      if (chosen === "invite") {
        const requests = askBack ? list.map((offer) => ({ scope: offer.scope, permission: offer.permission })) : [];
        const { token } = await sync.createShareInvite({ offers: list, requests });
        setCreated({ link: shareInviteLink(token), offers: list });
      } else {
```

Sostituisci con:

```tsx
      const list = offers();
      if (chosen === "invite") {
        const { token } = await sync.createShareInvite({ offers: list, requests: requestsFor(list) });
        setCreated({ link: shareInviteLink(token), offers: list });
      } else {
```

In `src/components/ShareDrawer.tsx` cerca:

```tsx
        Annulla
      </Button>
      <Button variant="primary" icon={chosen === "invite" ? "UserPlus" : "Share2"} onClick={() => void submit()} disabled={busy || !scopes.length}>
        {busy ? "Un attimo…" : chosen === "invite" ? "Crea l'invito" : "Condividi"}
      </Button>
    </div>
  );
```

Sostituisci con:

```tsx
        Annulla
      </Button>
      {/* Per una persona trovata l'invito parte da "Invita" sulla sua scheda. */}
      {chosen === "person" ? null : (
        <Button variant="primary" icon={chosen === "invite" ? "UserPlus" : "Share2"} onClick={() => void submit()} disabled={busy || !scopes.length}>
          {busy ? "Un attimo…" : chosen === "invite" ? "Crea l'invito" : "Condividi"}
        </Button>
      )}
    </div>
  );
```

In `src/components/ShareDrawer.tsx` cerca:

```tsx
            <select className={inputClass} value={chosen} onChange={(event) => setTarget(event.target.value as Target)}>
              <option value="invite">Una persona nuova (con un link di invito)</option>
              {people.length ? (
                <optgroup label="Persone collegate">
```

Sostituisci con:

```tsx
            <select className={inputClass} value={chosen} onChange={(event) => setTarget(event.target.value as Target)}>
              <option value="invite">Una persona nuova (con un link di invito)</option>
              <option value="person">{peopleLabels.shareTarget}</option>
              {people.length ? (
                <optgroup label="Persone collegate">
```

In `src/components/ShareDrawer.tsx` cerca:

```tsx
          </Field>

          {chosen === "invite" ? (
            <div className="grid grid-cols-1 gap-3">
              <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-[18px] bg-[var(--surface-soft)] p-3">
```

Sostituisci con:

```tsx
          </Field>

          {chosen === "invite" || chosen === "person" ? (
            <div className="grid grid-cols-1 gap-3">
              <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-[18px] bg-[var(--surface-soft)] p-3">
```

In `src/components/ShareDrawer.tsx` cerca:

```tsx
          )}

          {error ? (
            <p role="alert" className="text-sm font-bold text-[var(--danger-text)]">
```

Sostituisci con:

```tsx
          )}

          {chosen === "person" ? (
            <section aria-label={peopleLabels.findTitle} className="grid grid-cols-1 gap-2">
              <span className="text-sm font-black">{peopleLabels.findTitle}</span>
              <FindPerson onInvite={invitePerson} disabled={!scopes.length} disabledHint={peopleLabels.needsScopes} />
            </section>
          ) : null}

          {error ? (
            <p role="alert" className="text-sm font-bold text-[var(--danger-text)]">
```

- [ ] **Passo 4: crea `src/components/ProfileOnlineCard.tsx` e inseriscila in Impostazioni → Profilo**

Nome visibile (in sola lettura, viene da "Il tuo nome"), `@nome` con controllo di disponibilità dopo
700 ms di pausa (conta nel limite di ricerche, quindi niente controllo a ogni tasto), "Salva @nome",
"Togli @nome" e l'interruttore "Gli altri possono trovarmi". Senza riga sul server vale
`DEFAULT_PROFILE` (trovabile, senza `@nome`). `extra` è l'ultimo figlio.

```tsx
import { useEffect, useState, type ReactNode } from "react";
import { useCloudSession } from "../hooks/useCloudSession";
import { cloudConfigured } from "../lib/cloudSyncState";
import { peopleLabels } from "../lib/labels";
import { DEFAULT_PROFILE, normalizeHandle, peopleCauseText, type MyProfile } from "../lib/people";
import { selectPreferences, useStudyStore } from "../store/useStudyStore";
import { Button, Field, inputClass } from "./ui";
import { Icon } from "./Icon";

type Availability = "idle" | "invalid" | "current" | "checking" | "free" | "taken";

/** Pausa prima di controllare un @nome: ogni controllo conta nel limite di ricerche al minuto. */
const HANDLE_CHECK_MS = 700;

const AVAILABILITY_TEXT: Record<Availability, string> = {
  idle: peopleLabels.handleRule,
  invalid: peopleLabels.handleRule,
  current: peopleLabels.handleCurrent,
  checking: peopleLabels.handleChecking,
  free: peopleLabels.handleAvailable,
  taken: peopleLabels.handleTaken
};

const AVAILABILITY_TONE: Record<Availability, string> = {
  idle: "text-[var(--muted)]",
  invalid: "text-[var(--danger-text)]",
  current: "text-[var(--muted)]",
  checking: "text-[var(--muted)]",
  free: "text-[var(--success-text)]",
  taken: "text-[var(--danger-text)]"
};

/**
 * Profilo online in Impostazioni → Profilo: nome visibile (quello di "Il tuo nome"), @nome con
 * controllo di disponibilità e "Gli altri possono trovarmi". peopleSync arriva con import(): niente
 * supabase-js nel bundle iniziale. `extra` (es. le notifiche di questo dispositivo) va in fondo.
 */
export function ProfileOnlineCard({ extra }: { extra?: ReactNode }) {
  const session = useCloudSession();
  const me = session?.user.id ?? null;
  const displayName = useStudyStore((state) => selectPreferences(state).displayName.trim());
  const [profile, setProfile] = useState<MyProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [reload, setReload] = useState(0);
  const [draft, setDraft] = useState("");
  const [availability, setAvailability] = useState<Availability>("idle");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  // Profilo dell'account attuale (si rilegge cambiando account). Riga mancante = trovabile, senza @nome.
  useEffect(() => {
    setProfile(null);
    setLoadError("");
    setMessage(null);
    if (!me) return;
    let alive = true;
    setLoading(true);
    void import("../lib/peopleSync")
      .then((people) => people.loadMyProfile())
      .then((loaded) => {
        if (!alive) return;
        const next = loaded ?? { ...DEFAULT_PROFILE };
        setProfile(next);
        setDraft(next.handle ?? "");
      })
      .catch((cause: unknown) => {
        if (alive) setLoadError(peopleCauseText(cause));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [me, reload]);

  const ready = profile !== null;
  const current = profile?.handle ?? null;
  const normalized = normalizeHandle(draft);
  const typed = draft.trim() !== "";

  // Disponibilità: solo per un @nome valido e diverso da quello salvato, dopo una pausa di scrittura.
  useEffect(() => {
    if (!ready || !typed) {
      setAvailability("idle");
      return;
    }
    if (!normalized) {
      setAvailability("invalid");
      return;
    }
    if (normalized === current) {
      setAvailability("current");
      return;
    }
    setAvailability("checking");
    let alive = true;
    const timer = setTimeout(() => {
      void import("../lib/peopleSync")
        .then((people) => people.isHandleAvailable(normalized))
        .then((free) => {
          if (alive) setAvailability(free ? "free" : "taken");
        })
        .catch((cause: unknown) => {
          if (!alive) return;
          setAvailability("idle");
          setMessage({ tone: "error", text: peopleCauseText(cause) });
        });
    }, HANDLE_CHECK_MS);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [ready, typed, normalized, current]);

  const save = async (patch: Partial<Pick<MyProfile, "handle" | "discoverable">>, done: (saved: MyProfile) => string) => {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const people = await import("../lib/peopleSync");
      const saved = await people.saveMyProfile(patch);
      setProfile(saved);
      setDraft(saved.handle ?? "");
      setMessage({ tone: "ok", text: done(saved) });
    } catch (cause) {
      setMessage({ tone: "error", text: peopleCauseText(cause) });
    } finally {
      setBusy(false);
    }
  };

  const saveHandle = () => {
    if (!normalized) {
      setMessage({ tone: "error", text: peopleLabels.errors.badHandle });
      return;
    }
    if (normalized === current || availability === "taken" || availability === "checking") return;
    void save({ handle: normalized }, (saved) => peopleLabels.handleSaved(saved.handle ?? normalized));
  };

  let body: ReactNode;
  if (!cloudConfigured) {
    body = <p className="text-sm font-bold text-[var(--muted)]">{peopleLabels.profileNoCloud}</p>;
  } else if (!me) {
    body = <p className="text-sm font-bold text-[var(--muted)]">{peopleLabels.profileSignedOut}</p>;
  } else if (loading || (!profile && !loadError)) {
    body = <p className="text-sm font-bold text-[var(--muted)]">{peopleLabels.profileLoading}</p>;
  } else if (loadError || !profile) {
    body = (
      <div className="flex flex-wrap items-center gap-2">
        <p role="alert" className="min-w-0 flex-1 text-sm font-bold text-[var(--danger-text)]">
          {loadError}
        </p>
        <Button variant="soft" icon="RotateCcw" onClick={() => setReload((count) => count + 1)}>
          {peopleLabels.retry}
        </Button>
      </div>
    );
  } else {
    body = (
      <>
        <p className="text-sm font-bold">
          {peopleLabels.profileVisibleName(displayName || peopleLabels.noName)}
          <span className="block text-xs font-semibold text-[var(--muted)]">{peopleLabels.profileNameHint}</span>
        </p>
        <Field label={peopleLabels.handleLabel}>
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="relative min-w-0 flex-1">
              <span aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-black text-[var(--faint)]">
                @
              </span>
              <input
                className={`${inputClass} pl-7`}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    saveHandle();
                  }
                }}
                placeholder={peopleLabels.handlePlaceholder}
                autoCapitalize="none"
                autoComplete="off"
                spellCheck={false}
                maxLength={25}
                aria-describedby="profile-handle-status"
                disabled={busy}
              />
            </div>
            <Button
              variant="soft"
              icon="Check"
              onClick={saveHandle}
              disabled={busy || !normalized || normalized === current || availability === "taken" || availability === "checking"}
            >
              {busy ? peopleLabels.saving : peopleLabels.handleSave}
            </Button>
          </div>
        </Field>
        <div className="-mt-1 flex flex-wrap items-center justify-between gap-2">
          <p id="profile-handle-status" aria-live="polite" className={`text-xs font-bold ${AVAILABILITY_TONE[availability]}`}>
            {AVAILABILITY_TEXT[availability]}
          </p>
          {current ? (
            <Button variant="ghost" icon="X" onClick={() => void save({ handle: null }, () => peopleLabels.handleRemoved)} disabled={busy}>
              {peopleLabels.handleRemove}
            </Button>
          ) : null}
        </div>
        <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-[18px] bg-[var(--surface)] p-3">
          <input
            type="checkbox"
            role="switch"
            aria-checked={profile.discoverable}
            className="mt-1 h-4 w-4 shrink-0 accent-[var(--accent)]"
            checked={profile.discoverable}
            disabled={busy}
            onChange={(event) =>
              void save({ discoverable: event.target.checked }, (saved) => (saved.discoverable ? peopleLabels.discoverableOn : peopleLabels.discoverableOff))
            }
          />
          <span className="min-w-0">
            <span className="block text-sm font-black">{peopleLabels.discoverableLabel}</span>
            <span className="block text-xs font-semibold text-[var(--muted)]">
              {profile.discoverable ? peopleLabels.discoverableOn : peopleLabels.discoverableOff}
            </span>
          </span>
        </label>
        {message ? (
          <p role={message.tone === "ok" ? "status" : "alert"} className={`text-sm font-bold ${message.tone === "ok" ? "text-[var(--success-text)]" : "text-[var(--danger-text)]"}`}>
            {message.text}
          </p>
        ) : null}
      </>
    );
  }

  return (
    <section aria-labelledby="profile-online-title" className="mt-4 grid grid-cols-1 gap-3 rounded-[20px] bg-[var(--surface-soft)] p-3 sm:p-4">
      <div className="flex items-start gap-2">
        <Icon name="Globe" className="mt-0.5 h-4 w-4 shrink-0 text-[var(--accent-ink)]" />
        <div className="min-w-0">
          <h4 id="profile-online-title" className="text-sm font-black">
            {peopleLabels.profileTitle}
          </h4>
          <p className="text-xs font-bold text-[var(--muted)]">{peopleLabels.profileIntro}</p>
        </div>
      </div>
      {body}
      {extra}
    </section>
  );
}
```

In `src/views/SettingsView.tsx` cerca:

```tsx
import { CloudPanel } from "../components/CloudPanel";
import { AgentSettings } from "../components/AgentDesk";

const palettes: { id: PaletteName; label: string; colors: string[] }[] = [
```

Sostituisci con:

```tsx
import { CloudPanel } from "../components/CloudPanel";
import { AgentSettings } from "../components/AgentDesk";
import { ProfileOnlineCard } from "../components/ProfileOnlineCard";

const palettes: { id: PaletteName; label: string; colors: string[] }[] = [
```

In `src/views/SettingsView.tsx` cerca:

```tsx
            <span className="min-w-0 flex-1">Mostra la sezione Corso di laurea (BARB · UNIMI)</span>
          </label>
        </Panel>
        </section>
```

Sostituisci con:

```tsx
            <span className="min-w-0 flex-1">Mostra la sezione Corso di laurea (BARB · UNIMI)</span>
          </label>
          <ProfileOnlineCard />
        </Panel>
        </section>
```

- [ ] **Passo 5: crea `src/components/PeopleNotice.tsx` e montalo in `AppShell`**

Testo dello spec alla lettera, con **Ok** e **Apri il profilo**. Compare una volta per dispositivo,
solo con l'account; "Apri il profilo" usa `openSettings("profilo")` di `AppShell`.

```tsx
import { useCloudSession } from "../hooks/useCloudSession";
import { cloudConfigured } from "../lib/cloudSyncState";
import { peopleLabels } from "../lib/labels";
import { useUiState } from "../lib/uiState";
import { Button } from "./ui";
import { Icon } from "./Icon";

/**
 * Avviso una tantum dopo l'arrivo della ricerca persone: gli account sono trovabili di default.
 * Montato in AppShell (bundle iniziale): solo stato UI e sessione, mai peopleSync o supabase-js.
 * "Visto" vale per questo dispositivo (chiave di useUiState `peopleNoticeSeen`).
 */
export function PeopleNotice({ onOpenProfile }: { onOpenProfile: () => void }) {
  const session = useCloudSession();
  // Senza validate: useUiState accetta solo un valore salvato dello stesso tipo (boolean).
  const [seen, setSeen] = useUiState<boolean>("peopleNoticeSeen", false);
  if (!cloudConfigured || !session || seen) return null;
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-[22px] border border-[var(--border)] bg-[var(--surface-soft)] p-3 text-sm font-bold">
      <Icon name="Search" className="h-4 w-4 shrink-0 text-[var(--accent-ink)]" />
      <span className="min-w-0 flex-1">{peopleLabels.notice}</span>
      <span className="flex shrink-0 flex-wrap gap-2">
        <Button
          variant="soft"
          icon="User"
          onClick={() => {
            setSeen(true);
            onOpenProfile();
          }}
        >
          {peopleLabels.noticeOpenProfile}
        </Button>
        <Button variant="primary" onClick={() => setSeen(true)}>
          {peopleLabels.noticeOk}
        </Button>
      </span>
    </div>
  );
}
```

In `src/components/AppShell.tsx` cerca:

```tsx
import { AgentDock } from "./AgentDesk";
import { StudyTimerWatcher } from "./StudyTimerWatcher";
import { requestSettingsSection } from "../lib/settingsJump";
import { QUICK_ADD_EVENT } from "../lib/quickAdd";
```

Sostituisci con:

```tsx
import { AgentDock } from "./AgentDesk";
import { StudyTimerWatcher } from "./StudyTimerWatcher";
import { PeopleNotice } from "./PeopleNotice";
import { requestSettingsSection } from "../lib/settingsJump";
import { QUICK_ADD_EVENT } from "../lib/quickAdd";
```

In `src/components/AppShell.tsx` cerca:

```tsx
              </div>
            ) : null}
          </div>
```

Sostituisci con:

```tsx
              </div>
            ) : null}
          </div>

          {/* Avviso una tantum della ricerca persone (trovabili di default): solo con l'account. */}
          <div className="mx-auto max-w-[1380px]">
            <PeopleNotice onOpenProfile={() => openSettings("profilo")} />
          </div>
```

- [ ] **Passo 6: inviti per email "Scaduto" e inviti mandati in `GroupsView` e `SharingView`**

Gli inviti per email rimasti senza account dopo la migrazione (`isExpiredEmailInvite`) non si
mostrano più tra quelli ricevuti; chi li ha mandati li vede come "Scaduto: cerca la persona per
invitarla di nuovo". Gli inviti a una persona mostrano il nome ricordato o "Persona invitata" (gruppi)
e "A una persona, nella sua app" (condivisione).

In `src/views/GroupsView.tsx` cerca:

```tsx
import { safeHref } from "../lib/safeUrl";
import { isNullableString, oneOf, useUiState } from "../lib/uiState";

type DetailTab = "bacheca" | "membri" | "attivita";
```

Sostituisci con:

```tsx
import { safeHref } from "../lib/safeUrl";
import { isNullableString, oneOf, useUiState } from "../lib/uiState";
import { peopleLabels } from "../lib/labels";
import { groupInviteRecipient, isExpiredEmailInvite } from "../lib/people";

type DetailTab = "bacheca" | "membri" | "attivita";
```

In `src/views/GroupsView.tsx` cerca:

```tsx
  const myId = actor?.userId;
  const received = groupInvites
    .filter((invite) => invite.status === "pending" && invite.fromUserId !== myId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const open = openId ? studyGroups.find((group) => group.id === openId) ?? null : null;
```

Sostituisci con:

```tsx
  const myId = actor?.userId;
  // Un invito per email mai legato a un account non si può più accettare: non si mostra.
  const received = groupInvites
    .filter((invite) => invite.status === "pending" && invite.fromUserId !== myId && !isExpiredEmailInvite(invite))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const open = openId ? studyGroups.find((group) => group.id === openId) ?? null : null;
```

In `src/views/GroupsView.tsx` cerca:

```tsx
            <ul className="mt-2 grid grid-cols-1 gap-1.5 text-xs text-[var(--muted)]">
              <li><strong>Proprietario</strong>: ha creato il gruppo. Sceglie i ruoli, può togliere persone e contenuti dalla bacheca ed eliminare il gruppo.</li>
              <li><strong>Amministratore</strong>: come un membro, ma può anche invitare persone per email.</li>
              <li><strong>Membro</strong>: aggiunge link, note e file in bacheca e invita altri con link, QR o codice.</li>
            </ul>
```

Sostituisci con:

```tsx
            <ul className="mt-2 grid grid-cols-1 gap-1.5 text-xs text-[var(--muted)]">
              <li><strong>Proprietario</strong>: ha creato il gruppo. Sceglie i ruoli, può togliere persone e contenuti dalla bacheca ed eliminare il gruppo.</li>
              <li><strong>Amministratore</strong>: {peopleLabels.adminRoleHint}</li>
              <li><strong>Membro</strong>: aggiunge link, note e file in bacheca e invita altri con link, QR o codice.</li>
            </ul>
```

In `src/views/GroupsView.tsx` cerca:

```tsx
          {sentInvites.length ? (
            <div className="mt-4">
              <h4 className="mb-2 text-xs font-black uppercase text-[var(--faint)]">Inviti in attesa di risposta · {sentInvites.length}</h4>
              <ul className="grid grid-cols-1 gap-1.5">
                {sentInvites.map((invite) => (
                  <li key={invite.id} className="flex min-w-0 items-center gap-2 rounded-[14px] bg-[var(--surface-soft)] px-3 py-2 text-xs">
                    <Icon name="Mail" className="h-3.5 w-3.5 shrink-0 text-[var(--faint)]" />
                    <span className="one-line-safe min-w-0 flex-1 font-bold">{invite.recipientEmail ?? `Codice ${invite.code}`}</span>
                    <span className="shrink-0 font-black text-[var(--muted)]">in attesa</span>
                  </li>
                ))}
              </ul>
            </div>
```

Sostituisci con:

```tsx
          {sentInvites.length ? (
            <div className="mt-4">
              <h4 className="mb-2 text-xs font-black uppercase text-[var(--faint)]">{peopleLabels.sentInvitesTitle(sentInvites.length)}</h4>
              <ul className="grid grid-cols-1 gap-1.5">
                {sentInvites.map((invite) => {
                  // Invito per email di prima, non legato a nessun account: non si può più accettare.
                  const expired = isExpiredEmailInvite(invite);
                  return (
                    <li key={invite.id} className="flex min-w-0 items-start gap-2 rounded-[14px] bg-[var(--surface-soft)] px-3 py-2 text-xs">
                      <Icon name={expired ? "AlertTriangle" : "Mail"} className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--faint)]" />
                      <span className="min-w-0 flex-1">
                        <span className="one-line-safe block font-bold">{groupInviteRecipient(invite)}</span>
                        {expired ? <span className="block text-[var(--muted)]">{peopleLabels.expiredEmailInvite}</span> : null}
                      </span>
                      <span className="shrink-0 font-black text-[var(--muted)]">{expired ? peopleLabels.expired : peopleLabels.waiting}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
```

In `src/views/SharingView.tsx` cerca:

```tsx
  SHARE_SCOPE_LABEL,
  SHARING_TAB_LABEL,
  scopesSummary
} from "../lib/labels";
import {
  SUBJECTLESS_SCOPES,
```

Sostituisci con:

```tsx
  SHARE_SCOPE_LABEL,
  SHARING_TAB_LABEL,
  peopleLabels,
  scopesSummary
} from "../lib/labels";
import { isExpiredEmailInvite, shareInviteRecipient } from "../lib/people";
import {
  SUBJECTLESS_SCOPES,
```

In `src/views/SharingView.tsx` cerca:

```tsx
  const incoming = waitingForLink
    ? []
    : invites.filter((invite) => invite.ownerId !== me && invite.status === "pending" && !(pending && invite.id === openedId));
  const sent = invites.filter((invite) => invite.ownerId === me);
  const connecting = availability !== "ready" && availability !== "missing";
```

Sostituisci con:

```tsx
  const incoming = waitingForLink
    ? []
    : invites.filter(
        (invite) => invite.ownerId !== me && invite.status === "pending" && !isExpiredEmailInvite(invite) && !(pending && invite.id === openedId)
      );
  const sent = invites.filter((invite) => invite.ownerId === me);
  const connecting = availability !== "ready" && availability !== "missing";
```

In `src/views/SharingView.tsx` cerca:

```tsx
              {scopesSummary(invite.offers)}
              <span className="block text-xs text-[var(--muted)]">
                {invite.recipientEmail ?? "Con link"} · {SHARE_INVITE_STATUS_LABEL[invite.status]}
                {invite.status === "pending" && shortDate(invite.expiresAt) ? ` fino al ${shortDate(invite.expiresAt)}` : ""}
              </span>
            </span>
```

Sostituisci con:

```tsx
              {scopesSummary(invite.offers)}
              <span className="block text-xs text-[var(--muted)]">
                {isExpiredEmailInvite(invite) ? (
                  `${invite.recipientEmail} · ${peopleLabels.expiredEmailInvite}`
                ) : (
                  <>
                    {shareInviteRecipient(invite)} · {SHARE_INVITE_STATUS_LABEL[invite.status]}
                    {invite.status === "pending" && shortDate(invite.expiresAt) ? ` fino al ${shortDate(invite.expiresAt)}` : ""}
                  </>
                )}
              </span>
            </span>
```

In `src/views/SharingView.tsx` cerca:

```tsx
                variant="ghost"
                icon="X"
                aria-label={`Annulla l'invito: ${scopesSummary(invite.offers)}, ${invite.recipientEmail ?? "con link"}`}
                onClick={() => setConfirmId(invite.id)}
              >
```

Sostituisci con:

```tsx
                variant="ghost"
                icon="X"
                aria-label={`Annulla l'invito: ${scopesSummary(invite.offers)}, ${shareInviteRecipient(invite)}`}
                onClick={() => setConfirmId(invite.id)}
              >
```

- [ ] **Passo 7: test, typecheck, build e controllo del bundle iniziale**

```bash
npm test
```

Expected: `# fail 0` (stesso totale del Task 5).

```bash
npm run lint
```

Expected: nessun errore.

```bash
npm run build
```

Expected: `✓ built in …`.

Controllo del bundle con i valori finti del Task 6:

```bash
VITE_SUPABASE_URL=http://127.0.0.1:55421 VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_build_check npm run build
```

```bash
grep -l "find_person\|is_handle_available\|invite_person_to_group" dist/assets/*.js
```

Expected: un solo file, `dist/assets/peopleSync-<hash>.js`.

```bash
grep -c -E "find_person|studyos_profiles|invite_person_to|is_handle_available" dist/assets/index-*.js
```

Expected: `0`. (Le etichette di `peopleLabels` e il testo dell'avviso stanno invece nel chunk
iniziale, come tutte le altre etichette.)

```bash
npm run build
```

Expected: `✓ built in …`.

- [ ] **Passo 8: prova nel browser con due account (stack locale)**

Con le due origini del Task 6 (Alice su 5180, Bob su 5181):

1. Bob, con l'account, vede in cima l'avviso "Ora chi conosce la tua email o il tuo @nome può
   trovarti…": "Apri il profilo" apre Impostazioni → Profilo e l'avviso non torna dopo un
   ricaricamento. Senza account l'avviso non compare.
2. Bob, in "Profilo online": scrive `Bob.Prova` → "È il tuo @nome."; scrive `bob.nuovo` → dopo
   un attimo "Libero: puoi usarlo." → "Salva @nome" → "Fatto: ora ti trovano anche come @bob.nuovo.";
   scrive `bo` → la regola dei 3–24 caratteri, senza richieste in Network.
3. Alice crea un secondo gruppo (nel primo Bob è già entrato al Task 6) e da Invita, in "Invita
   una persona con il suo account", cerca
   `giulia rossi` → "Scrivi un'email completa (nome@esempio.it) o un @nome." (nessuna richiesta),
   poi `@bob.nuovo` → scheda con "Bob Prova" e "@bob.nuovo", senza email → "Invita" → "Invito
   mandato a Bob Prova: …". In Membri → "Inviti mandati · 1" la riga dice "Bob Prova" e "in attesa".
4. Bob vede l'invito nella campanella senza ricaricare e lo accetta.
5. Alice apre Condividi da una sezione, sceglie "Una persona (cerca per email o @nome)", cerca
   `bob@studyos.test` → "Invita" → "Invito mandato a Bob Prova: …". Bob lo trova in Condivisione → Inviti.
6. Bob spegne "Gli altri possono trovarmi"; Alice cerca `@bob.nuovo` → "Nessuna persona trovata",
   come per un account che non esiste. Bob lo riaccende.
7. A 375 px di larghezza (strumenti per sviluppatori) la scheda trovata, il pannello Invita e il
   profilo online non scorrono in orizzontale.

- [ ] **Passo 9: commit**

```bash
git add src/components/FindPerson.tsx src/components/ProfileOnlineCard.tsx src/components/PeopleNotice.tsx src/components/GroupInvite.tsx src/components/ShareDrawer.tsx src/views/SettingsView.tsx src/components/AppShell.tsx src/views/GroupsView.tsx src/views/SharingView.tsx
```

```bash
git commit -m "feat(people): find person, online profile and one-time notice" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

## Fase 4 — Client: iscrizione push, service worker e collegamento profondo

Vincoli che valgono per i Task 8–11 (il resto è nell'intestazione del piano): nel client solo
la chiave `sb_publishable_`; `lib/push` e `lib/supabase` solo con `import()` da store, shell e
componenti sempre montati; etichette solo in `src/lib/labels.ts`; ogni `grid` ha `grid-cols-*`;
Git nel worktree con comandi semplici e separati (niente `cd … &&`, `git -C`, `$(…)`); mai
`wrangler deploy` né `wrangler secret put` senza il via esplicito dell'utente.

### Task 8: `src/lib/push.ts`, interruttore, proposta dopo il primo invito e `?apri=`

**Files:**
- Create: `src/lib/push.ts`, `src/lib/openLink.ts`, `src/hooks/useOpenLink.ts`, `src/components/PushToggle.tsx`, `src/components/PushPrompt.tsx`, `tests/push.test.mjs`
- Modify: `src/lib/labels.ts` (in coda), `src/App.tsx`, `src/components/AppShell.tsx`, `src/views/SettingsView.tsx`, `src/components/CloudPanel.tsx`

**Interfaces:**
- Consumes: `VAPID_PUBLIC_KEY` da `src/lib/pushKeys.ts` (Task 4); tabella `studyos_push_subscriptions` (Task 1: colonne `endpoint` unique, `p256dh`, `auth`, `last_seen_at`; `user_id` si compila da solo con `auth.uid()`; RLS sulle sole proprie righe); `ProfileOnlineCard` con prop `extra` (Task 7); `useCloudSession` e `subscribeCloudSync` (esistenti, senza supabase-js).
- Produces:
  - `push.ts` (solo `import()`): `pushSupport(): "ok" | "unsupported" | "ios-install" | "denied"`, `enablePush(): Promise<boolean>`, `disablePush(): Promise<void>`, `syncPushSubscription(): Promise<void>`, più `isPushEnabled(userId: string): Promise<boolean>` e le funzioni pure `classifyPushSupport`, `base64UrlToBytes`, `sameServerKey`, `rowFromSubscription`, `parsePushState`, `shouldRefresh`.
  - `openLink.ts` (puro): `OPEN_NOTIFICATIONS_EVENT`, `OpenTarget`, `parseOpenTarget(search)`, `urlWithoutOpen(href)`, `requestOpenNotifications()`.
  - `pushLabels` in `labels.ts`; chiave `useUiState` `pushPromptSeen` (booleano, ambito dispositivo).

Prerequisiti: Task 4 (`src/lib/pushKeys.ts` esiste) e Task 7 (`grep -n "ProfileOnlineCard" src/views/SettingsView.tsx` mostra l'import e la riga `<ProfileOnlineCard />`). Il service worker del Task 9 non serve ancora per i test di questo task.

- [ ] **Passo 1: `pushLabels` in coda a `src/lib/labels.ts`**

`labels.ts` è modificato anche dal Task 5 (`peopleLabels`): non si cita il testo finale, si aggiunge in coda senza toccare il resto.

```bash
cat >> src/lib/labels.ts <<'EOF'

/** Notifiche push del dispositivo: interruttore in Impostazioni → Profilo e proposta dopo il primo invito. */
export const pushLabels = {
  toggle: "Notifiche su questo dispositivo",
  hint: "Ricevi un avviso anche con l'app chiusa: inviti, inviti accettati e permessi cambiati.",
  checking: "Controllo…",
  on: "Attive su questo dispositivo. Puoi spegnerle quando vuoi.",
  off: "Spente su questo dispositivo.",
  needAccount: "Accedi con il tuo account per ricevere le notifiche.",
  unsupported: "Questo browser non supporta le notifiche. Gli avvisi restano nella campanella dell'app.",
  iosInstall: "Aggiungi StudyOS alla schermata Home per ricevere le notifiche",
  denied: "Hai bloccato le notifiche per StudyOS. Riattivale dalle impostazioni del browser o del telefono, poi torna qui.",
  failed: "Non sono riuscito ad attivare le notifiche. Riprova tra poco.",
  promptTitle: "Vuoi un avviso quando ricevi un invito?",
  promptBody:
    "Ti mandiamo una notifica anche quando StudyOS è chiuso: inviti, inviti accettati e permessi cambiati. Puoi spegnerla in Impostazioni → Profilo.",
  promptAccept: "Attiva le notifiche",
  promptLater: "Non ora",
  promptFailed: "Non è stato possibile attivarle. Puoi riprovare da Impostazioni → Profilo.",
  promptClose: "Chiudi"
} as const;
EOF
```

- [ ] **Passo 2: test che falliscono, `tests/push.test.mjs`**

```js
import test from "node:test";
import assert from "node:assert/strict";

const { classifyPushSupport, base64UrlToBytes, sameServerKey, rowFromSubscription, parsePushState, shouldRefresh } = await import("../src/lib/push.ts");
const { parseOpenTarget, urlWithoutOpen } = await import("../src/lib/openLink.ts");

const env = (patch = {}) => ({
  isIos: false,
  standalone: false,
  hasServiceWorker: true,
  hasPushManager: true,
  hasNotification: true,
  permission: "default",
  ...patch
});

test("supporto push: browser completo e permesso da chiedere", () => {
  assert.equal(classifyPushSupport(env()), "ok");
  assert.equal(classifyPushSupport(env({ permission: "granted" })), "ok");
});

test("supporto push: permesso negato e API mancanti", () => {
  assert.equal(classifyPushSupport(env({ permission: "denied" })), "denied");
  assert.equal(classifyPushSupport(env({ hasPushManager: false })), "unsupported");
  assert.equal(classifyPushSupport(env({ hasServiceWorker: false })), "unsupported");
  assert.equal(classifyPushSupport(env({ hasNotification: false, permission: null })), "unsupported");
});

test("supporto push: iPhone e iPad vogliono StudyOS nella schermata Home", () => {
  // Safari in una scheda non espone PushManager: la risposta giusta resta "ios-install".
  assert.equal(classifyPushSupport(env({ isIos: true, hasPushManager: false })), "ios-install");
  assert.equal(classifyPushSupport(env({ isIos: true, standalone: false })), "ios-install");
  assert.equal(classifyPushSupport(env({ isIos: true, standalone: true })), "ok");
  assert.equal(classifyPushSupport(env({ isIos: true, standalone: true, hasPushManager: false })), "unsupported");
  assert.equal(classifyPushSupport(env({ isIos: true, standalone: true, permission: "denied" })), "denied");
});

test("chiave VAPID: base64url con e senza riempimento", () => {
  assert.deepEqual([...base64UrlToBytes("AQID")], [1, 2, 3]);
  assert.deepEqual([...base64UrlToBytes("-_8")], [251, 255]);
  const point = Uint8Array.from({ length: 65 }, (_, index) => (index * 7 + 4) % 256);
  const encoded = Buffer.from(point).toString("base64url");
  assert.equal(encoded.includes("="), false);
  assert.deepEqual([...base64UrlToBytes(encoded)], [...point]);
});

test("chiave del server: iscrizione fatta con un'altra chiave va rifatta", () => {
  const expected = Uint8Array.from([1, 2, 3, 4]);
  assert.equal(sameServerKey(Uint8Array.from([1, 2, 3, 4]).buffer, expected), true);
  assert.equal(sameServerKey(Uint8Array.from([1, 2, 3, 5]).buffer, expected), false);
  assert.equal(sameServerKey(Uint8Array.from([1, 2, 3]).buffer, expected), false);
  // Alcuni browser non riportano la chiave: non si rifà l'iscrizione a ogni avvio.
  assert.equal(sameServerKey(null, expected), true);
  assert.equal(sameServerKey(undefined, expected), true);
});

test("riga dell'iscrizione: serve https, p256dh e auth", () => {
  const json = { endpoint: "https://push.example/abc", keys: { p256dh: "P", auth: "A" } };
  assert.deepEqual(rowFromSubscription(json), { endpoint: "https://push.example/abc", p256dh: "P", auth: "A" });
  assert.equal(rowFromSubscription({ endpoint: "https://push.example/abc" }), null);
  assert.equal(rowFromSubscription({ endpoint: "https://push.example/abc", keys: { p256dh: "P" } }), null);
  assert.equal(rowFromSubscription({ endpoint: "http://push.example/abc", keys: { p256dh: "P", auth: "A" } }), null);
  assert.equal(rowFromSubscription({ keys: { p256dh: "P", auth: "A" } }), null);
});

test("stato salvato: solo valori ben formati", () => {
  assert.deepEqual(parsePushState(JSON.stringify({ endpoint: "https://e", userId: "u", at: 5 })), { endpoint: "https://e", userId: "u", at: 5 });
  assert.equal(parsePushState(null), null);
  assert.equal(parsePushState("non json"), null);
  assert.equal(parsePushState(JSON.stringify([1])), null);
  assert.equal(parsePushState(JSON.stringify({ endpoint: "", userId: "u", at: 5 })), null);
  assert.equal(parsePushState(JSON.stringify({ endpoint: "https://e", userId: "u", at: "ieri" })), null);
});

test("riallineamento all'avvio: cadenza di 12 ore, endpoint o account cambiati", () => {
  const hour = 60 * 60 * 1000;
  const prev = { endpoint: "https://e", userId: "u", at: 1_000_000 };
  assert.equal(shouldRefresh(null, "https://e", "u", prev.at), true);
  assert.equal(shouldRefresh(prev, "https://e", "u", prev.at + hour), false);
  assert.equal(shouldRefresh(prev, "https://e", "u", prev.at + 13 * hour), true);
  assert.equal(shouldRefresh(prev, "https://nuovo", "u", prev.at + hour), true);
  assert.equal(shouldRefresh(prev, "https://e", "altro", prev.at + hour), true);
  assert.equal(shouldRefresh(prev, "https://e", "u", prev.at - hour), true);
});

test("?apri=: solo le tre destinazioni note", () => {
  assert.equal(parseOpenTarget("?apri=notifiche"), "notifiche");
  assert.equal(parseOpenTarget("?x=1&apri=condivisione"), "condivisione");
  assert.equal(parseOpenTarget("?apri=gruppi"), "gruppi");
  assert.equal(parseOpenTarget("?apri=impostazioni"), null);
  assert.equal(parseOpenTarget("?apri=NOTIFICHE"), null);
  assert.equal(parseOpenTarget("?apri="), null);
  assert.equal(parseOpenTarget(""), null);
});

test("?apri=: l'URL ripulito tiene gli altri parametri e il frammento", () => {
  assert.equal(urlWithoutOpen("https://massimilianociconte.github.io/StudyOS/?apri=notifiche"), "/StudyOS/");
  assert.equal(urlWithoutOpen("https://x.github.io/StudyOS/?invito=ABC&apri=gruppi#a"), "/StudyOS/?invito=ABC#a");
  assert.equal(urlWithoutOpen("https://x.github.io/StudyOS/#invito=ABC"), "/StudyOS/#invito=ABC");
});
```

- [ ] **Passo 3: i test falliscono**

Run: `node --import ./scripts/lib/register-ts.mjs --test tests/push.test.mjs`
Expected: FAIL con `Cannot find module` per `src/lib/push.ts` (o `openLink.ts`).

- [ ] **Passo 4: `src/lib/openLink.ts`**

```ts
// Collegamento profondo ?apri=… (da toccare una notifica push): apre la pagina giusta all'avvio.
// Logica pura e senza dipendenze: la usano l'hook useOpenLink e i test.

/** Gli unici valori accettati: i parametri `url` che il server mette nelle notifiche. */
export type OpenTarget = "notifiche" | "condivisione" | "gruppi";

const TARGETS: readonly OpenTarget[] = ["notifiche", "condivisione", "gruppi"];

/** Il pannello Notifiche non è una sezione ma un cassetto della shell: si apre con questo evento. */
export const OPEN_NOTIFICATIONS_EVENT = "studyos:open-notifications";

export const parseOpenTarget = (search: string): OpenTarget | null => {
  const value = new URLSearchParams(search).get("apri");
  return TARGETS.find((target) => target === value) ?? null;
};

/** Percorso, query (senza `apri`) e frammento: pronto per history.replaceState. */
export const urlWithoutOpen = (href: string): string => {
  const url = new URL(href, "https://studyos.invalid/");
  url.searchParams.delete("apri");
  return `${url.pathname}${url.search}${url.hash}`;
};

export const requestOpenNotifications = () => {
  window.dispatchEvent(new Event(OPEN_NOTIFICATIONS_EVENT));
};
```

- [ ] **Passo 5: `src/lib/push.ts`**

```ts
// Notifiche push di questo dispositivo: permesso del browser, iscrizione al servizio push e riga
// in studyos_push_subscriptions (da cui il database sceglie a chi mandare le notifiche).
// Si carica solo con import(): porta con sé supabase-js, che resta fuori dal bundle iniziale.
// Il permesso si chiede sempre e solo dopo un tocco della persona (enablePush).

import type { SupabaseClient } from "@supabase/supabase-js";
import { VAPID_PUBLIC_KEY } from "./pushKeys";

export type PushSupport = "ok" | "unsupported" | "ios-install" | "denied";

export interface PushEnvironment {
  isIos: boolean;
  standalone: boolean;
  hasServiceWorker: boolean;
  hasPushManager: boolean;
  hasNotification: boolean;
  permission: "default" | "granted" | "denied" | null;
}

/** L'ordine conta: su iPhone una scheda di Safari non ha PushManager, e la cura è "aggiungi alla Home". */
export const classifyPushSupport = (environment: PushEnvironment): PushSupport => {
  if (environment.isIos && !environment.standalone) return "ios-install";
  if (!environment.hasServiceWorker || !environment.hasPushManager || !environment.hasNotification) return "unsupported";
  if (environment.permission === "denied") return "denied";
  return "ok";
};

export const base64UrlToBytes = (value: string): Uint8Array<ArrayBuffer> => {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
};

/** Se il browser non riporta la chiave si considera uguale: niente nuova iscrizione a ogni avvio. */
export const sameServerKey = (current: ArrayBuffer | null | undefined, expected: Uint8Array): boolean => {
  if (current === null || current === undefined) return true;
  const actual = new Uint8Array(current);
  if (actual.length !== expected.length) return false;
  for (let index = 0; index < actual.length; index += 1) if (actual[index] !== expected[index]) return false;
  return true;
};

export interface SubscriptionRow {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export const rowFromSubscription = (json: { endpoint?: string; keys?: Record<string, string> }): SubscriptionRow | null => {
  const endpoint = json.endpoint;
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;
  if (!endpoint || !p256dh || !auth) return null;
  if (!endpoint.startsWith("https://")) return null;
  return { endpoint, p256dh, auth };
};

// Cosa ricorda questo dispositivo: con quale account e quale endpoint è stata registrata l'iscrizione.
const STATE_KEY = "studyos-push-state";
const REFRESH_EVERY_MS = 12 * 60 * 60 * 1000;

export interface PushState {
  endpoint: string;
  userId: string;
  at: number;
}

export const parsePushState = (raw: string | null): PushState | null => {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return null;
    const { endpoint, userId, at } = value as Record<string, unknown>;
    if (typeof endpoint !== "string" || !endpoint) return null;
    if (typeof userId !== "string" || !userId) return null;
    if (typeof at !== "number" || !Number.isFinite(at)) return null;
    return { endpoint, userId, at };
  } catch {
    return null;
  }
};

export const shouldRefresh = (previous: PushState | null, endpoint: string, userId: string, now: number): boolean =>
  !previous || previous.endpoint !== endpoint || previous.userId !== userId || now < previous.at || now - previous.at >= REFRESH_EVERY_MS;

const readState = (): PushState | null => {
  try {
    return parsePushState(window.localStorage.getItem(STATE_KEY));
  } catch {
    return null;
  }
};

const writeState = (state: PushState) => {
  try {
    window.localStorage.setItem(STATE_KEY, JSON.stringify(state));
  } catch {
    // storage non disponibile: la prossima partenza riallinea comunque
  }
};

const clearState = () => {
  try {
    window.localStorage.removeItem(STATE_KEY);
  } catch {
    // niente da pulire
  }
};

export const pushSupport = (): PushSupport => {
  if (typeof window === "undefined" || typeof navigator === "undefined") return "unsupported";
  const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const standalone =
    (navigator as Navigator & { standalone?: boolean }).standalone === true ||
    (typeof window.matchMedia === "function" && window.matchMedia("(display-mode: standalone)").matches);
  const hasNotification = "Notification" in window;
  return classifyPushSupport({
    isIos,
    standalone,
    hasServiceWorker: "serviceWorker" in navigator,
    hasPushManager: "PushManager" in window,
    hasNotification,
    permission: hasNotification ? Notification.permission : null
  });
};

// ——— Browser e account ———

/** Il service worker c'è solo nella build pubblicata: in sviluppo non si arriva mai a iscriversi. */
const getRegistration = async (): Promise<ServiceWorkerRegistration | null> => {
  const existing = await navigator.serviceWorker.getRegistration();
  if (existing?.active) return existing;
  return Promise.race([navigator.serviceWorker.ready, new Promise<null>((resolve) => window.setTimeout(() => resolve(null), 5000))]);
};

interface Cloud {
  client: SupabaseClient;
  userId: string;
}

const cloudSession = async (): Promise<Cloud | null> => {
  const { supabase } = await import("./supabase");
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  const userId = data.session?.user.id;
  return userId ? { client: supabase, userId } : null;
};

const TABLE = "studyos_push_subscriptions";

const saveRow = (cloud: Cloud, row: SubscriptionRow) =>
  cloud.client.from(TABLE).upsert({ ...row, last_seen_at: new Date().toISOString() }, { onConflict: "endpoint" });

const deleteRow = async (cloud: Cloud, endpoint: string) => {
  try {
    await cloud.client.from(TABLE).delete().eq("endpoint", endpoint);
  } catch {
    // offline: il servizio push scarta l'endpoint alla prima notifica e il server lo toglie (push_gone)
  }
};

/** Annulla l'iscrizione nel browser e toglie la sua riga. */
const forgetSubscription = async (cloud: Cloud, subscription: PushSubscription) => {
  const endpoint = subscription.endpoint;
  await subscription.unsubscribe().catch(() => false);
  await deleteRow(cloud, endpoint);
};

/**
 * Chiede il permesso (se serve) e iscrive questo dispositivo. Da chiamare solo dal gestore di un
 * tocco: la prima cosa che aspetta è la richiesta di permesso, così il browser vede il gesto.
 * Ritorna false se il permesso manca, il browser rifiuta o la riga non si salva.
 */
export const enablePush = async (): Promise<boolean> => {
  if (pushSupport() !== "ok") return false;
  try {
    const permission = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
    if (permission !== "granted") return false;
    const registration = await getRegistration();
    if (!registration) return false;
    const cloud = await cloudSession();
    if (!cloud) return false;

    const key = base64UrlToBytes(VAPID_PUBLIC_KEY);
    let subscription = await registration.pushManager.getSubscription();
    if (subscription && !sameServerKey(subscription.options.applicationServerKey, key)) {
      await forgetSubscription(cloud, subscription);
      subscription = null;
    }
    // Due tentativi: se la riga di quell'endpoint appartiene a un altro account (uscita non pulita)
    // il salvataggio è rifiutato dalla RLS, e una nuova iscrizione ha un endpoint nuovo.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (!subscription) subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      const row = rowFromSubscription(subscription.toJSON());
      if (row) {
        const { error } = await saveRow(cloud, row);
        if (!error) {
          writeState({ endpoint: row.endpoint, userId: cloud.userId, at: Date.now() });
          return true;
        }
      }
      await subscription.unsubscribe().catch(() => false);
      subscription = null;
    }
    return false;
  } catch {
    return false;
  }
};

/** Spegne le notifiche di questo dispositivo: annulla l'iscrizione e toglie la riga. Non lancia mai. */
export const disablePush = async (): Promise<void> => {
  const state = readState();
  clearState();
  try {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    const registration = await navigator.serviceWorker.getRegistration();
    const subscription = registration ? await registration.pushManager.getSubscription() : null;
    const endpoint = subscription?.endpoint ?? state?.endpoint ?? null;
    if (subscription) await subscription.unsubscribe().catch(() => false);
    if (!endpoint) return;
    const cloud = await cloudSession();
    if (cloud) await deleteRow(cloud, endpoint);
  } catch {
    // niente da fare: l'iscrizione si ripulisce da sola alla prima notifica respinta
  }
};

/** L'interruttore è acceso se il permesso c'è, l'iscrizione esiste ed è di questo account. */
export const isPushEnabled = async (userId: string): Promise<boolean> => {
  if (pushSupport() !== "ok" || Notification.permission !== "granted") return false;
  if (readState()?.userId !== userId) return false;
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    return Boolean(registration && (await registration.pushManager.getSubscription()));
  } catch {
    return false;
  }
};

/**
 * All'avvio con un account: se questo dispositivo aveva attivato le notifiche con questo account,
 * riallinea la riga (endpoint cambiato → sostituito; chiave del server cambiata → nuova iscrizione;
 * ogni 12 ore aggiorna last_seen_at). Non iscrive mai chi non l'ha chiesto.
 */
export const syncPushSubscription = async (): Promise<void> => {
  try {
    if (pushSupport() !== "ok" || Notification.permission !== "granted") return;
    const previous = readState();
    if (!previous) return;
    const registration = await navigator.serviceWorker.getRegistration();
    if (!registration) return;
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) return;
    const cloud = await cloudSession();
    if (!cloud || cloud.userId !== previous.userId) return;

    const key = base64UrlToBytes(VAPID_PUBLIC_KEY);
    if (!sameServerKey(subscription.options.applicationServerKey, key)) {
      await forgetSubscription(cloud, subscription);
      subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    }
    const row = rowFromSubscription(subscription.toJSON());
    if (!row) return;
    const now = Date.now();
    if (!shouldRefresh(previous, row.endpoint, cloud.userId, now)) return;
    const { error } = await saveRow(cloud, row);
    if (error) return;
    if (previous.endpoint !== row.endpoint) await deleteRow(cloud, previous.endpoint);
    writeState({ endpoint: row.endpoint, userId: cloud.userId, at: now });
  } catch {
    // rete assente o browser che rifiuta: si riprova al prossimo avvio
  }
};
```

- [ ] **Passo 6: i test passano**

Run: `node --import ./scripts/lib/register-ts.mjs --test tests/push.test.mjs`
Expected: PASS, 9 test, 0 falliti.

- [ ] **Passo 7: l'hook `src/hooks/useOpenLink.ts` e `App.tsx`**

```ts
import { useEffect, useRef } from "react";
import { parseOpenTarget, requestOpenNotifications, urlWithoutOpen, type OpenTarget } from "../lib/openLink";
import { useStudyStore } from "../store/useStudyStore";

const openTarget = (target: OpenTarget) => {
  if (target === "gruppi") useStudyStore.getState().setActiveView("groups");
  else if (target === "condivisione") useStudyStore.getState().setActiveView("sharing");
  else requestOpenNotifications();
};

/**
 * Collegamento profondo ?apri=notifiche|condivisione|gruppi (lo mette il service worker quando si
 * tocca una notifica push). Legge il parametro all'avvio, lo toglie dall'URL e apre la pagina giusta
 * appena l'app è pronta (dopo lo sblocco della password, se attiva).
 */
export function useOpenLink(ready: boolean) {
  const pending = useRef<OpenTarget | null>(null);
  const readyRef = useRef(ready);
  readyRef.current = ready;

  useEffect(() => {
    const target = parseOpenTarget(window.location.search);
    if (!target) return;
    window.history.replaceState(window.history.state, "", urlWithoutOpen(window.location.href));
    if (readyRef.current) openTarget(target);
    else pending.current = target;
  }, []);

  useEffect(() => {
    if (!ready || !pending.current) return;
    const target = pending.current;
    pending.current = null;
    openTarget(target);
  }, [ready]);
}
```

Modifiche a `src/App.tsx`:

Cerca: `import { cloudConfigured } from "./lib/cloudSyncState";`
Sostituisci con:

```tsx
import { cloudConfigured, subscribeCloudSync } from "./lib/cloudSyncState";
```

Cerca: `import { useShareInviteLinks } from "./hooks/useShareInviteLinks";`
Sostituisci con:

```tsx
import { useShareInviteLinks } from "./hooks/useShareInviteLinks";
import { useOpenLink } from "./hooks/useOpenLink";
```

Cerca: `  useShareInviteLinks(!loading && !locked && !error);`
Sostituisci con:

```tsx
  useShareInviteLinks(!loading && !locked && !error);
  // Notifica push toccata: ?apri=notifiche|condivisione|gruppi apre la pagina giusta.
  useOpenLink(!loading && !locked && !error);
```

Poi, subito prima di `  useEffect(() => {\n    document.documentElement.dataset.theme = themeMode;` (cerca `    document.documentElement.dataset.theme = themeMode;` e inserisci prima del suo `useEffect(() => {`), aggiungi l'effetto:

```tsx
  // Notifiche push: se questo dispositivo le aveva già attivate, si riallinea l'iscrizione all'avvio
  // e dopo ogni accesso. Il codice push si carica solo con il permesso già concesso.
  useEffect(() => {
    if (loading || !cloudConfigured) return;
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    let lastUserId: string | null = null;
    return subscribeCloudSync((state) => {
      const userId = state.session?.user.id ?? null;
      if (!userId || userId === lastUserId) return;
      lastUserId = userId;
      void import("./lib/push").then((module) => module.syncPushSubscription()).catch(() => undefined);
    });
  }, [loading]);

```

Verifica: `grep -n "useOpenLink\|syncPushSubscription\|subscribeCloudSync" src/App.tsx` mostra import, chiamata e l'effetto.

- [ ] **Passo 8: `AppShell.tsx`, evento del cassetto Notifiche e proposta**

Cerca: `import { QUICK_ADD_EVENT } from "../lib/quickAdd";`
Sostituisci con:

```tsx
import { QUICK_ADD_EVENT } from "../lib/quickAdd";
import { OPEN_NOTIFICATIONS_EVENT } from "../lib/openLink";
import { PushPrompt } from "./PushPrompt";
```

Cerca: `  const openQuickAdd = () => {`
Sostituisci con:

```tsx
  // ?apri=notifiche (notifica push toccata): il cassetto Notifiche vive qui, lo apre un evento.
  useEffect(() => {
    const onOpen = () => setNotificationsOpen(true);
    window.addEventListener(OPEN_NOTIFICATIONS_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_NOTIFICATIONS_EVENT, onOpen);
  }, []);

  const openQuickAdd = () => {
```

Cerca: `      {notificationsOpen ? <NotificationsPanel onClose={() => setNotificationsOpen(false)} /> : null}`
Sostituisci con:

```tsx
      {notificationsOpen ? <NotificationsPanel onClose={() => setNotificationsOpen(false)} /> : null}
      <PushPrompt />
```

- [ ] **Passo 9: `src/components/PushToggle.tsx`**

```tsx
import { useEffect, useRef, useState } from "react";
import type { PushSupport } from "../lib/push";
import { cloudConfigured } from "../lib/cloudSyncState";
import { useCloudSession } from "../hooks/useCloudSession";
import { pushLabels } from "../lib/labels";

type PushModule = typeof import("../lib/push");

/**
 * "Notifiche su questo dispositivo" (Impostazioni → Profilo, sotto la scheda del profilo online).
 * Il codice push si carica qui, in differita; il permesso del browser si chiede solo al tocco.
 */
export function PushToggle() {
  const session = useCloudSession();
  const userId = session?.user.id ?? null;
  const push = useRef<PushModule | null>(null);
  const [support, setSupport] = useState<PushSupport | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!cloudConfigured) return;
    let cancelled = false;
    void import("../lib/push")
      .then(async (module) => {
        push.current = module;
        const current = module.pushSupport();
        const on = userId ? await module.isPushEnabled(userId) : false;
        if (cancelled) return;
        setSupport(current);
        setEnabled(on);
      })
      .catch(() => {
        if (!cancelled) setSupport("unsupported");
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  if (!cloudConfigured) return null;

  const toggle = async () => {
    const module = push.current;
    if (!module || busy) return;
    setBusy(true);
    setFailed(false);
    try {
      if (enabled) {
        await module.disablePush();
        setEnabled(false);
      } else {
        // Nessun await prima di enablePush: il permesso va chiesto dentro il gesto della persona.
        const ok = await module.enablePush();
        setEnabled(ok);
        const now = module.pushSupport();
        setSupport(now);
        if (!ok && now === "ok") setFailed(true);
      }
    } finally {
      setBusy(false);
    }
  };

  const note = (() => {
    if (!userId) return pushLabels.needAccount;
    if (support === null) return pushLabels.checking;
    if (support === "unsupported") return pushLabels.unsupported;
    if (support === "ios-install") return pushLabels.iosInstall;
    if (support === "denied") return pushLabels.denied;
    if (failed) return pushLabels.failed;
    return enabled ? pushLabels.on : pushLabels.off;
  })();
  const disabled = busy || !userId || support !== "ok";

  return (
    <div className="mt-4 rounded-[22px] bg-[var(--surface-soft)] p-3">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-black">{pushLabels.toggle}</p>
          <p className="safe-text mt-0.5 text-xs text-[var(--muted)]">{pushLabels.hint}</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label={pushLabels.toggle}
          disabled={disabled}
          onClick={() => void toggle()}
          className={`relative h-8 w-14 shrink-0 rounded-full transition-colors motion-reduce:transition-none after:absolute after:-inset-2 after:content-[''] disabled:cursor-not-allowed disabled:opacity-50 ${
            enabled ? "bg-[var(--accent)]" : "bg-[var(--surface-strong)]"
          }`}
        >
          <span
            className={`absolute top-1 h-6 w-6 rounded-full bg-white shadow transition-[left] motion-reduce:transition-none ${enabled ? "left-7" : "left-1"}`}
          />
        </button>
      </div>
      <p role="status" className="safe-text mt-2 text-xs font-bold text-[var(--muted)]">
        {note}
      </p>
    </div>
  );
}
```

- [ ] **Passo 10: `src/components/PushPrompt.tsx`**

```tsx
import { useEffect, useRef, useState } from "react";
import type { AppNotification } from "../types";
import { useStudyStore } from "../store/useStudyStore";
import { useCloudSession } from "../hooks/useCloudSession";
import { cloudConfigured } from "../lib/cloudSyncState";
import { useUiState } from "../lib/uiState";
import { pushLabels } from "../lib/labels";
import { Button } from "./ui";
import { Icon } from "./Icon";

type PushModule = typeof import("../lib/push");

// Inviti di gruppo (kind "invite") e di condivisione (id che comincia per notif-share-invite-).
const isInvite = (item: AppNotification) => item.kind === "invite" || item.id.startsWith("notif-share-invite-");

/**
 * Proposta una tantum: dopo il primo invito ricevuto, se il browser supporta le push e il permesso
 * non è ancora stato chiesto, propone di attivarle. Il permesso si chiede solo se la persona tocca
 * "Attiva le notifiche". Sempre montata nella shell: nessun import statico di push o supabase.
 */
export function PushPrompt() {
  const session = useCloudSession();
  const hasInvite = useStudyStore((state) => state.notifications.some((item) => !item.archived && isInvite(item)));
  const [seen, setSeen] = useUiState<boolean>("pushPromptSeen", false, { validate: (value) => typeof value === "boolean" });
  const push = useRef<PushModule | null>(null);
  const [eligible, setEligible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const active = cloudConfigured && Boolean(session) && hasInvite && !seen;

  useEffect(() => {
    if (!active) {
      setEligible(false);
      return;
    }
    let cancelled = false;
    void import("../lib/push")
      .then((module) => {
        push.current = module;
        if (!cancelled) setEligible(module.pushSupport() === "ok" && Notification.permission === "default");
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [active]);

  if (!(active && eligible) && !failed) return null;

  const accept = async () => {
    const module = push.current;
    if (!module || busy) return;
    setBusy(true);
    try {
      // Il modulo è già caricato: il permesso parte dentro il gesto del tocco.
      const ok = await module.enablePush();
      setSeen(true);
      if (!ok) setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      aria-label={pushLabels.promptTitle}
      className="soft-panel fixed inset-x-4 bottom-24 z-40 mx-auto max-w-md p-4 lg:bottom-6 lg:left-auto lg:right-6"
    >
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[var(--accent)] text-[#10131d]">
          <Icon name="Bell" className="h-4.5 w-4.5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="safe-text text-sm font-black">{failed ? pushLabels.promptFailed : pushLabels.promptTitle}</p>
          {failed ? null : <p className="safe-text mt-1 text-xs text-[var(--muted)]">{pushLabels.promptBody}</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            {failed ? (
              <Button variant="soft" onClick={() => setFailed(false)}>
                {pushLabels.promptClose}
              </Button>
            ) : (
              <>
                <Button variant="primary" icon="Bell" disabled={busy} onClick={() => void accept()}>
                  {pushLabels.promptAccept}
                </Button>
                <Button variant="soft" disabled={busy} onClick={() => setSeen(true)}>
                  {pushLabels.promptLater}
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Passo 11: Impostazioni e uscita dall'account**

`src/views/SettingsView.tsx`. Cerca: `import { AgentSettings } from "../components/AgentDesk";`
Sostituisci con:

```tsx
import { AgentSettings } from "../components/AgentDesk";
import { PushToggle } from "../components/PushToggle";
```

Cerca: `<ProfileOnlineCard />`
Sostituisci con: `<ProfileOnlineCard extra={<PushToggle />} />`

(Deve esserci una sola occorrenza: `grep -c "<ProfileOnlineCard" src/views/SettingsView.tsx` → `1`. Se il Task 7 l'ha messa altrove nella scheda Profilo, la sostituzione è la stessa.)

`src/components/CloudPanel.tsx`. Cerca: `      const result = await signOut();`
Sostituisci con:

```tsx
      // Prima dell'uscita serve ancora la sessione: toglie l'iscrizione push di questo dispositivo,
      // così le notifiche di questo account non continuano ad arrivare a chi usa il dispositivo dopo.
      await import("../lib/push").then((module) => module.disablePush()).catch(() => undefined);
      const result = await signOut();
```

- [ ] **Passo 12: verifiche**

Run: `npm test && npm run lint && npm run build`
Expected: PASS; nessun errore di tipo (in particolare `Uint8Array<ArrayBuffer>` per `applicationServerKey`).

Run: `ENTRY=dist/$(grep -o 'assets/index-[^"]*\.js' dist/index.html | head -1)` poi `grep -c "studyos_push_subscriptions\|pushManager\|studyos-push-state" "$ENTRY"`
Expected: `0` (nessuna di queste stringhe nel chunk iniziale; la stringa `studyos:open-notifications` di `openLink.ts` invece è ammessa).

Run: `ls dist/assets | grep -i -E "push"`
Expected: un chunk separato che contiene `push` (i nomi hanno l'hash; in caso di dubbio `grep -l "studyos_push_subscriptions" dist/assets/*.js` deve trovare un file diverso dall'entry).

- [ ] **Passo 13: commit**

```bash
git add src/lib/push.ts src/lib/openLink.ts src/hooks/useOpenLink.ts src/components/PushToggle.tsx src/components/PushPrompt.tsx tests/push.test.mjs src/lib/labels.ts src/App.tsx src/components/AppShell.tsx src/views/SettingsView.tsx src/components/CloudPanel.tsx
```

```bash
git commit -m "feat(push): device subscription, toggle, first-invite prompt and ?apri= deep link" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 9: `public/sw.js`, eventi `push` e `notificationclick`

**Files:**
- Modify: `public/sw.js`
- Create: `tests/swPush.test.mjs`

**Interfaces:**
- Consumes: il formato dei messaggi della tabella Interfacce (testo in chiaro dopo la decifratura = `JSON.stringify({ kind, title, body, url, tag })`; `url` è `?apri=notifiche`, `?apri=condivisione` o `?apri=gruppi`); icone esistenti `icons/studyos-192.png` e `icons/favicon-64.png`.
- Produces: gli eventi `push` e `notificationclick`; gli handler `install`, `activate`, `fetch` e `message` restano com'erano. Il nome della cache passa da `studyos-shell-v7` a `studyos-shell-v8`.

Il service worker si registra solo nella build (`import.meta.env.PROD` in `src/main.tsx`) con `updateViaCache: "none"`: chi ha già l'app riceve il nuovo file al prossimo avvio.

- [ ] **Passo 1: test che falliscono, `tests/swPush.test.mjs`**

Il file `sw.js` è eseguito in un contesto `node:vm` con un `self` finto: si lanciano gli eventi e si guarda cosa mostra e cosa apre.

```js
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");
const SCOPE = "https://massimilianociconte.github.io/StudyOS/";

const makeClient = (url, { focused = false, navigateFails = false } = {}) => {
  const calls = { focus: 0, navigated: [] };
  return {
    url,
    focused,
    calls,
    focus: async () => {
      calls.focus += 1;
    },
    navigate: async (target) => {
      if (navigateFails) throw new Error("scheda non controllata");
      calls.navigated.push(target);
    }
  };
};

const loadWorker = (windows = []) => {
  const handlers = new Map();
  const shown = [];
  const opened = [];
  const self = {
    location: { origin: "https://massimilianociconte.github.io" },
    registration: {
      scope: SCOPE,
      showNotification: (title, options) => {
        shown.push({ title, options });
        return Promise.resolve();
      }
    },
    clients: {
      matchAll: () => Promise.resolve(windows),
      openWindow: (url) => {
        opened.push(url);
        return Promise.resolve(null);
      },
      claim: () => Promise.resolve()
    },
    addEventListener: (type, handler) => handlers.set(type, handler),
    skipWaiting: () => undefined
  };
  vm.runInNewContext(source, { self, URL, Promise, Date, console });
  return { handlers, shown, opened };
};

const fire = async (worker, type, event) => {
  const waits = [];
  worker.handlers.get(type)({ ...event, waitUntil: (promise) => waits.push(promise) });
  await Promise.all(waits);
};

const pushWith = (payload) => ({ data: { json: () => payload } });
const clickOn = (url) => {
  const state = { closed: 0 };
  return { state, event: { notification: { close: () => (state.closed += 1), data: url === undefined ? undefined : { url } } } };
};

test("gli handler esistenti restano registrati", () => {
  const worker = loadWorker();
  for (const type of ["install", "activate", "fetch", "message", "push", "notificationclick"]) {
    assert.equal(typeof worker.handlers.get(type), "function", type);
  }
});

test("push: mostra titolo, testo, tag, icona e url dal messaggio", async () => {
  const worker = loadWorker();
  await fire(worker, "push", pushWith({ kind: "invite", title: "Invito al gruppo", body: "Giulia ti ha invitato.", url: "?apri=notifiche", tag: "group-invite:42" }));
  assert.equal(worker.shown.length, 1);
  const { title, options } = worker.shown[0];
  assert.equal(title, "Invito al gruppo");
  assert.equal(options.body, "Giulia ti ha invitato.");
  assert.equal(options.tag, "group-invite:42");
  assert.equal(options.icon, `${SCOPE}icons/studyos-192.png`);
  assert.equal(options.badge, `${SCOPE}icons/favicon-64.png`);
  assert.deepEqual({ ...options.data }, { url: "?apri=notifiche" });
});

test("push: contenuto illeggibile o assente mostra comunque una notifica", async () => {
  const unreadable = loadWorker();
  await fire(unreadable, "push", { data: { json: () => { throw new SyntaxError("json non valido"); } } });
  assert.equal(unreadable.shown[0].title, "StudyOS");
  assert.equal(unreadable.shown[0].options.body, "Hai una nuova notifica.");

  const empty = loadWorker();
  await fire(empty, "push", { data: null });
  assert.equal(empty.shown.length, 1);
  assert.equal(empty.shown[0].title, "StudyOS");

  const notAnObject = loadWorker();
  await fire(notAnObject, "push", pushWith("testo"));
  assert.equal(notAnObject.shown[0].title, "StudyOS");
});

test("push: campi mancanti o troppo lunghi", async () => {
  const worker = loadWorker();
  await fire(worker, "push", pushWith({ title: "T".repeat(500), body: 7, url: "", tag: null }));
  const { title, options } = worker.shown[0];
  assert.equal(title.length, 120);
  assert.equal(options.body, "");
  assert.equal(options.tag, "studyos");
  assert.deepEqual({ ...options.data }, { url: "./" });
});

test("click: porta in primo piano la scheda aperta e la fa navigare", async () => {
  const client = makeClient(`${SCOPE}?x=1`);
  const worker = loadWorker([makeClient("https://altro.example/"), client]);
  const { state, event } = clickOn("?apri=notifiche");
  await fire(worker, "notificationclick", event);
  assert.equal(state.closed, 1);
  assert.equal(client.calls.focus, 1);
  assert.deepEqual(client.calls.navigated, [`${SCOPE}?apri=notifiche`]);
  assert.deepEqual(worker.opened, []);
});

test("click: senza scheda aperta ne apre una nell'ambito dell'app", async () => {
  const worker = loadWorker([makeClient("https://altro.example/")]);
  const { state, event } = clickOn("?apri=condivisione");
  await fire(worker, "notificationclick", event);
  assert.equal(state.closed, 1);
  assert.deepEqual(worker.opened, [`${SCOPE}?apri=condivisione`]);
});

test("click: preferisce la scheda già in primo piano", async () => {
  const back = makeClient(SCOPE);
  const front = makeClient(`${SCOPE}?v=2`, { focused: true });
  const worker = loadWorker([back, front]);
  await fire(worker, "notificationclick", clickOn("?apri=gruppi").event);
  assert.equal(front.calls.navigated.length, 1);
  assert.equal(back.calls.navigated.length, 0);
});

test("click: un indirizzo fuori dall'app ripiega sulla pagina iniziale", async () => {
  for (const hostile of ["https://evil.example/x", "//evil.example/x", "javascript:alert(1)", "/altrove/"]) {
    const worker = loadWorker();
    await fire(worker, "notificationclick", clickOn(hostile).event);
    assert.deepEqual(worker.opened, [SCOPE], hostile);
  }
  const noData = loadWorker();
  await fire(noData, "notificationclick", clickOn(undefined).event);
  assert.deepEqual(noData.opened, [SCOPE]);
});

test("click: se la scheda non si lascia navigare si apre una nuova finestra", async () => {
  const client = makeClient(SCOPE, { navigateFails: true });
  const worker = loadWorker([client]);
  await fire(worker, "notificationclick", clickOn("?apri=gruppi").event);
  assert.equal(client.calls.focus, 1);
  assert.deepEqual(worker.opened, [`${SCOPE}?apri=gruppi`]);
});
```

- [ ] **Passo 2: i test falliscono**

Run: `node --import ./scripts/lib/register-ts.mjs --test tests/swPush.test.mjs`
Expected: FAIL: `gli handler esistenti restano registrati` (manca `push`) e tutti i test sulle notifiche.

- [ ] **Passo 3: `public/sw.js`**

Cerca: `const CACHE_NAME = "studyos-shell-v7";`
Sostituisci con:

```js
const CACHE_NAME = "studyos-shell-v8";
```

Cerca (ultimo blocco del file):

```js
self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});
```

Sostituisci con:

```js
self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

// ——— Notifiche push (invito ricevuto, invito accettato, permessi cambiati) ———
// Il Worker invia un messaggio cifrato; qui arriva già decifrato come JSON: { kind, title, body, url, tag }.
// `url` è relativo all'ambito dell'app (es. "?apri=notifiche"). Con userVisibleOnly ogni push deve
// mostrare una notifica: se il contenuto non è leggibile si mostra un testo generico.
const PUSH_FALLBACK = { title: "StudyOS", body: "Hai una nuova notifica.", url: "./", tag: "studyos" };

const readPushPayload = (event) => {
  try {
    const raw = event.data ? event.data.json() : null;
    if (!raw || typeof raw !== "object") return { ...PUSH_FALLBACK };
    const text = (value, fallback, max) =>
      typeof value === "string" && value.trim() ? value.trim().slice(0, max) : fallback;
    return {
      title: text(raw.title, PUSH_FALLBACK.title, 120),
      body: text(raw.body, "", 300),
      url: text(raw.url, PUSH_FALLBACK.url, 300),
      tag: text(raw.tag, PUSH_FALLBACK.tag, 120)
    };
  } catch {
    return { ...PUSH_FALLBACK };
  }
};

self.addEventListener("push", (event) => {
  const payload = readPushPayload(event);
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      tag: payload.tag,
      icon: new URL("icons/studyos-192.png", self.registration.scope).href,
      badge: new URL("icons/favicon-64.png", self.registration.scope).href,
      data: { url: payload.url }
    })
  );
});

// Solo pagine dell'app: mai un altro sito, anche se il contenuto di una push fosse manomesso.
const resolveNotificationUrl = (raw) => {
  const scope = new URL(self.registration.scope);
  try {
    const target = new URL(typeof raw === "string" ? raw : "", scope);
    if (target.origin === scope.origin && target.pathname.startsWith(scope.pathname)) return target.href;
  } catch {
    // indirizzo non valido: si apre la pagina iniziale
  }
  return scope.href;
};

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = resolveNotificationUrl(event.notification.data && event.notification.data.url);
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (windows) => {
      const scope = self.registration.scope;
      const inScope = windows.filter((candidate) => candidate.url.startsWith(scope));
      const client = inScope.find((candidate) => candidate.focused) || inScope[0];
      if (client) {
        try {
          await client.focus();
          await client.navigate(target);
          return;
        } catch {
          // scheda non controllata dal service worker o chiusa nel frattempo: se ne apre una nuova
        }
      }
      await self.clients.openWindow(target);
    })
  );
});
```

- [ ] **Passo 4: i test passano**

Run: `node --import ./scripts/lib/register-ts.mjs --test tests/swPush.test.mjs`
Expected: PASS, 8 test, 0 falliti.

Run: `npm test && npm run lint && npm run build && grep -c "notificationclick" dist/sw.js && grep -c "studyos-shell-v8" dist/sw.js`
Expected: tutto PASS; `1` e `1`.

- [ ] **Passo 5: commit**

```bash
git add public/sw.js tests/swPush.test.mjs
```

```bash
git commit -m "feat(push): service worker push and notificationclick handlers" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

## Fase 5 — Documentazione e verifica completa

### Task 10: documentazione e decisione (ADR)

**Files:**
- Modify: `supabase/README.md`, `docs/groups-sync.md`, `docs/agent-mcp.md`, `docs/agent/CURRENTSTATE.md`, `docs/agent/GOTCHAS.md`, `docs/agent/INDEX.md`
- Create: `docs/agent/decisions/2026-11-11-push-pg-net-worker.md`

**Interfaces:**
- Consumes: i nomi reali dei Task 1–9 (script SQL, RPC, tabelle, secret del Worker, `scripts/push-keys.mjs`, `src/lib/pushKeys.ts`).
- Produces: nessuna interfaccia di codice. I numeri delle verifiche si aggiungono nel Task 11, passo 8.

- [ ] **Passo 1: `supabase/README.md`, ordine degli script**

Cerca:

```markdown
1. `schema.sql` (la prima volta o dopo una sua revisione);
2. `groups.sql`;
3. `sharing.sql`;
4. `sharing-verify.sql`.
```

Sostituisci con:

```markdown
1. `schema.sql` (la prima volta o dopo una sua revisione);
2. `groups.sql`;
3. `sharing.sql`;
4. `sharing-verify.sql`;
5. `people.sql`;
6. `people-verify.sql`.

Dopo l'11/11/2026 **rieseguili tutti e tre** (`groups.sql`, `sharing.sql`, `people.sql`):
`groups.sql` e `sharing.sql` contengono ora le stesse regole di `people.sql` sull'accettazione
degli inviti, così rieseguirne uno non riapre l'accettazione per email.
```

- [ ] **Passo 2: `supabase/README.md`, nuova sezione**

Cerca la riga che comincia con «`university.sql` è opzionale e la PWA attuale non legge né scrive la sua» e inserisci **prima** di essa il blocco seguente (resta una riga vuota tra i due paragrafi).

````markdown
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
5. Ripeti `people-verify.sql`: ora anche le colonne su `pg_net` e sui segreti devono essere `true`.

Il segreto del Vault e `STUDYOS_PUSH_SECRET` del Worker devono essere lo stesso valore. Se una
push non arriva: `select id, status_code, left(content, 120) from net._http_response order by id desc limit 5;`
mostra le ultime risposte del Worker (401 = segreti diversi, 404 = URL sbagliato in Vault).

````

- [ ] **Passo 3: `docs/groups-sync.md`, nuova sezione**

Cerca la riga `## Limiti noti` e sostituiscila con il blocco seguente seguito dalla stessa riga:

````markdown
## Persone, inviti all'account e notifiche push (`people.sql`)

Serve `supabase/people.sql`, eseguito dopo `schema.sql`, `groups.sql` e `sharing.sql`. Decisione
sulle push: [ADR](agent/decisions/2026-11-11-push-pg-net-worker.md); design:
[spec](plans/2026-11-11-people-search-push-design.md).

- **Conferma email spenta.** Dall'11/11/2026 gli account nuovi sono attivi alla registrazione:
  l'email non è una prova di identità (chiunque può registrarsi con l'indirizzo di un altro; il
  vero proprietario può solo riprenderlo con il recupero password). Perciò **nessun invito si
  accetta in base all'email**: gli inviti in app (`invite_person_to_group`,
  `invite_person_to_share`) hanno `recipient_user_id` e solo `auth.uid()` può accettarli o
  rifiutarli. `create_share_invite` non crea più inviti per email; link, QR e codice restano.
  Gli inviti per email già pendenti si legano una volta sola all'account con quell'indirizzo
  (migrazione di `people.sql`); gli altri non sono accettabili e il mittente li vede "Scaduto".
- **Profilo**: `studyos_profiles` (nome visibile, `@nome` facoltativo, unico, minuscolo,
  `^[a-z0-9_.]{3,24}$`, interruttore «Gli altri possono trovarmi», acceso di default). RLS: ognuno
  vede e modifica solo la propria riga. Una riga mancante vale «trovabile, senza nome né `@nome`».
- **Ricerca**: `find_person` solo per email esatta o `@nome`, mai sé stessi, mai l'email nel
  risultato; un account non trovabile e uno inesistente danno la stessa risposta. Limiti: 30
  ricerche al minuto per account e 60 per indirizzo IP (`studyos_person_lookups`, senza policy).
- **Notifiche push**: iscrizioni in `studyos_push_subscriptions` (RLS sulle proprie righe).
  Trigger `AFTER` su inviti, accettazioni, ingressi nei gruppi e permessi chiamano
  `studyos_push_notify`, che raccoglie le iscrizioni dei destinatari (mai di chi ha compiuto
  l'azione) e con `pg_net` fa `POST` al Worker `/push` con l'intestazione
  `x-studyos-push-secret`. Segreto e URL stanno in Vault (`studyos_push_secret`,
  `studyos_push_url`). Senza `pg_net` o senza segreti non succede nulla e la scrittura che ha
  fatto scattare il trigger riesce lo stesso. Il Worker invia la notifica cifrata (RFC 8291,
  VAPID RFC 8292) e segnala con `push_gone` gli endpoint spenti, che il database cancella.
- **Client**: iscrizione e permesso solo dopo un tocco («Notifiche su questo dispositivo» in
  Impostazioni → Profilo, o la proposta dopo il primo invito ricevuto); `src/lib/push.ts` si
  carica con `import()`. Toccare la notifica apre `?apri=notifiche`, `?apri=condivisione` o
  `?apri=gruppi`. Su iPhone e iPad le push funzionano solo con StudyOS aggiunto alla schermata Home.
- **Agenti MCP**: nessuno strumento nuovo; non ricevono email, `@nome` cercati né iscrizioni push.

Prova automatica sullo stack locale: `scripts/supabase/local-stack.md` e
`scripts/supabase/people-check.mjs` (ricerca esatta, non trovabile = inesistente, limiti, inviti
solo al destinatario, email rifiutate, migrazione, trigger push verso un Worker finto).

## Limiti noti
````

Poi, nella stessa sezione `## Limiti noti`, cerca:

```markdown
- Le notifiche push/email non esistono: gli inviti arrivano nel pannello
  Notifiche all'apertura dell'app (realtime se aperta) e via link/email manuale.
```

Sostituisci con:

```markdown
- Le notifiche email non esistono. Le push funzionano solo con `people.sql`, `pg_net`, i
  segreti in Vault e il Worker distribuito (vedi sopra); senza, gli inviti arrivano comunque
  nel pannello Notifiche all'apertura dell'app (realtime se aperta) e via link, QR o codice.
- Push: il servizio push può non consegnare (dispositivo spento da giorni, TTL di 24 ore):
  l'avviso resta nella campanella. Un cambio della chiave VAPID invalida tutte le iscrizioni:
  chi le aveva attivate si reiscrive al primo avvio, gli altri riattivano l'interruttore.
```

- [ ] **Passo 4: `docs/agent-mcp.md`**

Cerca: «i codici di invito, gli inviti alla condivisione (creazione, link, accettazione) e il caricamento di file.»
Sostituisci con: «i codici di invito, gli inviti alla condivisione (creazione, link, accettazione), la ricerca di persone, le iscrizioni push e il caricamento di file.»

Cerca la riga `## Ripubblicare dopo una modifica` e sostituiscila con il blocco seguente seguito dalla stessa riga:

````markdown
## Notifiche push: route `/push` del Worker

Lo stesso Worker `studyos-agent` espone `POST /push`: non è uno strumento MCP e gli agenti non
lo vedono. Lo chiama solo il database (`pg_net`) con l'intestazione `x-studyos-push-secret`; il
Worker cifra e invia le notifiche push e non legge né scrive altro. Servono quattro secret, da
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

````

Poi, nella sezione «Ripubblicare dopo una modifica», cerca:

```markdown
2. Hub: `npx wrangler deploy -c worker/wrangler.jsonc` (la prima volta
   `npx wrangler login`). Il secret `STUDYOS_PAIR_KEY` e lo stato del Durable
   Object restano: client OAuth e collegamento del browser non cambiano.
```

Sostituisci con:

```markdown
2. Hub: `npx wrangler deploy -c worker/wrangler.jsonc` (la prima volta
   `npx wrangler login`). I secret (`STUDYOS_PAIR_KEY` e quelli delle push) e lo stato
   del Durable Object restano: client OAuth e collegamento del browser non cambiano.
```

- [ ] **Passo 5: `docs/agent/CURRENTSTATE.md`** (in fondo)

```bash
cat >> docs/agent/CURRENTSTATE.md <<'EOF'

Ricerca di persone, inviti all'account e notifiche push (11 novembre 2026): la conferma email è
spenta sul progetto reale (account attivi alla registrazione), quindi nessun invito si accetta
più per email. Chi ha un account si trova con l'email esatta o con `@nome` (profilo trovabile di
default, si spegne in Impostazioni → Profilo) e si invita in un gruppo o a vedere i propri dati;
l'invito è legato all'account del destinatario, che lo vede in Notifiche e lo accetta con un
tocco. Link, QR e codice restano per chi non ha un account; gli inviti per email già pendenti
vengono legati una volta sola o risultano "Scaduto". Notifiche push (browser, Android, iPhone e
iPad con l'app nella schermata Home) per invito ricevuto, invito accettato e permesso cambiato:
trigger SQL → `pg_net` → Worker `studyos-agent` `/push` (cifratura RFC 8291, VAPID, nessuna
`service_role`) → servizio push → service worker; il permesso del browser si chiede solo dopo
un tocco e toccare la notifica apre la pagina giusta (`?apri=`). Agenti MCP invariati (nessuno
strumento nuovo). Sul progetto reale: rieseguire `groups.sql`, `sharing.sql` e `people.sql`,
poi `people-verify.sql`; abilitare `pg_net`; `node scripts/push-keys.mjs`; segreti in Vault;
quattro `wrangler secret put` e `wrangler deploy`; push su `main`.
EOF
```

- [ ] **Passo 6: `docs/agent/GOTCHAS.md`** (in fondo)

```bash
cat >> docs/agent/GOTCHAS.md <<'EOF'
- Conferma email spenta sul progetto reale dall'11/11/2026 (Authentication → Sign In /
  Providers → Email): un account nuovo ha `email_confirmed_at` già impostato, quindi l'email non
  prova l'identità e chiunque può registrarsi con l'indirizzo di un altro. Mai basare un accesso
  o l'accettazione di un invito sull'email: gli inviti in app hanno `recipient_user_id` e solo
  `auth.uid()` li accetta (`groups.sql`, `sharing.sql` e `people.sql` contengono le stesse
  funzioni: una modifica va fatta in tutti e tre). La ricerca per email può quindi trovare chi
  ha registrato l'indirizzo di un altro: la scheda mostra nome e `@nome` da controllare.
- `find_person`: solo corrispondenza esatta, mai l'email nel risultato, stessa risposta per
  inesistente e non trovabile, 30 ricerche al minuto per account e 60 per IP. Gli account si
  creano senza conferma, per questo il limite per IP serve.
- Push: DB → `pg_net` → Worker `POST /push` → servizio push. Nessuna `service_role`: il database
  passa nel corpo le iscrizioni dei destinatari, il Worker si fida solo di
  `x-studyos-push-secret` (stesso valore di `studyos_push_secret` in Vault) e chiama
  `push_gone` con la chiave publishable. Senza `pg_net`, segreti o Worker non c'è push ma ogni
  altra cosa funziona: `studyos_push_notify` non deve mai far fallire la scrittura che l'ha
  chiamata. Il contenuto è cifrato fino al dispositivo; mai registrare endpoint o testi.
- `src/lib/push.ts` e `supabase` solo con `import()`. Il permesso del browser si chiede solo
  dentro un tocco (`enablePush` aspetta come prima cosa `Notification.requestPermission`: non
  mettere un `await` prima). Il service worker c'è solo nella build: per provare le push in
  locale serve `vite build` + `vite preview`, non `npm run dev`.
- iPhone e iPad: le push esistono solo con StudyOS nella schermata Home
  (`pushSupport()` = `ios-install` altrimenti). Un cambio della chiave VAPID
  (`src/lib/pushKeys.ts`) invalida le iscrizioni: `syncPushSubscription` rifà quelle di chi le
  aveva attivate, e l'uscita dall'account le toglie (`CloudPanel` chiama `disablePush` prima di
  `signOut`), altrimenti il dispositivo continuerebbe a ricevere le notifiche del vecchio account.
- `public/sw.js`: l'indirizzo della notifica (`data.url`, es. `?apri=notifiche`) si risolve
  sempre contro `self.registration.scope` e fuori dall'app ripiega sulla pagina iniziale. Il
  cassetto Notifiche non è una sezione: lo apre l'evento `studyos:open-notifications`.
  I test di `sw.js` (`tests/swPush.test.mjs`) lo eseguono in un contesto `node:vm`.
EOF
```

- [ ] **Passo 7: `docs/agent/INDEX.md`**

Cerca: `- Agenti MCP (ChatGPT, Claude, client locali) → [../agent-mcp.md](../agent-mcp.md)`
Sostituisci con:

```markdown
- Ricerca di persone, inviti all'account e notifiche push (decisione e design) → [decisions/2026-11-11-push-pg-net-worker.md](decisions/2026-11-11-push-pg-net-worker.md), [../plans/2026-11-11-people-search-push-design.md](../plans/2026-11-11-people-search-push-design.md)
- Agenti MCP (ChatGPT, Claude, client locali, route `/push` del Worker) → [../agent-mcp.md](../agent-mcp.md)
```

- [ ] **Passo 8: ADR `docs/agent/decisions/2026-11-11-push-pg-net-worker.md`**

```markdown
# ADR: notifiche push dal database al Worker con `pg_net`, senza `service_role`

- Stato: accettata
- Data: 11/11/2026
- Sostituisce: nessuna
- Design completo: [2026-11-11-people-search-push-design.md](../../plans/2026-11-11-people-search-push-design.md)

## Contesto

StudyOS è una PWA su GitHub Pages con Supabase (piano Free) e un Worker Cloudflare
(`studyos-agent`) già in uso. Gli inviti (gruppi e condivisione), le accettazioni e i cambi di
permesso devono arrivare anche ad app chiusa. Una Web Push va cifrata (RFC 8291) e firmata
(VAPID, RFC 8292) da un server con una chiave privata, e va spedita agli endpoint che ogni
dispositivo ha registrato. Chi decide *quando* inviare è il database: gli eventi nascono lì
(inserimenti in `studyos_group_invites`, `studyos_share_invites`, `studyos_group_members`,
cambi in `studyos_shares`). Vincolo del progetto: nel client, in CI e nel Worker solo la chiave
publishable, mai `service_role`.

## Decisione

1. **Trigger SQL → `pg_net` → Worker.** Un trigger `AFTER` per evento chiama
   `studyos_push_notify` (`security definer`, senza privilegi per `anon` e `authenticated`):
   toglie chi ha compiuto l'azione e i doppioni, raccoglie le iscrizioni dei destinatari da
   `studyos_push_subscriptions` e le spedisce nel corpo di un `POST` a `<worker>/push`.
2. **Il Worker non legge il database.** Riceve le iscrizioni nella richiesta, cifra, firma e
   invia. Si autentica chi lo chiama con `x-studyos-push-secret`; segreto e URL stanno in Vault
   (`studyos_push_secret`, `studyos_push_url`) e nei secret del Worker. L'unica chiamata verso
   Supabase è `push_gone(p_secret, p_endpoints)` con la chiave publishable, che cancella le
   iscrizioni spente (404/410) solo se il segreto coincide.
3. **Mai un errore a monte.** Senza `pg_net`, senza segreti o con il Worker irraggiungibile,
   `studyos_push_notify` non fa nulla o ignora l'errore: la scrittura che ha fatto scattare il
   trigger riesce comunque. `people-verify.sql` segnala cosa manca.
4. **Contenuto minimo e cifrato.** Il messaggio è `{ kind, title, body, url, tag }`, cifrato fino
   al dispositivo; il `tag` diventa anche l'intestazione `Topic`, così una notifica nuova
   sostituisce la vecchia. Il Worker registra solo `{ sent, gone }`.
5. **Client.** Permesso e iscrizione solo dopo un tocco; riga upsert su `endpoint`; riallineamento
   all'avvio; `public/sw.js` mostra la notifica e al tocco apre `?apri=…`.

## Alternative considerate

- **Edge Function di Supabase.** Avrebbe letto le iscrizioni con la chiave di servizio e
  inviato lei le push: richiede `service_role` in un ambiente esterno al database e non è
  disponibile sullo stack locale minimale usato per le prove.
- **Il Worker legge le iscrizioni con `service_role`.** Spostava la chiave più potente del
  progetto in un secret di Cloudflare: escluso dal vincolo.
- **Servizio terzo (OneSignal, Firebase).** Cede a terzi iscrizioni e contenuti e aggiunge una
  dipendenza e un account; la Web Push standard basta.
- **Solo Realtime e campanella.** Non raggiunge chi ha l'app chiusa: è il motivo della funzione.
- **Invio dal client del mittente.** Il mittente non conosce né deve leggere le iscrizioni
  degli altri.

## Conseguenze

- Le iscrizioni dei destinatari (endpoint e chiavi pubbliche del dispositivo) viaggiano dal
  database al Worker su HTTPS: servono per cifrare e non sono un segreto d'account.
- `pg_net` è asincrono e senza ritentativi: la consegna è al meglio; TTL 24 ore, urgenza
  `normal`. L'avviso resta comunque nella campanella dell'app.
- Rotazione del segreto: aggiornare Vault (`vault.update_secret`) e `STUDYOS_PUSH_SECRET` nello
  stesso momento. Rotazione della chiave VAPID: nuova coppia, nuovo `src/lib/pushKeys.ts`,
  `STUDYOS_VAPID_PRIVATE_KEY` e deploy; le iscrizioni vecchie si rifanno all'avvio successivo.
- Un nuovo evento da notificare è un trigger in `people.sql` che chiama `studyos_push_notify`
  con `kind`, testo, `url` (`?apri=notifiche|condivisione|gruppi`) e `tag`.
- Su iPhone e iPad le push richiedono StudyOS nella schermata Home.

## Componenti interessati

`supabase/people.sql`, `supabase/people-verify.sql`, `worker/webPush.ts`, `worker/push.ts`,
`worker/index.ts`, `scripts/push-keys.mjs`, `src/lib/pushKeys.ts`, `src/lib/push.ts`,
`src/lib/openLink.ts`, `src/components/PushToggle.tsx`, `src/components/PushPrompt.tsx`,
`public/sw.js`.
```

- [ ] **Passo 9: controlla i collegamenti**

Run: `ls supabase/people.sql supabase/people-verify.sql worker/push.ts worker/webPush.ts scripts/push-keys.mjs src/lib/pushKeys.ts docs/agent/decisions/2026-11-11-push-pg-net-worker.md docs/plans/2026-11-11-people-search-push-design.md`
Expected: tutti esistenti.

Run: `grep -n "people\|push" supabase/README.md docs/groups-sync.md docs/agent-mcp.md docs/agent/CURRENTSTATE.md docs/agent/GOTCHAS.md docs/agent/INDEX.md | head -60`
Expected: le voci nuove ci sono; nessun segnaposto `<…>` tranne i due valori segreti dello snippet Vault (`<SEGRETO stampato da push-keys.mjs>`, `<nuovo segreto>`), che sono valori da inserire a mano e non vanno mai scritti nei file.

- [ ] **Passo 10: commit**

```bash
git add supabase/README.md docs/groups-sync.md docs/agent-mcp.md docs/agent/CURRENTSTATE.md docs/agent/GOTCHAS.md docs/agent/INDEX.md docs/agent/decisions/2026-11-11-push-pg-net-worker.md
```

```bash
git commit -m "docs(people): script order, pg_net and Vault setup, email-confirmation note and push ADR" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 11: verifica completa

**Files:**
- Modifica solo i documenti del passo 8 (numeri reali). Eventuali correzioni di codice tornano nel task che possiede il file.

**Interfaces:**
- Consumes: tutto il lavoro dei Task 1–10, lo stack locale del Task 2.
- Produces: i numeri per `CURRENTSTATE.md` e `docs/groups-sync.md`, e l'elenco dei passi sul progetto reale da fare con l'utente.

- [ ] **Passo 1: catena automatica**

Run: `npm test && npm run lint && npm run build && npm run barb:validate`
Expected: tutto PASS. Annota il totale dei test (`# pass`).

- [ ] **Passo 2: il bundle iniziale non carica persone né push**

```bash
ENTRY=dist/$(grep -o 'assets/index-[^"]*\.js' dist/index.html | head -1)
grep -c "studyos_push_subscriptions\|studyos-push-state\|pushManager\|find_person\|invite_person_to_group\|invite_person_to_share\|is_handle_available\|push_shared_rows\|supabase-js" "$ENTRY"
grep -l "studyos_push_subscriptions" dist/assets/*.js
grep -c "notificationclick" dist/sw.js
```

Expected: il primo conteggio è `0`; il secondo comando elenca un chunk diverso dall'entry (i nomi hanno l'hash); l'ultimo stampa `1`. Se il primo conteggio non è 0, trova la riga con `grep -o ".\{60\}find_person.\{60\}" "$ENTRY"` e togli l'import statico dal file che la porta (store, shell o componente sempre montato).

- [ ] **Passo 3: SQL e script sullo stack locale**

Con lo stack del Task 2 avviato (`scripts/supabase/local-stack.md`; se il Task 2 prevede un processo separato per il Worker finto delle push, avvialo come lì descritto):

```bash
export PGURL=postgresql://postgres:postgres@127.0.0.1:55422/postgres
psql "$PGURL" -v ON_ERROR_STOP=1 -f supabase/schema.sql
psql "$PGURL" -v ON_ERROR_STOP=1 -f supabase/groups.sql
psql "$PGURL" -v ON_ERROR_STOP=1 -f supabase/sharing.sql
psql "$PGURL" -v ON_ERROR_STOP=1 -f supabase/people.sql
psql "$PGURL" -v ON_ERROR_STOP=1 -f supabase/people.sql
psql "$PGURL" -v ON_ERROR_STOP=1 -f supabase/groups.sql
psql "$PGURL" -v ON_ERROR_STOP=1 -f supabase/sharing.sql
psql "$PGURL" -v ON_ERROR_STOP=1 -f supabase/people-verify.sql
SUPABASE_URL=http://127.0.0.1:55421 SUPABASE_KEY=<chiave publishable locale> node scripts/supabase/people-check.mjs
SUPABASE_URL=http://127.0.0.1:55421 SUPABASE_KEY=<chiave publishable locale> node scripts/supabase/sharing-check.mjs
```

Expected: nessun errore, nemmeno rieseguendo `groups.sql` e `sharing.sql` dopo `people.sql` (non riaprono l'accettazione per email: lo prova `people-check.mjs`); `people-verify.sql` con tutti i `*_ready` a `t` (su stack locale quelli su `pg_net` e sui segreti seguono come li prepara il Task 2); `people-check.mjs` e `sharing-check.mjs` terminano con `<N> controlli superati, 0 falliti.` Annota i due `<N>`.

- [ ] **Passo 4: build con lo stack locale e tre origini**

Il service worker c'è solo nella build: la prova delle push non si fa con `npm run dev`.

```bash
VITE_SUPABASE_URL=http://127.0.0.1:55421 VITE_SUPABASE_PUBLISHABLE_KEY=<chiave publishable locale> npm run build
npx vite preview --port 5180 --strictPort
npx vite preview --port 5181 --strictPort
npx vite preview --port 5182 --strictPort
```

I tre `preview` si lanciano in tre terminali (o in background) dopo la build; sono tre origini con IndexedDB e `localStorage` separati: Alice su 5180, Bob su 5181, Carla (nuova, per la proposta una tantum) su 5182. Account di `scripts/supabase/local-stack.md`: `alice@studyos.test`, `bob@studyos.test`; Carla si registra dall'app (nessuna conferma email sullo stack locale).

- [ ] **Passo 5: prova nel browser con due account (poi un terzo)**

Con il browser integrato o la skill `webapp-testing`, in ordine:
1. Alice e Bob accedono (due origini). Ognuno apre Impostazioni → Profilo e imposta un `@nome` (`@alice`, `@bob`); la verifica di disponibilità segnala un nome già preso.
2. Bob cerca `@alice`, poi `alice@studyos.test`: compare la stessa scheda (nome e `@alice`, mai l'email). Cerca se stesso e un `@nome` inesistente: «Nessuna persona trovata».
3. Alice spegne «Gli altri possono trovarmi»: Bob cerca di nuovo e riceve la stessa risposta dell'inesistente. Alice riaccende.
4. Gruppo: Alice crea un gruppo e invita Bob dalla ricerca (niente campo email). Con l'app aperta, Bob vede l'invito in Notifiche in tempo reale; **Accetta** → è subito nel gruppo, e Alice lo vede tra i membri.
5. Dati: Alice apre Condividi → «Una persona» → Bob, sezione Calendario; Bob riceve l'invito in Notifiche e accetta: gli eventi di Alice compaiono subito, senza ricaricare.
6. Permesso cambiato: Alice passa Calendario a «Può vedere»; Bob non può più modificare gli eventi di Alice.
7. Inviti per email: nel cassetto Condividi non esiste più il campo email; un invito creato prima (se presente nello stack) appare «Scaduto: cerca la persona per invitarla di nuovo».
8. Interruttore: Bob (5181) → Impostazioni → Profilo → «Notifiche su questo dispositivo»: il permesso del browser compare solo dopo il tocco; concesso, l'interruttore resta acceso dopo un ricaricamento. Controllo: `psql "$PGURL" -c "select left(endpoint, 40), last_seen_at from public.studyos_push_subscriptions;"` → 1 riga; nella console della scheda `(await navigator.serviceWorker.getRegistration()).pushManager.getSubscription()` non è `null`. Se l'automazione nega in automatico il permesso, l'interruttore mostra il testo «Hai bloccato le notifiche…» e la prova del permesso concesso si fa a mano su un browser vero (passo 9, punto 7).
9. Collegamento profondo: apri `http://127.0.0.1:5181/?apri=notifiche`, poi `?apri=condivisione`, poi `?apri=gruppi`: si aprono rispettivamente il cassetto Notifiche, Condivisione e Gruppi, e il parametro sparisce dall'URL (`location.search` vuoto). `?apri=altro` non fa nulla. Con la password dell'app attiva, l'apertura avviene dopo lo sblocco.
10. Service worker, a mano: DevTools → Application → Service Workers → «Push» con `{"kind":"invite","title":"Prova","body":"Invito di prova","url":"?apri=notifiche","tag":"prova"}`: compare la notifica; toccarla porta in primo piano la scheda e apre il cassetto Notifiche. Il browser integrato non mostra le notifiche di sistema: in quel caso il comportamento di `push` e `notificationclick` è coperto da `tests/swPush.test.mjs` e si ripete a mano su un browser vero.
11. Proposta una tantum: Carla si registra su 5182 e non attiva nulla; Alice la invita in un gruppo. Quando l'invito arriva a Carla compare la scheda «Vuoi un avviso quando ricevi un invito?»; «Non ora» la chiude e dopo un ricaricamento non ricompare (`pushPromptSeen` in `studyos-ui` di `localStorage` vale `true`). Con Bob (già con le notifiche attive) la scheda non compare mai.
12. Uscita: Bob esce dall'account (Impostazioni → Account): `select count(*) from public.studyos_push_subscriptions;` scende di uno, e `getSubscription()` torna `null`.
13. Push dal database: la consegna dai trigger al Worker (invito ricevuto, invito accettato, ingresso nel gruppo, permesso cambiato o tolto, nessuna push a chi agisce) è provata da `people-check.mjs` (passo 3). La consegna vera a un browser si prova sul progetto reale (passo 9): la Web Push ha bisogno del servizio push di Google, Apple o Mozilla e di una coppia di chiavi VAPID vera.
14. 375 px e tema scuro su Impostazioni → Profilo (interruttore) e sulla scheda della proposta: nessuno scroll orizzontale, l'interruttore si tocca con facilità, nessun errore in console.

Expected: tutti i punti come descritto. Ogni difetto si corregge nel task che possiede il file, con il suo test, e la verifica riparte dal passo 1.

Spegni i tre `preview` e lo stack come da `scripts/supabase/local-stack.md` (`supabase stop --no-backup`); non toccare lo stack `sessa-erp` (54321–54324).

- [ ] **Passo 6: agenti MCP e segreti**

Run: `git log --oneline --grep="people" -- src/agent`
Expected: nessuna riga (nessuno strumento MCP è cambiato per questa funzione).

Run: `git grep -n -E "sb_secret_|eyJhbGci" -- src worker scripts public supabase`
Expected: nessun risultato.

Run: `git grep -n "service_role" -- src worker public`
Expected: nessun risultato (in `docs/` e nei commenti SQL compare solo per dire di non usarla).

Run: `git status --short`
Expected: vuoto (tutto committato); `ls .claude` mostra ancora la cartella.

- [ ] **Passo 7: `verify-change`**

Esegui la skill `verify-change` sul diff completo rispetto alla spec
(`docs/plans/2026-11-11-people-search-push-design.md`): ogni requisito 1–7 coperto da un test o da un punto del passo 5, nessun segnaposto, nessun file di altre sessioni nei commit.

- [ ] **Passo 8: numeri nei documenti e commit**

In `docs/agent/CURRENTSTATE.md` aggiungi in coda una riga con i numeri veri del passo 1 e 3, poi la voce in `docs/groups-sync.md`.

```bash
cat >> docs/agent/CURRENTSTATE.md <<'EOF'
Verifiche della ricerca persone e delle push (11 novembre 2026): <T> test, lint, build, `barb:validate`;
stack locale: `groups.sql`, `sharing.sql` e `people.sql` due volte e `people-verify.sql`, `people-check.mjs`
<N1> controlli e `sharing-check.mjs` <N2> controlli, 0 falliti; prova nel browser con tre account (ricerca per
email e `@nome`, profilo non trovabile, invito di gruppo e di dati con accettazione immediata, permesso cambiato,
interruttore e proposta una tantum, `?apri=`, uscita che toglie l'iscrizione). La consegna push vera si prova sul
progetto reale dopo il deploy del Worker.
EOF
```

Sostituisci a mano `<T>`, `<N1>` e `<N2>` con i numeri annotati (nessun segnaposto deve restare: `grep -n "<T>\|<N1>\|<N2>" docs/agent/CURRENTSTATE.md` non trova nulla).

In `docs/groups-sync.md`, sotto `## Verifiche eseguite`, in cima alla sezione, aggiungi un paragrafo con la data del giorno e gli stessi numeri (stesso testo, senza l'ultima frase sul progetto reale).

```bash
git add docs/agent/CURRENTSTATE.md docs/groups-sync.md
```

```bash
git commit -m "docs(people): record local verification results" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Passo 9: consegna all'utente (tutto sul progetto reale `kobmoygkwzlprhgfkzwh`, ogni punto con «chiedi il via»)**

Riporta l'elenco, senza eseguirlo (la CLI non ha accesso al progetto), e per ogni punto che richiede un comando sul tuo account o un segreto **chiedi il via** prima:

1. **SQL Editor, in ordine**, una query alla volta: `supabase/groups.sql`, `supabase/sharing.sql`, `supabase/people.sql`, poi `supabase/people-verify.sql`. Attesi: tutti i `*_ready` `true` salvo quelli su `pg_net` e sui segreti, finché non fai i punti 2–4. *Chiedi il via.*
2. **pg_net**: Dashboard → Database → Extensions → `pg_net` → Enable. *Chiedi il via.*
3. **Chiavi**: `node scripts/push-keys.mjs` in locale; salva la privata e il segreto dove li tieni (mai nel repository), committa solo `src/lib/pushKeys.ts` con la chiave pubblica. *Chiedi il via.*
4. **Vault** (SQL Editor): `vault.create_secret` per `studyos_push_secret` (il segreto del punto 3) e `studyos_push_url` (`https://studyos-agent.nexify-api.workers.dev/push`), come in `supabase/README.md`. Poi ripeti `people-verify.sql`: tutto `true`. *Chiedi il via.*
5. **Worker**: `npx wrangler secret put STUDYOS_PUSH_SECRET -c worker/wrangler.jsonc`, poi `STUDYOS_VAPID_PRIVATE_KEY`, `STUDYOS_SUPABASE_URL`, `STUDYOS_SUPABASE_KEY` (publishable), poi `npx wrangler deploy -c worker/wrangler.jsonc`. *Chiedi il via per ognuno dei cinque comandi.*
6. **Sito**: merge del ramo `worktree-sharing` in `main` e `git push origin main` (il workflow Pages ricostruisce e pubblica; deve contenere la stessa `pushKeys.ts` del Worker). Solo con il tuo via esplicito.
7. **Prova reale** con due account veri (uno su desktop, uno su telefono con StudyOS nella schermata Home): ricerca, invito in app e push, tocco sulla notifica che apre la pagina giusta, accettazione, permesso cambiato → push. Se una push non arriva: `select id, status_code, left(content, 120) from net._http_response order by id desc limit 5;` (401 = segreti diversi, 404 = URL in Vault sbagliato) e i log del Worker (`npx wrangler tail -c worker/wrangler.jsonc`, solo conteggi).
8. Gli inviti per email ancora pendenti: dopo `people.sql` risultano legati all'account con quell'indirizzo oppure «Scaduto»; avvisa chi li aveva mandati.
