# Audit timer di studio (read-only)

Percorsi relativi a .../StudyOS/.claude/worktrees/sharing

## 1. Pomodoro oggi
Non esiste un vero Pomodoro: esiste un solo conto alla rovescia con 3 durate fisse.
- `src/lib/studyTimer.ts:8` TimerMode = classic | pomodoro | deep-focus; durate 45/25/90 min (:22-26). Nessun valore personalizzabile, nessuna preferenza (Preferences non ha campi timer, types.ts:299).
- Nessuna pausa breve/lunga, nessun contatore di cicli, nessun passaggio automatico focus->pausa. Il testo "25 minuti di studio, poi fai 5 minuti di pausa" (StudyView.tsx:24) promette una pausa che l'app non gestisce.
- Notifiche/suoni: nessuno. grep su Notification/Audio/AudioContext/vibrate in src = zero risultati. Solo un banner in-app "Tempo scaduto" (StudyTimerWatcher.tsx:62-64, :70-80) e il titolo scheda "MM:SS · Pomodoro · StudyOS" (:47-49).
- Sfondo/reload: modello a timestamp (`endsAt`, studyTimer.ts:44-47, 61-67) = corretto anche con scheda nascosta, sleep, cambio pagina; stato in localStorage `studyos-study-timer` (:34, 97-103), ricaricato e "settled" in loadTimer (:86-95). Il watcher e' montato in AppShell.tsx:425, quindi funziona in tutte le viste. Limiti: con scheda nascosta setInterval viene limitato (titolo e avviso in ritardo, ma i secondi restano esatti); se l'app e' chiusa alla scadenza il banner non compare mai (`finishedLabel` e' solo stato React, Watcher:38), non c'e' push/notifica; resta solo "Tempo scaduto: salva la sessione" nella vista (StudyView.tsx:132-133).
- Cosa viene salvato: SOLO se l'utente preme "Salva sessione"/"Termina e salva" (StudyView.tsx:73-94, 192-204). Nessun salvataggio automatico alla scadenza: chiudere/azzerare = tempo perso (confirm a :68, :99, :105).

## 2. Cronometro libero per materia
Non esiste. Il timer conta solo alla rovescia da una durata fissa (`remainingSeconds`), non c'e' modo "senza limite".
- Materia: select in StudyView.tsx:140-149, ma non fa parte di TimerState (studyTimer.ts:10-20): vive in `useUiState("study.subject")` (:36-37), titolo in `study.title` con scope "tab" (:38) -> inconsistente con il timer che e' in localStorage condiviso tra schede. `TimerState.linkedTaskId` (studyTimer.ts:19) non e' mai usato (grep: nessun altro riferimento).
- Start/pausa/riprendi/azzera: store `startStudyTimer/toggleStudyTimer/resetStudyTimer/settleStudyTimer` (useStudyStore.ts:206-209, 1491-1497); `toggle` da "scaduto" riparte con durata piena (studyTimer.ts:65).
- Salvataggio: finishSession (StudyView.tsx:73-94) crea StudySession con subjectId (opzionale), actualMinutes = round(elapsed/60), plannedMinutes = durata, start = now - elapsed, end = now, status completed, focusLevel 4 fisso, template scelto. addSession a useStudyStore.ts:1137-1160.
- Minimo: 1 minuto (StudyView.tsx:74-77), bottone disabilitato < 60 s (:201).
- Precisione: i secondi sono esatti (timestamp) ma `elapsed` = durata - residuo, quindi capato alla durata; per un cronometro serve `startedAt` + `accumulatedSeconds`. Sleep: il tempo di sleep conta come studiato (wall-clock), nessun controllo di inattivita'.
- Bug data: `start = Date.now() - elapsed` (:87): dopo pause lunghe o scadenza non salvata da ore, start/end sono spostati a "adesso" (puo' cadere nel giorno sbagliato per le statistiche per giorno/streak).
- Modifica dopo: nessuna UI per modificare una sessione (updateSession esiste, store :1162, usato solo dall'agente execute.ts:636-640). Solo elimina con confirm, senza annulla (StudyView.tsx:253-260). Correggere = elimina + "Aggiungi studio fatto" (ManualSessionDrawer, :455+, 1-960 min).
- Studio senza timer: "Aggiungi studio fatto" e' gia' in un Drawer (:316-326).

## 3. Presentazione UI
- Un'unica scheda (StudyView.tsx:120-218). Le "modalita'" sono presentate come "Durata" in un Segmented (:180-189): "Pomodoro · 25 min", "Classico · 45 min", "Concentrazione lunga · 90 min" (nomi in TIMER_PRESET_NAME, StudyTimerWatcher.tsx:15-19). Pomodoro e' solo un preset di durata, non una modalita'; non c'e' modo di distinguerlo da un cronometro.
- Duplicazioni: etichette in due posti (TIMER_LABELS studyTimer.ts:28-32, "Deep focus" in inglese, salvato in `timer.label`; TIMER_PRESET_NAME nel componente Watcher; StudyView importa da un componente, :14). Hint in StudyView:23-27 (terzo posto).
- Altri "timer": il timer per Attivita' (lib/taskTimer.ts, TaskTimerReminder.tsx) conta in `task.actualMinutes`, NON crea StudySession -> quelle ore non entrano in statistiche/streak/ore per materia. Tre sistemi di tempo separati (timer studio, timer attivita', studio manuale) senza ponte.
- Copy/controlli confusi: "Altre opzioni · Tipo di sessione" nascosto in un <details> (:154-177; vincolo progetto: dettagli in Drawer); "Azzera" vs "Termina e salva" vs "Salva sessione" (tre bottoni simili, :192-209); "Ricomincia" a scaduto scarta la sessione (:105); stato idle "Scegli materia e durata" ma la durata e' sotto la materia. window.confirm al posto di dialog/annulla dell'app.
- Dashboard: solo il bottone "Inizia a studiare" (DashboardView.tsx:137) e il widget "Studio della settimana" (:85-93); nessun indicatore di timer attivo fuori da Studio (solo titolo scheda e banner a fine).

## 4. Statistiche sul tempo registrato
Tutte leggono `sessions` con status "completed" e `actualMinutes`.
- Esistono: KPI settimana vs obiettivo (selectors.ts:96-105; StatsView.tsx:57; Studio pannello laterale :275-283; Dashboard :85), streak (selectors.ts:111-125), ore per giorno ultimi 14 gg (StatsView.tsx:17-28, 92-117), ore per materia a torta + percentuali (workloadBySubject selectors.ts:133-140; StatsView:44-47, 143-175), minuti oggi (StudyView:61-63), ore per materia in SubjectsView:34-40, contatore sessioni salvate (StatsView:183).
- Mancano: trend settimanale/mensile (solo 14 gg fissi), filtro periodo (la torta e' "da sempre"), confronto settimana corrente vs precedente, ore per materia nel tempo, media/lunghezza sessione, distinzione Pomodoro vs cronometro vs manuale (nessun campo `source`), pianificato vs effettivo, ore del timer Attivita'.
- Bug: workloadBySubject somma solo sessioni con subjectId esistente -> le sessioni "Nessuna materia" sono escluse dalla torta (totale diverso dal KPI settimana) e il testo vuoto (:173) non lo spiega. Giorno attribuito a `start` (sessioni a cavallo di mezzanotte).

## 5. Bug / incompleti / duplicazioni
1. Nessun Pomodoro reale (pause, cicli, auto-avanzamento); copy promette una pausa inesistente (StudyView:24).
2. Nessun cronometro libero; "classico/deep focus" sono solo countdown piu' lunghi.
3. Nessun salvataggio automatico/bozza: sessione persa se azzerata o se si cambia durata; a scadenza va salvata a mano (Watcher:78).
4. Materia/titolo/tipo fuori da TimerState; `linkedTaskId` morto; `study.title` scope tab vs timer globale.
5. start/end sessione calcolati "adesso - elapsed" (StudyView:87).
6. Nessuna notifica/suono/vibrazione; banner solo se l'app e' aperta.
7. Etichette duplicate e in inglese nello stato salvato (`label`); `isTimerState` (studyTimer.ts:75-84) non valida `endsAt`: stato corrotto con running=true ed endsAt mancante mostra un residuo fisso e non scade mai.
8. MCP: `studyos_timer_status` (execute.ts:986-990) usa Math.round mentre l'app usa ceil (1 s di scarto) e non espone elapsed/materia; `studyos_timer_control` (catalog.ts:965-975, execute.ts:992-1000) accetta solo start(mode)/toggle/reset: niente stop+salva, niente materia. Enum duplicato a mano in 3 punti (catalog.ts:970, execute.ts:995-998). Nessun test MCP del timer (grep tests/ = nessun risultato per studyos_timer).
9. tests/studyTimer.test.mjs: 3 test sulle funzioni pure (start, pausa/ripresa, scadenza). Non coprono loadTimer/saveTimer, isTimerState, creazione sessione, MCP.
10. Sessioni: nessuna UI di modifica; elimina senza annulla; `status: "running"` (types.ts:203) mai usato.

## Proposta: un solo timer, due modalita' separate
UI (StudyView, Panel timer):
- Segmented in alto "Pomodoro | Cronometro" (stato in useUiState con chiave NUOVA es. `study.timerKind`; `study.subject/title/template/topicsOpen/logOpen` invariate).
- Pomodoro: preset focus 25 (default), 45, 90 gia' esistenti come "Durata del blocco"; pausa breve 5 e lunga 15 ogni 4 blocchi; indicatore "Blocco 2 di 4". Impostazioni (durate, avvio automatico pausa, suono) in un `Drawer` "Impostazioni timer" (non <details>).
- Cronometro: "Studia quanto vuoi, il tempo conta in avanti". Materia scelta o "Nessuna materia" esplicita; Avvia / Pausa / Riprendi / "Termina e salva". Minimo 1 minuto.
- Controlli comuni: un bottone primario (Avvia/Pausa/Riprendi), "Termina e salva", "Scarta sessione" (al posto di "Azzera", con conferma). Tipo di sessione in un Drawer "Dettagli sessione".
- Auto-salvataggio: a fine di ogni blocco Pomodoro si salva una sessione (completed) e parte la pausa; cronometro salva con "Termina e salva"; reset con >= 1 min offre "Annulla".
- Etichette in `src/lib/labels.ts`: TIMER_MODE_LABEL {pomodoro:"Pomodoro", stopwatch:"Cronometro"}, TIMER_PHASE_LABEL {focus:"Studio", short:"Pausa breve", long:"Pausa lunga"}; fonte unica per i preset (rimuovere TIMER_PRESET_NAME dal componente e TIMER_LABELS inglese). Mai "task": "Attivita'".
- Notifiche: Notification API (permesso da bottone esplicito) + beep breve (Web Audio dopo gesto utente) a fine blocco, fallback banner esistente, `navigator.vibrate` opzionale. Titolo scheda anche per il cronometro (tempo trascorso).
- Layout: ogni grid con `grid-cols-*`; transizioni solo `m.` sotto LazyMotion.

Modello minimo (retro-compatibile con localStorage e MCP):
- TimerState (studyTimer.ts): aggiungere opzionali `kind: "pomodoro"|"stopwatch"` (default pomodoro), `phase: "focus"|"short"|"long"`, `cycle: number`, `startedAt?`, `accumulatedSeconds`, `subjectId?`, `title?`, `template?`. Default in loadTimer; rafforzare `isTimerState`. mode classic/pomodoro/deep-focus restano come preset di durata.
- Funzioni pure nuove: `stopwatchElapsedSeconds`, `startStopwatch`, `toggleStopwatch`, `nextPhase`, `finishedSession(timer, now)` (start/end/actualMinutes dai timestamp reali, corregge StudyView:87), clamp minuti.
- StudySession (types.ts:181): campo opzionale `source?: "pomodoro"|"stopwatch"|"manual"` (assente = vecchio/manuale; nessuna migrazione). Eventuale `Preferences.pomodoro?` {focusMinutes, shortBreakMinutes, longBreakMinutes, cyclesBeforeLong, autoStartBreaks, sound}.
- Store: `startStudyTimer(mode)` resta; aggiungere `startStopwatch(subjectId?)`, `finishStudyTimer()` (salva + reset atomico), `skipBreak()`. Le pause non creano sessioni.
- MCP: `studyos_timer_control` resta compatibile (start/toggle/reset con mode classic|pomodoro|deep-focus); aggiungere opzionali `kind`, `subjectId` e action `finish`. `studyos_timer_status` aggiunge kind, phase, elapsedSeconds, subjectId e usa lo stesso arrotondamento dell'app. Enum da una costante unica per catalog/execute.
- Statistiche: selettore periodo (7/30 gg, settimane), trend settimanale, voce "Senza materia", ore per `source`, media sessione. Da decidere: creare una StudySession quando un'Attivita' con timer passa a fatta.

Test da aggiungere (tests/studyTimer.test.mjs + agent.test.mjs):
- loadTimer: stato vecchio/corrotto/running senza endsAt/localStorage assente -> default; roundtrip save/load; settle al caricamento se scaduto in background.
- Cronometro: elapsed con pausa/ripresa, sleep lungo, nessun cap alla durata, minimo 1 minuto.
- Pomodoro: focus -> pausa breve x3 -> pausa lunga, contatore cicli, salta pausa, durate personalizzate.
- finishedSession: start/end corretti dopo pausa e dopo scadenza non salvata, a cavallo di mezzanotte, arrotondamento.
- Store: finishStudyTimer crea StudySession con subjectId/source/actualMinutes e azzera il timer; nessuna sessione per le pause.
- Selectors: ore per materia con "Senza materia"; trend settimanale; totale torta = totale periodo.
- MCP: timer_status/timer_control invariati per i client esistenti; enum da costante unica; stesso arrotondamento.
