# Appelli condivisi dei gruppi

Spec: [superpowers/specs/2026-11-12-shared-exam-sessions-design.md](superpowers/specs/2026-11-12-shared-exam-sessions-design.md).
Piano: [superpowers/plans/2026-11-12-shared-exam-sessions.md](superpowers/plans/2026-11-12-shared-exam-sessions.md)
(il codice di oggi segue la spec e i giri di correzione; dove il piano dice altro, vale questa pagina).

## Cosa è del gruppo e cosa è personale

- Del gruppo (Supabase, `supabase/group-exams.sql`): appelli (`studyos_group_exam_sessions`), correzioni al
  catalogo BARB (`studyos_group_catalog_overrides`) e cronologia (`studyos_group_history`). Le tabelle si
  leggono solo da membri del gruppo (RLS) e si scrivono solo con le funzioni (`save_group_exam_session`,
  `delete_group_exam_session`, `save_group_catalog_override`, `delete_group_catalog_override`,
  `restore_group_record`): versione attesa, doppioni, permessi, limite di modifiche e cronologia stanno lì.
  Esito: `{status, row?, message?, field?}` con `status` tra `ok`, `duplicate`, `conflict`, `gone`,
  `not_found`, `denied`, `invalid`.
- Personale (cloud personale, collezione `examPlans`): scelto sì/no, stato, note, promemoria, collegamenti
  a materia, esame ed evento. Il gruppo non lo vede. Una copia dei dati dell'appello (`ExamPlanSnapshot`)
  resta nel piano, così un appello scelto si vede anche offline o dopo che è stato eliminato.
- Dati locali: Dexie versione 8, `SYNC_SCHEMA` 4. `examPlans` è una collezione personale come le altre
  (backup, sync, «Cancella anche dall'account»).
- Eliminare dall'account non tocca gli appelli e le correzioni scritti nei gruppi: sono del gruppo e restano
  (vedi [security-data.md](security-data.md)). Eliminare un gruppo li toglie a cascata.

## Client

- `src/lib/groupExams.ts`: regole pure (gli stessi controlli e messaggi del server). Le righe che non
  superano `sessionFromRow` / `overrideFromRow` (forma sbagliata, indirizzo non istituzionale in una
  correzione) vengono scartate, non mostrate a metà.
- `src/store/useGroupExamStore.ts`: appelli e correzioni solo in memoria; `ready` = primo pull fatto,
  `available = false` = script non eseguito. Prima di `ready` nessuna schermata dice «non c'è». Un pull non
  abbassa la versione di una riga già in memoria e non toglie le righe appena scritte.
- `src/lib/groupExamSync.ts`: pull, realtime, scritture e notifiche in app. Caricato con `import()`: l'entry
  non contiene Supabase. Si ferma e si riavvia a ogni cambio di account o blocco.
- Notifiche: solo in app (pannello Notifiche), `src/lib/groupExamNotify.ts`. Non c'è nessuna push per appelli
  nuovi o cambiati (Task 23 del piano non fatto, per scelta). I promemoria di un appello **scelto** invece
  partono anche con l'app chiusa, dalla pipeline esistente ([push-reminders.md](push-reminders.md)).
- Promemoria: `src/lib/reminderSources.ts` unisce eventi, appelli scelti e promemoria autonomi per il watcher
  e per le push. Solo i promemoria degli appelli aspettano la conferma dello store dei gruppi (primo pull);
  quelli personali e autonomi non aspettano mai. I promemoria autonomi stanno nel pannello Notifiche
  (`StandaloneReminders`).
- Calendario: eventi virtuali `gexam:<id>` e `gexam-reg:<id>` (chiusura iscrizioni), mai salvati. Preferenza
  `calendar.groupExams` (`all` di default, `subjects`, `off`) per dispositivo. Un appello scelto si vede
  sempre. Un appello collegato a un mio evento o esame non si ripete. Un evento o esame personale con lo
  stesso corso e giorno, non ancora collegato, nasconde un appello **non scelto**; uno scelto non sparisce
  mai e il riquadro propone il collegamento. «Tienili separati» tiene entrambi.
- Il numero di membri per appello non si mostra (scelta presa).

## Conflitti, doppioni, cronologia

- Ogni modifica porta la versione letta. Se nel frattempo è cambiata: il client unisce i campi diversi
  e, se lo stesso campo è cambiato da entrambe le parti, chiede quale tenere. Il modulo tiene la riga
  com'era all'apertura come base.
- Lo stesso appello (gruppo, corso, giorno, tipo) non esiste due volte: chi lo aggiunge di nuovo riceve
  quello che c'è.
- Eliminare è morbido: l'appello resta 180 giorni e si ripristina dalla cronologia (che si tiene 365
  giorni). Al massimo 60 scritture all'ora per persona e gruppo (`field = 'rate'`).
- Un'aggiunta non si ripristina: per toglierla si elimina l'elemento.

## Email

Una sola regola, in SQL e in TypeScript: `src/lib/institutionalEmail.ts` e le funzioni
`studyos_email_normalize`, `studyos_hide_emails`, `studyos_only_unimi_emails` di `group-exams.sql`.
Normalizza (NFKC), toglie i caratteri invisibili, porta gli spazi strani a spazi e legge `%40`, `&#64;`,
`&commat;`, `(at)`, `[at]`, `{at}` come `@`; senza nessuna `@` il testo resta com'è scritto. Una corsa di
caratteri senza spazi che contiene `@` è un candidato (oltre 300 caratteri si nasconde senza analisi) e vale solo
se tutto è `nome@unimi.it` (parte locale ASCII senza `%`, dominio senza distinzione di maiuscole, niente
sottodomini); il resto diventa «[email nascosta]», e con una `@` all'inizio o alla fine si nascondono anche le
corse vicine. È un lavoro lineare: un testo lungo non fa scadere lo snapshot del connettore (il nome del gruppo
si taglia a 120 caratteri; nessun limite sul nome, perché il client non ne ha).
I casi di prova sono in `tests/fixtures/emailVectors.json`; `scripts/supabase/email-vectors-tests.sql`
si genera con `node scripts/supabase/gen-email-vectors.mjs` e un test fallisce se è vecchio.

- Le correzioni al catalogo accettano solo indirizzi istituzionali (`nome.cognome@unimi.it` come forma);
  altrimenti `invalid` con `field = 'targetLabel'` (nome del contatto) o sul campo.
- I testi liberi degli appelli (note, aula, etichetta) restano scrivibili, ma non arrivano mai agli agenti
  con un indirizzo dentro.

## Agenti

Strumenti in `src/agent/catalogGroupExams.ts`, `catalogExtras.ts`, `catalogUniversity.ts` (21 nuovi: 94 in
tutto, 73 in `catalog.ts`; server 1.9.0). Le scritture sul gruppo hanno `expectedVersion` e rispondono
`code: "conflict"` con `data.current`; seguono la stessa politica di conferma delle altre scritture visibili
al gruppo, senza `alwaysAsk`.

- Email agli agenti: ogni indirizzo scritto da un membro è nascosto sempre, anche `@unimi.it`
  (`agentMemberText`). Solo i campi `email`, `website`, `url` e `value` di una correzione possono mostrare
  `@unimi.it`, e solo con `AGENT_INSTITUTIONAL_EMAILS` acceso (`src/agent/project.ts`).
- Il connettore remoto legge appelli e correzioni dallo snapshot `studyos_agent_group_snapshot(p_secret)` (a
  ogni chiamata, mai conservato) ma non scrive sul gruppo: aggiungere, modificare, eliminare, cronologia
  e correzioni al catalogo rispondono `CLOUD_UNAVAILABLE`. Lo snapshot redige valore per valore e non può
  fallire per il contenuto delle righe; salta i gruppi con id di forma insolita (i vecchi), e il vincolo
  `studyos_groups_id_shape` rifiuta quelli nuovi.
- Il registro del connettore remoto (audit e ripristino) riduce il piano d'esame a gruppo, data, tipo, ora e
  versione. I suggerimenti del controllo di coerenza sul remoto nominano solo strumenti che il remoto ha
  (altrimenti dicono di farlo nell'app).

## Sicurezza dei membri

Un trigger in `supabase/groups.sql` (`studyos_group_members_pin_identity`) tiene fissi `user_id` e `group_id`
di una riga di membro: chi gestisce un gruppo non può iscrivere una persona senza il suo consenso.
`group-exams.sql` si rifiuta di partire se manca (vecchio `groups.sql`). Colonna di prontezza:
`group_exams_members_pinned_ready` in `supabase/sharing-verify.sql`.

## Da eseguire

Ordine in `supabase/README.md`: `group-exams.sql` dopo `schema`, `groups`, `sharing`, `people`, `storage` e
`push-reminders` (se li usi); `agent.sql` può stare prima o dopo, ma `group_exams_agent_ready` lo vuole. Poi `verify.sql` e `sharing-verify.sql` (le sei colonne `group_exams_*` vere).
Il client nuovo vuole `people.sql` e `group-exams.sql`: pubblica il client subito dopo aver eseguito l'SQL.
Senza lo script l'app mostra «Gli appelli del gruppo non sono ancora attivi.» e non perde nulla.
Prove SQL: `LC_ALL=C LANG=C zsh scripts/supabase/scratch-pg.sh` (Postgres usa e getta). Prova end-to-end:
`tests/e2e/08-group-exams.spec.ts` (`npm run e2e`).
