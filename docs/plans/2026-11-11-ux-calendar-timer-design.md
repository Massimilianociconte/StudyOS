# Calendario, timer e semplificazione dell'interfaccia: design

Stato: approvato in chat l'11/11/2026. Analisi di partenza in
[2026-11-11-ux-audit/](2026-11-11-ux-audit/) (`calendar.md`, `timer.md`, `shell.md`,
`sections.md`, con riferimenti file:riga). Principio guida: **ridurre la complessità
percepita, non quella funzionale** — nessuna funzione si toglie, ognuna resta raggiungibile in
al massimo 2 passi.

Scelte dell'utente: "Per materia" filtra il calendario; ogni blocco Pomodoro finito si salva da
solo; durate del timer libere e ricordate per materia; menu laterale a gruppi (fase 2);
attività aggiunte al volo senza scadenza.

## Fase 1 (subito)

### 1. Pezzi comuni dell'interfaccia e correzioni urgenti

- `HelpTip` in `src/components/ui.tsx`: pulsante "?" (`aria-expanded`), si apre al tocco o al
  clic (mai solo al passaggio), Escape chiude solo il suggerimento, reso fuori dal pannello
  come `Drawer` (lo stile dei pannelli sposta e ritaglia i popover fissi). Props
  `{ title, text, example? }`; testi in `HELP_TEXT` in `src/lib/labels.ts`.
- `PageActions`: una sola azione primaria più un menu "Altre azioni" (tastiera: frecce,
  Escape, focus che torna al pulsante).
- `StatTile` cliccabile: un numero che porta a ciò che conta (schema esistente
  `writeUiState(key, value)` + `setActiveView()`).
- Correzioni: in "Elimina tutti i dati" il pulsante "Annulla" non deve cancellare nulla
  (correzione minima in `SettingsView.tsx`); l'aggiunta rapida crea attività **senza
  scadenza**.

### 2. Calendario per materia

- Riga di filtri per materia sopra il calendario (Tutte · Analisi · Fisica…), nuova chiave
  `useUiState` `calendar.subject` (stringa o null). Il filtro vale per Mese, Settimana, Giorno
  e Agenda e mostra lezioni ed eventi con `subjectId`, esami della materia, attività con
  scadenza della materia e sessioni di studio completate della materia.
- Chip "Solo: Analisi ✕" per tornare a tutto.
- Le schede "Per materia" diventano l'ingresso al filtro: solo materie non archiviate, conteggi
  corretti (serie ricorrente = 1 voce, esami e scadenze inclusi), tre informazioni distinte:
  materie del piano, materie con eventi, eventi della materia.
- Stato vuoto per una materia senza eventi, con "Aggiungi un evento" già legato alla materia.

### 3. Guida a importazione ed esportazione

- `Drawer` guidato che sostituisce i comandi sparsi di `CalendarTransfer.tsx`: direzione
  (da StudyOS a un'altra app / da un'altra app a StudyOS) → dispositivo (rilevato, si può
  cambiare: Samsung One UI, Pixel e altri Android, iPhone e iPad, Windows, macOS) → app
  (Google Calendar, Apple Calendar, Samsung Calendar, Outlook) → passi numerati con icone e
  piccole illustrazioni disegnate nello stile dell'app (niente schermate reali di altre app).
  Il pulsante per scaricare o scegliere il file sta dentro il passo che lo richiede.
- Onestà: è un file `.ics`, non una sincronizzazione automatica; le modifiche successive vanno
  esportate di nuovo; i passi che richiedono un computer lo dicono (l'importazione in Google
  Calendar si fa da calendar.google.com).
- Correzioni in `src/lib/ics.ts`: reimportare la propria esportazione non duplica nulla (gli UID
  `…@studyos` riconosciuti); avviso esplicito per le regole di ripetizione non supportate.

### 4. Timer: Pomodoro e Cronometro

- Un solo timer con selettore **Pomodoro | Cronometro**.
- Pomodoro: blocchi di concentrazione e pause di durata libera (minuti), predefiniti 25/5 con
  pausa lunga 15 ogni 4 blocchi; ogni materia ricorda le sue durate; ogni blocco finito diventa
  da solo una sessione della materia (le pause non contano).
- Cronometro: materia, Avvia / Pausa / Riprendi / Termina; salva il tempo reale con inizio e
  fine corretti; durata obiettivo facoltativa che avvisa al traguardo senza fermare.
- Entrambi resistono a ricarica e scheda in background; gli strumenti MCP del timer restano
  compatibili (nuovi argomenti solo facoltativi).

### 5. Statistiche di studio

- Periodo (settimana, mese, semestre), ore per materia, andamento nel tempo, durata media
  delle sessioni; il totale per materia coincide con il totale del periodo (le sessioni senza
  materia hanno la loro voce).

### 6. Schermate più semplici

Dalla tabella "Le 14 modifiche" di `sections.md`, tranne le voci 13–14 (fase 2): elementi
informativi resi cliccabili; Attività e Studio con l'elenco e "Avvia timer" subito visibili su
telefono; Materie con un solo filtro di semestre e azioni nel menu "⋯"; intestazioni con una
azione primaria più "Altre azioni" (Calendario da 6 pulsanti a 1, Esami da 4 a 1); viste del
calendario da 7 a 4; niente testi tecnici per gli studenti in `BarbView`; il selettore "Corso di
laurea" del Libretto diventa testo con "Cambia in Impostazioni"; un nome solo per l'aggiunta
degli appelli ufficiali; "?" con testi ed esempi dove serve; stati vuoti con un'azione.

## Fase 2 (dopo il merge di people-push)

Menu laterale a gruppi (Oggi · Università · Con gli altri · Altro, nulla tolto); un solo
"Aggiungi" che si adatta alla pagina; Impostazioni a schede riassuntive con dettagli in
pannelli; Gruppi e Condividi più semplici; salto alle categorie di Impostazioni; poi modali
fatte a mano → `Drawer` e un solo modulo per creare un'attività.

## Vincoli

Etichette solo in `src/lib/labels.ts`, italiano semplice ("Attività", mai "task"); ogni `grid`
ha `grid-cols-*`; testo accento con `var(--accent-ink)`; dettagli in `Drawer`; chiavi
`useUiState` esistenti mai rinominate (le nuove passano da un validatore) e valori vecchi di
`calendar.mode`, `tasks.mode`, `barb.tab` ancora validi; animazioni solo `m.` sotto
`LazyMotion`; niente import statici di `lib/supabase`, `lib/groupSync`, `lib/shareSync` o dati
BARB nel bundle iniziale; in fase 1 non si toccano `AppShell.tsx`, `App.tsx`, `CloudPanel.tsx`,
`GroupInvite.tsx`, `ShareDrawer.tsx`, `GroupsView.tsx`, `SharingView.tsx` (salvo la correzione
minima di `SettingsView.tsx`).

## Verifica

`npm test`, `npm run lint`, `npm run build`; test nuovi per il filtro per materia, gli UID
`.ics`, il timer (fasi Pomodoro, cronometro, salvataggio, ricarica) e le statistiche; prova nel
browser a 375, 768 e 1280 px di ogni schermata toccata.
