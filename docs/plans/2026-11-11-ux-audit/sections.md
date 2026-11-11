# Audit UX delle sezioni: ridurre la complessità percepita

Audit in sola lettura del worktree `sharing` (commit 034a91d). Obiettivo: **ridurre la complessità percepita, non quella funzionale**. Ogni funzione resta raggiungibile in al massimo 2 passi.

**Metodo.** Tutto è ricavato dal codice; l'app non è stata avviata. I conteggi "sopra la piega" sono stime fatte dalle classi Tailwind:

- Desktop: area utile di circa 950–1100 px con la barra laterale a partire da 1280 px.
- Telefono: 375×812, con la barra fissa in alto (circa 70 px) e la barra in basso (circa 96 px), quindi restano circa 640 px utili.

La barra globale (`AppShell.tsx:249-283`: ricerca, tema, notifiche, profilo, **Aggiungi**) aggiunge 5 controlli a ogni schermata e **non** è inclusa nei conteggi.

**Legenda.**

- Impegno: **S** = meno di mezza giornata, un file. **M** = 1–2 giorni, oppure un nuovo componente di base. **L** = più giorni o un cambio che tocca più sezioni.
- Valore: **Alto**, **Medio**, **Basso**.
- **⚠ dopo people-push** = da fare solo dopo il merge del ramo `claude/people-push-6582b6`, che modifica `GroupsView.tsx` e `SharingView.tsx`.

Audit collegati nella stessa cartella: `calendar.md` (import/export .ics e "Per materia") e `timer.md` (timer).

---

## 0. Le 14 modifiche con il miglior rapporto valore/impegno

| # | Modifica | Dove | Imp. | Valore |
|---|---|---|---|---|
| 1 | Rendere cliccabili le schede "Per materia" e "Esami" del calendario e le pillole d'esame nella griglia. Una materia applica un filtro al calendario, un esame apre l'esame. | CalendarView.tsx:2271, 2218, 1129-1143 | M | Alto |
| 2 | Trasformare numeri e righe "solo informativi" in collegamenti, con lo schema già usato `writeUiState(key, value) + setActiveView()` (esempio a CalendarView.tsx:411-412). Riguarda Statistiche, Studio, scheda esame, dettaglio materia e i riquadri di Attività. | vedi §4.3 | S ciascuno | Alto |
| 3 | Attività su telefono: la prima riga dell'elenco oggi è sotto la piega. Aggiunta rapida ridotta a un campo solo e una riga di riepilogo al posto dei 4 riquadri. | TasksView.tsx:132-144, 247 | S | Alto |
| 4 | Studio su telefono: "Avvia timer" oggi è sotto la piega. Va portato subito sotto il tempo. | StudyView.tsx:120-210 | S | Alto |
| 5 | Materie: togliere il doppio filtro per semestre, spostare i colori nel dettaglio, raccogliere le azioni della scheda in un menu "⋯". | SubjectsView.tsx:150-161, 233-247, 316-360 | S/M | Alto |
| 6 | Intestazione con **una** azione primaria più un menu "Altre azioni". Il Calendario passa da 6 pulsanti a 1 + menu, Esami da 4 a 1 + menu. | CalendarView.tsx:389-421, ExamsView.tsx:196-208 | M | Alto |
| 7 | Togliere dall'interfaccia degli studenti i testi tecnici: comandi `npm`, Firecrawl, codici HTTP, "affidabilità %", nomi di file SQL. | BarbView.tsx:943, 988, 1027-1045, 749; SharingView.tsx:236 ⚠ | S | Alto |
| 8 | Libretto: il selettore "Corso di laurea" cambia una preferenza (e nasconde o mostra la sezione Corso di laurea). Va sostituito con un testo in sola lettura e "Cambia in Impostazioni". | CareerView.tsx:117, 230-237 | S | Alto |
| 9 | Nuovo componente "?" (`HelpTip`, si apre al tocco) con i testi in `labels.ts`, al posto dei suggerimenti `title` che su touch non si vedono. | §4.4 | M | Alto |
| 10 | Viste del calendario da 7 a 4: "Giornata di studio" diventa un'opzione di Giorno; "Esami" e "Per materia" vanno nel menu e diventano un filtro. | CalendarView.tsx:136-144 | M | Medio-Alto |
| 11 | Esami: prima il titolo, poi le schede. "Date ufficiali" meno densa: avvisi dietro "?" e un filtro per insegnamento invece di due. | ExamsView.tsx:86-89; BarbExamCalendar.tsx:53-69 | S/M | Medio |
| 12 | Un nome solo per l'aggiunta degli appelli ufficiali. Oggi gli ingressi verso lo stesso pannello hanno 3 nomi diversi. | CalendarView.tsx:402; ExamsView.tsx:199; BarbExamCalendar.tsx:53 | S | Medio |
| 13 | Modifica e dettagli sempre in `Drawer`. Oggi ci sono 6 modali centrate fatte a mano, senza blocco del focus. | §4.6 | L (in totale) | Medio |
| 14 | Un solo modulo per creare un'attività. Oggi ce ne sono 4, con campi diversi. | §4.8 | L | Medio |

---

## 1. Calendario (`src/views/CalendarView.tsx`)

### Inventario sopra la piega

| | Desktop ≥1280 (Settimana) | 375 px (Settimana = elenco per giorno) |
|---|---|---|
| Azione primaria | "Nuovo evento" (393). Più la barra globale "Aggiungi": due pulsanti color accento | uguale |
| Controlli prima del contenuto | **16**: 6 in intestazione (393-418: Nuovo evento, Aggiungi appelli ufficiali, Vedi appelli ufficiali, Importa da Google/Apple, Esporta, Condividi), 7 viste (426, opzioni 136-144), 3 di navigazione (430-438). In più, una pillola per ogni persona che condivide (450-466) | 16. L'intestazione va a capo su circa 4 righe; delle 7 viste se ne vedono circa 3 (scorrono). **Circa 450 px prima del primo giorno**: restano circa 190 px di calendario |
| Sezioni | intestazione, barra viste, "Calendari condivisi", avviso, pannello | uguale |
| Filtri e interruttori | viste (7), pillole delle persone | uguale |
| Riquadri statistici | 0 in Settimana. Le viste "Esami" (2193) e "Per materia" (2250) sono fatte solo di schede statistiche | uguale |

### Problemi

- **Cose che sembrano cliccabili e non lo sono** (è l'esempio citato dall'utente):
  - Le schede "Per materia" sono `div` (2271-2283). Il titolo della vista dice "con quanti eventi hai in calendario" (142), ma non si può aprire la materia né filtrare. In più l'elenco mostra anche le materie archiviate e superate (2266 usa `subjects.map` senza filtro).
  - Le schede della vista "Esami" sono `div` (2218-2229).
  - La pillola dell'esame nella griglia è un `div` con `cursor-default`, che blocca il clic e basta (1129-1143). Nella stessa riga gli eventi, invece, sono pulsanti.
- **Azioni in competizione:**
  - 6 azioni in intestazione, 3 delle quali riguardano gli appelli ufficiali o la sezione Esami.
  - "Aggiungi appelli ufficiali" (402) e "Vedi appelli ufficiali" (415) hanno quasi lo stesso nome e fanno cose diverse.
  - L'import .ics è un `<label>` con uno stile diverso da `Button` (CalendarTransfer.tsx:118-134).
- **Viste in sovrabbondanza:**
  - 7 viste, di cui 3 non sono calendari: "Esami" e "Per materia" sono riepiloghi, "Giornata di studio" è Giorno con una fascia oraria fissa (499-501).
  - Per "Esami" e "Per materia" frecce e "Oggi" spariscono e restano un testo grigio (441-443): l'utente perde l'orientamento.
- **Gesti a sorpresa:**
  - Nel Mese un tocco su una cella crea un evento (1293-1297), mentre un tocco sul numero apre il giorno (1319-1332).
  - Su telefono le pillole del mese sono nascoste (1335): toccando un giorno per vedere cosa c'è si apre invece "Nuovo evento".
  - Nella griglia oraria un clic su una colonna crea un evento (921-925). La spiegazione è solo nel `title`.
- **Componenti non uniformi:**
  - Modifica e creazione usano `ModalShell` (1577-1603), una modale centrata fatta a mano: Esc funziona solo con il focus dentro e il focus non resta bloccato nella finestra. La regola del progetto è "dettagli in Drawer".
  - "Oggi" è un `<button>` grezzo (431-437); in Date ufficiali lo stesso comando è `Button variant="soft"` (BarbExamCalendar.tsx:58).
  - Conferme con `window.confirm` (346, 537, 575, 663).
- **Gergo:** "file .ics" (CalendarTransfer.tsx:124), "Giornata di studio" (143), "↻" senza testo visibile (1118-1122, 1234-1238).
- **Stati vuoti:** solo l'Agenda ne ha uno (1438-1448). Settimana, Giorno e Mese vuoti mostrano una griglia vuota senza spiegazioni; su telefono compare 7 volte "Nessun impegno" (1184).

### Proposta

| Modifica | Dove va | Passi per arrivarci | Imp. | Valore |
|---|---|---|---|---|
| In intestazione resta solo "Nuovo evento" (primaria) | — | 1 | S | Alto |
| Menu **"Altre azioni ⋯"** con: Aggiungi appelli al calendario, Importa da Google o Apple, Esporta, Condividi, Date ufficiali degli appelli (va in Esami › Date ufficiali) | menu nell'intestazione | 2 | M (serve `MoreMenu`; CalendarTransfer deve permettere di aprire il selettore file da un riferimento) | Alto |
| Viste: **Giorno, Settimana, Mese, Agenda**. "Giornata di studio" diventa l'opzione "Solo 8–19, ore grandi" dentro Giorno. "Esami" e "Per materia" vanno nel menu "⋯" alla voce "Riepiloghi". I valori salvati `focus`, `exam`, `semester` restano validi in `calendar.mode` e vengono convertiti | barra viste e menu | 1–2 | M | Medio-Alto |
| **Filtro per materia** ("Tutte le materie ▾", con una pillola "Solo: Biochimica ×" che si toglie) in tutte le viste. Si salva in una nuova chiave `calendar.subject` (si aggiunge, non si rinomina nulla) | barra viste | 1 | M | Alto |
| Schede "Per materia" come pulsanti: il tocco applica il filtro e passa a Settimana; il link "Apri materia" fa `writeUiState("subjects.open", id, "tab")` e `setActiveView("subjects")`. Si escludono archiviate e superate, oppure si raccolgono in fondo | vista Per materia | 1 | S (link) / M (filtro) | Alto |
| Schede della vista "Esami" e pillola d'esame come pulsanti che aprono l'esame. Serve una nuova chiave `exams.editing` in ExamsView, dove oggi `editingExam` è uno `useState` (95). Ripiego S: portare il calendario al giorno dell'esame | ExamSession, ExamChip | 1 | M (S il ripiego) | Alto |
| Mese su touch: il tocco su una cella apre il giorno. La creazione resta col "+" del giorno (DayList, 1173-1181). Su desktop il clic resta com'è | MonthGrid | 2 per creare | S | Medio |
| Editor e creazione in `Drawer`, con conferma prima di chiudere se ci sono modifiche non salvate (`onDirtyChange` esiste già, 1626) | — | — | M | Medio |
| Sottotitolo ridotto a "Lezioni, studio, scadenze ed esami." La frase "clicca un giorno…" va nel "?" | 388 | — | S | Basso |

### Aiuto "?"

- **Accanto alle viste:** "Giorno, Settimana e Mese mostrano gli impegni sul calendario; Agenda li elenca per le prossime due settimane. Tocca un orario libero per aggiungere un evento. Es.: tocca martedì alle 10 per segnare la lezione di Anatomia."
- **Accanto a "Calendari condivisi":** "I bordi tratteggiati sono eventi di un'altra persona. Tocca il suo nome per mostrarli o nasconderli. Es.: nascondi il calendario di Giulia per vedere solo il tuo."
- **Voce di menu "Aggiungi appelli al calendario":** "Le date d'esame pubblicate dall'università diventano promemoria di tutta la giornata nel tuo calendario. Es.: l'appello di Anatomia del 12 febbraio."
- **Voce di menu "Importa da Google o Apple":** "Scegli il file del calendario (.ics) esportato da Google Calendar o Apple Calendario: prima di aggiungere vedrai un'anteprima. Es.: l'orario delle lezioni scaricato dal portale."
- **Campo "Ripetizione":** "Un evento che si ripete resta uno solo: se lo sposti o lo modifichi, cambiano tutte le date. Es.: la lezione di ogni martedì."

### Stati vuoti da migliorare

- Calendario senza eventi (Settimana, Giorno, Mese): un riquadro sopra la griglia con il testo "Il calendario è vuoto. Aggiungi un evento, importa l'orario da Google o Apple oppure aggiungi gli appelli ufficiali." e i pulsanti [Nuovo evento] [Importa]. Si chiude, e la scelta si ricorda in una nuova chiave per dispositivo. **S**
- Su telefono, in una settimana vuota: un solo messaggio invece di 7 "Nessun impegno". **S**

---

## 2. Attività (`src/views/TasksView.tsx` + `TaskModal.tsx`, `TaskEditorModal.tsx`)

### Inventario sopra la piega

| | Desktop (Lista) | 375 px |
|---|---|---|
| Azione primaria | "Nuova attività" (108), più "Aggiunta rapida" (144) e la barra globale "Aggiungi": **3 modi di creare visibili insieme** | uguale |
| Controlli prima della prima riga | **13**: 2 in intestazione, 5 nell'aggiunta rapida (236-274), 5 viste (147-158), 1 ordinamento (159-172) | 13. **Prima riga a circa 750 px, cioè sotto la piega.** I riquadri 2×2 occupano circa 150 px e l'aggiunta rapida circa 290 px: sotto i 480 px va in una colonna sola (247) |
| Controlli per riga | fino a 5: spunta, titolo, stato (`select` da md, 355-368), modifica ed elimina al passaggio del mouse (370-378) | 2 (spunta, titolo) |
| Riquadri statistici | 4 non cliccabili (93-98, 132-142) | 4 (in 2×2) |

### Problemi

- **Riquadri informativi che invitano a tappare:** "In ritardo" e "Urgenti" (95-96) sembrano filtri ma non fanno nulla.
- **Duplicazioni:**
  - Aggiunta rapida e "Nuova attività" hanno campi diversi. La rapida imposta la scadenza alle 18:00 (218); il calendario usa data e ora (CalendarView.tsx:2104).
  - Il commento di TaskModal.tsx:13 dice "un solo ingresso", ma gli ingressi sono 4: TaskModal, QuickTaskBar, CalendarView CreateModal "Attività con scadenza" (2056) e QuickAddModal.
- **Gergo e concetti avanzati in vista:**
  - "Urgenza e importanza" (156), spiegata da una frase sempre visibile che rimanda a «Altre opzioni» (650-652).
  - Nell'editor: "Importanza (da 1 a 5)", "Difficoltà (da 1 a 5)" ed "Energia richiesta" senza spiegazione (TaskEditorModal.tsx:228-240).
  - Il suggerimento sul timer è un testo dinamico sotto "Stato" (TaskEditorModal.tsx:139-144, 202).
- **Informazione non modificabile:** "x/y passaggi" (60-63, 330-335) compare nelle righe, ma i passaggi non si modificano da nessuna parte nell'interfaccia (`subtasks` non c'è in TaskEditorModal).
- **Componenti non uniformi:**
  - Stato vuoto fatto a mano (118-129) invece di `EmptyState`. "Per materia" vuoto è un `<p>` (685).
  - Editor e creazione sono modali centrate (TaskEditorModal.tsx:147-156, TaskModal.tsx:74-86), non `Drawer`. Il pulsante di chiusura è un `Button ghost` con testo "Chiudi" (TaskEditorModal.tsx:162-164), mentre altrove è `IconButton X`.
  - Etichette fuori da `labels.ts`: `statuses` (22-28) ripete `TASK_STATUS_LABEL`; "Senza materia" (679) invece di `NO_SUBJECT_LABEL`; le opzioni dell'energia sono scritte a mano (TaskEditorModal.tsx:236-238) invece di `ENERGY_LABEL`.
- **Per stato:** ogni scheda ha `select`, modifica ed elimina (606-635). Su touch sono sempre visibili, quindi 3 controlli per scheda.

### Proposta

| Modifica | Dove va | Passi | Imp. | Valore |
|---|---|---|---|---|
| Riquadri sostituiti da **una riga di riepilogo** con collegamenti: "12 da fare · **3 in ritardo** · **2 urgenti** · 6 h previste". Ogni parte in grassetto applica un filtro (nuova chiave `tasks.filter`: `overdue`, `urgent`, `null`) mostrato come pillola "In ritardo ×". Su desktop si possono tenere i riquadri, ma come pulsanti | 132-142 | 1 | S/M | Alto |
| **Aggiunta rapida** ridotta a un campo ("Scrivi un'attività e premi Invio") più un pulsante "Dettagli ▾" che apre materia, priorità e data. Su telefono si apre con il "+" | 209-279 | 1–2 | S | Alto |
| Viste: in vista restano "Lista", "Piano di oggi", "Per stato"; "Per materia" e "Urgenza e importanza" vanno in "Altre viste ▾". I valori di `tasks.mode` restano validi | 147-158 | 2 | M | Medio |
| Riga: spunta, titolo e **"⋯"** (Modifica, Stato ▸, Elimina). Lo stato in `select` (355-368) e le icone al passaggio del mouse (370-378) entrano nel menu. In "Per stato" resta il `select` di colonna, perché serve a chi non può trascinare (607) | TaskRow, KanbanTaskCard | 2 | M | Medio |
| Editor in `Drawer`. "Altre opzioni" divise in "Pianificazione" (priorità, importanza, difficoltà, energia, durata) e "Note e tag" | TaskEditorModal | 2 | M | Medio |
| **Passaggi** modificabili nell'editor (elenco da spuntare) | TaskEditorModal | 2 | M | Medio |
| Etichette in `labels.ts` | 22-28, 679; TaskEditorModal.tsx:236-238 | — | S | Basso |

### Aiuto "?"

- **Vista "Urgenza e importanza"** (sostituisce la frase fissa 650-652): "Quattro riquadri per decidere cosa fare prima. Urgente = priorità alta o urgente. Importante = importanza 4 o 5, che imposti aprendo l'attività. Es.: «Consegnare la relazione domani» va in «Fai ora»."
- **Vista "Piano di oggi":** "Le 6 attività da fare più urgenti, in ordine di scadenza e priorità."
- **Campi "Importanza, Difficoltà, Energia":** "Ti aiutano a scegliere cosa fare in base a come stai. Es.: se sei stanco, scegli un'attività con energia bassa, come riordinare gli appunti."
- **Campo "Stato" = In corso:** "Quando metti un'attività «In corso» parte un timer che misura quanto ci metti. Lo fermi cambiando stato."

### Stati vuoti

- Usare `EmptyState` (118-129) con il testo: "Qui annoti compiti, consegne e cose da studiare. Es.: «Esercizi 1–10 di pagina 52, entro venerdì»." e i pulsanti [Nuova attività] [Scegli dal calendario]. **S**
- "Per materia" e "Urgenza e importanza" vuoti: `EmptyState` con un'azione per tornare alla Lista. **S**

---

## 3. Studio (`src/views/StudyView.tsx` + `TopicManager.tsx`)

### Inventario sopra la piega

| | Desktop | 375 px |
|---|---|---|
| Azione primaria | "Avvia timer" (197-199) | stessa. **Stima: circa 830 px dall'alto, cioè sotto la piega.** In ordine: anello da 180 px (122), tempo, Materia, Titolo, "Altre opzioni", Durata e infine i pulsanti |
| Controlli | 9: Condividi, Materia, Titolo, Altre opzioni, 3 durate, Avvia, "Vedi tutti" (288) | 9 |
| Sezioni | Timer, Ripasso, Sessioni recenti, colonna laterale (Questa settimana, Prossimi ripassi) | in colonna; la colonna laterale va in fondo |
| Riquadri statistici | anello, "Questa settimana" (274-283), sottotitolo "Oggi hai studiato" (233) | uguale |

### Problemi

- **Cose informative che dovrebbero essere cliccabili:**
  - "Prossimi ripassi": le righe (295-301) sono `li` di solo testo.
  - "Questa settimana" (274-283) non porta a Statistiche e non permette di cambiare l'obiettivo, che sta solo in Impostazioni (SettingsView.tsx:328-331).
  - "Sessioni recenti": le righe (242-261) non si possono aprire né modificare; si possono solo eliminare con un'icona che compare al passaggio del mouse. Eppure `updateSession` esiste nello store (useStudyStore.ts:146).
- **Gergo:**
  - "Concentrazione lunga", "Pomodoro", "Classico" (StudyTimerWatcher.tsx:15-19).
  - "domande guida", "ripasso n. 3" (380), "primo ripasso".
  - "Tipo di sessione" con 9 valori (labels.ts:91-101), anche se serve solo come promemoria (159).
- **Componenti non uniformi:**
  - I tipi di sessione sono pillole fatte a mano con `role="radio"` (160-175) invece di `Segmented`.
  - In TopicManager i pulsanti con stile primario sono grezzi (TopicManager.tsx:143-149, 183-199) invece di `Button`.
  - Le sessioni vuote sono un `<p>` tratteggiato (265-267, 424-428) invece di `EmptyState`.
  - `TIMER_PRESET_NAME` e `REVIEW_RATING_LABEL` stanno fuori da `labels.ts`.
- **Primo accesso:** senza materie, il campo "Materia" mostra solo "Nessuna materia" e non dice dove crearne una.
- Vedi anche `timer.md` per il doppio timer (sessione e attività).

### Proposta

| Modifica | Dove va | Passi | Imp. | Valore |
|---|---|---|---|---|
| Su telefono: anello e tempo **affiancati** (anello di 96–120 px) e **Avvia timer subito sotto il tempo**. "Titolo" va dentro "Altre opzioni" insieme al tipo; in vista resta solo "Materia" | 120-210 | 1 | S | Alto |
| "Questa settimana" come pulsante verso Statistiche, più il link "Cambia obiettivo" (Impostazioni › Profilo) | 274-283 | 1 | S | Medio |
| Righe di "Prossimi ripassi" come pulsanti: aprono il pannello degli argomenti con quell'argomento in modifica, oppure "Ripassa in anticipo" | 295-301 | 1 | S/M | Medio |
| Righe di "Sessioni recenti" come pulsanti che aprono **ManualSessionDrawer in modifica** (`updateSession`). Elimina va nel piè di pagina del pannello | 242-261, 457-561 | 1 | M | Medio |
| Tipi di sessione con `Segmented size="sm"`, oppure un `select` come in ManualSessionDrawer (545-553) | 160-175 | — | S | Basso |

### Aiuto "?"

- **Titolo "Ripasso":** "Ti riproponiamo ogni argomento quando stai per dimenticarlo: all'inizio dopo pochi giorni, poi sempre più distanziato. Es.: rispondi «Bene» e lo rivedi tra circa una settimana."
- **Campo "Domande guida":** "Domande da farti prima di riaprire gli appunti. Es.: «Quali sono le fasi dell'infiammazione acuta?»"
- **Scelta "Durata":** "Pomodoro: 25 minuti di studio, poi 5 di pausa. Classico: 45 minuti di fila. Concentrazione lunga: 90 minuti per gli argomenti difficili."
- **Campo "Tipo di sessione":** "Serve solo a ricordarti cosa hai fatto: lo vedi accanto alla sessione salvata. Es.: «Esercizi»."

### Stati vuoti

- Timer senza materie: sotto il campo, "Non hai ancora materie: [Aggiungile]". Il link porta a Materie. **S**
- Sessioni: `EmptyState` compatto con il pulsante [Aggiungi studio fatto]. **S**

---

## 4. Materie (`src/views/SubjectsView.tsx`)

### Inventario sopra la piega

| | Desktop (con il corso di laurea attivo) | 375 px |
|---|---|---|
| Azione primaria | "Aggiungi materia": pulsante grezzo con stile primario nella barra (248-254). In intestazione c'è anche "Scegli dal corso di laurea" (141) | uguale |
| Controlli prima della prima scheda | **20**: 1 in intestazione, 10 nella barra (campo, **8 colori** a 233-247, pulsante), 4 riquadri per semestre (sono pulsanti, 150-158) e **5 pillole che filtrano lo stesso semestre** (159-161) | 20. **Prima scheda a circa 700 px** |
| Controlli per scheda | 4–5: nome, stato (`select`, 317-328), "Apri" (335-337), Archivia (338-348), Elimina (349-359) | uguale |
| Riquadri statistici | 4 riquadri per semestre, e in ogni scheda 6 dati più la barra di avanzamento (294-314) | uguale |

### Problemi

- **Due controlli per lo stesso stato:** riquadri e pillole dei semestri (150-161) cambiano entrambi `subjects.semester`. I riquadri sembrano statistiche ma sono filtri.
- **Troppi controlli per scheda:**
  - "Apri" ripete quello che fa già il clic sul nome (288-291).
  - Il `select` dello stato è in vista su ogni scheda.
  - Pillola dell'esame (329-334) e numero di appelli (307, `BarbExamAvailability`) non sono cliccabili.
- **Azioni in competizione:** archiviare dalla scheda è immediato e si può annullare (68-76); archiviare dal dettaglio usa `window.confirm` e un pulsante `danger` (456-465), anche se è reversibile.
- **Dettaglio troppo lungo:** in un'unica pagina ci sono numeri, appelli (fino a decine di righe), modulo dati, materiali, attività e argomenti.
  - Le attività del dettaglio (654-659) sono testo, non si aprono.
  - "Esame tra" (491-492) non si apre.
- **Gergo:** "gg" (332, 492); CFU senza spiegazione; "Dal piano ufficiale" (509).
- **Componenti non uniformi:**
  - Le pillole semestre fatte a mano (160) non usano `Segmented`.
  - Pulsanti grezzi in NewSubjectBar (248-254).
  - In questa sezione gli stati vuoti usano già `EmptyState`: è il modello da seguire.

### Proposta

| Modifica | Dove va | Passi | Imp. | Valore |
|---|---|---|---|---|
| **Un solo filtro per semestre**: `Segmented` con i conteggi ("Tutte 8 · 1° sem. 4 · 2° sem. 3 · Annuali 1"). I CFU per semestre vanno nel sottotitolo. Si tolgono i riquadri (150-158) | 150-161 | 1 | S | Alto |
| Barra di aggiunta: solo nome e "Aggiungi materia" (`Button` primario). Il colore lo assegna l'app, già a rotazione (224), e si cambia nel dettaglio (529-551) | 216-257 | 2 | S | Medio |
| Scheda: il clic su tutta la scheda apre il dettaglio; si toglie "Apri"; stato e Archivia (o Elimina) vanno in **"⋯"**. Lo stato resta visibile come `Tag` | 259-378 | 2 | S/M | Alto |
| Pillola dell'esame cliccabile (apre l'esame, vedi §1) e numero di appelli cliccabile (apre il dettaglio sulla scheda "Appelli") | 307, 329-334 | 1 | S | Medio |
| **Dettaglio diviso in schede** (`Segmented size="sm"`, come in CourseDrawer, BarbView.tsx:621-632): Panoramica (numeri, prossimo esame, attività, argomenti) · Dati · Materiali · Appelli. Nuova chiave `subjects.drawerTab` | 479-671 | 2 | M | Alto |
| Righe delle attività nel dettaglio cliccabili: aprono `TaskEditorModal` (poi Drawer) sopra il dettaglio, oppure `writeUiState("tasks.editing", id, "tab")` e `setActiveView("tasks")` | 654-659 | 1 | S | Medio |
| Archiviare dal dettaglio come dalla scheda: subito, con "Annulla", variante `soft` | 456-465 | — | S | Medio |
| "gg" → "giorni" | 332, 492 | — | S | Basso |

### Aiuto "?"

- **Campo "CFU":** "I crediti dell'esame: dicono quanto pesa. Es.: nella media ponderata un esame da 9 CFU conta più di uno da 6."
- **Menu "⋯" › Archivia:** "La materia sparisce dall'elenco, ma attività, esami e materiali restano. La ritrovi in «Archiviate», da dove puoi anche eliminarla per sempre."
- **Campo "Semestre":** "Se la segui in un periodo diverso da quello del piano ufficiale, sceglilo qui. Es.: la recuperi nel secondo semestre."

### Stati vuoti

Sono già buoni (176-193). Con il corso di laurea attivo, "Scegli dal corso di laurea" dovrebbe essere la **prima** azione, perché evita di scrivere i nomi a mano. **S**

---

## 5. Esami (`src/views/ExamsView.tsx` + `BarbExamCalendar.tsx`, `BarbExamImport.tsx`, `BarbExamSessions.tsx`, `GradeDrawer.tsx`)

### Inventario sopra la piega: scheda "I miei esami"

| | Desktop | 375 px |
|---|---|---|
| Azione primaria | "Aggiungi esame" (203) | uguale |
| Controlli prima delle schede | **7**: 2 schede (87, **sopra il titolo**), 4 in intestazione (199-206: Importa appelli ufficiali, Registra un voto, Aggiungi esame, Condividi i progressi), la barra del Libretto (212-232) | 7. Le 4 azioni vanno a capo su circa 3 righe. **Prima scheda a circa 560 px** |
| Controlli per scheda d'esame | 6: nome, matita, −, +, "Aggiungi il programma al ripasso", "Studia" (527-593) | uguale |
| Riquadri statistici | barra Libretto (3 numeri); in ogni scheda giorni mancanti, % e 2–3 pillole, conteggi e fino a 7 argomenti | uguale |

### Inventario: scheda "Date ufficiali" (BarbExamCalendar)

- Un secondo `SectionTitle` ("Appelli ufficiali BARB", 53) con un'azione primaria.
- Riquadro di copertura (54), avviso fonti (56), filtro "Insegnamento" e viste Giorno/Settimana/Mese (57), navigazione (58), avviso sugli appelli nello stesso giorno (59), suggerimento (60).
- Griglia del mese, poi **33 pulsanti di insegnamento** (68) che fanno la stessa cosa del filtro (57), poi "Fonti ufficiali" (69).
- In tutto **circa 45 controlli** e 4 riquadri di testo prima o intorno al calendario.

### Problemi

- **Gerarchia invertita:** le schede (87) stanno sopra l'H2 "I miei esami" (194). In "Date ufficiali" c'è un altro H2 (53): due titoli diversi per la stessa sezione.
- **Nomi diversi per lo stesso pannello `BarbExamImport`:** "Importa appelli ufficiali" (199), "Aggiungi appelli ufficiali" (CalendarView.tsx:402), "Aggiungi al mio calendario" (BarbExamCalendar.tsx:53).
- **Due moduli per registrare un voto:**
  - `GradeDrawer` (200, e Libretto).
  - I campi del voto dentro il modulo dell'esame quando lo stato è "Sostenuto" (378-415): stesso dato, interfaccia diversa.
- **Cose informative che dovrebbero essere cliccabili:**
  - La riga "3 attività da fare · 2 h di studio · 4 argomenti" (568-570).
  - Gli argomenti del programma come pillole (572-578): sembrano filtri.
  - Il bollino di rischio, spiegato solo nel `title` (541-548).
  - "Studia" apre Studio senza scegliere la materia (591-593).
- **Gergo:** "BARB", "UNIMI", "precedente ordinamento F92" (BarbExamCalendar.tsx:54, 57; BarbExamSessions.tsx:39), "voci ufficiali", "voci negli elenchi ufficiali" (BarbExamSessions.tsx:76, 98), "Commissione", "Iscrizioni per ordinamento", "Fonte {codice}" (BarbExamSessions.tsx:31, 43), "Preparazione (%)" senza spiegare che è una stima personale (370), "Domande frequenti" (424).
- **Componenti non uniformi:**
  - Modulo dell'esame come modale centrata fatta a mano (322-482).
  - Stati vuoti fatti a mano (241-251, 295-304).
  - Bollino di rischio come `span` invece di `Tag` (541-548).
  - Tipi di prova e stati scritti dentro BarbExamSessions.tsx:16, 102 invece che in `labels.ts`.

### Proposta

| Modifica | Dove va | Passi | Imp. | Valore |
|---|---|---|---|---|
| Prima `SectionTitle "Esami"`, poi le schede "I miei esami" / "Date ufficiali". Dentro le schede i titoli diventano H3; "Appelli ufficiali BARB" diventa "Date ufficiali degli appelli" | 86-89, 193-195; BarbExamCalendar.tsx:53 | — | S | Medio |
| Intestazione: "Aggiungi esame" più **"⋯"** con Registra un voto, Aggiungi appelli al calendario e Condividi i progressi | 196-208 | 2 | M (`MoreMenu`) | Alto |
| **Un nome solo**, "Aggiungi appelli al calendario", nei 3 punti (testo in `labels.ts`) | vedi sopra | — | S | Medio |
| Scheda dell'esame: restano giorni, nome, data, barra con −/+ e bollino di rischio (come `Tag` con "?"). Programma e "Aggiungi il programma al ripasso" vanno nel **Drawer** dell'esame. I conteggi diventano 3 collegamenti: attività (Attività filtrata per materia), studio (`writeUiState("study.subject", id)` più Studio), argomenti (`study.topicsOpen=true`). "Studia" sceglie già la materia | 489-597 | 1 | S/M | Alto |
| Modulo dell'esame in **Drawer**. Con lo stato "Sostenuto" compare "Registra il voto", che apre `GradeDrawer` per quell'esame al posto dei campi del voto (378-415) | 321-482 | 2 | M | Medio |
| **Date ufficiali:** copertura e "Se un insegnamento non ha date…" (54) vanno nel "?" del titolo; l'avviso sulle fonti (56) diventa una riga dentro "Fonti ufficiali". I 33 pulsanti (68) entrano in un `<details>` "Sfoglia per insegnamento" chiuso, perché il `select` (57) basta. Nuovo filtro "Solo le mie materie", attivo di default (chiave nuova `barbExams.mine`) | BarbExamCalendar.tsx:54-69 | 1–2 | M | Alto |
| Gergo: "precedente ordinamento F92" diventa "vecchio piano di studi (F92)" con il "?"; "voci ufficiali" diventa "iscrizioni"; si toglie "Fonte {codice}" a favore di "Fonte 1, 2" con il nome del corso | BarbExamSessions.tsx | — | S | Medio |

### Aiuto "?"

- **Campo "Preparazione":** "Quanto ti senti pronto, da 0 a 100%. Lo decidi tu: aggiornalo con + e − dopo lo studio. Es.: hai finito metà del programma → 50%."
- **Bollino "Sei indietro":** "Mancano meno di 10 giorni e la preparazione è sotto il 70%." (oppure "meno di 20 giorni e sotto il 55%")
- **Scheda "Date ufficiali":** "Le date d'esame pubblicate dall'università per tutti gli insegnamenti del corso. Non entrano nel tuo calendario finché non le aggiungi. Se un insegnamento non ha date, non vuol dire che non ci siano esami."
- **Campo "Domande frequenti":** "Le domande che il docente fa spesso. Es.: «Descrivi il ciclo di Krebs»."
- **Azione "Aggiungi il programma al ripasso":** "Ogni riga del programma diventa un argomento da ripassare in Studio."

### Stati vuoti

- Le versioni fatte a mano (241-251, 295-304) vanno sostituite con `EmptyState`, con l'azione [Aggiungi esame] e, se c'è il corso di laurea, [Aggiungi appelli al calendario]. **S**

---

## 6. Libretto e laurea (`src/views/CareerView.tsx` + `GradeDrawer.tsx`)

### Inventario sopra la piega

| | Desktop | 375 px |
|---|---|---|
| Azione primaria | "Registra un voto" (55-57) | uguale |
| Controlli | circa 9, più le righe del libretto: corso di laurea (2, a 230-237), prova finale o tesi (`select`), media da usare (`select`), estero (casella), 2–3 link alle fonti | 9. **Su telefono il pannello del voto di laurea viene prima del libretto (106): le righe dei voti partono oltre circa 1300 px** |
| Riquadri statistici | 4 riquadri (61-87), voto previsto, dettaglio dei punti (259-266) | 4 in 2×2 |

### Problemi

- **Effetto collaterale nascosto:** il `Segmented` "Corso di laurea" (230-237) chiama `updatePreferences({ degreeProgram, degreeCfu, showBarb })` (117). Da un pannello di calcolo si cambiano i CFU totali e si mostra o nasconde un'intera sezione della navigazione. La stessa scelta è già in Impostazioni (SettingsView.tsx:311-315).
- **Suggerimenti invisibili su touch:** le spiegazioni dei riquadri stanno solo nel `title` (159).
- **Gergo:**
  - "Media ponderata" e "aritmetica", "Voto di partenza", "Media × 110 / 30" (84), "centodecimi" (85).
  - "Manifesto 2026/27" (265), "commissione" (254, 340).
  - "ID" e "30L" (412), "Idoneità".
- **Contenuto principale in fondo su telefono:** l'elenco dei voti (121-139) viene dopo un pannello di circa 900 px.

### Proposta

| Modifica | Dove va | Passi | Imp. | Valore |
|---|---|---|---|---|
| Al posto del `Segmented`: "Regole di: Biologia applicata… (LM-6) · [Cambia in Impostazioni]" | 230-237 | 2 | S | Alto |
| Su telefono si mostra prima il libretto (`order-*` sulla griglia 106). Il pannello di laurea parte chiuso e mostra solo "Voto previsto 104–106 / 110 · [Vedi il calcolo]"; dentro ci sono dettaglio, ipotesi, note e fonti | 106-140, 239-359 | 1–2 | S/M | Medio-Alto |
| Spiegazioni dei riquadri con `HelpTip` invece del `title` | 157-170 | 1 | S | Medio |
| "ID" diventa "Idon." (con `aria-label` "Idoneità") e "30L" diventa "30 e lode" in un `Tag` | 412 | — | S | Basso |

### Aiuto "?"

- **Riquadro "Media ponderata":** "Gli esami con più CFU contano di più. Es.: 30 in un esame da 12 CFU e 24 in uno da 6 → (30×12 + 24×6) / 18 = 28."
- **Riquadro "Voto di partenza":** "La media ponderata portata su 110. Es.: media 27 → 27 × 110 / 30 = 99."
- **Opzione "Idoneità":** "Esame senza voto: ti dà i CFU ma non entra nella media. Es.: inglese B2."
- **Opzione "Lode":** "Nella media vale 30. In alcuni corsi aggiunge punti al voto di laurea."
- **Campo "Media da usare":** "Puoi includere i voti obiettivo degli esami che devi ancora dare, per vedere dove arriveresti."

### Stati vuoti

Il libretto vuoto (384-398) va bene, ma è fatto a mano: va passato a `EmptyState`. **S**

---

## 7. Corso di laurea (`src/views/BarbView.tsx`)

### Inventario sopra la piega

| | Desktop (scheda Insegnamenti) | 375 px |
|---|---|---|
| Azione primaria | Nessuna nella pagina. Quella vera, "Aggiungi alle mie materie", sta nel piè di pagina del dettaglio (472-505) | uguale |
| Controlli prima delle schede | **circa 16**: 2 in intestazione (148-151; il link contiene un `Button`), 6 schede (132-139), ricerca, 5 semestri, 2 caselle (278-308) | uguale. **Prima scheda a circa 800 px** |
| Riquadri statistici | 4 non cliccabili (160-166: 2 semestri, Insegnamenti, Docenti), una riga di metadati (155-158), pillole "Nelle tue materie" (310-315) | 4 in 2×2 |

### Problemi

- **Testo tecnico per gli studenti:**
  - Riga dei metadati con classe, codice, "A.A." e data di verifica (155-158).
  - "Settore (SSD)" (280, 642); "affidabilità dei dati 87%" e l'URL completo della fonte (746-750).
  - Eventuali conflitti mostrati col **nome interno del campo** (711, oggi nessun dato ne contiene).
  - **Comandi `npm`** (943, 1042).
  - **Firecrawl, `localhost:3002`, docker e percorsi `.cache`** (1027-1045).
  - **Codici HTTP** (988).
- **Riquadri che ripetono le schede:** "Insegnamenti 33" e "Docenti 31" (164-165) ripetono i conteggi delle schede (133, 135). I riquadri dei semestri non filtrano.
- **6 schede:** "Aule e sedi" fa parte dell'orario; "Fonti ufficiali" è un'appendice. La descrizione nella navigazione promette "appelli ufficiali BARB" (AppShell.tsx:44), ma la sezione non ha una scheda per gli appelli (salvo "Appelli condivisi").
- **Elementi ingannevoli:** l'icona "+" sulla scheda (426-430) sembra "aggiungi", ma apre solo il dettaglio.
- **Ordine sbagliato:** "Come iniziare" (316-322) sta *sotto* i filtri.
- **Accessibilità:** `<a><Button/></a>` annidati (148-150, 947, 1092-1095); c'è già `LinkButton` (90).
- **Gergo:** BARB, UNIMI, F92, SSD, "A.A.", "Scelta guidata", "Altre conoscenze", "Gruppo 1/2/3" (35-58), "Ariel" (719), "Edizione" (649).
- **Etichette:** `CHARACTER_LABEL` (35-42) sta fuori da `labels.ts`.

### Proposta

| Modifica | Dove va | Passi | Imp. | Valore |
|---|---|---|---|---|
| **Togliere i contenuti per sviluppatori**: comandi, Firecrawl, HTTP e affidabilità si mostrano solo con `import.meta.env.DEV`, oppure in un `<details>` "Dettagli tecnici" | 943, 988, 1027-1045, 749 | 2 (sviluppatori) | S | Alto |
| Metadati ridotti a "Biologia applicata alla ricerca biomedica · anno accademico 2026/27"; il resto va in "Fonti ufficiali" | 155-158 | 2 | S | Medio |
| Togliere i riquadri Insegnamenti e Docenti. I riquadri dei semestri diventano una riga compatta nella scheda Orario, oppure pulsanti che filtrano gli insegnamenti | 160-166 | 1 | S | Medio |
| Schede: Insegnamenti · Orario e aule (unione di 134 e 136) · Docenti e contatti · (Appelli condivisi). "Fonti ufficiali" diventa il link "Da dove vengono i dati" in fondo. Si aggiunge il link "Date degli appelli" verso Esami › Date ufficiali. I valori di `barb.tab` restano validi (`aule` e `fonti` vengono convertiti) | 132-139 | 1–2 | M | Medio |
| "Come iniziare" sopra i filtri e più evidente quando nessun insegnamento è ancora tra le materie | 316-322 | — | S | Medio |
| Scheda insegnamento: "Da aggiungere" come testo invece dell'icona "+", oppure un vero "Aggiungi" rapido (con `stopPropagation`) | 426-430 | 1 | S | Medio |
| `<a><Button>` sostituiti da `LinkButton` | 148-150, 947, 1092-1095 | — | S | Medio (accessibilità) |
| Filtri: in vista restano ricerca, "Solo le mie materie" e semestre; "Nascondi i non attivi" va in "Altri filtri" | 297-306 | 2 | S | Basso |

### Aiuto "?"

- **Etichetta "Settore (SSD)":** "Il codice della disciplina usato dall'università. Es.: BIO/10 è Biochimica."
- **Titoli "Gruppo 1, 2, 3":** "Da ogni gruppo scegli il numero di insegnamenti indicato. Es.: dal Gruppo 2 ne scegli 2, per 12 CFU."
- **Etichetta "Vecchio piano (F92)":** "Insegnamenti del piano di studi degli anni passati. Ti servono solo se devi ancora sostenere un esame del vecchio piano."
- **Link "Ariel":** "La piattaforma UniMi con i materiali del corso."

---

## 8. Materiali (`src/views/MaterialsView.tsx`)

### Inventario sopra la piega

| | Desktop | 375 px |
|---|---|---|
| Azione primaria | "Carica un file": un `<label>` con stile primario (366-368). Accanto, il modulo del link (380-394) | in colonna, circa 4 righe |
| Controlli | **circa 14**: Condividi, Carica, URL, nome, "Salva un link", ricerca, tipi (fino a 7), materia (`select`) | 14. **Prima scheda a circa 650 px** |
| Controlli per scheda | 4: nome, apri o scarica, modifica, elimina (189-241) | 4 |

### Problemi

- **Due moduli di aggiunta sempre aperti** (file e link) e un pulsante grezzo (387-393).
- **Pillole informative che sembrano filtri:** la materia collegata (198) e i `#tag` (199-201).
- **Filtro per materia poco chiaro:**
  - Prende solo i materiali collegati direttamente alla materia (60), non quelli collegati a un suo esame o a una sua attività.
  - L'elenco mostra anche le materie archiviate (163).
- **Modifica** in una modale fatta a mano (271-346).
- **Stato vuoto** senza azione (267).

### Proposta

| Modifica | Dove va | Passi | Imp. | Valore |
|---|---|---|---|---|
| Azione primaria "Carica un file" con `Button`. Il link si apre con "oppure **salva un link**" sotto, un pulsante che apre il campo dell'indirizzo; il nome resta facoltativo | 353-397 | 1–2 | S | Medio |
| Pillola della materia come pulsante che applica il filtro; `#tag` come pulsante che lo mette nella ricerca | 198-201 | 1 | S | Medio |
| Modifica in `Drawer` | 271-346 | — | M | Medio |
| Filtro per materia esteso ai materiali dei suoi esami, attività ed eventi, oppure "?" che spiega il limite | 60 | — | M (S il "?") | Basso |

### Aiuto "?"

- **Campo "Materia":** "Collegalo a una materia e lo ritrovi anche nella sua scheda. Es.: le slide di Anatomia."
- **Campo "Etichette":** "Parole per ritrovarlo con la ricerca. Es.: «orale», «formulario»."

### Stati vuoti

- `EmptyState` con l'azione [Carica un file]. **S**

---

## 9. Obiettivi (`src/views/GoalsView.tsx`)

È già la sezione più leggera: intestazione con 1 controllo, barra con 3 (97-134), 3 controlli per scheda; la prima scheda è a circa 400 px su telefono.

### Problemi

- Stato vuoto senza azione: rimanda al "campo qui sopra" (62-66).
- Pulsante grezzo (125-131).
- La categoria è obbligatoria prima di creare (113-124), ma è un dettaglio che si può decidere dopo.
- La regola "ogni + o − sposta del 5%" sta nel sottotitolo (49) invece che vicino ai pulsanti.

### Proposta

- Barra con solo titolo e "Crea obiettivo" (`Button`); la categoria va nel dettaglio, con "Studio" come valore iniziale. **S**, valore Basso.
- `EmptyState` con l'azione [Crea il primo obiettivo], che porta il focus nel campo. **S**
- Il sottotitolo diventa "Fissa i tuoi traguardi e segna a che punto sei."; la regola del 5% va nel "?".

### Aiuto "?"

- **Pulsanti + e −:** "Ogni tocco sposta il progresso del 5%. Al 100% l'obiettivo è raggiunto."
- **Campo "Come lo misuri":** "Es.: ore a settimana, capitoli, esercizi."

---

## 10. Statistiche (`src/views/StatsView.tsx`)

Nessun elemento cliccabile: 4 riquadri (56-70, 76-89), 2 grafici, l'elenco delle preparazioni (119-141), "Da tenere d'occhio" (177-185). Su telefono si legge bene, ma ogni numero è un vicolo cieco.

### Problemi

- **Avvisi senza azione:** "Attività in ritardo, bloccate, rimandate" (180-182) segnalano un problema ma non portano dove risolverlo.
- **Un dato fuori posto:** "Sessioni di studio salvate" (183) non è un avviso, eppure sta in "Da tenere d'occhio".
- **Dati ripetuti altrove:**
  - "Questa settimana" (57) è uguale a Studio (StudyView.tsx:274-283).
  - "Preparazione esami" (119-141) ripete le schede di Esami e la vista Esami del Calendario.
- **Primo accesso:** 4 pannelli vuoti, ognuno con la sua frase (115, 139, 173).

### Proposta

| Modifica | Dove va | Passi | Imp. | Valore |
|---|---|---|---|---|
| Riquadri e avvisi come collegamenti: "Questa settimana" porta a Studio; "Attività fatte" ad Attività; "Ripassi fatti" a Studio con gli argomenti aperti (`study.topicsOpen`); "in ritardo" ad Attività filtrata (`tasks.filter`); "bloccate" e "rimandate" ad Attività nella vista "Per stato" (`tasks.mode=kanban`) | 56-70, 177-185 | 1 | S | Alto |
| Righe di preparazione cliccabili verso l'esame; legenda "Ore per materia" cliccabile verso la materia (`subjects.open`) | 126-135, 160-168 | 1 | S | Medio |
| "Sessioni di studio salvate" spostato tra i riquadri | 183 | — | S | Basso |
| Primo accesso: un solo `EmptyState` ("Le statistiche si riempiono quando usi il timer o completi attività") con [Vai a Studio] | 72-187 | — | S | Medio |

### Aiuto "?"

- **Riquadro "Giorni di fila":** "Giorni consecutivi con almeno una sessione di studio salvata. Es.: hai studiato lunedì, martedì e mercoledì → 3."
- **Riquadro "Attività fatte":** "Percentuale delle attività completate su tutte quelle non archiviate."

---

## 11. Gruppi (`src/views/GroupsView.tsx`) — ⚠ dopo people-push

### Inventario

- Intestazione con 2 azioni: "Aggiorna" (152-154) e "Nuovo gruppo" (158).
- Possibili avvisi: account (173-180), invito in sospeso (182), inviti ricevuti (190-199).
- Schede dei gruppi con 2 controlli ciascuna (285-315).
- Riquadro "Entra con un codice" **sempre visibile** (235-256).

### Problemi

- "Entra con un codice" compare due volte quando non ci sono gruppi: un pulsante che sposta il focus (213-215) e il riquadro (235-256).
- "Aggiorna" è un concetto tecnico, da sincronizzazione.
- Gli inviti sono in tre posti: Gruppi, la scheda Inviti di Condivisione e le Notifiche che arriveranno con people-push.
- `CreateGroupModal` (379) e `ResourceModal` (811) sono modali fatte a mano.

### Proposta (dopo il merge)

- Con almeno un gruppo, "Entra con un codice" va nel menu "⋯" dell'intestazione insieme ad "Aggiorna". **S**
- Inviti riuniti nelle Notifiche, con un collegamento da qui. **M**
- Modali in `Drawer`. **M**
- **"?" sul titolo:** "Gruppo: una bacheca comune dove tu e i compagni condividete file, link e appunti. Per mostrare a una persona il tuo calendario o le tue attività usa invece «Condivisione»."

---

## 12. Condivisione (`src/views/SharingView.tsx`) — ⚠ dopo people-push

### Inventario

- Intestazione con "Aggiorna" e "Condividi" (186-189); "Condividi" ha il calendario già scelto (189).
- 4 schede (260-270), con i contenuti delle schede.

### Problemi

- **Messaggio tecnico per gli studenti:** "…eseguire supabase/sharing.sql nel SQL Editor di Supabase" (236).
- "Condividi" da questa pagina sceglie già il calendario (189, 314, 365), mentre qui l'utente si aspetta di scegliere cosa condividere.
- "Modifiche di altri" (labels.ts:309) non spiega che si possono annullare.

### Proposta (dopo il merge)

- Messaggio per gli studenti: "La condivisione non è ancora attiva su questo server. Riprova più tardi." I dettagli tecnici vanno in un `<details>` "Per chi gestisce l'app". **S**
- `ShareButton` senza sezione già scelta su questa pagina. **S**
- **"?" sulla scheda "Modifiche di altri":** "Le modifiche fatte ai tuoi dati da chi ha «Può modificare». Puoi riportare ogni elemento com'era prima. Es.: Giulia ha spostato la tua lezione: tocca «Ripristina»."

---

## 4. Modelli da rendere uguali in tutte le sezioni

### 4.1 Intestazione di pagina con una sola azione primaria e "Altre azioni"

Oggi le intestazioni contengono:

| Sezione | Azioni (riferimento) |
|---|---|
| Calendario | 6 (CalendarView.tsx:389-421) |
| Esami | 4 (ExamsView.tsx:196-208) |
| Corso di laurea | 2 (BarbView.tsx:146-153) |
| Gruppi | 2 (GroupsView.tsx:147-164) |
| Condivisione | 2 (SharingView.tsx:183-192) |
| Attività | 2 (TasksView.tsx:105-114) |
| Materie | 1 (SubjectsView.tsx:137-145) |
| Studio, Materiali, Obiettivi | solo "Condividi" (StudyView.tsx:115, MaterialsView.tsx:120, GoalsView.tsx:50) |

Proposta:

- **Nuovo componente `PageActions`** in `ui.tsx`: `primary?: ReactNode` più `more: {label, icon, onSelect, help?}[]`.
- Su desktop "⋯" apre un piccolo popover; su telefono un `Drawer` dal basso, già pronto.
- `ShareButton` entra come voce del menu: serve un hook `useShareDrawer(scopes)` che mantenga il caricamento differito e l'errore (ShareButton.tsx:19-48). **M**
- La barra globale "Aggiungi" (AppShell.tsx:276-283) è color accento come la primaria della pagina: due pulsanti primari nella stessa schermata. Proposta: variante `soft` sulle sezioni che hanno già una primaria per creare (Calendario, Attività, Esami, Materie, Gruppi). **S**, valore Medio.

### 4.2 Un solo componente per filtri a pillole

Oggi ci sono 4 versioni diverse:

- pillole semestre (SubjectsView.tsx:159-161);
- tipi di sessione con `role=radio` (StudyView.tsx:160-175);
- persone che condividono (CalendarView.tsx:448-467);
- `Segmented` ovunque altrove.

Proposta:

- `Segmented` per la scelta singola.
- **Nuovo `ChipToggle` / `ChipGroup`** per la scelta multipla (persone), con `aria-pressed` e il conteggio.
- Una **pillola di filtro attivo** ("In ritardo ×", "Solo: Biochimica ×") uguale in Attività, Calendario e Materiali. **S/M**

### 4.3 Informativo o cliccabile: una regola sola

**Regola:** un riquadro o una pillola con bordo o sfondo da scheda è cliccabile se porta a un elenco filtrato o a un dettaglio. Altrimenti diventa testo semplice, senza aspetto da scheda.

Il trasporto esiste già: `writeUiState(key, value, scope)` più `setActiveView(view)` (CalendarView.tsx:411-412; NotificationsPanel.tsx:33).

| Elemento informativo (riferimento) | Diventa | Chiave |
|---|---|---|
| Schede "Per materia" (CalendarView.tsx:2271) | filtro del calendario / apri materia | `calendar.subject` (nuova) / `subjects.open` |
| Schede "Esami" e pillola d'esame (CalendarView.tsx:2218, 1129) | apri esame | `exams.editing` (nuova) |
| Riquadri "In ritardo" e "Urgenti" (TasksView.tsx:132-142) | filtro | `tasks.filter` (nuova) |
| "Prossimi ripassi" (StudyView.tsx:295-301) | apri argomento | `study.topicsOpen` |
| "Sessioni recenti" (StudyView.tsx:242-261) | modifica la sessione | — (Drawer locale) |
| "Questa settimana" (StudyView.tsx:274-283; StatsView.tsx:57) | Statistiche / Studio | — |
| Pillola d'esame e numero di appelli nella scheda materia (SubjectsView.tsx:307, 329-334) | apri esame / scheda Appelli | `exams.editing`, `subjects.drawerTab` (nuova) |
| Attività e "Esame tra" nel dettaglio materia (SubjectsView.tsx:654-659, 491) | apri attività / esame | `tasks.editing`, `exams.editing` |
| Conteggi della scheda esame (ExamsView.tsx:568-570) | Attività, Studio, argomenti | `tasks.filter`, `study.subject`, `study.topicsOpen` |
| Avvisi e righe di Statistiche (StatsView.tsx:126-135, 160-168, 180-183) | Attività, Esami, Materie | `tasks.filter`, `tasks.mode`, `subjects.open` |
| Riquadri del Corso di laurea (BarbView.tsx:160-166) e "Nelle tue materie" (310-315) | filtro semestre / "Solo le mie" | `barb.semester`, `barb.myPlanOnly` |
| Pillola materia e `#tag` dei materiali (MaterialsView.tsx:198-201) | filtro / ricerca | `materials.subject`, `materials.query` |

Elementi **cliccabili che sembrano solo informativi**, da sistemare:

- I riquadri dei semestri in Materie (SubjectsView.tsx:150-158) sono filtri con l'aspetto di statistiche.
- Il "+" sulla scheda insegnamento (BarbView.tsx:426-430) sembra "aggiungi" ma apre il dettaglio.

### 4.4 Aiuto contestuale "?"

Oggi molte spiegazioni sono solo nel `title`, che **su touch non si vede**:

- opzioni delle viste (CalendarView.tsx:136-144; TasksView.tsx:151-157);
- riquadri del Libretto (CareerView.tsx:159);
- bollino di rischio (ExamsView.tsx:542);
- riquadri dei semestri (BarbView.tsx:185);
- pillole del mese e del Calendario.

Proposta:

- **Nuovo componente `HelpTip`** in `ui.tsx`: pulsante "?" di 24 px con area di tocco di 44 px (lo schema `after:-inset-*` è già usato) e un popover che si apre al tocco, si chiude con Esc o con un tocco fuori e ha `aria-describedby`.
- Testi in **`labels.ts` → `HELP_TEXT`**, raggruppati per sezione, nella forma "frase semplice + Es.: …". Tutti i testi delle sezioni precedenti sono pronti da copiare.
- **M**

### 4.5 Stati vuoti

Oggi convivono `EmptyState` e versioni fatte a mano:

| File | Righe |
|---|---|
| TasksView.tsx | 118-129, 685 |
| ExamsView.tsx | 241-251, 295-304 |
| CareerView.tsx | 386-397 |
| StudyView.tsx | 265-267, 424-428 |
| StatsView.tsx | 115, 139, 173 |
| GroupsView.tsx | 202-219 ⚠ |

Quelli senza azione: GoalsView.tsx:62-66, MaterialsView.tsx:267.

**Regola:** sempre `EmptyState`, sempre con un'azione e con un esempio nel testo. **S** per ciascuno.

### 4.6 Drawer per dettagli e modifiche

Modali centrate fatte a mano, senza blocco del focus e con un Esc che funziona solo se il focus è dentro:

- CalendarView `ModalShell` (1577-1603), che serve sia la modifica sia la creazione di eventi;
- TaskModal.tsx:74-86;
- TaskEditorModal.tsx:147-156;
- ExamsView.tsx:322-482;
- MaterialsView.tsx:272-346;
- GroupsView.tsx:379, 811 ⚠.

In `Drawer` invece: SubjectDrawer, GoalDrawer, ManualSessionDrawer, GradeDrawer, BarbExamImport, CourseDrawer, i dettagli degli appelli, l'anteprima di import .ics.

Proposta:

- Spostare tutte le modali in `Drawer`, con la conferma "Hai modifiche non salvate" su Esc o tocco fuori. È lo schema `dismissOutside` già presente in ui.tsx:341.
- **L** in totale, **M** per ciascuna.

### 4.7 Azioni per riga e conferme

**Azioni per riga.** Le icone che compaiono al passaggio del mouse, e su touch restano sempre visibili, sono in:

- TasksView.tsx:370-378, 606-635;
- StudyView.tsx:253-260;
- MaterialsView.tsx:228-241;
- SubjectsView.tsx:338-359.

Proposta: **menu di riga "⋯"** con Modifica, Stato ed Elimina. Restano visibili solo la spunta e il titolo.

**Conferme.** Oggi convivono `window.confirm` (quasi ovunque), `InlineConfirm` (SubjectsView.tsx:363) e "Annulla" a tempo (SubjectsView.tsx:164-174).

Regola proposta:

- Azioni reversibili (archiviare, cambiare stato): subito, con "Annulla".
- Azioni irreversibili: `InlineConfirm` o `ConfirmWithError`.
- Eliminare `window.confirm` un po' alla volta.

**M**

### 4.8 Un solo modulo per creare un'attività

Oggi i moduli sono 4, con campi e scadenze diversi:

- `TaskModal`: data, scadenza alle 18:00;
- `QuickTaskBar`: data, 18:00 (TasksView.tsx:218);
- `CreateModal` "Attività con scadenza": data e ora (CalendarView.tsx:2094-2105);
- `QuickAddModal`.

Proposta:

- Un `TaskForm` condiviso, con titolo, scadenza e materia in vista e "Altre opzioni" per il resto.
- Il Calendario passa la data e l'ora già scelte.
- **L**

### 4.9 Conformità alle regole del progetto (trovate nell'audit)

- **Etichette fuori da `labels.ts`:**
  - TasksView.tsx:22-28 (`statuses`), 679 ("Senza materia");
  - TaskEditorModal.tsx:236-238 (energia);
  - BarbExamSessions.tsx:16, 102 (tipi di prova, stati);
  - BarbView.tsx:35-58 (`CHARACTER_LABEL`, `PLAN_GROUPS`);
  - StudyTimerWatcher.tsx:15-19, lib/review.ts:11-16.
- **Griglie senza `grid-cols-*`:** CalendarView.tsx:1335 (`sm:grid`), BarbExamSessions.tsx:105. Quelle a CalendarView.tsx:846 e 904 hanno le colonne nello stile in linea, quindi vanno bene.
- **Pulsanti primari grezzi da sostituire con `Button`:** SubjectsView.tsx:248-254, GoalsView.tsx:125-131, MaterialsView.tsx:366-368, 387-393, TopicManager.tsx:143-149, 183-199, e "Oggi" (CalendarView.tsx:431-437).
- **Varianti sbagliate:** `danger` per un'azione reversibile (SubjectsView.tsx:457), mentre lo stesso caso è `soft` in GoalsView.tsx:229. Chiusura con testo (TaskEditorModal.tsx:162) invece di `IconButton X`.
- `text-[var(--accent)]` sul testo, animazioni non `m.`: **nessuna violazione** nelle sezioni analizzate.

---

## 5. Ingressi ripetuti tra le sezioni

| Funzione | Ingressi oggi | Proposta |
|---|---|---|
| Aggiungere appelli ufficiali al calendario | Calendario "Aggiungi appelli ufficiali" (CalendarView.tsx:402) · Esami "Importa appelli ufficiali" (ExamsView.tsx:199) · Date ufficiali "Aggiungi al mio calendario" (BarbExamCalendar.tsx:53) | Un nome solo. Primaria solo in Date ufficiali; altrove nel menu "⋯" |
| Vedere le date ufficiali | Calendario "Vedi appelli ufficiali" (CalendarView.tsx:406-416) · Esami › Date ufficiali (ExamsView.tsx:87) · Corso di laurea › dettaglio › "Esame e materiali" (BarbView.tsx:630) · Materie › dettaglio (SubjectsView.tsx:496) · numero sulla scheda materia (SubjectsView.tsx:307) · Corso di laurea "Appelli condivisi" (BarbView.tsx:138) | Riferimento unico: Esami › Date ufficiali. Gli altri diventano collegamenti lì, con l'insegnamento già filtrato (`barbExams.course`) |
| Registrare un voto | Esami in intestazione (ExamsView.tsx:200), modulo dell'esame "Sostenuto" (378-415), "Registra l'esito" (265), Libretto in intestazione (CareerView.tsx:55), Libretto vuoto (394), "Aggiungi voto" (132) | Sempre `GradeDrawer`; nel modulo dell'esame un pulsante che lo apre |
| Creare un'attività | barra "Aggiungi" (AppShell.tsx:276), "Nuova attività" (TasksView.tsx:108), Aggiunta rapida (144), Calendario "Attività con scadenza" (CalendarView.tsx:2056) | Un solo `TaskForm` (§4.8) |
| Creare una materia | barra "Aggiungi", barra in Materie, "Scegli dal corso di laurea", Corso di laurea "Aggiungi alle mie materie", GradeDrawer "+ Materia non in elenco" | Vanno bene tutti (contesti diversi); "Scegli dal corso di laurea" in primo piano |
| Caricare un materiale | barra "Aggiungi", Materiali, dettaglio materia "Carica un file" (SubjectsView.tsx:561) | Vanno bene; nel dettaglio materia sotto la scheda "Materiali" |
| Argomenti da ripassare | Studio "Gestisci argomenti" (StudyView.tsx:368), dettaglio materia (SubjectsView.tsx:669), Esami "Aggiungi il programma al ripasso" (ExamsView.tsx:585) | Vanno bene; il "?" spiega il legame |
| Ore della settimana | Studio (StudyView.tsx:274-283), Statistiche (StatsView.tsx:57), Home | In Studio come collegamento a Statistiche |
| Preparazione agli esami | schede Esami, Calendario › Esami (CalendarView.tsx:2193), Statistiche (StatsView.tsx:119-141), Home | Riepiloghi cliccabili verso l'esame |
| Materie per semestre | Materie (SubjectsView.tsx:150-161), Calendario › Per materia (CalendarView.tsx:2250), Corso di laurea "Nelle tue materie" (BarbView.tsx:310-315) | Calendario: diventa un filtro; Corso di laurea: pillole cliccabili |
| Condividi | 9 punti: Calendario, Attività, Studio, Esami, Materiali, Obiettivi, Corso di laurea, Condivisione e il suo stato vuoto | Nel menu "⋯" (§4.1) |
| Corso di laurea (regole del voto) | Impostazioni (SettingsView.tsx:311-315), Libretto (CareerView.tsx:230-237, con effetto collaterale) | Solo Impostazioni; nel Libretto testo in sola lettura più collegamento |
| Inviti | Gruppi "Inviti ricevuti" (GroupsView.tsx:190-199), Condivisione › Inviti, Notifiche | ⚠ dopo people-push: riunirli nelle Notifiche |
| Aggiorna | Gruppi (GroupsView.tsx:152), Condivisione (SharingView.tsx:186) | ⚠ nel menu "⋯", o aggiornamento automatico |

---

## 6. Rischi e vincoli

- **⚠ GroupsView.tsx e SharingView.tsx** sono modificati sul ramo `claude/people-push-6582b6` (design: docs/plans/2026-11-11-people-search-push-design.md). Tutte le modifiche alle sezioni 11–12 e le voci con ⚠ in §4 e §5 vanno fatte **dopo il merge di people-push**. Lo stesso vale per `ShareButton` e `ShareDrawer`, se il ramo li tocca: verificare prima di §4.1.
- **Chiavi `useUiState`:** nessuna si rinomina.
  - Le nuove si aggiungono: `calendar.subject`, `tasks.filter`, `exams.editing`, `subjects.drawerTab`, `barbExams.mine`, e una per il suggerimento del calendario vuoto.
  - Togliendo opzioni dalle viste, i validatori (`calendar.mode` a CalendarView.tsx:200, `tasks.mode` a TasksView.tsx:66, `barb.tab` a BarbView.tsx:105) devono continuare ad accettare i valori vecchi e convertirli.
  - Ogni nuova chiave passa da un validatore e da `APP_VIEWS`, se serve (GOTCHAS).
- **Collegamenti tra sezioni:** gli id letti da `writeUiState` vanno ignorati se l'elemento è sparito (regola già presente in GOTCHAS). `exams.editing` richiede che ExamsView passi da `useState` (95) a `useUiState`.
- **Drawer sovrapposti:** aprire `TaskEditor` dal dettaglio materia crea due Drawer uno sopra l'altro. La pila `openDrawers` (ui.tsx:321) lo gestisce; da verificare il focus al ritorno.
- **Passaggio da modale a Drawer:** su telefono il Drawer è un foglio alto al massimo il 92% dello schermo (ui.tsx:414). Nei moduli lunghi (attività, esame) i pulsanti vanno nel `footer`, altrimenti finiscono sotto la piega. Le bozze non salvate degli eventi altrui (CalendarView.tsx:224, 550-552) vanno protette alla chiusura.
- **CalendarTransfer in un menu:** l'import usa un `<label>` con un `input file` (CalendarTransfer.tsx:118-134). Nel menu serve un `ref.click()`; il messaggio di esito è `fixed` in basso (148-157) e non deve finire sotto il foglio.
- **Test:** i test in `tests/` sono di logica e non coprono l'interfaccia (non dipendono dalle etichette). Dopo ogni modifica serve una verifica manuale a 375, 768, 1024, 1280 e 1440 px, nei temi chiaro e scuro, al primo accesso (dati vuoti) e con dati. Per ogni passo usare `verify-change`.
- **Regole da rispettare:**
  - testi nuovi (help, nomi unificati) solo in `labels.ts`;
  - "Attività", mai "task";
  - "Corso di laurea", "appelli ufficiali";
  - griglie nuove con `grid-cols-*`;
  - testo in accento con `var(--accent-ink)`;
  - popover di `HelpTip` e `PageActions` animati solo con `m.` dentro `LazyMotion`.
