# Appelli condivisi dei gruppi, piano d'esame personale, strumenti MCP e correzioni BARB — design

- **Data:** 12/11/2026
- **Stato:** approvato dalla persona («implementali tutti»). Decisione del 12/11 sulle email dei docenti
  inclusa (§9.3). La cifratura nel cloud resta solo RLS: qui non serve un design di cifratura.
- **Piano di implementazione:** [../plans/2026-11-12-shared-exam-sessions.md](../plans/2026-11-12-shared-exam-sessions.md)
- **Dipende da:** `supabase/groups.sql` del 12/11 (timbri del server), merge di `claude/people-push-6582b6`
  (inviti per `recipient_user_id`, `people.sql`), lavoro B2 (registro del connettore remoto, `AGENT_SERVER_VERSION` 1.8.0),
  B3 (promemoria con l'app chiusa, `pushReminderSync.ts`) e B4 (controlli generici in `verify.sql`). Tutti
  già in `worktree-sharing` (79895d9): il piano è stato provato su quel codice.

## 1. Obiettivo

Un appello (corso + data + tipo di prova) si scrive **una volta** nel gruppo e lo vedono tutti i
membri, nel calendario e nella pagina della materia. Esempio: Bea aggiunge «Preappello · Farmacologia
Speciale · 12/01/2027» al gruppo «Farmaco»; Ada e Olga lo vedono subito nel calendario e nella loro
materia Farmacologia Speciale. Ognuno decide per sé se sceglierlo, con stato, note, promemoria ed
esito: queste scelte restano personali e il gruppo non le vede.

Insieme:
- strumenti MCP per leggere e scrivere gli appelli del gruppo, il piano personale, la cronologia;
- gli strumenti personali che mancano (`delete_subject`, etichette, promemoria);
- `studyos_check_consistency`: un controllo di coerenza che gli agenti possono eseguire spesso;
- correzioni del gruppo al catalogo BARB: docenti, aule, ricevimento, contatti.

## 2. Cosa è del gruppo e cosa è personale

| Dato | Dove sta | Chi lo vede | Chi lo cambia |
|---|---|---|---|
| Appello (corso, data, tipo, etichetta, ora, aula, note, iscrizioni) | `studyos_group_exam_sessions` | membri del gruppo | ogni membro; elimina solo chi l'ha aggiunto o owner/admin |
| Cronologia delle modifiche | `studyos_group_history` | membri del gruppo | nessuno direttamente (la scrivono le funzioni) |
| Correzioni al catalogo BARB | `studyos_group_catalog_overrides` | membri del gruppo | ogni membro; elimina solo chi l'ha scritta o owner/admin |
| Piano d'esame (scelto, stato, note, promemoria, collegamenti) | collezione personale `examPlans` (`studyos_items`, `entity_type = 'examPlan'`) | solo io | solo io |
| Voto ed esito | l'esame personale (`exams`) collegato dal piano | solo io (e chi ha la mia condivisione «progress») | solo io |
| Attività, sessioni di studio, progressi, obiettivi, preferenze | come oggi | come oggi | come oggi |

Il gruppo non sa chi ha scelto un appello (§15, domanda 5).

## 3. Decisioni prese in questo design

| # | Decisione | Perché |
|---|---|---|
| D1 | Nuovo script `supabase/group-exams.sql`, separato da `groups.sql` | `groups.sql` è appena stato unito con people-push: un file nuovo non tocca blocchi copiati tra script e non crea conflitti. |
| D2 | Scritture solo con funzioni `security definer`; ai client solo `select` | Versione, cronologia, permessi di eliminazione e nome di chi scrive li decide il server: un client non può saltarli né fingersi un altro. |
| D3 | Concorrenza con `version integer` (non con `updated_at`) | Un numero intero non dipende dagli orologi; la cronologia lo usa per «versione 3 → 4». |
| D4 | Due chiavi uniche parziali (solo righe vive): `(group_id, course_key, exam_date, kind)` e `(group_id, course_norm, exam_date, kind)` | Un membro sceglie il corso dal catalogo (`barb:<id>`), un altro lo scrive a mano (`nome:…`): con la seconda chiave resta un solo appello. |
| D5 | Eliminazione morbida (`deleted_at`); righe eliminate tolte dopo 180 giorni, cronologia dopo 365 | Chi aveva scelto l'appello vede «eliminato» invece di un buco; il ripristino funziona; la tabella non cresce per sempre. |
| D6 | Ripristino = la riga torna com'era **prima** della modifica scelta | È ciò che una persona intende con «annulla questa modifica». Una creazione non si ripristina (si elimina). Un ripristino che rielimina vale come eliminazione (stessi permessi). |
| D7 | Nessuna scrittura offline sugli appelli del gruppo | Senza rete non si sa se c'è un conflitto o un doppione; l'interfaccia dice «Serve la connessione». Il piano personale invece funziona offline (sync personale). |
| D8 | Appelli del gruppo solo in memoria (`useGroupExamStore`), mai su disco | Come le altre tabelle condivise lette al momento; offline l'appello scelto si vede dalla copia (`snapshot`) nel piano personale. |
| D9 | Piano personale con id deterministico `plan_<sessionId>` | Due dispositivi che scelgono lo stesso appello scrivono la stessa riga (LWW), non due piani. |
| D10 | Il voto non sta nel piano: il piano collega un esame personale (`examId`) | Il libretto e la media leggono gli esami: una sola fonte per il voto. |
| D11 | Eventi del calendario virtuali (`gexam:<sessionId>`), mai salvati in `events` | Non si duplica il dato del gruppo nei dati personali; export ICS, condivisioni e sync personale restano come sono. Chi vuole l'appello come evento suo lo collega (§12). |
| D12 | L'apertura dal calendario passa da `onEditEvent` con il prefisso `gexam:` | Tutte le viste (Mese, Settimana, Giorno, Agenda, elenco del telefono, anteprima, «+N») chiamano già `onEditEvent`: un solo punto da cambiare. |
| D13 | Notifiche solo in app (kind `group`), id stabili | Il push con l'app chiusa vuole un nuovo `kind` nel Worker e un deploy (§15, domanda 2). |
| D14 | Correzioni del catalogo con un tipo in più, `course` (aula, edificio, sede, orari delle lezioni) | Il catalogo oggi ha 0 regole d'orario (`schedule: []`, orari non pubblicati): senza `course` le aule non si potrebbero correggere. `schedule_rule` resta per quando gli orari usciranno. |
| D15 | Email dei docenti agli agenti: solo dominio esatto `@unimi.it`, maiuscole ignorate, niente sottodomini | Il catalogo contiene 41 indirizzi, tutti `@unimi.it`, nessun sottodominio: la regola più stretta copre tutto. `@studenti.unimi.it` è degli studenti e resta fuori. |
| D16 | Le correzioni accettano email solo `@unimi.it` anche nel server | Un membro non può mettere nel catalogo del gruppo l'indirizzo personale di qualcuno; gli agenti ricevono solo ciò che il server ha già filtrato e il client filtra di nuovo. |
| D17 | Strumenti degli appelli in file propri (`catalogGroupExams.ts`, `groupExamTools.ts`, …) | B2 lavora su `catalog.ts` ed `execute.ts`: blocchi separati, una riga ciascuno nei file condivisi. |
| D18 | Connettore remoto: gli appelli si leggono (RPC `studyos_agent_group_snapshot`), non si scrivono | Il connettore non chiede conferme e scrive con un segreto: le scritture sul gruppo arrivano ad altre persone. Si aprono solo se la persona lo dice (§15, domanda 1). |
| D19 | Promemoria autonomi (entità `Reminder`, oggi dormiente) attivati con un elenco minimo nel pannello Notifiche | Gli strumenti MCP sui promemoria hanno senso solo se la persona li vede in app (§15, domanda 3). |
| D20 | Calendario: di default tutti gli appelli dei miei gruppi (`calendar.groupExams = "all"`) | È l'esempio approvato («appare nel calendario di ogni membro»). Si può ridurre a «delle mie materie» o «solo scelti» (§15, domanda 4). |

## 4. Modello dati sul server

### 4.1 File e ordine di esecuzione

`supabase/group-exams.sql`, rieseguibile. All'inizio un blocco `do $$` controlla che esistano
`studyos_groups`, `studyos_group_members`, `studyos_group_activity`, `studyos_group_stamp()`,
`studyos_is_group_member(text)` e `studyos_group_role(text)`; altrimenti si ferma con «Esegui prima
groups.sql (versione del 12/11)».

Ordine completo dopo il merge di people-push:
`schema.sql` → `groups.sql` → `sharing.sql` → `people.sql` → **`group-exams.sql`** → `verify.sql` →
`sharing-verify.sql` (con le nuove colonne `group_exams_*`) → `people-verify.sql`. Per il connettore
remoto: `agent.sql` (→ `agent-verify.sql`); `group-exams.sql` può girare prima o dopo `agent.sql`
(la funzione per il connettore chiama `studyos_agent_user` solo quando viene usata). `storage.sql` (A5) e
`push-reminders.sql` (B3) non c'entrano: restano dove li mette `supabase/README.md`. Con le push degli
appelli (Task 23, facoltativo) `people.sql` si riesegue prima di `group-exams.sql`.

Il database deve essere UTF8 (Supabase lo è): `translate()` con lettere accentate in un database
`SQL_ASCII` lavora sui byte. Le prove su Postgres temporaneo usano `initdb -E UTF8 --locale=C`.

### 4.2 `public.studyos_group_exam_sessions`

| Colonna | Tipo | Regola |
|---|---|---|
| `id` | text PK | `^[A-Za-z0-9_-]{1,120}$`, scelto dal client (`gexam_<32 esadecimali>`) |
| `group_id` | text | FK `studyos_groups(id)` `on delete cascade` |
| `course_key` | text | `barb:<id del catalogo>` oppure `nome:<nome normalizzato>` |
| `course_id` | text null | id del corso BARB, se scelto dal catalogo |
| `course_name` | text | 2–160 caratteri, spazi compattati |
| `course_norm` | text | `studyos_course_norm(course_name)` |
| `exam_date` | date | 2000-01-01 … 2100-12-31; giorno ufficiale, senza fuso |
| `kind` | text | `appello`, `preappello`, `prova_in_itinere`, `scritto`, `orale`, `laboratorio`, `altro` |
| `label` | text | ≤ 80 (es. «Modulo A», «turno 2») |
| `exam_time` | text null | `HH:MM` |
| `room` | text | ≤ 120 |
| `notes` | text | ≤ 1000 |
| `registration_opens`, `registration_closes` | date null | apertura ≤ chiusura |
| `barb_session_id` | text null | id dell'appello ufficiale, se nato dal catalogo |
| `source` | text | `member` o `barb` (con `barb` servono `course_id` e `barb_session_id`) |
| `version` | integer | 1 alla creazione, +1 a ogni modifica, eliminazione o ripristino |
| `created_by`, `created_by_name` | text | dal server (`auth.uid()`, nome del membro) |
| `updated_by`, `updated_by_name` | text | dal server |
| `deleted_at`, `deleted_by`, `deleted_by_name` | null se vivo | dal server |
| `created_at`, `updated_at` | timestamptz | `updated_at` dal trigger `studyos_group_stamp` |

Indici: chiavi uniche parziali `studyos_gexam_live_key (group_id, course_key, exam_date, kind)` e
`studyos_gexam_live_name_key (group_id, course_norm, exam_date, kind)` `where deleted_at is null`;
`(group_id, exam_date)`; `(group_id, deleted_at) where deleted_at is not null`.

**Nome normalizzato** (`studyos_course_norm`, specchio `normalizeCourseName` in `src/lib/groupExams.ts`):
accenti italiani tolti con `translate()` (stesse due stringhe nei due file, il test lo controlla), ogni
sequenza di caratteri diversi da `A-Z a-z 0-9` → uno spazio, minuscolo, spazi ai bordi tolti.
Esempi condivisi (stessi nel test SQL e nel test JS): «Farmacologia Speciale» → `farmacologia speciale`;
«  Biologia   Molecolare II » → `biologia molecolare ii`; «Chimica – Organica (A-L)» →
`chimica organica a l`; «Ànatomia Umana» → `anatomia umana`; «ÉTICA e Società» → `etica e societa`.

### 4.3 `public.studyos_group_catalog_overrides`

| Colonna | Regola |
|---|---|
| `id` text PK | `gover_<32 esadecimali>` |
| `group_id` | FK con cascade |
| `target_kind` | `teacher`, `course`, `schedule_rule`, `contact` |
| `target_id` | `^[A-Za-z0-9_.:-]{1,160}$`: id del docente (`unimi-mario-rossi`), del corso, `<courseId>:<ruleId>` per una regola d'orario, `contatto:<etichetta-normalizzata>` per un contatto ufficiale, `nuovo:<id>` per un contatto aggiunto dal gruppo |
| `target_label` | ≤ 160, nome leggibile (il catalogo può cambiare) |
| `fields` jsonb | oggetto con i soli campi permessi (§11) |
| versione, autore, eliminazione, date | come gli appelli |

Chiave unica parziale `(group_id, target_kind, target_id) where deleted_at is null`: una correzione per
elemento e per gruppo; un'altra persona la modifica, non ne crea una seconda.

### 4.4 `public.studyos_group_history`

`id bigint generated always as identity`, `group_id` (FK cascade), `record_kind`
(`exam_session` | `catalog_override`), `record_id`, `action` (`create` | `update` | `delete` | `restore`),
`version` (dopo la modifica), `before` jsonb (riga intera prima; null per `create`), `after` jsonb,
`changed_fields text[]` (nomi del client: `course`, `date`, `kind`, `label`, `time`, `room`, `notes`,
`registrationOpens`, `registrationCloses`, `deleted`; per le correzioni i nomi dei campi più
`targetLabel`), `actor_user_id`, `actor_name`, `changed_at`. Indici per gruppo, per riga e per autore.

### 4.5 RLS e privilegi

- RLS attiva sulle tre tabelle; una sola policy `for select to authenticated using
  (public.studyos_is_group_member(group_id))`.
- `revoke all … from public, anon, authenticated`, poi solo `grant select … to authenticated`. Nessun
  insert, update o delete per i client: si scrive con le funzioni.
- Funzioni interne senza grant (`revoke all … from public, anon, authenticated`):
  `studyos_group_member_name(text)`, `studyos_group_write_gate(text)`,
  `studyos_group_history_write(…)`, `studyos_group_activity_write(…)`, `studyos_exam_session_twin(…)`.
- Funzioni pubbliche: `execute` a `authenticated`, revocato a `public` e `anon`. Tutte `security definer`
  con `set search_path = public` (le pure con `pg_catalog`).

### 4.6 Trigger

`studyos_gexam_stamp` e `studyos_gover_stamp`: `before insert or update … execute function
public.studyos_group_stamp()` (stesso timbro del server delle altre tabelle dei gruppi). Nessun trigger
scrive la cronologia: la scrivono le funzioni, che sanno se è una modifica o un ripristino.

### 4.7 Funzioni

Tutte restituiscono `jsonb` `{ status, row?, message?, field? }` con
`status ∈ ok | duplicate | conflict | gone | not_found | denied | invalid`; `row` è la riga del server
(`to_jsonb`, colonne snake_case): quella scritta (`ok`), quella attuale (`conflict`, `gone`, `denied`)
o il doppione già presente (`duplicate`). `message` è italiano semplice, pronto da mostrare.

| Firma | Cosa fa |
|---|---|
| `save_group_exam_session(p_group_id text, p_id text, p_expected_version integer, p_fields jsonb) returns jsonb` | `p_expected_version` null = crea con id `p_id`; altrimenti modifica partendo da quella versione. `p_fields` è sempre l'appello intero (camelCase: `courseId`, `courseName`, `date`, `kind`, `label`, `time`, `room`, `notes`, `registrationOpens`, `registrationCloses`, `barbSessionId`, `source`). |
| `delete_group_exam_session(p_id text, p_expected_version integer) returns jsonb` | Eliminazione morbida. Solo autore o owner/admin. |
| `save_group_catalog_override(p_group_id text, p_id text, p_expected_version integer, p_target_kind text, p_target_id text, p_target_label text, p_fields jsonb) returns jsonb` | Crea o modifica una correzione. Una correzione non cambia elemento (`invalid` su `targetId`). |
| `delete_group_catalog_override(p_id text, p_expected_version integer) returns jsonb` | Solo autore o owner/admin. |
| `restore_group_record(p_history_id bigint, p_expected_version integer) returns jsonb` | Riporta la riga com'era in `before` della voce scelta. `p_expected_version` = versione attuale vista da chi ripristina. |
| `studyos_agent_group_snapshot(p_secret text) returns jsonb` | Solo connettore remoto (§9.5). |

Funzioni pure (immutable/stable, senza privilegi da proteggere): `studyos_course_norm(text)`,
`studyos_try_date(text)`, `studyos_exam_kind_label(text)`, `studyos_only_unimi_emails(text)`,
`studyos_group_result(…)`, `studyos_exam_session_clean(jsonb)`, `studyos_catalog_override_clean(text, jsonb)`,
`studyos_exam_session_changes(jsonb, jsonb)`, `studyos_catalog_override_changes(jsonb, jsonb)`,
`studyos_exam_session_title(jsonb)`.

### 4.8 Regole di scrittura

1. **Chi chiama.** Senza `auth.uid()` → `denied`. Non membro del gruppo → `denied` in scrittura nuova,
   `not_found` su una riga esistente (non si rivela che esiste).
2. **Campi.** `studyos_exam_session_clean` rifiuta campi sconosciuti, valori non stringa, date
   impossibili, tipi non previsti; i messaggi sono gli stessi di `cleanSessionFields` nel client.
3. **Uno per volta nel gruppo.** `pg_advisory_xact_lock(hashtext('studyos-group-write:' || group_id))`
   prima di leggere e scrivere: il controllo dei doppioni non può essere battuto da due scritture
   contemporanee. Le chiavi uniche restano come rete (`unique_violation` → `duplicate`).
4. **Tetto.** Più di 60 voci di cronologia dello stesso membro nel gruppo nell'ultima ora → `invalid`
   con `field = 'rate'` («Troppe modifiche in un'ora: riprova più tardi.»).
5. **Pulizia** (alla scrittura, solo nel gruppo toccato): appelli e correzioni eliminati da oltre 180
   giorni, cronologia oltre 365 giorni.
6. **Creazione.** Id già usato dallo stesso autore, versione 1, vivo → `ok` con la riga (risposta persa e
   richiesta ripetuta: niente doppione). Id usato da altri → `invalid` (`field = 'id'`). Doppione →
   `duplicate` con l'appello che c'è già. Scrive cronologia `create` e la voce di attività «ha aggiunto
   l'appello «Preappello Farmacologia Speciale del 12/01/2027»».
7. **Modifica.** Riga assente o di un altro gruppo → `not_found`; eliminata → `gone`; versione diversa →
   `conflict` con la riga attuale; nessun campo cambiato → `ok` senza nuova versione; doppione di un
   altro appello → `duplicate`. Scrive cronologia `update` con i campi cambiati. Nessuna voce di
   attività per le modifiche (la bacheca non si riempie di «ha cambiato l'aula»).
8. **Eliminazione.** Autore o owner/admin, altrimenti `denied` con «Può eliminarlo solo chi l'ha aggiunto
   o chi gestisce il gruppo.». Versione diversa → `conflict`. Voce di attività «ha eliminato l'appello …».
9. **Ripristino.** `create` → `invalid`. Riga tolta definitivamente → `gone`. Versione diversa →
   `conflict`. Ripristino che rielimina → solo autore o owner/admin. Ripristino che fa tornare viva una
   riga uguale a un'altra viva → `duplicate`. Voce di attività solo quando un appello eliminato torna.

### 4.9 Realtime

`studyos_group_exam_sessions` e `studyos_group_catalog_overrides` entrano nella pubblicazione
`supabase_realtime` (stesso blocco `do $$` idempotente di `groups.sql`). La cronologia no: si legge
quando si apre. Supabase applica la policy di `select` agli eventi: un non membro non li riceve.

### 4.10 Controlli di prontezza

In fondo a `supabase/sharing-verify.sql` (stessa select, colonne nuove):
`group_exams_tables_ready` (tabelle + RLS), `group_exams_rpc_ready` (cinque funzioni + execute ad
`authenticated`), `group_exams_closed_ready` (niente execute ad `anon`, niente insert/update diretti,
niente select ad `anon`), `group_exams_realtime_ready`, `group_exams_agent_ready`. Tutte `true` dopo
`group-exams.sql` nel progetto reale (`realtime_ready` è falsa solo su un Postgres senza pubblicazione).

I controlli generici di B4 in `supabase/verify.sql` coprono già le tabelle nuove (RLS, niente privilegi
ad `anon`, niente `TRUNCATE`) e ogni funzione `security definer` (con `search_path` fisso, tolta ad
`anon`). L'unica eccezione nuova è l'ingresso del connettore `studyos_agent_group_snapshot(text)`, che
controlla il segreto come `studyos_agent_pull`: entra nell'elenco `anon_entry` di `verify.sql` e in
`ANON_ENTRIES` di `tests/securityData.test.mjs` (piano, Task 2); senza, `definer_functions_ready` diventa
`false`.

### 4.11 Connettore remoto

`studyos_agent_group_snapshot(p_secret text) returns jsonb`: `security definer`, account dal segreto con
`studyos_agent_user` (stesso errore `28000` di `studyos_agent_pull` se non valido), `execute` ad `anon` e
`authenticated` come le altre funzioni del connettore. Restituisce
`{ groups: [{id, name}], sessions: [...], overrides: [...] }` dei gruppi dell'account: appelli (vivi ed
eliminati non ancora tolti, massimo 2000 più recenti) e correzioni vive, **senza** `created_by`,
`updated_by`, `deleted_by` (id degli account) e con `mine: boolean`. Nessun dato di altri gruppi, nessuna
email di membri (le righe non ne contengono).

### 4.12 Cancellazione dell'account

`examPlans` sono righe di `studyos_items`: le toglie già `erase_studyos_account_items`. Appelli,
correzioni e cronologia sono contenuto del gruppo: restano con il nome di chi li ha scritti, come le
risorse e l'attività dei gruppi nella revisione B4 (`docs/security-data.md`, «Restano: sono anche degli
altri membri»). Questo design non aggiunge nulla a `erase_studyos_account_items`; il piano aggiunge una
riga alla tabella di `docs/security-data.md` (Task 24).

## 5. Modello client

### 5.1 Tipi

In `src/types.ts`:

```ts
export type GroupExamKind = "appello" | "preappello" | "prova_in_itinere" | "scritto" | "orale" | "laboratorio" | "altro";
export type ExamPlanStatus = "planned" | "registered" | "taken" | "passed" | "failed" | "withdrawn" | "skipped";

/** Copia dell'appello al momento della scelta: serve offline e per dire «è cambiato». */
export interface ExamPlanSnapshot {
  groupId: ID; groupName: string; courseKey: string; courseName: string;
  date: string; kind: GroupExamKind; time: string | null; room: string;
  registrationCloses: string | null; version: number;
}

export interface ExamPlan extends BaseEntity {
  sessionId: ID;
  selected: boolean;
  status: ExamPlanStatus;
  notes: string;
  reminders: EventReminder[];
  remindRegistration: boolean;
  subjectId?: ID;
  examId?: ID;
  linkedEventId?: ID;
  /** `event:<id>` / `exam:<id>` scartati con «Tienili separati». */
  dismissedMatches: string[];
  snapshot: ExamPlanSnapshot;
}
```

`StudySnapshot` riceve `examPlans: ExamPlan[]`. In `src/lib/groupExams.ts`: `GroupExamSession`,
`CatalogOverride`, `GroupHistoryEntry`, `SessionFields`, `GroupWriteResult<T>`, `GroupExamWriter`
(campi nel piano, Task 3).

### 5.2 Moduli

| File | Responsabilità | Puro |
|---|---|---|
| `src/lib/groupExams.ts` | tipi, nome normalizzato, chiave del corso, controllo dei campi, righe del server, doppioni, unione a tre, cronologia leggibile | sì |
| `src/lib/examPlans.ts` | id del piano, copia, modifica del piano, normalizzazione dal cloud | sì |
| `src/lib/groupExamCalendar.ts` | eventi virtuali (calendario e promemoria), doppioni personali | sì |
| `src/lib/groupExamNotify.ts` | notifiche in app con id stabili | sì |
| `src/lib/examConsistency.ts` | controllo di coerenza | sì |
| `src/lib/catalogOverrides.ts` | campi permessi, controllo, valori effettivi | sì |
| `src/lib/institutionalEmail.ts` | regola @unimi.it e oscuramento delle email | sì |
| `src/store/useGroupExamStore.ts` | appelli, correzioni e nomi dei gruppi in memoria | sì (zustand) |
| `src/lib/groupExamSync.ts` | pull, realtime, RPC, notifiche; implementa `GroupExamWriter` | no (Supabase, sempre con `import()`) |
| `src/lib/reminderSources.ts` | eventi da cui nascono i promemoria (personali + appelli + promemoria autonomi) | sì |

### 5.3 Store

`useGroupExamStore` (memoria, mai su disco):
`viewerId`, `ready` (primo pull fatto), `available` (tabelle presenti), `groups: {id, name}[]`,
`sessions: GroupExamSession[]`, `overrides: CatalogOverride[]`, `error`, e le azioni `setSnapshot`,
`setGroups` (con l'elenco nuovo toglie appelli e correzioni dei gruppi lasciati), `applySession`,
`applyOverride`, `dropSession`, `dropOverride`, `setUnavailable`, `setError`, `reset`; più l'aiuto
`groupNamesOf(groups)`. Una riga con versione più vecchia di quella in memoria non vince mai
(`mergeSessionRow`).

`useStudyStore` riceve `examPlans` e le azioni `planExam(sessionId, patch, session?, groupName?)`,
`removeExamPlan(id)`, `addReminder`, `updateReminder`, `deleteReminder`. `deleteSubject`, `deleteExam` e
`deleteEvent` tolgono dai piani i collegamenti che puntano a ciò che sparisce (`subjectId`, `examId`,
`linkedEventId`), come già fanno con note, materiali e promemoria.

### 5.4 Collezione `examPlans`

- `COLLECTIONS` + `ENTITY_TYPES.examPlans = "examPlan"` (in fondo all'elenco).
- Dexie: tabella `examPlans: "id, updatedAt, sessionId"` nella **prima versione libera** di
  `src/lib/db.ts`: dopo i merge dell'ondata 2 l'ultima è la v7 (A5), quindi **v8**; il Task 0 del piano
  lo ricontrolla e, se l'ultima è un'altra, usa la successiva.
- `SYNC_SCHEMA` in `src/lib/cloudSync.ts` +1 (oggi 3 → 4): un dispositivo con l'app vecchia ha saltato le
  righe `examPlan` muovendo il cursore; con lo schema nuovo le rilegge una volta.
- Backup completo: etichetta «piani d'esame». I backup parziali (attività, calendario, materie) non cambiano.
- Non è condivisibile (nessuno scope di `sharing.sql` lo nomina) e non è in `GROUP_COLLECTIONS`.

## 6. Sync e realtime

- **Avvio.** `ensureSharedMailbox()` in `groupSync.ts`, dopo il pull riuscito, carica con `import()`
  `groupExamSync` e chiama `startGroupExamSync()`. Senza account, senza Supabase o con il vault bloccato
  non parte.
- **Gruppi.** Quelli pubblicati (`sharedAt`) in `useStudyStore.studyGroups`; l'elenco si ricalcola quando
  cambia `studyGroups` (entrata, uscita, nuovo gruppo).
- **Pull.** `select *` delle due tabelle con `group_id in (…)`, a pagine di 500 ordinate per `id`
  (la RLS filtra comunque). Al primo pull `ready = true`. Errore `42P01` (tabella mancante) →
  `available = false`: le sezioni mostrano «Gli appelli del gruppo non sono ancora attivi.».
- **Realtime.** Canale `studyos-group-exams:<me>`, `postgres_changes` su entrambe le tabelle con filtro
  `group_id=in.(…)` (al massimo 100 gruppi, `realtimeGroupIds`). INSERT e UPDATE: la riga arriva nel
  payload e si applica subito (`sessionFromRow`); DELETE (pulizia dopo 180 giorni o cascade) porta solo
  la chiave: si toglie per id. Riconnessione: pull completo.
- **Controlli.** Pull al ritorno sulla scheda se l'ultimo ha più di 30 s, e ogni 5 minuti a scheda visibile.
- **Scritture.** Solo online: `rpc(...)`, poi la riga dell'esito si applica allo store (non si aspetta il
  realtime). Errore di rete → l'interfaccia lo dice; niente coda.
- **Cambio account, uscita, vault bloccato.** `stopSharedMailbox()` → `stopGroupExamSync()`;
  `resetSharedCache()` → `useGroupExamStore.getState().reset()`; al blocco del vault lo store si svuota e
  il canale si chiude; allo sblocco riparte se era attivo.
- **Bundle iniziale.** Nessun import statico di `groupExamSync` da moduli raggiungibili dall'avvio:
  store e moduli puri sì, Supabase no (`grep` del bundle nel piano).

## 7. Interfaccia (italiano semplice)

Testi condivisi (tipi di prova, stati del piano, nomi dei campi, messaggi dei controlli) in
`src/lib/labels.ts`; testi delle schermate in `src/lib/labels/groupExams.ts`.

### 7.1 Dove si vedono gli appelli

- **Calendario:** giornata intera, colore della tipologia «Esame», titolo «Preappello · Farmacologia
  Speciale». Un appello scelto ha la priorità alta; uno eliminato ma scelto resta visibile con il titolo
  «Eliminato nel gruppo · Preappello · Farmacologia Speciale». Non si trascina. Toccandolo si apre il
  riquadro dell'appello.
- **Pagina della materia:** sezione «Appelli del gruppo» sotto gli appelli ufficiali BARB: gli appelli
  futuri dei miei gruppi per quel corso, con «Scegli» / «Scelto» e «Aggiungi un appello».
- **Gruppi → dettaglio:** due schede nuove, «Appelli» e «Docenti e aule».
- **BARB:** sotto ogni docente e contatto, «Corretto dal gruppo X» con i valori del gruppo.

### 7.2 Aggiungere un appello

Campi: Corso (le mie materie, oppure scritto a mano), Data, Tipo (Appello, Preappello, Prova in itinere,
Scritto, Orale, Laboratorio, Altra prova), Etichetta (facoltativa), Ora, Aula, Iscrizioni dal / al, Note.
Prima di salvare il client cerca un doppione (`findTwin`) e lo dice subito:
«Questo appello c'è già nel gruppo: Preappello · Farmacologia Speciale del 12/01/2027, aggiunto da Bea.»
con il pulsante «Apri quello». Se il server risponde `duplicate` si mostra lo stesso messaggio.
Da un appello ufficiale BARB: «Aggiungi al gruppo» compila corso, data, tipo, ora, sede, iscrizioni.

### 7.3 Modificare e conflitti

Si modifica nel riquadro. Al salvataggio si manda la versione di partenza. Se il server risponde
`conflict`:
- campi diversi da quelli che ho toccato → unione automatica e nuovo salvataggio, con «Nel frattempo Ada
  ha cambiato l'aula: abbiamo tenuto anche la tua modifica.»;
- stesso campo cambiato da entrambi → pannello «Ada ha cambiato questo appello mentre lo modificavi.»
  con, per ogni campo, «La tua: 14/01/2027» / «Di Ada: 13/01/2027» e i pulsanti «Tieni la mia» e
  «Tieni quella di Ada», poi «Salva».
- `gone`: «Questo appello è stato eliminato da Olga. Le tue modifiche non sono state salvate.» con
  «Chiudi».

### 7.4 Eliminare

Solo chi l'ha aggiunto o chi gestisce il gruppo vede «Elimina appello»; gli altri leggono «Può
eliminarlo Bea o chi gestisce il gruppo.». Conferma in riga: «Eliminare l'appello per tutto il gruppo?
Chi l'ha scelto lo vedrà come eliminato.» → «Elimina».

### 7.5 Cronologia e ripristino

Nel riquadro, sezione «Cronologia» (si carica quando si apre): «Ada · ieri 18:02 · Aula: Aula C03 →
Aula G24 · Ripristina». «Ripristina» → «Riportare l'appello com'era prima di questa modifica?» →
«Ripristina». Gli esiti usano i messaggi del server. Nella scheda «Appelli» del gruppo, «Eliminati di
recente» elenca gli eliminati con «Ripristina».

### 7.6 Il mio piano

Nel riquadro, sezione «Il mio piano» (solo mia, scritto: «Solo tu vedi queste scelte.»):
interruttore «Lo scelgo»; Stato (Da fare, Iscritto, Sostenuto, aspetto l'esito, Superato, Non superato,
Ritirato, Non lo faccio); Note; Promemoria (stesso editor degli eventi tutto il giorno); «Avvisami prima
della chiusura delle iscrizioni»; Materia; «Registra l'esito» apre il libretto sull'esame collegato
(o crea l'esame personale con la data dell'appello e poi apre il voto). Se l'appello è cambiato da
quando l'ho scelto: «È cambiato da quando l'hai scelto: Data 12/01/2027 → 14/01/2027.» con «Ho visto»
(le righe le calcola `planChanges` in `src/lib/groupExamUi.ts`, confrontando l'appello con
`examPlan.snapshot`).

### 7.7 Notifiche (in app, kind `group`)

| Quando | Id | Titolo | Testo |
|---|---|---|---|
| Un altro membro aggiunge un appello futuro di una mia materia | `notif-gexam-new-<id>` | Nuovo appello nel gruppo | «Preappello · Farmacologia Speciale, 12/01/2027 · da Bea» |
| Un appello che ho scelto cambia data, tipo, ora, aula, corso o iscrizioni | `notif-gexam-<id>-v<versione>` | Appello cambiato | «Preappello · Farmacologia Speciale: Data: 12/01/2027 → 14/01/2027 · da Ada» |
| Un appello che ho scelto viene eliminato | `notif-gexam-<id>-deleted` | Appello eliminato | «… del 12/01/2027 · eliminato da Olga. È ancora nel tuo piano.» |

Il primo avvio per un account fissa un segno (`gexam-seen:<userId>` nella tabella `meta`) e non avvisa
del passato. Le proprie modifiche non avvisano. «Apri» porta a Gruppi → gruppo → scheda «Appelli».

### 7.8 Collegare ciò che ho già (migrazione)

Nel riquadro, se ho un mio evento d'esame o un mio esame dello stesso corso nello stesso giorno:
«Hai già questo appello nel tuo calendario: Appello · Farmacologia Speciale (12/01).» con «Collega» e
«Tienili separati». «Collega» sceglie l'appello, collega l'evento (`linkedEventId`) o l'esame
(`examId`) e non cambia nulla dei miei dati. Poi propone «Vuoi togliere il tuo evento? L'appello del
gruppo resta nel calendario.» con «Togli il mio evento» (che si può annullare dal messaggio «Evento
tolto · Annulla») e «Tienilo».

### 7.9 Docenti e aule

Scheda «Docenti e aule» del gruppo: elenco dei docenti dei corsi e dei contatti, con il valore ufficiale
e, se c'è, quello del gruppo. «Correggi» apre un riquadro con i campi permessi (§11); sotto c'è sempre
«Dato ufficiale: …». Email: «Solo indirizzi istituzionali che finiscono con @unimi.it.»

### 7.10 Promemoria autonomi

Nel pannello Notifiche, sezione «Promemoria»: elenco dei prossimi (titolo, giorno e ora, collegamento),
spunta «Fatto», «Aggiungi promemoria» (titolo, giorno, ora). Scattano come i promemoria degli eventi
(stesso watcher), anche per quelli creati dagli agenti. Componente `StandaloneReminders` in
`src/components/StandaloneReminders.tsx`, montato in `NotificationsPanel.tsx`.

## 8. Calendario e pagina della materia

- `CalendarView` unisce alle occorrenze proprie e condivise gli eventi di `groupExamEvents(...)` con
  `occurrenceKey = gexam:<sessionId>`. Il filtro per materia funziona (gli eventi virtuali hanno
  `subjectId` della mia materia dello stesso corso).
- `CalendarOccurrence` riceve `groupExam?: GroupExamMarker`; `canDrag` restituisce `false` se c'è.
- `onEditEvent(id, …)`: se `sessionIdOfEventId(id)` non è null apre `GroupExamDrawer` (caricato con
  `lazy`) invece dell'editor. `onMoveEvent` ignora gli eventi `gexam:`.
- Menu del calendario: «Appelli dei gruppi: Tutti · Delle mie materie · Solo quelli scelti»
  (`useUiState("calendar.groupExams", "all", { scope: "device", validate: oneOf("all", "subjects", "off") })`).
- Promemoria: `EventReminderWatcher` pianifica su `reminderSourceEvents(state, groupExamState)` =
  eventi personali + `groupExamReminderEvents(sessions, examPlans)` + promemoria autonomi come eventi
  virtuali. Se B3 (promemoria con l'app chiusa) è già unito, il suo calcolo usa la stessa funzione.
- `SubjectGroupExams` in `SubjectsView` subito dopo `BarbExamSessions`, anche senza corso BARB (si
  confronta il nome della materia).

## 9. Strumenti MCP

### 9.1 Elenco

| Nome | Rischio | Flag | Connettore remoto |
|---|---|---|---|
| `studyos_list_group_exam_sessions` | read | idempotent | sì (snapshot) |
| `studyos_create_group_exam_session` | write | additive, openWorld | no |
| `studyos_update_group_exam_session` | write | openWorld | no |
| `studyos_delete_group_exam_session` | destructive | openWorld | no |
| `studyos_list_group_history` | read | idempotent | no |
| `studyos_restore_group_change` | write | openWorld | no |
| `studyos_plan_exam` | write | — | sì |
| `studyos_list_exam_plan` | read | idempotent | sì |
| `studyos_delete_subject` | destructive | — | sì |
| `studyos_list_tags` | read | idempotent | sì |
| `studyos_tag_items` | write | — | sì |
| `studyos_list_reminders` | read | idempotent | sì |
| `studyos_create_reminder` | write | additive | sì |
| `studyos_update_reminder` | write | — | sì |
| `studyos_delete_reminder` | destructive | — | sì |
| `studyos_check_consistency` | read | idempotent | sì (snapshot) |
| `studyos_list_barb_teachers` | read | idempotent | sì |
| `studyos_get_barb_course` | read | idempotent | sì |
| `studyos_list_barb_contacts` | read | idempotent | sì |
| `studyos_save_catalog_override` | write | openWorld | no |
| `studyos_delete_catalog_override` | destructive | openWorld | no |

Gli strumenti `openWorld` hanno effetto su altre persone: la descrizione lo dice («lo vedono tutti i
membri del gruppo»). `studyos_get_subject` riceve `linkedCounts` (esami, argomenti, attività, eventi,
sessioni, materiali, note, promemoria, piani) per spiegare cosa farà `studyos_delete_subject`.
Nuovo codice d'errore `conflict` in `AgentCallResult` (con `data.current`).

### 9.2 Schemi d'ingresso

Costanti: `ID` (come oggi), `DAY` (`^\d{4}-\d{2}-\d{2}$`), `DAY_OR_EMPTY` (`^(\d{4}-\d{2}-\d{2})?$`),
`TIME_OR_EMPTY` (`^(([01][0-9]|2[0-3]):[0-5][0-9])?$`), `VERSION` (intero 1–1 000 000), `KIND`
(enum dei sette tipi), `CONFIRM`, `LIMIT`, `OFFSET`, `QUERY`. Stringa vuota = «togli il valore» (niente
`null` negli schemi: alcuni client non accettano tipi multipli).

- `list_group_exam_sessions`: `groupId?`, `subjectId?`, `from?` DAY, `to?` DAY, `includeDeleted?` (false),
  `onlyChosen?` (false), `query?`, `limit`, `offset`.
- `create_group_exam_session`: `groupId`, `date`, `kind` obbligatori; uno tra `subjectId` (corso dalla mia
  materia) e `courseName` (+ `courseId?` del catalogo); `label?`, `time?`, `room?`, `notes?`,
  `registrationOpens?`, `registrationCloses?`, `choose?` (false: se true lo mette anche nel mio piano).
- `update_group_exam_session`: `id`, `expectedVersion` obbligatori; `courseName?`, `courseId?`, `date?`,
  `kind?`, `label?`, `time?`, `room?`, `notes?`, `registrationOpens?`, `registrationCloses?`. I campi
  assenti restano come sono.
- `delete_group_exam_session`: `id`, `confirm`; `expectedVersion?` (senza: si elimina la versione
  attuale; con: se l'appello è cambiato nel frattempo risponde `conflict` prima di scrivere).
- `list_group_history`: `groupId` obbligatorio; `recordId?`, `recordKind?` (`exam_session` |
  `catalog_override`), `limit` (1–50, default 20), `beforeId?` (`^[0-9]{1,18}$`).
- `restore_group_change`: `historyId` (`^[0-9]{1,18}$`), `expectedVersion`.
- `plan_exam`: `sessionId` obbligatorio; `chosen?`, `status?` (sette stati), `notes?` (≤ 2000),
  `reminders?` (`EVENT_REMINDERS` di oggi), `remindRegistration?`, `subjectId?`, `examId?`,
  `linkedEventId?` (stringa vuota = togli), `acknowledgeChanges?`, `dismissMatch?`
  (`^(event|exam):[A-Za-z0-9_.:-]{1,120}$`). Il voto: `studyos_record_grade` sull'esame collegato.
- `list_exam_plan`: `includeNotChosen?` (false), `from?`, `to?`, `limit`, `offset`.
- `delete_subject`: `id`, `confirm`.
- `list_tags`: `query?`, `limit`, `offset`.
- `tag_items`: `type` (`task` | `material` | `note` | `event`), `ids` (1–50 ID), `add?`, `remove?`
  (1–20 etichette, 1–40 caratteri, senza virgole).
- `list_reminders`: `includeDone?` (false), `from?`, `to?`, `limit`, `offset`.
- `create_reminder`: `title` (1–200), `remindAt` (ISO come gli eventi), `linkedType?`
  (`subject` | `exam` | `calendarEvent` | `task` | `note`), `linkedId?`.
- `update_reminder`: `id`; `title?`, `remindAt?`, `done?`.
- `delete_reminder`: `id`, `confirm`.
- `check_consistency`: `scope?` (`all` | `personal` | `groups`), `minSeverity?` (`info` | `warning` |
  `error`), `limit`, `offset`.
- `list_barb_teachers`: `query?`, `courseId?`, `groupId?`, `limit`, `offset`.
- `get_barb_course`: `id`, `groupId?`.
- `list_barb_contacts`: `groupId?`.
- `save_catalog_override`: `groupId`, `targetKind`, `targetId` (`^[A-Za-z0-9_.:-]{1,160}$`),
  `targetLabel?`, `fields` (oggetto, chiavi permesse per tipo, valori stringa ≤ 300; vuota = togli),
  `expectedVersion?` (obbligatoria se il gruppo ha già una correzione per quell'elemento).
- `delete_catalog_override`: `id`, `confirm`; `expectedVersion?` (come per gli appelli).

### 9.3 Proiezioni e regola sulle email

**Decisione della persona (12/11):** gli agenti possono ricevere gli indirizzi email istituzionali di
docenti e contatti dell'università, solo se finiscono esattamente con `@unimi.it`. Mai email di
studenti, membri dei gruppi, invitati o account.

Controllo dei dati: in `src/data/university/*` ci sono 41 indirizzi, tutti con dominio esatto
`unimi.it` (nessun sottodominio). **Scelta:** confronto esatto del dominio, maiuscole ignorate,
`^[a-z0-9._%+-]+@unimi\.it$` sul valore senza spazi e in minuscolo. `@studenti.unimi.it`,
`@sub.unimi.it`, `@unimi.it.evil.com`, `x@unimi.it@evil.com` restano fuori.

Una sola costante in `src/agent/project.ts`:
`export const AGENT_INSTITUTIONAL_EMAILS = true;` — `false` riporta alla regola di prima («nessuna email»)
senza toccare altro. Funzioni (da `src/lib/institutionalEmail.ts`):
- `agentTeacherEmail(value, allow = AGENT_INSTITUTIONAL_EMAILS)` → indirizzo in minuscolo o `null`;
- `agentCatalogText(text, allow = AGENT_INSTITUTIONAL_EMAILS)` → testo dei contatti con gli indirizzi
  non istituzionali (o tutti, se `allow` è false) sostituiti da «[email nascosta]»;
- `agentMemberText(text)` → testo scritto dai membri (note degli appelli, note delle correzioni): **tutti**
  gli indirizzi oscurati, sempre.

Proiezioni:
- **Appello:** `id`, `groupId`, `groupName`, `courseName`, `courseId`, `date`, `kind`, `kindLabel`,
  `label`, `time`, `room`, `notes` (`agentMemberText`, accorciate a 300 con `truncated`),
  `registrationOpens`, `registrationCloses`, `source`, `version`, `addedBy` (nome), `updatedBy` (nome),
  `updatedAt`, `deleted`, `deletedBy?` (nome), `mySubjectId?`, `myPlan?` (`chosen`, `status`,
  `statusLabel`). Mai `createdBy`/`updatedBy` come id.
- **Membri:** solo nome e ruolo (`publicGroup` di oggi).
- **Docente:** `id`, `name`, `role`, `department`, `courseIds`, `email` (`agentTeacherEmail`), `phone`,
  `office`, `officeHours`, `officeHoursPlace`, `website`, `profileUrl`, `corrections` (per gruppo:
  `overrideId`, `groupId`, `groupName`, `fields` con `email` passata da `agentTeacherEmail`, `note`
  con `agentMemberText`, `by`, `updatedAt`, `version`), `effective` se c'è `groupId`.
- **Contatto:** `targetId`, `label`, `value` (`agentCatalogText`), `url` (un `mailto:` passa solo se
  l'indirizzo è istituzionale), `corrections` come sopra.
- **Cronologia:** `historyId`, `recordKind`, `recordId`, `action`, `actionLabel`, `version`, `title`,
  `changes` (righe di `describeHistoryEntry`, con `agentMemberText`), `by` (nome), `at`, `restorable`.

Test (piano, Task 21): un indirizzo non `@unimi.it` o di un membro non arriva mai agli agenti — né dagli
elenchi dei docenti, né dai contatti, né dalle note degli appelli, né dalla cronologia, né dai gruppi —
e con il flag a `false` nessun indirizzo arriva.

### 9.4 Errori

| Esito del server | Codice MCP | `data` |
|---|---|---|
| `ok` | ok | `session` / `override` / `restored` |
| `duplicate` (creazione) | ok | `created: false`, `duplicate: true`, `session` già presente |
| `duplicate` (modifica, ripristino) | `invalid` | `existing` |
| `conflict` | `conflict` | `current` (riga attuale proiettata) |
| `gone` | `not_found` | `current` |
| `not_found` | `not_found` | — |
| `denied` | `denied` | — |
| `invalid` | `invalid` | `field` |
| rete o tabelle mancanti | `not_connected` | — |

### 9.5 Connettore remoto

Prima di uno strumento che legge gli appelli o le correzioni (`studyos_list_group_exam_sessions`,
`studyos_plan_exam`, `studyos_list_exam_plan`, `studyos_check_consistency`, `studyos_list_barb_teachers`,
`studyos_get_barb_course`, `studyos_list_barb_contacts`), `cloudRunner` chiama
`studyos_agent_group_snapshot` e riempie `useGroupExamStore` (`viewerId = "remote"`); dopo lo svuota,
come fa con `useStudyStore`. Funzione mancante (script non eseguito) → `available = false` e gli
strumenti rispondono `not_connected` «Gli appelli dei gruppi non sono ancora attivi.». Le scritture sul
gruppo e la cronologia sono in `CLOUD_UNAVAILABLE` finché la persona non decide (§15, domanda 1). Le
scritture personali del connettore (`examPlan`, promemoria, etichette, `delete_subject`) passano da
`studyos_agent_push` e quindi dal registro del connettore di B2 (`studyos_agent_audit`): nessun registro
in più qui. Le scritture sul gruppo dal ponte locale le registra la cronologia del gruppo (con il nome
della persona) e il registro locale (`studyos_list_audit`).

### 9.6 Versione

`AGENT_SERVER_VERSION` → `1.9.0` (B2 porta 1.8.0). Le istruzioni del server (`src/agent/mcp.ts`)
ricevono una riga: «Appelli dei gruppi: prima di crearne uno usa studyos_list_group_exam_sessions; per
modificarlo passa expectedVersion; le scelte personali vanno con studyos_plan_exam. Esegui
studyos_check_consistency quando riordini il piano d'esame.»

## 10. Controllo di coerenza

`checkConsistency(input)` in `src/lib/examConsistency.ts`, sola lettura, deterministico. Uscita:
`{ checkedAt, groupsChecked, groupExamsChecked, counts: { error, warning, info }, issues: [...] }`;
ogni problema `{ id, code, severity, title, detail, refs, fix? }` con `id = code:refs ordinati` (stabile)
e `fix = { tool, args, needsConfirmation }`. Ordine: gravità, codice, id.

| Codice | Gravità | Quando | Proposta |
|---|---|---|---|
| `duplicate_session` | error | due appelli vivi nello stesso gruppo, stesso giorno, tipo e corso | elimina il più recente (`needsConfirmation`) |
| `possible_duplicate` | warning | stesso gruppo, corso e tipo, un giorno di distanza | — |
| `same_session_other_group` | info | stesso appello in due miei gruppi | — |
| `orphan_plan` | warning | appello scelto non più raggiungibile | `plan_exam chosen=false` |
| `selected_deleted` | warning | appello scelto eliminato nel gruppo | `plan_exam chosen=false` |
| `selected_changed` | info | appello scelto cambiato (data, tipo, ora, aula, corso, iscrizioni) | `plan_exam acknowledgeChanges` |
| `exam_date_mismatch` | warning | esame collegato con un'altra data | — |
| `linked_event_missing` | warning | evento collegato sparito | `plan_exam linkedEventId=""` |
| `linked_event_mismatch` | warning | evento collegato in un altro giorno | — |
| `unlinked_personal_duplicate` | info | mio evento d'esame o esame stesso corso e giorno, non collegato né scartato | `plan_exam` con collegamento |
| `orphan_exam_subject` | warning | esame la cui materia non c'è più | — |
| `orphan_plan_subject` / `orphan_plan_exam` | info / warning | piano che punta a materia/esame spariti | `plan_exam` con `""` |
| `orphan_link` | info | promemoria, nota o materiale collegati a qualcosa che non c'è | — |
| `passed_but_selected_future` | info | esame già superato e appello futuro ancora scelto | `plan_exam chosen=false` |
| `two_selected_same_course` | info | più appelli futuri scelti per lo stesso corso | — |
| `override_target_missing` | info | correzione per un elemento non più nel catalogo | elimina la correzione (`needsConfirmation`) |
| `registration_closing` | warning | scelto, «Da fare», iscrizioni che chiudono entro 3 giorni | — |

Senza appelli letti (offline, script non eseguito) solo i controlli personali, con
`groupExamsChecked: false`: non si dice mai «manca» per ciò che non si è potuto leggere.

## 11. Correzioni al catalogo BARB

| Tipo | `target_id` | Campi |
|---|---|---|
| `teacher` (`BarbTeacher`) | id del docente | `officeHours`, `officeHoursPlace`, `office`, `phone`, `email` (solo @unimi.it), `website` (http/https), `note` |
| `course` | id del corso | `room`, `building`, `site`, `lessonTimes`, `note` |
| `schedule_rule` (`ScheduleRule`) | `<courseId>:<ruleId>` | `room`, `building`, `site`, `note` |
| `contact` (`UniversityContact`) | `contatto:<etichetta>` o `nuovo:<id>` | `label`, `value`, `url` (https o `mailto:` istituzionale), `note` |

Limiti: 160 caratteri; `phone` 40 (`^[0-9 +()./-]{3,40}$`); `note` 500; `officeHours`, `lessonTimes`,
`value`, `url`, `website` 300. Ogni testo può contenere solo indirizzi `@unimi.it`. Vuoto o null = il
campo non si corregge. Almeno un campo. Il valore effettivo (`withOverride`) è quello ufficiale con
sopra quello del gruppo scelto; la nota resta sulla correzione. Il catalogo statico non cambia mai.
Link mostrati con `safeHref`/`normalizeExternalUrl`.

## 12. Migrazione dei dati esistenti

Niente si unisce da solo e niente si perde:
1. Gli esami personali, gli eventi d'esame (anche quelli importati da BARB con `appello-importato`) e le
   loro note restano dove sono.
2. Quando un appello del gruppo coincide con un mio evento d'esame o un mio esame (stesso giorno, stesso
   corso per materia collegata o nome), il riquadro e il controllo di coerenza lo propongono (§7.8).
3. «Collega» scrive solo il mio piano (`linkedEventId` / `examId`, `chosen = true`); il mio evento non
   cambia. Togliere il mio evento è un passo in più, con «Annulla».
4. «Tienili separati» scrive `dismissedMatches`: non si propone più.
5. Un mio evento d'esame si può portare nel gruppo dal suo editor: «Condividi con il gruppo» crea
   l'appello (con controllo dei doppioni) e collega subito l'evento al piano.

## 13. Piano di test

- **SQL** (`scripts/supabase/group-exams-tests.sql`, Postgres temporaneo UTF8 con stub di `auth`, 69
  controlli, script applicato due volte): nome normalizzato (6 esempi), email (6), creazione e
  ripetizione, doppioni per chiave e per nome, modifica, nessun cambio, conflitto, doppione in modifica,
  campi non validi (4), estranea (lettura, scrittura, eliminazione, scrittura diretta), eliminazione
  (permessi, versione, già eliminato, modifica di un eliminato), ripristino (creazione, versione,
  membro, rieliminazione, duplicate), correzioni (email, sottodominio, email nel testo, sito, valida,
  duplicate, modifica, contatto, campo di un altro tipo, permessi, ripristino), tetto, pulizia,
  connettore (snapshot senza id, segreto sbagliato), privilegi, cascade. Più le colonne di prontezza.
- **Unità** (`node --test`, ora locale e `TZ=UTC`): `groupExams.test.mjs`, `groupExamPlan.test.mjs`,
  `catalogOverrides.test.mjs`, `examConsistency.test.mjs`, `groupExamNotify.test.mjs`, più i test di
  store (`examPlansStore.test.mjs`), sync (sorgente), calendario (sorgente e puro), agenti
  (`agentGroupExams.test.mjs`, `agentPersonalTools.test.mjs`, `agentEmails.test.mjs`,
  `agentUniversity.test.mjs` con la prova che nessun indirizzo non `@unimi.it` o di un membro arriva agli
  agenti) e connettore (`cloudRunnerGroupExams.test.mjs`).
- **Bundle:** `npm run build` e `grep` dell'entry senza client Supabase.
- **A mano (chi controlla l'interfaccia):** due account nello stesso gruppo sullo stack locale
  (porte 55421–55429): creazione, doppione, conflitto, eliminazione, ripristino, notifica, calendario,
  pagina della materia, offline con appello scelto.

## 14. Rischi

| Rischio | Effetto | Mitigazione |
|---|---|---|
| Stesso corso con chiave `barb:` e `nome:` diversi e nomi diversi («Farmacologia speciale» vs «Farmacologia sp.») | due appelli | client: suggerisce il corso dal catalogo; controllo di coerenza `possible_duplicate` non lo vede (nomi diversi): l'utente lo nota in elenco ordinato per data; accettato |
| Versione Dexie in collisione con A5 | apertura del database fallita | Task 0 legge l'ultima versione in `db.ts` dopo i merge e usa la successiva |
| Numero di strumenti (73 → 94) | alcuni client MCP limitano gli strumenti | descrizioni brevi; se un client lo chiede, gli strumenti BARB e dei promemoria si possono spostare dietro un'opzione |
| Merge people-push e push per gli appelli | conflitti in `groups.sql`/`people.sql` | file separato; push solo nel Task 23 facoltativo, con kind nuovo `group` in `people.sql` e nel Worker; il trigger legge solo righe in chiaro (`encrypted = false`) e non blocca mai la scrittura |
| Dati vecchi sul connettore remoto | un agente legge un appello appena cambiato | snapshot a ogni chiamata che lo usa; le scritture remote sono chiuse |
| Realtime perso (rete, sospensione) | appelli non aggiornati | pull a ogni riconnessione, al ritorno sulla scheda (30 s) e ogni 5 minuti |
| Tetto di 60 modifiche l'ora | un agente in ciclo si ferma | messaggio chiaro; il tetto protegge gli altri membri |
| Cronologia con dati di chi è uscito | nomi di ex membri visibili | contenuto del gruppo; anonimizzazione decisa da B4 |

## 15. Domande per la persona

1. Il connettore remoto (senza conferme) può **scrivere** appelli e correzioni del gruppo? Default: no,
   solo lettura.
2. Notifiche **push** sul telefono per appelli nuovi o cambiati? Default: solo in app (serve un kind nuovo
   nel Worker e un deploy).
3. Attivare i **promemoria autonomi** (entità `Reminder`) visibili nel pannello Notifiche? Default: sì,
   elenco minimo.
4. Calendario: **tutti** gli appelli dei gruppi o solo quelli **delle mie materie** come default?
   Default: tutti.
5. I membri devono vedere **quanti** nel gruppo hanno scelto un appello? Default: no (resta privato).

## 16. Fuori ambito

Registro del connettore remoto (B2), promemoria con l'app chiusa (B3), revisione RLS e cancellazione
dell'account (B4), scritture remote sul gruppo, conteggi di chi ha scelto un appello, import automatico
dal catalogo BARB nel gruppo.
