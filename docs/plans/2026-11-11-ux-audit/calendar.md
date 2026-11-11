# Audit Calendario: import/export .ics e "Per materia"
(percorsi relativi a .claude/worktrees/sharing; sola lettura)

## A) Import/export calendario

### A1. Cosa fa DAVVERO oggi
- Montaggio: `src/views/CalendarView.tsx:417` `<CalendarTransfer />` nella SectionTitle (riga azioni secondaria, accanto a "Vedi appelli ufficiali" e ShareButton).
- SOLO file: nessun `webcal://`, nessun feed/URL di sottoscrizione, nessuna API Google/Outlook, nessun navigator.share (unico uso di `text/calendar`: CalendarTransfer.tsx:40,127).
- Export (`buildIcs`, src/lib/ics.ts:71): file unico `studyos-calendario-YYYY-MM-DD.ics` con TUTTO lo storico, nessuna scelta di periodo/materia/categoria.
  - Eventi propri non archiviati (ics.ts:98-130): DTSTART/DTEND con TZID (fuso del dispositivo, ics.ts:77-86) oppure `VALUE=DATE` se `allDay`; SUMMARY; DESCRIPTION = description + notes; CATEGORIES = etichetta categoria + nome materia; RRULE solo daily/weekly/monthly con UNTIL; `status==="skipped"` -> STATUS:CANCELLED; UID = `sourceUid` o `<id>@studyos`.
  - Esami non archiviati (ics.ts:132-147): "Esame: <materia>", durata fissa 2 h, CATEGORIES:Esame.
  - Task con dueDate non done/archived (ics.ts:149-166): giorno intero "Scadenza: <titolo>", TRANSP:TRANSPARENT.
  - NON esporta: eventi condivisi da altri, sessioni di studio, luogo (non esiste un campo), promemoria/VALARM, checklist, colore. Nessun VTIMEZONE.
- Import (`parseIcs`, ics.ts:288): solo VEVENT. Gestiti: DTSTART (UTC, TZID IANA, floating, VALUE=DATE), DTEND/DURATION, SUMMARY, DESCRIPTION, LOCATION (finisce in descrizione come "Luogo: ..."), UID, STATUS:CANCELLED (scartato), RRULE DAILY/WEEKLY/MONTHLY INTERVAL=1 con UNTIL o COUNT, WEEKLY con BYDAY multipli (una serie per giorno, ics.ts:383-399). Avvisi per: INTERVAL>1/YEARLY (solo prima data, 347-351), EXDATE ignorato (352), RECURRENCE-ID ignorato (307-310), eventi senza data scartati. Non importati: VTODO, ALARM, ATTENDEE, VTIMEZONE. TZID Windows ("W. Europe Standard Time") ripiega sull'ora locale del dispositivo (ics.ts:263-270), silenzioso, senza avviso. Limiti: 5 MB (CalendarTransfer.tsx:14), 2000 eventi (ics.ts:286).
- Dedup: `sourceUid` (store/useStudyStore.ts:952-979) aggiorna invece di duplicare; riscrive title/description/date/ricorrenza e `archived:false`.
- Abbinamento materia per nome nel titolo (`matchSubject`, ics.ts:441, nomi >= 4 caratteri, materie non archiviate/completate) e categoria da titolo (`guessCategory`, ics.ts:433) con categoria predefinita scelta nel Drawer.

### A2. Flusso UI passo per passo
1. Calendario, in alto a destra due controlli ghost: "Importa da Google/Apple" (`<label>`+file input, CalendarTransfer.tsx:118-135) e "Esporta" (136-144). Sotto `sm` le scritte spariscono: resta l'icona (testo solo sr-only; il `title` non si vede al tocco).
2. Esporta: scarica subito il file (`downloadBlob`, lib/backup.ts:120, anchor+blob, revoca a 30 s). Toast fisso in basso: "File del calendario scaricato: aprilo con Google Calendar o Apple Calendario per aggiungere eventi, esami e scadenze." (riga 42), sparisce dopo 7 s (29-36), role="status".
3. Importa: scelta file `.ics`; errori: troppo grande (50), illeggibile (57), "Nel file non ci sono eventi da importare... Scegli un file .ics esportato da Google Calendar, Apple Calendario o dall'orario delle lezioni." (62-65).
4. Drawer anteprima (169-236, eyebrow "Importa da Google/Apple", titolo = nome file): riepilogo conteggio/periodo/ricorrenti, select "Tipo di evento" (usato se il titolo non lo chiarisce), checkbox "Collega alle mie materie in base al titolo (N riconosciuti)", elenco dei primi 6 eventi, riquadro avvisi, footer "Annulla" / "Aggiungi N eventi al calendario".
5. Toast finale: "Fatto: N eventi aggiunti, M aggiornati nel calendario..." oppure "Nessuna novità..." (109-113).

### A3. Gap e bug
1. BUG ROUND-TRIP: gli eventi esportati hanno UID `<id>@studyos` ma NON hanno `sourceUid`; esami e scadenze escono come VEVENT. Reimportare il proprio export (o un export Google che lo contiene) crea duplicati di ogni evento e trasforma esami/scadenze in eventi "Esame: ..." / "Scadenza: ..." doppi (importEvents cerca solo `event.sourceUid`, useStudyStore.ts:954). Servirebbe riconoscere gli UID `@studyos` (saltarli o mapparli all'id).
2. TZID senza VTIMEZONE (ics.ts:80 + X-WR-TIMEZONE): Google e Apple leggono i nomi IANA, Outlook desktop classico potrebbe ignorarlo e sfasare gli orari. Da verificare.
3. Copy dice solo "Google/Apple": mancano Outlook e Samsung, che sono casi reali; nessuna istruzione sul COME (dove si importa; su Google solo da web). L'etichetta "Importa da Google/Apple" suggerisce una connessione diretta che non esiste.
4. Toast di export dura 7 s e contiene l'unica istruzione: troppo breve, non riapribile; su mobile i pulsanti sono solo icone.
5. Nessun sottoinsieme (periodo, materia, categoria, solo esami); nessuna sottoscrizione (webcal): l'export è una fotografia, ogni modifica richiede nuovo export+import. Se Google aggiorna per UID alla reimportazione: da verificare.
6. Download in PWA iOS standalone: `a[download]` con blob può non salvare; nessun fallback con Web Share (files). Da verificare su dispositivo.
7. Import: ricorrenze INTERVAL>1/YEARLY/EXDATE perdono informazioni (solo avviso); fuso Windows ignorato senza avviso; VTODO ignorati senza avviso; LOCATION solo nel testo.
8. Reimport rimette `archived:false` su eventi archiviati (store:975), non segnalato in anteprima.
9. Anteprima mostra max 6 eventi, nessun modo di deselezionarne; "Tipo di evento" predefinito "Lezione" anche per calendari personali.
10. Nessuna deduplica contro eventi creati a mano o da "appelli ufficiali" (nessun sourceUid): duplicati possibili.

### A4. Cosa deve fare l'utente per piattaforma
(1) = portare l'export StudyOS nel calendario; (2) = portare un .ics dal calendario in StudyOS. Mark "DESKTOP" = serve un browser su PC/Mac.

**Google Calendar (account Google, qualsiasi sistema)**
- (1) DESKTOP: calendar.google.com -> ingranaggio -> Impostazioni -> Importa ed esporta -> Importa -> scegli file e calendario di destinazione. Le app Android/iOS non hanno l'importazione nel menu; aprire il .ics dai File di Android a volte propone Google Calendar: da verificare. Consiglio: creare prima un calendario "StudyOS" dedicato, così si può eliminare e reimportare.
- (2) DESKTOP: stessa pagina -> Esporta: scarica uno ZIP con un .ics per calendario (da estrarre); oppure Impostazioni del singolo calendario -> "Esporta calendario". Da telefono: nessuna esportazione nell'app.

**Samsung One UI (Samsung Calendar)**
- (1) Dopo il download (cartella Download), da "I miei file" toccare il .ics: Samsung Calendar dovrebbe aprire un'anteprima con salvataggio; alternativa nell'app: menu -> Impostazioni -> Importa/Esporta (nome esatto da verificare, varia con la versione One UI). Su quale account finiscono gli eventi: da verificare.
- (2) Samsung Calendar -> menu -> Impostazioni -> Esporta calendario (salva .ics in memoria): da verificare. Alternativa: Google Calendar web se sincronizzato (DESKTOP).

**Google Pixel / altri Android (Google Calendar)**
- (1) Chrome scarica in Download; toccare il file da File: Android può offrire "Calendario" per .ics (comportamento variabile, da verificare). Altrimenti DESKTOP (calendar.google.com).
- (2) L'app non esporta: DESKTOP (vedi Google).

**iPhone / iPad (Calendario Apple)**
- (1) Safari scarica in File (Download): aprire File, toccare il .ics -> anteprima Calendario con "Aggiungi tutti" (o singoli eventi), poi scegliere il calendario. Meglio crearne prima uno "StudyOS" (Calendario -> Calendari -> Aggiungi). Da Mail, allegato .ics: stesso flusso. Non serve il desktop.
- (2) L'app Calendario di iOS NON esporta .ics. Serve un Mac (File -> Esporta) oppure iCloud.com (link pubblico webcal, non un file: se esiste un export .ics, da verificare). Da dire chiaramente in app: da iPhone l'import di un calendario Apple in StudyOS richiede un Mac.

**macOS (Calendario Apple)**
- (1) Doppio clic sul .ics o File -> Importa... -> scegli il calendario di destinazione (meglio uno nuovo).
- (2) Seleziona il calendario nella barra laterale -> File -> Esporta -> Esporta... (un .ics per calendario; "Archivio Calendario" è un altro formato e non va bene).

**Windows (Outlook / Google nel browser)** — tutto DESKTOP
- (1) Outlook classico: File -> Apri ed esporta -> Importa/Esporta -> "Importa un file iCalendar (.ics) o vCalendar"; il doppio clic sul .ics apre Outlook con proposta di importazione (da verificare). Nuovo Outlook / Outlook.com: Calendario -> Aggiungi calendario -> "Carica da file". L'app Calendario di Windows non c'è più.
- (2) Outlook classico: File -> Salva calendario (.ics), con scelta intervallo e dettaglio. Outlook.com/nuovo Outlook: solo link ICS pubblicato, non file: da verificare; Google Calendar web è l'alternativa più affidabile.
- Outlook esporta TZID Windows: StudyOS usa l'ora del dispositivo (ok in Italia, sbagliato se il PC è in un altro fuso).

Note trasversali: l'import in Google/Outlook da file è sempre una copia che non si sincronizza; per aggiornamenti continui servirebbe un feed webcal con token (richiede backend, non esiste).

## B) "Per materia" nel Calendario
Nota: la stringa "Calendario per materia" non esiste; la sottosezione è la modalità "Per materia" (id `semester`).

### B1. Dove e come
- Definita in `modes` (CalendarView.tsx:142): label "Per materia", title "Le tue materie, con quanti eventi hai in calendario per ognuna". Persistita in `useUiState("calendar.mode", ...)` (200).
- Se attiva: niente navigazione periodo (`navigable=false`, 391), testo fisso "Eventi per materia" (442). Il ramo `semester` in `navigate()` (385) è codice morto.
- Render: `<SemesterMap events subjects onGoSubjects>` (522), funzione a 2250-2288. NON è un calendario: griglia di card `quiet-panel` (div, non interattive, senza click, Drawer o filtro).
- Ogni card: icona corso BARB (`resolveBarbCourse` + `CourseIcon`) o icona materia, nome, "N eventi" e "· M ogni settimana", Tag semestre (`subjectSemester`, SEMESTER_LABEL/TONE da lib/semesters.ts).
- Griglia a riga 2265: `[grid-template-columns:repeat(auto-fill,minmax(min(100%,260px),1fr))]` senza `grid-cols-*` (viola il vincolo; stesso pattern in ExamSession 2210).
- Empty state: nessuna materia -> `EmptyState` "Ancora nessuna materia" + "Vai a Materie" (2251-2262). Non c'è empty state per materia senza eventi: mostra "0 eventi".

### B2. Bug/imprecisioni
- Il copy dice "divisi per semestre" (2255) ma l'elenco è piatto, in ordine di store.
- `subjects` non filtrato: include archiviate e completate (`selectableSubjects`, lib/selectors.ts:28, non è usato).
- `count` usa `events` grezzi (2268): include eventi archiviati (expandEvents li salta), conta una serie ricorrente come 1, esclude eventi condivisi, non conta esami/task/sessioni. Non coincide con ciò che si vede nelle viste Giorno/Settimana/Mese.
- Nessuna scorciatoia "vedi gli eventi di questa materia".

### B3. Come gli eventi sono legati alle materie
- `CalendarEvent.subjectId?` (types.ts:132); mostrato con `occurrenceSubject` (CalendarView.tsx:114) e colore `eventColor` (194). Eventi condivisi usano `sharedFrom.subjectName` del proprietario, mai le mie materie (113-115, 1537).
- Esame: `Exam.subjectId` obbligatorio (types.ts:97), `ExamChip` nelle viste (1129) e modalità "Esami" (2193).
- Task: `Task.subjectId?` + `dueDate` (types.ts:163-164); in calendario via `calendarTasks` (282, esclude solo archived, include done).
- Sessioni di studio: `StudySession.subjectId?` (types.ts:183) ma CalendarView non le usa (nessun riferimento a `sessions`): non appaiono in nessuna vista.
- BARB: gli appelli ufficiali importati diventano CalendarEvent con tag `["BARB","appello-importato"]`, allDay, `sourceUid` "barb-exam-..." e subjectId risolto da `prepareBarbExamImport` (useStudyStore.ts:925-950; badge "Data appello" 197/1755). Le LEZIONI del piano BARB (`schedule: ScheduleRule[]`, university/types.ts:67,132) vivono solo in BarbView e non generano eventi in calendario. Collegamento materia-corso: `resolveBarbCourse(subject, courses)`.
- Tre insiemi oggi mescolati: (a) materie nel piano di studio (store `subjects`, anche archiviate/complete), (b) materie con eventi (subjectId in almeno un evento attivo), (c) eventi per materia (ricorrenze espanse nel periodo). SemesterMap mostra (a) con un numero che è (c) grezzo.

### B4. Stato filtri esistente (useUiState)
- Chiavi calendario: `calendar.mode`, `calendar.cursor` (scope tab), `calendar.editingEvent`, `calendar.editingTask`, `calendar.editingShared` (scope tab). Correlate: `exams.tab` (scritta da "Vedi appelli ufficiali", riga ~413), `subjects.showArchived`, `subjects.showCompleted`.
- Nessun filtro per materia/categoria nel calendario; solo il filtro "Calendari condivisi" (toggle proprietari, ~446-463) via useSharedStore.hiddenOwners.
- Modali evento/creazione NON sono Drawer: `ModalShell` custom (1575-1590) per EventEditorModal/CreateModal; l'unico Drawer legato al calendario è l'anteprima import (CalendarTransfer). Il vincolo "dettagli in Drawer" oggi non è rispettato in CalendarView.

### B5. Cosa servirebbe per un filtro/vista per materia
- Nuova chiave (senza rinominare le esistenti), es. `calendar.subjectFilter` (string|null, `isNullableString`, scope device come `calendar.mode`).
- Selettore sopra il Panel (vicino a 436-444) con `selectableSubjects(subjects, filtro)` + "Senza materia" + "Tutte le materie"; filtrare `occurrences` (360), `calendarTasks` (282) ed `exams` per `subjectId` prima di passarli a TimeGrid/MonthGrid/Agenda.
- In SemesterMap: card come `button` che apre un `Drawer` (ui.tsx:323) con prossimi eventi (espansi con `expandEvents` su ~60 giorni), esame con giorni mancanti, scadenze task, e azione "Mostra nel calendario" che imposta il filtro e passa ad agenda/mese. Contatori coerenti: esclusi archiviati, solo occorrenze future.
- Empty state: materia senza eventi ("Nessun evento per <materia>: aggiungine uno", `setCreator` con subjectId preimpostato); filtro senza risultati nel periodo ("Nessun evento di <materia> in questo periodo" + "Mostra tutte le materie").
- Etichette in `src/lib/labels.ts` in italiano semplice; griglie con `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3` al posto dell'auto-fill; animazioni solo con `m.` sotto LazyMotion.
- Sessioni e lezioni BARB: decidere se mostrarle (richiede nuove sorgenti nell'espansione eventi); fuori scope se non richiesto.
