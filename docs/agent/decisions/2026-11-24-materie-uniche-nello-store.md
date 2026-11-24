# ADR: materie uniche controllate nello store, non nel database

- Stato: accettata
- Data: 24/11/2026
- Codice: `src/lib/subjectIdentity.ts`, `src/lib/subjectMerge.ts`, `src/store/useStudyStore.ts`
  (`addSubject`, `updateSubject`, `mergeSubjects`), `src/agent/execute.ts` (`create_subject`,
  `update_subject`, `merge_subjects`, `add_barb_courses`), `src/components/SubjectDuplicates.tsx`

## Contesto

Un assistente ha creato «Anatomia Umana» accanto a «Anatomia dell'uomo» e «Principi di Fisiologia»
accanto a «Principi di fisiologia»:
`studyos_create_subject` non guardava le materie esistenti. Attività, esami e preparazione si sono
divisi fra le copie e il progresso pre-esame era sbagliato. Le materie si creano da più strade: moduli
dell'app, catalogo BARB, libretto, agenti nel browser e connettore remoto (Worker).

## Decisione

- Una sola regola di identità (`compareSubjects`): «same» se il nome normalizzato è uguale o
  l'insegnamento del catalogo è lo stesso; «likely» con lo stesso docente e una parola significativa
  in comune, o le stesse parole con i sinonimi; «related» solo come indicazione.
- Lo store rifiuta i «same» (`SubjectDuplicateError`). App, agenti nel browser e connettore remoto
  eseguono le stesse azioni dello store, quindi il blocco vale ovunque.
- Gli strumenti rispondono `code: "conflict"` con `reason` `duplicate` (si usa la materia esistente) o
  `similar` (si chiede alla persona; `confirmDistinct: true` per creare comunque).
- Le copie già presenti si uniscono con `mergeSubjects` / `studyos_merge_subjects`: ogni collegamento
  passa alla materia che resta, i campi vuoti si completano, la copia si elimina. «Sono materie
  diverse» salva la coppia in `distinctSubjectPairs` e il pannello non la ripropone.

## Alternative scartate

- Vincolo `unique` in Postgres: le righe della sync personale hanno un `payload` JSON generico per
  tutte le entità, l'app funziona anche senza cloud (il vincolo non vedrebbe i dati locali) e il nome
  normalizzato con accenti e sinonimi non è un'espressione da indice. Rifiutare in push lascerebbe il
  dispositivo con una riga che il cloud non accetta.
- Unione automatica dei «likely»: due insegnamenti diversi con nomi vicini («Fisica I» e «Fisica II»)
  si unirebbero per errore; la persona decide.

## Conseguenze

- Ogni nuovo percorso che crea o rinomina materie deve passare dallo store o da `executeAgentTool`.
- Due dispositivi offline possono ancora creare la stessa materia: dopo la sync il pannello «Una
  materia sembra doppia» la mostra e si unisce con un tocco.
