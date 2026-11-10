# Condivisione granulare tra utenti e gruppi: design

Stato: approvato in chat il 10/11/2026 (scelte: sezione + filtro materie, due livelli
di permesso con cronologia, nuova sezione Condivisione, agente senza inviti).
Decisione architetturale: [ADR](../agent/decisions/2026-11-10-condivisione-righe-originali.md).

## Obiettivo

Ogni persona sceglie quali sezioni dei propri dati condividere, con chi (una
persona o un gruppo) e con quale permesso. Chi riceve vede quei dati nelle stesse
viste in cui vede i propri, marcati come "di altri", e li modifica solo se ha il
permesso. Modifiche, aggiunte ed eliminazioni arrivano in tempo reale a tutti gli
autorizzati, senza copie. Il proprietario cambia o revoca i permessi quando vuole
senza toccare i propri dati.

Caso guida: due studenti si scambiano il calendario. Ciascuno vede eventi e
appelli dell'altro e, con il permesso di modifica, li aggiunge, sposta o elimina.

## Requisiti

1. Unità di condivisione: **sezione** con filtro facoltativo per **materie**.
2. Destinatario: una persona (invito o persona già collegata) oppure un gruppo
   (membri attuali e futuri; chi esce dal gruppo perde l'accesso).
3. Permessi: `view` ("Può vedere") e `edit` ("Può modificare": aggiungere,
   cambiare, eliminare). Ogni modifica fatta da altri conserva la versione
   precedente sul server: il proprietario vede chi ha cambiato cosa e ripristina.
4. Inviti: link con token (anche per chi non ha un account), email facoltativa,
   richiesta reciproca ("chiedi in cambio") che il destinatario accetta o no.
5. Dati altrui distinti per costruzione: mai nelle collezioni personali, nella
   coda di sync personale o nei backup.
6. Agente MCP: legge e modifica i dati condivisi secondo i permessi, gestisce i
   permessi; inviti e accettazioni solo nell'app.
7. Serve un account con la sync attiva da entrambe le parti: i dati condivisi
   sono le righe di `studyos_items`. Senza account la sezione lo spiega.

## Sezioni condivisibili

| Scope | Etichetta | Righe coperte | Filtro materie |
| --- | --- | --- | --- |
| `calendar` | Calendario | `calendarEvent` | `payload.subjectId` |
| `barb_exams` | Appelli BARB | `calendarEvent` con `sourceUid` che inizia per `barb-exam-` | `payload.subjectId` |
| `tasks` | Attività | `task` | `payload.subjectId` |
| `study` | Studio | `studySession`, `studyTopic` | `payload.subjectId` |
| `progress` | Progressi | `exam` senza `grade` e senza `passFail` | `payload.subjectId` |
| `materials` | Materiali | `attachment`, `note` | `linkedEntityId` se `linkedEntityType = 'subject'` |
| `goals` | Obiettivi | `goal` | non applicabile (lista vuota obbligatoria) |

- Mai condivisibili: `preferences`, `notification`, `subject` completo, gruppi
  personali, `tag`, `reminder`, `widget`, voti (il libretto).
- Con un filtro materie, un elemento senza materia non è coperto.
- `barb_exams` ammette solo `view`: le date sono ufficiali.
- Le materie del proprietario arrivano solo come etichette (id, nome, colore,
  icona) tramite `shared_subject_labels()`; mai note, docente o voto obiettivo.

## Server: `supabase/sharing.sql`

Da eseguire dopo `schema.sql` e `groups.sql`; rieseguibile. Se `studyos_groups`
manca, il file si ferma con un messaggio chiaro. Verifica in sola lettura:
`supabase/sharing-verify.sql`.

### Tabelle

`studyos_shares` (accessi attivi):

- `id uuid` pk; `owner_id uuid` → `auth.users` (cascade); `owner_name text`.
- `scope text` (check sui sette valori); `subject_ids text[]` (vuoto = tutte;
  massimo 50; vuoto obbligatorio per `goals`).
- `permission text` in (`view`, `edit`); check `barb_exams` ⇒ `view`.
- Esattamente uno tra `grantee_user_id uuid` → `auth.users` (cascade) e
  `grantee_group_id text` → `studyos_groups` (cascade); `grantee_user_id` diverso
  da `owner_id`.
- `grantee_name text`, `grantee_email text` (solo da inviti accettati, visibile
  al proprietario), `created_at`, `updated_at`.
- Unicità: `(owner_id, scope, coalesce(grantee_user_id::text, grantee_group_id))`.
- Indici: `grantee_user_id`, `grantee_group_id`, `owner_id`.

`studyos_share_invites`:

- `id uuid` pk; `owner_id`, `owner_name`.
- `offers jsonb`: `[{scope, permission, subject_ids}]` (1–7 voci).
- `requests jsonb`: `[{scope, permission}]` chieste in cambio (0–7 voci).
- `recipient_email text` facoltativa; `token_hash bytea` unico (`sha256`).
- `status` in (`pending`, `accepted`, `declined`); `accepted_by uuid`;
  `expires_at` = creazione + 14 giorni; massimo 50 inviti `pending` per persona.

`studyos_item_revisions`:

- `id bigint` identity; `owner_id`, `entity_type`, `entity_id`, `payload`,
  `deleted`, `changed_by uuid`, `change` in (`update`, `delete`), `changed_at`.
- Scritta solo dal trigger; il proprietario legge ed elimina. Ogni inserimento
  cancella le revisioni dello stesso proprietario più vecchie di 90 giorni.

### Funzioni

- `studyos_scope_covers(scope, entity_type, payload, subject_ids)` immutable:
  la tabella delle sezioni. Specchio esatto in `src/lib/sharing.ts`, con gli
  stessi casi di prova.
- `studyos_item_access(owner, entity_type, payload)` DEFINER stable, costo alto:
  `null`, `view` o `edit` per `auth.uid()` (condivisioni dirette e di gruppo;
  `edit` vince).
- `studyos_type_access(owner, entity_type)` DEFINER: `null`, `view` o `edit`
  sulle condivisioni la cui sezione include il tipo, ignorando il filtro (serve
  ai tombstone).
- `studyos_knows_user(user)` DEFINER: gruppo in comune o condivisione in una
  delle due direzioni.
- `shared_subject_labels()` DEFINER: `(owner_id, id, name, color, icon)` delle
  materie non eliminate dei proprietari che condividono con me.
- `create_share_invite(p_owner_name, p_offers, p_requests, p_recipient_email)`
  DEFINER: valida, genera il token (due `gen_random_uuid()` senza trattini),
  salva l'hash, restituisce `(id, token)` una sola volta.
- `preview_share_invite(p_token)` DEFINER, solo `authenticated`: id, nome del
  proprietario, offerte, richieste, scadenza, stato; nessuna email.
- `accept_share_invite(p_invite_id, p_token, p_display_name, p_reciprocal)`
  DEFINER: se l'invito ha un'email vale solo per quell'account; altrimenti serve
  il token. Crea o aggiorna le condivisioni offerte; per ogni voce reciproca
  scelta (sottoinsieme delle richieste, permesso uguale o minore, materie del
  destinatario) crea la condivisione inversa. Segna l'invito come accettato.
- `decline_share_invite(p_invite_id, p_token)` DEFINER.
- `push_shared_rows(p_owner_id, p_client_id, p_rows)` INVOKER: come
  `push_studyos_rows` ma sulle righe di un altro. Per ogni riga controlla prima
  `edit` sul payload proposto e sulla riga esistente (se c'è, viva e coperta),
  così una policy non fa mai fallire l'intero batch, e restituisce
  `(entity_type, entity_id, accepted, reason)` con `reason` in
  (`denied`, `stale`, null). Un tombstone aggiorna solo una riga esistente, non
  la crea, e il suo payload contiene solo `id` e `deletedAt`. Massimo 200 righe.

### RLS e trigger su `studyos_items`

Le quattro policy "own" restano identiche. Si aggiungono:

- `studyos_select_shared_items`: `user_id <> auth.uid()` e
  (riga viva coperta da una condivisione, oppure tombstone di un tipo coperto).
  Un tombstone contiene solo `id` e `deletedAt`.
- `studyos_insert_shared_items`: riga viva, accesso `edit` sul payload proposto.
- `studyos_update_shared_items`: USING riga viva coperta con `edit`; WITH CHECK
  payload coperto con `edit`, oppure `deleted = true` con `edit` sul tipo e
  payload ridotto a `id` e `deletedAt` (`payload - 'id' - 'deletedAt' = '{}'`).
- Nessuna policy DELETE per chi riceve.
- Trigger `studyos_items_guard` (BEFORE UPDATE): vieta di cambiare `user_id`,
  `entity_type`, `entity_id`.
- Trigger `studyos_items_revision` (AFTER UPDATE, DEFINER): se
  `auth.uid()` è diverso da `old.user_id` salva la riga precedente in
  `studyos_item_revisions`.

Nelle policy l'espressione del proprietario viene prima e le funzioni di
condivisione hanno costo alto: la sync personale non le paga.

### RLS delle nuove tabelle

- `studyos_shares`: select per proprietario, destinatario diretto e membri del
  gruppo; insert se `owner_id = auth.uid()` e il destinatario è un gruppo di cui
  si è membri o una persona nota (`studyos_knows_user`); update solo del
  proprietario e solo su `permission`, `subject_ids`, `owner_name`,
  `grantee_name` (trigger); delete per proprietario o destinatario diretto
  ("Esci").
- `studyos_share_invites`: select per proprietario e per l'email destinataria
  (`pending`); delete per il proprietario; scritture solo via RPC.
- `studyos_item_revisions`: select e delete per il proprietario.
- Privilegi solo ad `authenticated`, revocati ad `anon`.
- Realtime: `studyos_shares` e `studyos_share_invites` entrano nella
  pubblicazione (`studyos_items` c'è già).

## Client

### Moduli

- `src/lib/sharing.ts` (puro, nessun import di Supabase): sezioni, copertura,
  calcolo del permesso da un elenco di condivisioni, riconciliazione della cache,
  pulizia del payload scritto su dati altrui (si conservano dal valore remoto
  `attachmentIds`, `goalId`, `linkedTaskIds`, `linkedSessionIds`, che
  riferiscono entità dell'altro), parsing del link `#condividi=`.
- `src/lib/shareSync.ts` (caricato con `import()`, come `groupSync`):
  - disponibilità: `studyos_shares` leggibile (stessa logica di
    `isSharedAvailable`: solo l'esito positivo resta in IndexedDB);
  - pull: condivisioni e inviti, poi per ogni proprietario le righe dei tipi
    coperti con cursore `updated_at` (meta `share:cursor:<viewer>:<owner>`), poi
    l'elenco degli id visibili (solo `entity_type, entity_id`, a pagine) per
    togliere dalla cache ciò che non è più visibile: revoche, filtri cambiati,
    elementi spostati su una materia esclusa, voti registrati;
  - push: coda `sharedOutbox` (solo chiavi; il payload sta nella cache) verso
    `push_shared_rows`; `denied` toglie la voce e rilegge la riga, `stale` rilegge
    e applica la versione remota;
  - realtime: un canale per chi guarda con `postgres_changes` su
    `studyos_items` filtrato `user_id=in.(proprietari)` (massimo 100; Realtime
    applica la RLS) e sulle due tabelle di condivisione, solo come segnale per un
    pull. Al cambio dei proprietari si attende `removeChannel` prima di
    ricreare il canale. Riserva periodica di 5 minuti e al ritorno visibile;
  - al cambio account o al logout la cache si svuota.
- `src/store/useSharedStore.ts` (zustand separato): condivisioni date e
  ricevute, inviti, elementi altrui per tipo con `ownerId`, `ownerName`,
  `canEdit`, etichette delle materie. Non usa `commit()` e non tocca outbox o
  backup. Le scritture passano da `saveSharedItem` / `deleteSharedItem`
  (ottimistiche, poi coda).
- Dexie v6: tabelle `sharedItems` (`key`, `ownerId`, `entityType`) e
  `sharedOutbox` (`key`, `queuedAt`). Non entrano in `COLLECTIONS`, in
  `SYNC_SCHEMA` né nei backup. Con la password (vault) attiva restano solo in
  memoria: si riscaricano dopo lo sblocco e le modifiche offline ai dati altrui
  non sopravvivono a un ricaricamento.
- Reset dei dati locali e cambio account svuotano entrambe le tabelle.
- Conflitti: LWW su `updatedAt`, come la sync personale.
- Notifiche: una condivisione nuova ricevuta o un invito per email crea una
  notifica (`kind: "share"`, etichetta in `labels.ts`) con id stabile
  (`notif-share-<id>`), così più dispositivi dello stesso account non la
  duplicano.

### Link di invito

`…/StudyOS/#condividi=<token>`: letto a livello di app come `#invito=`, salvato
14 giorni in localStorage (`studyos-pending-share`), URL ripulito, apertura della
sezione Condivisione sulla scheda dell'invito. Senza account: "Accedi o
registrati per vedere l'invito"; dopo il login anteprima e conferma esplicita.
Il link di conferma email porta `?condividi=` come fa `?invito=`.

## Interfaccia

- Vista `sharing` "Condivisione" nel gruppo Strumenti (`navItems`,
  `APP_VIEWS`), con una frase di aiuto. Schede:
  - **Condivisi da me**: per persona o gruppo, sezioni con permesso e materie,
    modifica nel `Drawer`, "Smetti di condividere" con conferma che dice cosa
    succede ("Giulia non vedrà più il tuo calendario. I tuoi eventi restano.");
  - **Condivisi con me**: per persona, interruttore Mostra/Nascondi (stato UI di
    dispositivo), "Esci dalla condivisione" per le condivisioni dirette;
  - **Inviti**: ricevuti (anteprima, accetta con le caselle reciproche, rifiuta)
    e inviati (in attesa, scaduti, annulla);
  - **Modifiche di altri**: revisioni con chi, quando, cosa; "Ripristina" scrive
    la versione salvata come nuova versione locale (normale `commit()` + sync).
- Pannello **Condividi** (`Drawer`): sezioni (caselle), materie (facoltativo),
  destinatario (persona nuova con email facoltativa, persona già collegata,
  gruppo), permesso, "Chiedi in cambio". Per una persona nuova genera l'invito e
  mostra link, QR, WhatsApp/Telegram/email/condivisione di sistema riusando il
  pannello di `GroupInvite`. Si apre anche dai pulsanti "Condividi" di
  Calendario, Attività, Corso di laurea, Studio, Esami, Materiali, Obiettivi,
  già sulla sezione giusta.
- Marcatura "di altri": etichetta "di Giulia" con iniziali e colore stabile per
  persona, bordo tratteggiato. Il colore accento usa `var(--accent-ink)`.
  - **Calendario**: eventi altrui sovrapposti nelle viste giorno, settimana,
    mese e agenda, filtro per persona; trascinamento e modifica solo con `edit`;
    nuovo evento "Nel calendario di" (mio o di chi mi ha dato `edit`).
  - **Corso di laurea**: scheda "Appelli condivisi" con gli appelli scelti da
    ciascuna persona e il segno "anche tu" sugli appelli in comune.
  - **Attività, Studio, Esami (Progressi), Materiali, Obiettivi**: gruppo
    "Condivisi con te" in fondo alla lista.
  - Con `view` il `Drawer` è in sola lettura e lo dice.
- Etichette e permessi in `src/lib/labels.ts`; lessico di GOTCHAS ("Attività",
  "Corso di laurea", "appelli ufficiali"); ogni `grid` con `grid-cols-*`.

## Agente MCP (server 1.2.0)

Nuovi strumenti in `src/agent/catalog.ts`, eseguiti in `execute.ts` su
`useSharedStore`:

| Strumento | Rischio | Note |
| --- | --- | --- |
| `studyos_list_shares` | read | date e ricevute: sezione, permesso, materie, nomi; mai email, token, codici |
| `studyos_list_shared_items` | read | filtri per sezione, persona, date; ogni elemento con `owner`, `can_edit`; eventi ripetuti espansi |
| `studyos_create_shared_item` | write, openWorld | evento o attività nella sezione di un altro, solo con `edit` |
| `studyos_update_shared_item` | write, openWorld | solo con `edit` |
| `studyos_delete_shared_item` | destructive, openWorld | `confirm=true`, solo con `edit` |
| `studyos_share_with` | write, openWorld | solo gruppi o persone già collegate, per id |
| `studyos_update_share` | write | permesso e materie di una condivisione propria |
| `studyos_revoke_share` | destructive | `confirm=true` |

- Il permesso si controlla nell'app prima della chiamata; la RLS lo impone
  comunque sul server. Un rifiuto restituisce `denied` con il motivo.
- Le descrizioni degli strumenti personali dicono "solo dati tuoi; per quelli di
  altri usa studyos_list_shared_items". La panoramica aggiunge gli eventi
  condivisi di oggi.
- Ogni elemento passa da `publicEntity`. Serve un nuovo deploy del Worker
  `studyos-agent` perché l'hub espone il catalogo.

## Errori e casi limite

- Migrazione assente: la sezione spiega quale file eseguire; nessun errore
  altrove (come i gruppi).
- Revoca mentre l'altro ha modifiche in coda: `denied`, voce scartata, avviso
  "Non hai più il permesso di modificare i dati di Giulia".
- Elemento spostato fuori dal filtro: sparisce all'altro al pull successivo (al
  più 5 minuti o al ritorno sulla scheda); Realtime non può segnalarlo perché la
  riga nuova non è visibile.
- Più di 100 proprietari: realtime sui primi 100, gli altri col controllo
  periodico.
- Invito scaduto, già usato, per un'altra email, proprio invito: messaggi
  distinti dalla RPC.
- Gruppo eliminato: le condivisioni verso il gruppo cadono in cascata.
- Il proprietario esce da un gruppo o ne viene rimosso: un trigger su
  `studyos_group_members` (AFTER DELETE) cancella le sue condivisioni verso quel
  gruppo.

## Verifica

- `tests/sharing.test.mjs`: copertura (stessi casi dell'SQL), permessi diretti e
  di gruppo, riconciliazione, pulizia del payload, parsing del link.
- `tests/agent.test.mjs`: strumenti condivisi, rifiuto senza `edit`, nessuna
  email o token nelle risposte.
- `scripts/supabase/sharing-check.mjs`: rifiuta URL non locali; contro uno stack
  Supabase locale con porte separate esegue con supabase-js le stesse chiamate
  del client per quattro account (Alice proprietaria, Bob invitato, Carla membro
  di gruppo, Mallory estranea): invito, anteprima, accettazione reciproca,
  lettura, scrittura `edit`, rifiuto `view`, filtro materie, BARB solo lettura,
  tombstone, revisioni, ripristino, revoca, uscita dal gruppo, Realtime, e i
  tentativi di Mallory (lettura, scrittura, cambio proprietario, invito altrui).
- Browser su due origini con lo stack locale: calendario reciproco, appelli BARB
  condivisi, ogni sezione, sola lettura, revoca, telefono a 375 px, temi chiaro
  e scuro.
- `npm test`, `npm run lint`, `npm run build`, `npm run barb:validate`; skill
  `verify-change` prima di dichiarare concluso.

## Fasi

1. **Fondamenta e calendario reciproco**: `sharing.sql` completo (tutte le
   sezioni, così lo si esegue una volta), `sharing-verify.sql`, script di
   controllo, `sharing.ts`, `shareSync.ts`, `useSharedStore`, Dexie v6, vista
   Condivisione, pannello Condividi, link di invito, calendario sovrapposto,
   cronologia e ripristino.
2. **Appelli BARB**: scheda "Appelli condivisi" nel Corso di laurea.
3. **Altre sezioni**: Attività, Studio, Progressi, Materiali, Obiettivi.
4. **Agente e documentazione**: strumenti MCP, `docs/agent-mcp.md`,
   `supabase/README.md`, `docs/groups-sync.md`, `CURRENTSTATE.md`,
   `GOTCHAS.md`, `verify-change`.

## Fuori ambito

Condividere funzioni (timer, "sto studiando"), notifiche push o email inviate dal
server, condivisione del libretto, trasferimento della proprietà, cifratura
end-to-end (limite già noto: sul server il JSON è in chiaro).
