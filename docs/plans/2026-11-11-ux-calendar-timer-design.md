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

### 7. Calendario avanzato: ripetizioni, eccezioni, ricorrenze, festività

Richiesta dell'11/11 (stessa giornata). Analisi del codice attuale in
[2026-11-11-ux-audit/recurrence.md](2026-11-11-ux-audit/recurrence.md). Scelte dell'utente: prima gli
eventi, le Attività ripetute dopo con lo stesso motore; tutte le Attività con una data nel calendario;
festività e celebrazioni italiane nel calendario; sincronizzazione solo con file `.ics`, ma completi.

**Ripetizioni.** Nessuna; ogni giorno; ogni settimana in uno o più giorni (lun, mer, ven in un solo
evento); ogni N settimane; ogni mese per data, ultimo giorno o "primo/secondo/…/ultimo lunedì";
ogni 3 mesi; ogni 6 mesi; ogni anno; personalizzata (ogni N giorni, settimane, mesi o anni). Fine:
mai, il giorno X (compreso), dopo N volte. Modello: regola strutturata `repeat` (sottoinsieme di
RRULE, RFC 5545) con `timeZone` IANA dell'evento; `recurrence`/`recurrenceUntil` restano come
proiezione compatibile per le versioni vecchie dell'app e per il controllo del server sulle modifiche
degli altri (`recurrence` resta una stringa per sempre). Conversione solo in lettura, nessuna
migrazione distruttiva, nessuna modifica a Dexie, schema di sincronizzazione o SQL.

**Modifiche ed eliminazioni.** Solo questa, questa e le successive, tutta la serie — per modifica,
spostamento (anche trascinando) ed eliminazione. Le occorrenze modificate o cancellate sono righe
separate con id prevedibile `serie@data` (RECURRENCE-ID / EXDATE): modifiche concorrenti su
occorrenze diverse non si perdono, sulla stessa occorrenza convergono. "Questa e le successive" divide
la serie in una serie figlia (`splitFrom`) e chi espande chiude comunque la madre all'inizio della
figlia, così l'ordine delle scritture non crea doppioni. Eliminare la serie elimina anche le sue
occorrenze modificate (e, chiedendo, le serie figlie).

**Fusi orari e ora legale.** Gli eventi con orario si ripetono all'ora locale del loro fuso (10:00 a
Roma resta 10:00 anche dopo il cambio dell'ora e anche se l'evento si guarda da un altro fuso); quelli
di tutto il giorno e le ricorrenze sono date "fluttuanti" (stesso giorno in ogni fuso). Gli eventi già
salvati senza fuso mantengono il comportamento di oggi. Ripetizione mensile vecchia: resta "il giorno X
o l'ultimo del mese" (nessuna occorrenza sparisce).

**Compleanni, anniversari, ricorrenze.** Un percorso dedicato "Ricorrenza" (più semplice del modulo
evento): tipo (Compleanno, Anniversario, Festa o ricorrenza personale, Altro ogni anno), nome, giorno e
mese, anno facoltativo (mostra "compie 25 anni" / "25 anni"), note, uno o più promemoria. Ogni anno in
automatico, tutto il giorno; nato il 29 febbraio → 28 febbraio negli anni non bisestili. Nel calendario:
piccola icona e colore dedicati, discreti. In Home: prossime ricorrenze entro un anno.

**Promemoria.** Uno o più per evento ("all'ora", 15 min prima, 1 giorno prima alle 9…). Esportati nel
`.ics` come VALARM (così li fa suonare anche Google o Apple). Dentro StudyOS avvisano quando l'app è
aperta (notifica dell'app e, se l'utente lo permette, notifica di sistema); avvisi ad app chiusa arrivano
con le notifiche push della fase 2. L'interfaccia lo dice.

**Festività italiane.** Calcolate, non salvate: festivi nazionali (Capodanno, Epifania, Pasqua, Lunedì
dell'Angelo, 25 aprile, 1° maggio, 2 giugno, Ferragosto, San Francesco d'Assisi il 4 ottobre dal 2026 —
Legge 8 ottobre 2025 n. 151 —, Ognissanti, Immacolata, Natale, Santo Stefano) e celebrazioni non festive
(San Valentino, Giovedì e Martedì grasso, Mercoledì delle Ceneri, Festa della donna, Festa del papà,
Domenica delle Palme, Festa della mamma, Festa dei nonni, Halloween, Commemorazione dei defunti,
Vigilia di Natale, San Silvestro, cambi dell'ora). Si vedono in ogni vista come voci leggere di tutto il
giorno, con un interruttore "Festività" nel menu del calendario; non si esportano e non contano nei
riepiloghi.

**Attività nel calendario.** Tutte le Attività con una data compaiono in ogni vista (già oggi in parte),
le fatte attenuate, spuntabili dal calendario; le Attività senza data sono raccolte in "Senza data · N"
con "Scegli la data".

**Modulo evento progressivo.** Prima titolo, data, ora, tipo; poi una riga "Non si ripete ▾" con scelte
pronte calcolate dalla data (Ogni giorno · Ogni settimana il martedì · Ogni mese il 12 · Ogni mese il
secondo martedì · Ogni anno il 12 novembre · Giorni feriali · Personalizza…); "Personalizza" apre una
sezione con intervallo, giorni della settimana, modo mensile e fine. Promemoria, materia, colore, note
in "Altre opzioni". Ogni regola ha una frase leggibile ("Ogni 2 settimane lun, mer, ven, fino al 18
dicembre").

**`.ics`.** Esportazione e importazione conservano RRULE (INTERVAL, BYDAY, BYMONTHDAY, BYSETPOS dove
serve, COUNT, UNTIL nel formato giusto), EXDATE, occorrenze modificate (RECURRENCE-ID), VALARM e fuso
(VTIMEZONE); fusi Windows riconosciuti; reimportare la propria esportazione o un vecchio import diviso
(`uid#n`) non crea doppioni; le parti di una regola non supportate sono conservate e segnalate.
Nessuna sincronizzazione automatica: lo si dice chiaramente. Un link di abbonamento in sola lettura è
fattibile (vedi analisi §8) ma resta fuori da questo giro.

**Agenti (MCP).** Compatibili: valori vecchi di `recurrence` sempre accettati; nuovi argomenti
facoltativi `repeat`, `occurrenceDate`, `scope` (questa / successive / tutte).

**Ordine.** (a) motore puro e store (fusi, regole, espansione con eccezioni e divisioni, festività,
promemoria come calcolo) in parallelo agli altri filoni; (b) interfaccia (modulo progressivo, scelta
"solo questa / successive / tutte", ricorrenze, festività, Attività, avvisi) dopo il filtro per materia;
(c) `.ics` completo e guida all'importazione/esportazione; poi strumenti MCP.

### 8. Modulo evento, selettori, sovrapposizioni, più giorni, colori per tipologia

Richiesta dell'11/11 (punti 8, 9, 9.1, 9.2).

**Selettore di data e ora** (`DateField` / `DateTimeField`, al posto di `datetime-local`, che sui
telefoni apre le rotelle). Al tocco: un mese intero con i giorni della settimana in alto (lun → dom),
oggi riconoscibile, la data scelta piena; frecce per i mesi e tocco sul titolo per scegliere mese e
anno senza scorrere. Scelta la data, nello stesso pannello si sceglie l'ora: orari ogni 15 minuti
attorno a quello attuale più un campo "hh:mm" da scrivere. Sul telefono è un pannello dal basso, sul
computer un popover; tastiera completa (frecce, Pagina su/giù, Invio, Escape). Accanto al campo il
testo mostra sempre giorno della settimana e data ("mar 12 nov, 10:00"). Lo usano il modulo evento e
l'aggiunta rapida subito; le altre schermate (Attività, Esami, Obiettivi, voti, studio manuale) dopo.

**Eventi contemporanei.** Nella griglia oraria gli eventi che si sovrappongono stanno affiancati in
colonne proporzionate (gruppi di sovrapposizione, colonne assegnate in ordine di inizio, un evento si
allarga verso destra se la colonna accanto è libera), posizione e altezza restano quelle dell'orario.
Gli eventi non sovrapposti non si restringono. Su schermi stretti, oltre 2 colonne: le prime due più
un "+N" che apre l'elenco di quella fascia.

**Pop-up e scorrimento.** Con un pannello o una finestra aperta la pagina sotto non scorre; scorre
solo il contenuto del pannello; alla chiusura la pagina resta dov'era (nessun salto); funziona con
pannelli uno sopra l'altro (es. data dentro il modulo evento) e al tocco (iOS compreso). Focus
dentro il pannello, Escape chiude solo quello in cima, il focus torna al pulsante che l'ha aperto.

**Un solo modulo per creare e modificare un evento** (`Drawer`), con le stesse sezioni nei due casi:
1. Principali: titolo, inizio, fine (oppure durata), tutto il giorno.
2. Aspetto e collocazione: tipologia, colore (tavolozza con anteprima), materia.
3. Altre opzioni (chiuse all'inizio): ripetizione e fine della ripetizione, promemoria, descrizione,
   luogo o destinazione, collegamenti, il resto che esiste già.
Salva e Annulla sempre visibili in fondo; la fine non può precedere l'inizio (messaggio chiaro, la
fine si sposta con l'inizio mantenendo la durata); chiudere con modifiche non salvate chiede conferma.

**Vacanza.** Nuova tipologia (`category: "vacation"`; le versioni vecchie mostrano solo un'etichetta
vuota, nessun errore). Percorso semplice come le ricorrenze: nome, dal… al… con il selettore a
calendario, durata in giorni calcolata (partenza e ritorno compresi), tutto il giorno automatico,
colore giallo e icona valigia, destinazione, note, promemoria facoltativi. Un solo evento:
modificarne le date lo allunga o accorcia, eliminarlo lo toglie tutto.

**Eventi su più giorni** (qualsiasi tipologia). In Settimana e Mese una sola barra continua che
copre i giorni interessati, nella fascia "tutto il giorno" in alto; nel Mese si spezza solo al cambio
di riga (settimana), come Google; tocco ovunque sulla barra = stesso evento. In Giorno compare come
striscia in alto con "giorno 2 di 3"; in Agenda una sola voce "ven 3 – dom 5".

**Colori per tipologia.** Ogni tipologia ha un colore predefinito applicato subito alla scelta (con
anteprima nel modulo): Esame rosso, Palestra bianco, Personale verde, Vacanza giallo, Compleanno viola,
festività grigio chiaro; le altre tipologie hanno un colore proprio della tavolozza. Se l'utente sceglie
un colore a mano quell'evento lo tiene (`colorCustom`), anche cambiando tipologia; altrimenti segue il
colore della tipologia. Eventi già salvati: se il loro colore è quello che l'app assegnava in
automatico seguono la tipologia, altrimenti è considerato scelto a mano. I colori predefiniti si
cambiano da "Altre azioni › Colori delle tipologie" (preferenza sincronizzata). Leggibilità: colori
chiari (bianco, giallo, grigio) resi con fondo tenue, bordo e testo scuri, sempre contrasto AA in
chiaro e scuro; oltre al colore, una piccola icona per tipologia.

## Timer: tre modalità e sessioni complete (richiesta dell'11/11, punto 10)

Aggiunta al §4. **Pomodoro · Timer · Cronometro**:
- Timer: conto alla rovescia con durata libera in ore e minuti (1 h 30, 2 h 15…); le durate pronte
  restano come scorciatoie. Pausa, riprendi, termina prima.
- Cronometro e Pomodoro come al §4.
- Prima di avviare: materia (o "Nessuna materia") e, facoltativi, argomento (tra quelli della materia
  o scritto libero: capitolo, lezione, breve descrizione).
- Ogni sessione salva: materia, data, inizio e fine reali, durata senza pause, modalità, argomento,
  note. Timer e Cronometro alla fine mostrano un riepilogo modificabile (materia, argomento, note,
  minuti) con "Salva"; i blocchi Pomodoro si salvano da soli (scelta già presa) e si correggono dopo con
  "Modifica" dalla notifica o dall'elenco delle sessioni (oggi manca: si aggiunge la modifica di una
  sessione). Se il timer finisce ad app chiusa, alla riapertura compare il riepilogo con l'ora reale.
- Ogni sessione conta una volta sola ovunque (Studio, Materie, Statistiche, calendario).
- Pagina della materia: tempo totale, oggi, per giorno / settimana / mese, andamento, elenco delle
  sessioni (data, durata, argomento), tempo per argomento. Statistiche generali: confronto tra materie.

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
