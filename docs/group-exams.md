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
Normalizza (NFKC), toglie i caratteri invisibili, porta gli spazi strani a spazi e legge `&#64;`, `&#x40;`,
`&commat;` e `%40` come `@`. `(at)`, `[at]` e `{at}` valgono `@` solo se attaccati a qualcosa da tutti e due i
lati: «bea(at)gmail.com» sì, «Sede di Asti (AT), aula 3» no. Nei campi link (`url`, `website`) `%40` resta com'è
nel percorso di un indirizzo http(s), cioè dalla prima `/`, `?` o `#` dopo il nome del sito (link di Teams e di
Google Calendar); vale `@` prima del percorso e in un `mailto:`. Senza nessuna `@` il testo resta com'è scritto.

- Più di 10 `@` in un valore: tutto il valore diventa «[email nascosta]».
- Se la normalizzazione allunga un valore con `@` di oltre 32 caratteri (NFKC: U+FDFA da solo ne diventa 18,
  «㌀» 4), tutto il valore diventa «[email nascosta]» senza analisi. Senza `@` il testo resta com'è, lungo o no.
- Una corsa di caratteri senza spazi che contiene `@` è un candidato. Oltre 300 caratteri si nasconde senza
  analisi; una corsa lunga senza `@` resta. I caratteri si contano come in Postgres: una emoji vale uno.
- Il candidato resta solo se tutto è `nome@unimi.it` (parte locale ASCII senza `%`, dominio senza distinzione di
  maiuscole, niente sottodomini). Il resto diventa «[email nascosta]», e con una `@` all'inizio o alla fine si
  nascondono anche le corse vicine.

Costo. Il lavoro su un valore è limitato (al massimo 10 `@`, candidati fino a 300 caratteri, crescita della
normalizzazione fino a 32 caratteri), ma dipende comunque da cosa c'è scritto: prima di questo giro lo snapshot
oscurava ogni valore a ogni lettura, e con testi al limite pieni di caratteri che NFKC allunga (U+FDFA) 2000
appelli costavano circa 6 s. Il testo di prima («dipende dal numero di righe e non da cosa c'è scritto») era
sbagliato. Ora l'oscuramento si fa una volta, quando la riga si scrive (vedi «Copie per gli agenti»): lo snapshot
legge copie già pronte e il suo costo dipende dal numero di righe (al massimo 2000 appelli, più le correzioni
attive) e dalla lunghezza delle copie, che restano vicine a quella del testo salvato (una copia nascosta per la
crescita è il solo segnaposto). Su un Postgres 17 locale, 2000 appelli con ogni testo al limite della colonna: lo
snapshot da anon impiega da 0,03 a 0,07 s in tutte le forme, con collation C ed en_US.UTF-8 (prima 1,8 s per N3 e
circa 6 s per N5). Il costo si sposta sulla scrittura, una volta per riga: una scrittura con la funzione al limite
costa 1-2 ms (circa 6 ms la prima della sessione), 2000 righe scritte direttamente da 0,1 a 2,3 s. Le prove
`LOAD1`-`LOAD7` di `scripts/supabase/group-exams-tests.sql` chiedono lo snapshot da anon sotto il secondo con le
forme più care note (N2, N3, N5 con U+FDFA, N6) e `W1` una scrittura al limite sotto i 50 ms in tutte e due le
collation.

### Copie per gli agenti

Ogni testo dei membri che lo snapshot restituisce ha accanto la sua copia oscurata: negli appelli
`agent_course_name`, `agent_course_norm`, `agent_course_key` (dal nome oscurato; una chiave `barb:` resta),
`agent_label`, `agent_room`, `agent_notes`, `agent_created_by_name`, `agent_updated_by_name`,
`agent_deleted_by_name`; nelle correzioni `agent_target_label`, `agent_fields` e gli stessi tre nomi. Tutti i testi
dei membri e i nomi perdono ogni indirizzo (anche `@unimi.it`); nei campi `email` e `value` restano gli `@unimi.it`;
`url` e `website` passano da `studyos_agent_link` (sotto). La cronologia non ha copie: lo snapshot non la dà.

- Le scrive un trigger `BEFORE INSERT OR UPDATE` per riga (`studyos_gexam_agent_copy`,
  `studyos_gover_agent_copy`) a ogni scrittura: funzioni, ripristini e scritture dirette dal SQL Editor. Una copia
  scritta a mano viene ricalcolata. Se il calcolo fallisse la scrittura passa con le copie vuote e lo snapshot dà
  «[email nascosta]» al loro posto (una correzione senza copia: nessun campo), mai il testo.
- `agent_rule` è la versione della regola con cui sono state calcolate: `studyos_email_rule_version()` (ora 5).
  Rieseguire `group-exams.sql` chiama `studyos_agent_copies_refresh()`, che ricalcola solo le righe senza copie o
  con un'altra versione (la prima volta tutte, poi nessuna); `updated_at` e `version` non cambiano (il trigger
  del timbro è spento solo dentro la funzione, nella stessa transazione). Realtime manda comunque un UPDATE per
  quelle righe: l'app le rilegge uguali. **Quando cambia la regola** (in `institutionalEmail.ts` e in SQL insieme):
  aumenta il numero in `studyos_email_rule_version()`, aggiorna i vettori, riesegui `group-exams.sql`.
- Accesso: le copie sono colonne delle stesse righe, con la stessa RLS (i membri del gruppo le leggono, anon non ha
  privilegi, nessuno scrive). Un membro legge già il testo intero, e la copia ne è una versione con meno
  informazioni: non serve chiuderle. Privilegi per colonna no: `select=*` di PostgREST si romperebbe. L'app non le
  usa (`sessionFromRow` e `overrideFromRow` leggono solo i loro campi; un test controlla che `src` non le nomini) e
  le funzioni di scrittura le tolgono dalle righe che restituiscono e dalla cronologia
  (`studyos_without_agent_copies`).
- Link delle correzioni per gli agenti (`studyos_agent_link`, `agentCorrectionLink` in TypeScript): il valore si
  decodifica come `decodeURIComponent`; se non si decodifica, o la forma decodificata contiene un indirizzo che non
  è esattamente `@unimi.it`, il link non arriva (nella copia: «[email nascosta]», così la chiave resta e il valore
  effettivo non torna quello del catalogo). Un link di Teams (`…%40thread.v2`), di Google Calendar o con
  `?to=bea%40gmail.com` resta nell'app ma non va agli agenti; `mailto:prof@unimi.it` (solo nel campo `url`) sì. Lo
  stesso fa `publicCorrection` sul client, quindi locale e connettore remoto danno lo stesso risultato.

Il nome di un gruppo ha al massimo 120 caratteri: il modulo ha `maxLength` 120 e il trigger
`studyos_groups_name_limit` rifiuta un nome più lungo quando il nome cambia («Il nome del gruppo può avere al
massimo 120 caratteri.»). Niente vincolo CHECK: i gruppi già salvati con un nome più lungo restano. Agli agenti
quei nomi arrivano tagliati a 120 caratteri al confine di una corsa PRIMA di nascondere gli indirizzi
(`studyos_cut_at_run` nello snapshot, `cutAtRunBoundary` in `agentGroupName`): mai metà di un indirizzo. Se la
prima corsa tolta inizia con `@` («bea.privata @gmail.com» tagliato fra le due parole) si toglie anche l'ultima
corsa tenuta. Lo stesso taglio vale per i nomi degli altri gruppi nel controllo di coerenza, per l'invito nel
registro del connettore remoto e per i titoli delle notifiche agli agenti (`agentNotificationTitle`, 160
caratteri); l'app mostra i nomi interi. Un gruppo locale con un nome più lungo (scritto prima del limite) parte
verso il server già tagliato (`serverGroupName` in `src/lib/groups.ts`); se il server rifiuta comunque il nome
(23514), il gruppo non torna in coda e l'invito dice «Nome troppo lungo…».

I casi di prova sono in `tests/fixtures/emailVectors.json` (`vectors` per la regola, `cuts` per il taglio dei
nomi, `links` per i link delle correzioni); `scripts/supabase/email-vectors-tests.sql` si genera con
`node scripts/supabase/gen-email-vectors.mjs` e un test fallisce se è vecchio.

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
  e correzioni al catalogo rispondono `CLOUD_UNAVAILABLE`. Lo snapshot legge le copie già oscurate (vedi «Copie
  per gli agenti») e non oscura nulla, tranne i nomi dei gruppi (tagliati, poi oscurati); non può fallire per il
  contenuto delle righe; salta i gruppi con id di forma insolita (i vecchi), e il vincolo
  `studyos_groups_id_shape` rifiuta quelli nuovi.
- Il registro del connettore remoto (audit e ripristino) riduce il piano d'esame a gruppo, data, tipo, ora e
  versione. I suggerimenti del controllo di coerenza sul remoto nominano solo strumenti che il remoto ha
  (altrimenti dicono di farlo nell'app).

## Sicurezza dei membri

Un trigger in `supabase/groups.sql` (`studyos_group_members_pin_identity`) tiene fissi `user_id` e `group_id`
di una riga di membro: chi gestisce un gruppo non può iscrivere una persona senza il suo consenso.
`group-exams.sql` si rifiuta di partire se manca (vecchio `groups.sql`) o se è stato cambiato: deve essere
attivo, `before insert or update` per riga, senza elenco di colonne (`update of …`) e senza condizione
(`when …`). Colonna di prontezza: `group_exams_members_pinned_ready` in `supabase/sharing-verify.sql`, che
controlla anche il trigger del limite sul nome del gruppo.

## Da eseguire

Ordine in `supabase/README.md`: `group-exams.sql` dopo `schema`, `groups`, `sharing`, `people`, `storage` e
`push-reminders` (se li usi); `agent.sql` può stare prima o dopo, ma `group_exams_agent_ready` lo vuole. Poi `verify.sql` e `sharing-verify.sql` (le sei colonne `group_exams_*` vere).
Il client nuovo vuole `people.sql` e `group-exams.sql`: pubblica il client subito dopo aver eseguito l'SQL.
Senza lo script l'app mostra «Gli appelli del gruppo non sono ancora attivi.» e non perde nulla.
Prove SQL: `LC_ALL=C LANG=C zsh scripts/supabase/scratch-pg.sh` (Postgres usa e getta). Prova end-to-end:
`tests/e2e/08-group-exams.spec.ts` (`npm run e2e`).
