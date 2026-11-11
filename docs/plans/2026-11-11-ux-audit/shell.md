# Audit UX — shell e prime schermate (StudyOS)

Ambito: `AppShell`, Home (`DashboardView`), Impostazioni (`SettingsView` + `CloudPanel` + `AgentDesk`),
`QuickAddModal`, `NotificationsPanel`/`NotificationsBell`, `GlobalSearch`, `LockScreen`, `CloudStatusBadge`,
`ui.tsx`, `labels.ts`. Worktree `sharing`, commit `034a91d`.

Metodo: sola lettura del codice. Nessuna esecuzione dell'app: i conteggi "sopra la piega" sono **stime dal
markup** per 1440×900 (barra laterale completa, `xl`) e 375×812 (barra in basso), per un **utente nuovo**:
nessun dato, nessun account, senza password dell'app, cloud configurato, `showBarb` al valore predefinito
(`true`, `src/data/defaults.ts:75`). Da confermare con screenshot prima di implementare.

Obiettivo dell'utente: *ridurre la complessità percepita, non quella funzionale*.

---

## 0. In breve

1. La shell espone **14 voci** di navigazione (13 senza BARB) più 7 controlli di contorno: su desktop un
   utente nuovo vede ~**35 controlli** sopra la piega della Home, ~**76** in Impostazioni.
2. La Home di un utente nuovo mostra **12 inviti ad "aggiungere"** (4 passi della guida, 7 stati vuoti,
   "Aggiungi" in alto), 4 numeri a zero e 7 riquadri vuoti: la guida non è l'unica cosa in primo piano.
3. Impostazioni è **una sola pagina lunga con 7 categorie e ~55 controlli**, dove convivono il nome
   dell'utente e i comandi `node --import … --stdio`, **4 password diverse** e i pulsanti di
   sincronizzazione forzata.
4. Tutto il testo è `font-bold`/`extrabold`/`black` (zero `font-medium`/`normal` nei file principali): senza
   contrasto di peso la gerarchia si appiattisce e "tutto grida".
5. Lo stesso aspetto vuol dire cose diverse: `Pill` di stato identica a un pulsante selezionato, righe
   della Home a volte cliccabili a volte no, `Sparkles` usata per logo, sync e Agenti AI, `Shield` mostrato
   quando i dati **non** sono protetti.
6. Primo avvio: il passo 1 della guida porta **tutti** al Corso di laurea BARB (default `showBarb: true`),
   anche chi studia Scienze biologiche.
7. Quasi tutta la proposta P0 si fa **senza toccare i file caldi** (`ui.tsx`, `DashboardView`, `AgentDesk`,
   `QuickAddModal`, `GlobalSearch`, `Notifications*`, `CloudStatusBadge`, `LockScreen`). Navigazione,
   Impostazioni, `CloudPanel` e i testi in `labels.ts` sono **da fare dopo il merge di people-push**.

---

## 1. Inventario per schermata

| Schermata (utente nuovo) | Sopra la piega 1440×900 | Sopra la piega 375×812 | Totale nella schermata | Blocchi |
|---|---|---|---|---|
| Shell (sempre presente) | 21 | 10 | — | — |
| Home | ~35 (21 + 14) | ~15 (10 + 5) | ~45 desktop | guida + 4 numeri + 7 riquadri |
| Impostazioni | ~34 (21 + 7 chip + 6 profilo) | ~16 | ~76 (21 + 55) | 7 categorie in una pagina |
| Foglio "Altro" (mobile) | — | 11 + chiudi | 11 | 3 gruppi |
| Aggiungi (tipo Attività) | 14 | 14 (con scroll) | 14 | — |
| Notifiche | 2 + 3 per notifica | idem | 3n + 2 | — |
| Agenti AI (dentro Impostazioni) | — | — | 14–16 + 2 chip di stato | 6 blocchi |
| Account non connesso (`CloudPanel`) | — | — | 5 + 3 avvisi | — |

### Shell — `src/components/AppShell.tsx`
- Barra laterale ≥1280 px: pulsante logo (`:192`), 13 voci in 3 gruppi + Impostazioni (`:28-59`, `:209-219`),
  riquadro "I tuoi dati" (`:221-231`), `Blocca StudyOS` se c'è la password (`:232-242`), `CloudStatusBadge`
  (`:243`). **16 controlli.**
- Barra compatta 640–1279 px: le stesse 14 voci a icone in 92 px (`:163-189`) + lucchetto + badge: 17
  controlli impilati, ridotti a 42 px sotto gli 800 px di altezza (`:126`).
- Barra in alto: ricerca (`:252`), data "Oggi" da `lg` (`:254-257`), tema (`:258-262`), campanella (`:263`),
  avatar → Profilo (`:264-276`), `Aggiungi` primario (`:277-285`). **5 controlli.**
- 375 px: ricerca + tema + campanella + avatar in alto (alla ricerca restano ~180 px), barra in basso con 4
  voci + "Altro" (`:344-378`), pulsante "+" fisso (`:334-342`). **10 controlli.**
- Cosa compete: la voce attiva (fondo accento), il logo (fondo accento), `Aggiungi` (accento + ombra +
  ingrandimento al passaggio), il badge **giallo di avviso** "Salvato solo qui" per chi non ha account,
  la campanella che oscilla **all'infinito** con notifiche non lette (`NotificationsBell.tsx:34`), il
  link "WebNovis" nel piè di pagina di ogni sezione (`:318-330`).
- Sopra il contenuto possono comparire due avvisi (`persistError` `:289-300`, `shareNotice` `:304-314`);
  people-push ne aggiunge altri due (`PeopleNotice`, `PushPrompt`).

### Home — `src/views/DashboardView.tsx`
- Titolo + "Inizia a studiare" (`:133-141`), guida "Per iniziare" con 4 passi + "Nascondi la guida"
  (`:143-147`, `:480-593`), 4 riquadri numerici cliccabili (`:149-176`), poi 7 riquadri: Oggi, Cosa fare
  adesso, Esami in arrivo, Le tue materie, Prossimi giorni, Obiettivi, Ultimi materiali (`:181-459`).
- Utente nuovo, desktop: 21 controlli di shell + 1 + 5 (guida) + 4 (numeri) + ~4 dei riquadri visibili
  ≈ **35**. Nella pagina intera: **24 controlli di contenuto**, di cui 12 "aggiungi" e 9 che portano a
  sezioni già presenti nella barra laterale ("Apri calendario" compare due volte, `:182` e `:380`).
- 375 px: il titolo, il pulsante a tutta larghezza e la guida (una colonna, ~110 px a passo) riempiono lo
  schermo: si vedono 2–3 passi. I numeri e i riquadri sono tutti sotto la piega.
- I 4 numeri di un utente nuovo valgono "0 h su 10 h", "0 giorni", "0%", "—": rumore al primo avvio.
- La data compare due volte su desktop: barra in alto (`AppShell.tsx:254-257`) e sottotitolo della Home (`:135`).

### Impostazioni — `src/views/SettingsView.tsx` (una pagina, non schede)
- Fila di 7 chip che scorrono alla categoria (`:240-252`): non resta fissa, non segna dove sei e a 375 px
  scorre in orizzontale senza sfumatura (il `Segmented` di `ui.tsx` invece ce l'ha).
- Controlli per categoria (senza account, senza password dell'app): Profilo 6 (`:255-348`), Aspetto 12
  (3 temi + 7 palette + 2 menu, `:350-414`), Account 5 (`CloudPanel`), Privacy 3 (`:421-497`), Copia di
  sicurezza 7–8 (`:499-575`), Agenti AI 14–16 (`AgentDesk.tsx:126-309`), Dati 1 (`:588-612`). **≈55.**
- I nuovi campi di people-push (`@nome`, "Gli altri possono trovarmi", "Notifiche su questo dispositivo")
  finiscono in Profilo e lo rendono ancora più denso.

### Account — `src/components/CloudPanel.tsx`
- Doppia intestazione: "Account" fuori dal riquadro (`SettingsView.tsx:417`), poi "Accedi o crea un
  account" in `text-2xl` dentro (`:245`). È l'unica categoria con l'intestazione fuori dal `Panel`.
- Senza account: **3 avvisi** sulla stessa schermata — nota sulla cifratura (`:251-253`), riquadro giallo
  "Per ora i tuoi dati sono solo in questo browser" (`:315-317`), pill "Non connesso" (`:255`).
- Con account: email, conferma, ultima sincronizzazione, "Modifiche da inviare: 0 · Aggiornamento in tempo
  reale: attivo" (`:262-271`), "Sincronizza ora" con icona `Sparkles`, "Esci", "Altre opzioni" (`:285-311`).

### Agenti AI — `src/components/AgentDesk.tsx`
- Sempre aperto per tutti: 2 chip di stato (`:153-160`), chiave + "Collega" (`:165-187`), indirizzo MCP
  (`:193-198`), matrice di permessi 3×3 = 9 pulsanti (`:207-229`), "15 minuti" (`:230-235`), "Revoca"
  (`:240-247`), elenco azioni (`:249-265`), "Istruzioni tecniche" con `npm run …`, `node --import …`,
  `localhost` (`:267-306`).
- Chi non ha mai collegato un assistente vede comunque "Collegamento non raggiungibile" o "Controllo in
  corso…" e "Questo browser non è collegato": sembra un errore.
- La richiesta di conferma che compare in tutta l'app (`AgentDock`) mostra gli argomenti in **JSON grezzo**
  (`:42-46`, `:77-79`).

### Aggiungi — `src/components/QuickAddModal.tsx`
- 5 tipi (`:16-22`) + per Attività 3 modi "Da fare / Inizio ora / Già fatta" (`:207-235`) + nome, data,
  materia, minuti (`:251-319`) + chiudi, Annulla, Crea = **14 controlli** per "aggiunta rapida".
- Materiale: due strade nello stesso modulo (link `:237-249` e file `:321-346`), con "Salva link" come
  pulsante anche quando si vuole caricare un file.

### Notifiche — `NotificationsPanel.tsx`, `NotificationsBell.tsx`
- Ogni notifica ha fino a 3 pulsanti con tre stili diversi: "Apri" con fondo, "Segna come letta" senza fondo,
  "Elimina" rosso (`NotificationsPanel.tsx:68-95`). 10 notifiche = 30 pulsanti.

### Ricerca — `GlobalSearch.tsx`
- Cerca solo nei contenuti: "copia di sicurezza", "password", "tema" o "agenti" non danno risultati, quindi
  non aiuta a capire **dove sono le cose**.
- Un risultato apre la sezione, non l'elemento (`:330-335`).
- Segnaposto lungo (`:373`), troncato a 375 px; suggerimento "↑ ↓ … Invio" mostrato anche al tocco (`:404`).

### Blocco — `LockScreen.tsx`
- Nessuna via d'uscita se si dimentica la password (cosa fare: copia di sicurezza, account, cancellazione);
  il pulsante "Apri StudyOS" ha l'icona `Lock` (`:62`); `min-h-screen` invece di `dvh` (`:34`, GOTCHAS:50).

---

## 2. Problemi concreti

### 2.1 Gerarchia
- **Due primari nella stessa schermata.** `Aggiungi` della barra in alto (`AppShell.tsx:277-285`) è sempre
  primario; in Attività c'è anche "Nuova attività" primario (`TasksView.tsx:108`), in Calendario "Nuovo
  evento" (`CalendarView.tsx:393`), in Esami "Aggiungi esame" (`ExamsView.tsx:203`). Due bottoni color
  accento affiancati, e aprono **moduli diversi** per lo stesso oggetto (aggiunta rapida contro editor completo).
- **Titoli tutti uguali su mobile.** Titolo di pagina `SectionTitle` h2 `text-2xl` sotto `md`
  (`ui.tsx:84`); titolo di categoria `SettingHeader` h3 sempre `text-2xl` (`SettingsView.tsx:633`); titolo
  di `CloudPanel` `text-2xl` (`:245`). A 375 px pagina, categoria e sotto-riquadro hanno la stessa dimensione.
- **Peso del carattere piatto.** Conteggio: AppShell 10 `black` / 5 `bold`, Dashboard 24 / 15, Settings 10 / 6,
  CloudPanel 7 / 7, AgentDesk 17 / 15; **0** `font-medium` o `font-normal`. Anche i testi secondari in grigio sono `font-bold`.
- **Le etichette dei campi sono MAIUSCOLE, grigie e piccole** (`Field`, `ui.tsx:178`) e contengono vere e
  proprie spiegazioni: "Promemoria della password (facoltativo, visibile a chi apre l'app)"
  (`SettingsView.tsx:459`), "Indirizzo https del programma, se il collegamento diretto non risponde"
  (`AgentDesk.tsx:282`). Manca un `hint` sotto il campo.
- **Avvisi permanenti di tono "warning"** per una scelta legittima (usare l'app senza account):
  `CloudStatusBadge.tsx:23` (giallo), `CloudPanel.tsx:315-317` (giallo). Chi non vuole un account vede per
  sempre un segnale di problema.
- **Le informazioni tecniche stanno allo stesso livello delle essenziali**: in `CloudPanel` il conteggio
  della coda e il canale in tempo reale (`:268-270`) sono subito sotto l'email; in Impostazioni gli Agenti AI
  sono una categoria di pari peso del Profilo.

### 2.2 Densità
- Impostazioni: ~55 controlli in una colonna, con il risultato delle azioni (`message`) mostrato **in cima
  alla pagina** (`SettingsView.tsx:234-238`) mentre Copia e Cancella sono in fondo: su mobile chi scarica una
  copia non vede la conferma.
- Aspetto: 7 palette sempre aperte (`:372-393`) per una scelta che si fa una volta.
- Copia di sicurezza: 4 pulsanti di download (completa + 3 parziali) e 2 campi password nello stesso riquadro
  (`:503-572`); le copie parziali servono di rado.
- Home: 9 blocchi, 7 dei quali vuoti al primo avvio, ognuno con titolo, link e invito.
- "Cosa fare adesso": "45 min · Energia media · Importanza 3/5" (`DashboardView.tsx:281`), tre concetti del
  modello interno spiegati da nessuna parte.

### 2.3 Punti di ingresso duplicati

| Azione | Ingressi | Riferimenti |
|---|---|---|
| Aggiungere qualcosa | `Aggiungi` in alto, "+" su mobile, 4 passi della guida, 7 stati vuoti della Home, "Nuova …" in ogni vista | `AppShell.tsx:277,334`; `DashboardView.tsx:259,298,335,370,400,427,454,490-528`; viste |
| Aggiungere un evento | aggiunta rapida (1 h, categoria "Altro"), creatore del Calendario, clic su un giorno | `QuickAddModal.tsx:121-130`; `CalendarView.tsx:393` |
| Pianificare studio | "Studio pianificato" crea un **evento**, non una sessione di Studio | `QuickAddModal.tsx:19,131-141` |
| Cronometro | "Inizio ora" (cronometro dell'attività) e il timer di Studio | `QuickAddModal.tsx:211`; `StudyView` |
| Aprire Impostazioni | voce di menu, avatar → Profilo, badge → Account, passo 4 della guida, avviso Agenti AI | `AppShell.tsx:59,268,187,243,414`; `DashboardView.tsx:523`; `AgentDesk.tsx:113-116` |
| Tema | interruttore in alto (solo chiaro/scuro) e 3 temi in Aspetto | `AppShell.tsx:258-262`; `SettingsView.tsx:354-370` |
| Bloccare l'app | "Blocca StudyOS" nella barra laterale, lucchetto della barra compatta, "Blocca ora" | `AppShell.tsx:185,233`; `SettingsView.tsx:486` |
| Stato dei dati | riquadro "I tuoi dati — Salvati su questo dispositivo" **e** badge "Salvato solo qui" nello stesso riquadro | `AppShell.tsx:221-243` |
| Calendario dalla Home | "Apri calendario" in Oggi e in Prossimi giorni, clic su ogni evento di oggi | `DashboardView.tsx:182,189,380` |

Tre meccanismi diversi per "apri Impostazioni su una categoria": `requestSettingsSection` + `sessionStorage`
(`settingsJump.ts`), `setTimeout` + `scrollIntoView` (`AgentDesk.tsx:113-116`), chip interni (`SettingsView.tsx:245`).

### 2.4 Gergo tecnico

| Termine | Dove | Proposta |
|---|---|---|
| Sincronizza / Sincronizzazione / Sincronizzato | `CloudStatusBadge.tsx:28-35`; `CloudPanel.tsx:38-41,266,287,300`; `SettingsView.tsx:178-181` | "Salvato nell'account" / "Salvataggio nell'account…" / "Aggiorna adesso" + HelpTip "Cosa vuol dire?" |
| "N modifiche da inviare" | `CloudStatusBadge.tsx:34`; `CloudPanel.tsx:40,269` | "N modifiche partono appena c'è connessione" |
| "Aggiornamento in tempo reale: attivo / no, controllo ogni tanto" | `CloudPanel.tsx:269` | solo dentro "Dettagli" |
| "senza cifratura", "cifrati" | `CloudPanel.tsx:252`; `SettingsView.tsx:439` | "Nell'account i dati non sono coperti dalla password dell'app" (vedi Rischi: resta visibile dove si decide) |
| `VITE_SUPABASE_URL`, `.env` | `CloudPanel.tsx:78-80` | mostrarlo solo in sviluppo |
| browser / dispositivo / "qui" per lo stesso concetto | `CloudPanel.tsx:76,135,316`; `CloudStatusBadge.tsx:26`; `AppShell.tsx:229`; `SettingsView.tsx:352,426,440`; `AgentDesk.tsx:158,185,199,246,263` | sempre "su questo dispositivo"; la sfumatura "in questo browser" in un HelpTip |
| Quattro "password" | account `CloudPanel.tsx:378`; app `SettingsView.tsx:450,469`; copia `:515`; ripristino `:552` | nominarle sempre "password dell'account", "password dell'app", "password della copia" + un HelpTip comune |
| MCP, "server MCP", "connettore personalizzato", OAuth | `AgentDesk.tsx:195-196,300` | passi numerati ("In ChatGPT apri Connettori → Aggiungi → incolla"); i nomi tecnici solo in "Dettagli tecnici" |
| `npm run agent`, `npm run dev`, terminale, stdio, localhost, `node --import …`, trycloudflare | `AgentDesk.tsx:190,271,282-297,304` | visibili solo in sviluppo (`localPage`); sul sito pubblicato non servono |
| Chiave / Codice di collegamento | `AgentDesk.tsx:172` | "Chiave dell'assistente" + HelpTip "Dove la trovo?" |
| "Collegamento attivo / non raggiungibile / Controllo in corso" | `AgentDesk.tsx:155` | solo se c'è un collegamento; "Nessun assistente collegato" altrimenti |
| JSON degli argomenti | `AgentDesk.tsx:43-46,77-79` | riassunto leggibile + "Dettagli tecnici" chiusi |
| BARB, "BARB · UNIMI", "appelli ufficiali BARB" | `AppShell.tsx:44`; `SettingsView.tsx:345` | solo per chi ha scelto BARB; altrove "il tuo corso" o il nome del corso |
| `.json` | `SettingsView.tsx:41,561` | "il file della copia scaricato da StudyOS" |
| `.ics` (fuori ambito) | `CalendarTransfer.tsx:57,63,120,124,141` | "file del calendario (.ics)" + HelpTip |
| Energia, Importanza 3/5 | `DashboardView.tsx:281` | HelpTip o toglierli dalla Home |
| "preparazione 40%" | `DashboardView.tsx:322` | HelpTip "Come si calcola" |
| Tema "Focus", "Densità" | `SettingsView.tsx:32,396` | "Focus (meno colori)" + HelpTip |
| "Studio pianificato" | `QuickAddModal.tsx:19` | "Tempo di studio" (blocco nel calendario) |
| "Spazio e dati" (non mostra spazio) | `SettingsView.tsx:592` | "I tuoi dati" |
| offline / "Senza connessione" | `CloudStatusBadge.tsx:30` contro `CloudPanel.tsx:37` | sempre "Senza connessione" |

Restano comprensibili e da tenere: CFU, L-13/LM-6 (nel nome del corso), "Giorni di fila", "Agenti AI" (nome
da non cambiare: i messaggi MCP citano "Impostazioni → Agenti", GOTCHAS:118-119).

### 2.5 Cliccabile o informativo?
- `Pill` di stato (`ui.tsx:92-108`) con `active` = fondo accento e testo scuro, **identica** a un pulsante
  selezionato di `Segmented` o dei temi: "Sincronizzato" (`CloudPanel.tsx:255`), "Protetto da password"
  (`SettingsView.tsx:427`), "Collegamento attivo" (`AgentDesk.tsx:154`).
- Stessa `Pill` usata **dentro** i pulsanti dei tipi dell'aggiunta rapida (`QuickAddModal.tsx:186-195`):
  lo stesso aspetto significa sia "stato" sia "pulsante".
- Home, righe dall'aspetto uguale: cliccabili gli eventi di oggi (`:187`), le materie (`:348`) e i
  materiali (`:440`); **non** cliccabili gli esami (`:314`), i prossimi giorni (`:384`), gli obiettivi (`:415`).
  Le righe cliccabili aprono la sezione, non l'elemento.
- Passi della guida già fatti: restano pulsanti attenuati che portano comunque alla sezione (`:564-569`).
- `DataStat` di Impostazioni (`:643-650`) hanno l'aspetto dei numeri cliccabili della Home ma non lo sono.
- Riquadro "I tuoi dati" della barra laterale (`AppShell.tsx:221-231`): sembra una scheda, è cliccabile solo il badge interno.
- Etichetta di tipo nei risultati di ricerca con bordo e forma da pulsante (`GlobalSearch.tsx:455`).
- Due stili di link testuale nella Home: grigio con freccia (`PanelHeader`, `:53`) e accento con "→" (`:259` ecc.).

### 2.6 Componenti incoerenti
- **Intestazioni**: `SectionTitle` (`ui.tsx:72`), `PanelHeader` locale (`DashboardView.tsx:48`),
  `SettingHeader` locale (`SettingsView.tsx:629`), h3 di `CloudPanel` (`:245`), h4 di `AgentDesk`
  (`:202,250`) e di Impostazioni (`:503,547`).
- **Scelta tra N opzioni**, cinque implementazioni: `Segmented` (`ui.tsx:207`), temi (`SettingsView.tsx:355-369`),
  accedi/registrati (`CloudPanel.tsx:319-350`), permessi (`AgentDesk.tsx:211-226`), tipi e modi
  dell'aggiunta rapida (`QuickAddModal.tsx:186-233`); altezze 32/36/44/48/56 px, raggi 18/20/22 px/pieno.
- **Finestre**: `Drawer` (pila, focus trap, Esc) contro `QuickAddModal` fatto a mano (`:163-177`, senza
  focus trap né chiusura col clic fuori) contro `window.confirm` (`SettingsView.tsx:141,161,169`;
  `CloudPanel.tsx:179,199`).
- **Contenuti a scomparsa**: `<details>` nativo (`AgentDesk.tsx:267`) contro pulsante `ghost` con
  `aria-expanded` (`CloudPanel.tsx:292`).
- **Stati vuoti**: `EmptyState` esiste (`ui.tsx:195`) ma la Home ne scrive 7 a mano con due stili (bordo
  tratteggiato `:257`, testo semplice `:296` ecc.).
- **Messaggi di esito**: in cima alla pagina (Impostazioni `:234`), in fondo al riquadro (`CloudPanel.tsx:400`),
  in cima al riquadro (`AgentDesk.tsx:162-163`).
- **Icone con più significati**: `Sparkles` = logo (`AppShell.tsx:171,199`), sync riuscita
  (`CloudStatusBadge.tsx:55,69`), "Sincronizza ora" (`CloudPanel.tsx:286`), Agenti AI
  (`SettingsView.tsx:624`). `Shield` = dati **non** protetti (`AppShell.tsx:226`, `CloudStatusBadge.tsx:55`,
  `SettingsView.tsx:433`) ma anche "Togli la password" (`:489`) e "Revoca" (`AgentDesk.tsx:241`). `Trash2`
  sul chip "Dati" (`SettingsView.tsx:625`). `Lock` per **aprire** l'app (`LockScreen.tsx:62`).
- **Raggi**: in questi file ci sono 14, 16, 18, 20, 22, 24, 26, 30 px, `rounded-super` e `rounded-full`.

### 2.7 Difetti trovati lungo la strada
1. **Salto in Impostazioni che non scatta**: se si è già in Impostazioni, avatar o badge non spostano la
   pagina (`takeSettingsSection` si legge solo al montaggio, `SettingsView.tsx:81-90`; `AppShell.tsx:111-114`),
   e la richiesta resta in `sessionStorage` e fa saltare la pagina alla visita successiva.
2. **"Annulla" che non annulla**: la seconda conferma di "Cancella tutti i dati" usa OK = cancella ovunque,
   Annulla = svuota solo il dispositivo (`SettingsView.tsx:169-171`).
3. **Interruttore del tema** che ignora "Focus": da Focus passa a Chiaro con l'etichetta "Passa al tema
   chiaro" (`AppShell.tsx:258-262`).
4. **Scadenza predefinita a mezz'ora**: ogni attività rapida riceve la scadenza alla mezz'ora successiva
   (`QuickAddModal.tsx:37,50,109`) e finisce subito "in scadenza oggi". Da verificare se è voluto.
5. **BARB per tutti**: `showBarb: true` (`src/data/defaults.ts:75`) e menu del corso che ricade su `barb`
   (`SettingsView.tsx:311`): il passo 1 della guida porta chiunque al Corso di laurea BARB
   (`DashboardView.tsx:495-499`).
6. `grid gap-1` senza `grid-cols-*` in "Cosa fare adesso" con testo troncato (`DashboardView.tsx:284`):
   proprio il caso di GOTCHAS:29-31.
7. La Home importa staticamente `BARB_DATASET` e `resolveBarbCourse` (`DashboardView.tsx:43-44`), che
   portano ~340 KB di JSON (`barb.synced.json` 231 KB + appelli 55 + 50 KB) nel pezzo della **prima schermata
   di ogni utente**, anche senza BARB. Non viola alla lettera GOTCHAS:101-104 (la vista è lazy) ma allunga il
   "Caricamento…" del primo avvio.
8. `ShareButton` compare in quasi ogni intestazione anche senza account (`ShareButton.tsx:21` controlla solo
   `cloudConfigured`): pulsante in più per chi non può condividere.

---

## 3. Navigazione e architettura dell'informazione

### Oggi
```
Ogni giorno   Home · Calendario · Attività · Studio
Università    Materie · Esami · Libretto e laurea · Corso di laurea (BARB, visibile di default)
Strumenti     Materiali · Obiettivi · Statistiche · Gruppi · Condivisione
—             Impostazioni
piede         riquadro "I tuoi dati" · Blocca · badge account
```
14 voci (13 senza BARB). "Strumenti" mescola strumenti personali e funzioni con altre persone. Mobile: 4 voci
+ "Altro" con 10 voci (Università 4, Strumenti 5, Account 1) e il badge. Le `hint` per voce (`AppShell.tsx:25-57`)
sono una buona base: oggi servono solo per tooltip e foglio "Altro".

### Proposta (stabile, non adattiva)
```
(senza titolo)   Home · Calendario · Attività · Studio            ← invariato, anche su mobile
Università       Materie · Esami · Materiali · Libretto e laurea · [Il tuo corso: solo con BARB]
Con gli altri    Gruppi · Condivisione                              ← in futuro una voce sola
Altro ▸          Obiettivi · Statistiche                            ← chiuso di default, stato ricordato
piede            [avatar · nome · ● stato dei dati]                  → menu: Profilo, Impostazioni, Tema, Blocca
```
- Utente nuovo senza BARB: **11 righe visibili** (4 + 4 + 2 + "Altro") più il piede, contro 14 voci + piede.
- Il piede unisce riquadro "I tuoi dati", badge e "Blocca": un pallino di stato (verde = nell'account,
  grigio = solo su questo dispositivo, giallo = in attesa, rosso = errore).
- Barra in alto: ricerca, campanella, `Aggiungi`. Tema e data escono; l'avatar resta su mobile (porta a Impostazioni).
- Nuova chiave `useUiState` per "Altro" aperto/chiuso (es. `shell.moreOpen`, ambito device). Nessuna chiave
  esistente rinominata (`view`, `scroll.*`).
- `Aggiungi` resta **l'unico primario globale** e si apre già sul tipo della vista corrente (Attività →
  attività, Calendario → evento, Materie → materia, Materiali → materiale, Studio → tempo di studio). I "Nuova …"
  delle viste diventano `soft` quando ci sono dati.

### Foglio "Altro" su mobile
Stesso ordine dei gruppi: Università (Materie, Esami, Materiali, Libretto, Il tuo corso), Con gli altri,
Obiettivi e Statistiche; in fondo una riga con avatar, nome, stato dei dati e "Impostazioni" al posto del
gruppo "Account" + scheda badge. Le `hint` restano: sono la guida più utile per chi è nuovo.

### Percorso del primo avvio
Oggi l'utente nuovo trova: titolo "Home", guida a 4 passi (il primo porta a BARB), 4 numeri a zero, 7
riquadri vuoti, 14 voci, un badge giallo.

Proposta:
1. **Home in modalità benvenuto** finché mancano materie, eventi e attività: solo la scheda di benvenuto.
   Primo passo: "Che corso frequenti?" (Scienze biologiche L-13 / BARB LM-6 / Un altro corso) →
   `degreeProgram`/`showBarb`. Poi materie (da BARB solo se scelto), lezioni (con import da Google o Apple),
   prima attività. Il nome si scrive nella scheda, senza saltare in Impostazioni.
2. I numeri e i riquadri vuoti restano nascosti; il link "Mostra la Home completa" li apre (stato ricordato).
   Ogni sezione nascosta resta a un passo dalla barra.
3. L'invito all'account arriva **dopo** i primi dati ("Vuoi ritrovarli sul telefono? Accedi"), non come
   avviso giallo permanente.
4. Al primo avvio non si parla di agenti, gruppi o condivisione.

---

## 4. Proposta di redesign con rivelazione progressiva (in ordine di priorità)

Legenda: **[subito]** file non toccati da people-push · **[dopo il merge di people-push]** file caldi.

### P0 — basi nel design system [subito] (`ui.tsx`, `Icon.tsx`)
1. **`HelpTip`** (API sotto) + icona `HelpCircle` in `Icon.tsx` (oggi c'è solo `Info`).
2. **Pila dei livelli**: generalizzare `openDrawers` (`ui.tsx:321`) in una pila comune a `Drawer` e `HelpTip`,
   così Esc chiude solo il livello in cima.
3. **`Disclosure`** (titolo + `aria-expanded` + contenuto, animato con `m.`) per sostituire `<details>` di
   `AgentDesk` e il pulsante "Altre opzioni" di `CloudPanel`.
4. **`StatusPill`**: stato con pallino colorato e **senza** fondo accento pieno; `Pill active` si usa
   solo dentro elementi interattivi.
5. **`TextLink`** (un solo stile di link testuale) e `PanelHeader` spostato in `ui.tsx`.
6. **`Field`** con `hint` (testo normale sotto il campo) e `help` (HelpTip accanto all'etichetta); etichette brevi.
7. **Scala dei pesi**: testo secondario `font-medium`, corpo `font-normal`/`medium`; `black` solo per titoli e numeri.
8. `Button` con `size="sm"` per le azioni compatte (oggi si sovrascrive `min-h-9`/`min-h-8` a mano).

### P0 — Home e primo avvio [subito] (`DashboardView.tsx`, `src/data/defaults.ts`)
9. Modalità benvenuto (§3) con la domanda sul corso; nuovi utenti con `showBarb` deciso dalla risposta
   (valutare il default `false`: tocca solo chi non ha ancora preferenze).
10. Riquadri senza dati nascosti dopo il primo avvio, oppure ridotti a una riga con un solo "Aggiungi".
11. Righe coerenti: tutte cliccabili, e aprono l'elemento quando la vista lo supporta (tab-state "…open"
    come `groups.open`), altrimenti nessuna con aspetto da pulsante.
12. Usare `EmptyState`/`TextLink`; togliere il doppio "Apri calendario"; `grid-cols-1` a `:284`.
13. Energia, Importanza e preparazione: HelpTip, oppure via dalla Home (restano in Attività ed Esami).
14. Import BARB della Home dinamico (`import()`), o una tabella icone leggera.

### P0 — Agenti AI [subito] (`AgentDesk.tsx`)
15. In Impostazioni una **scheda riassunto**: "Nessun assistente collegato · [Collega un assistente]" oppure
    "ChatGPT collegato · chiede conferma per le modifiche · [Gestisci]". Il resto in un `Drawer`:
    passi di collegamento numerati, Permessi (3 menu con "(consigliato)" invece di 9 pulsanti), "Consenti per
    15 minuti", Ultime azioni, Revoca, "Dettagli tecnici" (chiusi; i comandi solo se `localPage`).
16. `AgentDock`: riassunto leggibile; JSON dentro "Dettagli tecnici" chiusi.

### P0 — Aggiunta rapida [subito] (`QuickAddModal.tsx`)
17. Tipi come `Segmented`; per Attività solo nome + data + materia; "Inizio ora / Già fatta" e minuti in
    "Altre opzioni" (chiuse, default "Da fare"). Decidere se togliere la scadenza predefinita a mezz'ora.
18. "Studio pianificato" → "Tempo di studio" con hint "Un blocco nel calendario".
19. Passare a `Drawer` (o a un `Dialog` in `ui.tsx`): focus trap, Esc dalla pila, clic fuori.

### P0 — Notifiche, ricerca, stato, blocco [subito]
20. Notifiche: tutta la scheda apre e segna come letta; "Elimina" come `IconButton` (o menu "…"); campanella
    che oscilla 2–3 volte e poi si ferma (`NotificationsBell.tsx:34`).
21. Ricerca: risultati "Vai a" per sezioni e categorie di Impostazioni (Copia di sicurezza, Password dell'app,
    Tema, Agenti AI…) usando le `hint`. Segnaposto "Cerca" su mobile; suggerimento tastiera solo con
    `can-hover:`. (L'elenco delle sezioni oggi vive in `AppShell`: per ora una copia in `GlobalSearch`, da
    unificare dopo il merge in `src/lib/navigation.ts`.)
22. `CloudStatusBadge`: tono **neutro** senza account ("Dati su questo dispositivo · Accedi per averli anche
    sul telefono"); icone `Cloud`/`CloudOff`/`CheckCircle2` al posto di `Sparkles`/`Shield`.
23. `LockScreen`: "Hai dimenticato la password?" (`Disclosure`: ripristina da una copia; con l'account
    cancella i dati di questo dispositivo e riscaricali); icona di apertura; `min-h-dvh`.
24. `ShareButton`: nascosto senza sessione (la Condivisione resta nella sua sezione).

### P1 — Navigazione e shell [dopo il merge di people-push] (`AppShell.tsx`)
25. Gruppi e "Altro ▸" come in §3; piede con avatar e stato; menu dell'avatar (Profilo, Impostazioni, Tema a 3
    valori, Blocca); data e interruttore del tema fuori dalla barra in alto.
26. **Uno slot avvisi**: un avviso alla volta, per priorità (salvataggio non riuscito > permesso tolto >
    `PeopleNotice` > `PushPrompt`), con "altri N" se ne restano.
27. `Aggiungi` contestuale (§3).

### P1 — Impostazioni [dopo il merge di people-push] (`SettingsView.tsx`, `CloudPanel.tsx`, `settingsJump.ts`)
28. Da pagina lunga a **schede riassunto + Drawer**, ognuna con lo stato e al massimo un controllo in linea:
    - **Tu**: foto, nome, corso, ore a settimana → "Altre opzioni" (CFU totali, mostra la sezione del corso).
    - **Aspetto**: tema a 3 valori in linea → "Colori e densità" (palette, densità, sezione all'apertura).
    - **Account e persone**: una riga di stato + l'azione principale (Accedi / Aggiorna adesso); in Drawer
      dettagli (coda, tempo reale, ultimo salvataggio), "Risoluzione problemi" (invia/riscarica tutto), Esci;
      qui anche `@nome`, "Gli altri possono trovarmi", "Notifiche su questo dispositivo" di people-push.
    - **Sicurezza e copie**: Password dell'app (stato + Attiva/Blocca ora) e Copia di sicurezza ("Scarica una
      copia" in linea; ripristino e copie parziali nel Drawer).
    - **Avanzate** (righe più piccole in fondo, **non** chiuse in un'altra tendina): Agenti AI (la scheda del
      punto 15), Cancella tutti i dati (Drawer con tre pulsanti espliciti: "Cancella ovunque", "Svuota solo
      questo dispositivo", "Annulla").
29. Esito delle azioni **accanto** all'azione, o nel Drawer.
30. Il salto alla categoria funziona anche da Impostazioni già aperte: evento come `QUICK_ADD_EVENT` che apre
    il Drawer giusto; un solo meccanismo (anche per `AgentDock`). Gli id `settings-*` restano.
31. `CloudPanel`: una sola intestazione; accedi/registrati come `Segmented`; la nota sulla cifratura dove si
    decide (registrazione, attivazione della password dell'app con account), non come terzo avviso fisso.

### P1 — Testi [dopo il merge di people-push] (`labels.ts`)
32. `HELP_TEXT` (contenuti dei HelpTip), `NAV_TEXT` (voci e `hint` oggi in `AppShell`), `DATA_STATUS_TEXT`
    (stato dei dati con un lessico unico). Fino al merge `HelpTip` riceve i testi come prop e nessun file
    caldo cambia.

### P2 — dopo
33. Gruppi + Condivisione in una sezione "Con gli altri" a schede (`GroupsView`, `SharingView`: caldi, da progettare a parte).
34. Adottare `Segmented`/`StatusPill`/`TextLink`/`Disclosure` nelle altre viste; ridurre i raggi a 3 valori.

### Componente `HelpTip` (uno, riusabile)
```tsx
// src/components/ui.tsx
export function HelpTip(props: {
  title: string;              // titolo del fumetto; il pulsante si chiama "Spiegazione: {title}"
  text: ReactNode;            // 1–2 frasi senza gergo
  example?: ReactNode;        // mostrato come "Per esempio: …"
  action?: { label: string; onClick: () => void }; // es. "Apri Copia di sicurezza"
  placement?: "auto" | "top" | "bottom";            // default "auto": sotto, sopra se manca spazio
  className?: string;
}): JSX.Element;

// uso
<Field label="Password dell'app" help={<HelpTip title="Password dell'app" text={HELP_TEXT.appPassword.text} example={HELP_TEXT.appPassword.example} />}>
```
Comportamento:
- Trigger `<button type="button" aria-expanded aria-controls={id} aria-label="Spiegazione: …">` con
  `HelpCircle` da 16 px; area di tocco ≥44 px con `after:absolute after:-inset-3` (come la spunta della Home,
  `DashboardView.tsx:218`); focus visibile.
- Si apre **al clic/tocco**, Invio o Spazio (toggletip), mai solo al passaggio del mouse (`hoverOnlyWhenSupported`, GOTCHAS:48-50).
- Fumetto in **portal su `body`** come `Drawer`: `.soft-panel` ha `backdrop-filter`, che diventa il
  riferimento dei figli `position: fixed`, e il corpo del `Drawer` taglia ciò che esce (`ui.tsx:414`).
  `position: fixed` calcolata dal trigger, `z-[60]` (sopra i Drawer `z-50`), larghezza
  `min(20rem, calc(100vw - 32px))`, margine di 16 px a 375 px; si chiude su scroll o resize.
- Contenuto in un contenitore `role="status"` riempito all'apertura: lo screen reader lo legge e il focus
  resta sul pulsante. Con `action` il focus entra nel fumetto e torna al pulsante alla chiusura.
- **Esc** chiude solo il fumetto (pila dei livelli, P0.2), clic fuori chiude, Tab fuori chiude.
- Animazione con `m.` (LazyMotion strict), rispettando `prefers-reduced-motion`. Nessun import pesante.

Dove metterlo, in ordine:
1. Stato dei dati / account: "Cosa vuol dire salvato nell'account?" (`CloudStatusBadge`, `CloudPanel`).
2. Le tre password: dell'account, dell'app, della copia (`CloudPanel:378`, `SettingsView:450,515,552`).
3. Copia completa contro parziale (`SettingsView:532`).
4. Agenti AI: "Cos'è un assistente AI collegato", "Dove trovo la chiave" (`AgentDesk:172`).
5. Home: "Cosa fare adesso" (come si sceglie), Energia/Importanza, "preparazione %", "Giorni di fila".
6. Aspetto: tema Focus, Densità.
7. Voce "Il tuo corso" e appelli ufficiali (nav e BarbView).
8. Aggiunta rapida: Attività contro Tempo di studio.
9. Dopo il merge: "Può vedere / Può modificare" nella condivisione.

### Testi da riscrivere (selezione; il resto è nella tabella 2.4)

| Oggi | Proposta |
|---|---|
| "Salvato solo qui" / "Accedi per sincronizzare" | "Dati su questo dispositivo" / "Accedi per averli anche sul telefono" |
| "Sincronizzato" | "Tutto salvato nell'account" |
| "Sincronizza ora" | "Aggiorna adesso" |
| "Modifiche da inviare: 0 · Aggiornamento in tempo reale: attivo" | (in Dettagli) "In attesa: nessuna modifica · Aggiornamenti immediati: sì" |
| "Per ora i tuoi dati sono solo in questo browser. Accedi (dopo aver confermato l'email)…" | togliere: lo dice già la riga di stato |
| "Collega questo browser" | "Collega questo dispositivo" |
| "Revoca l'accesso agli assistenti" | "Togli l'accesso a tutti gli assistenti" |
| "Agenti AI: il programma sul computer non risponde" | "L'assistente AI non risponde. Apri Impostazioni → Agenti AI" |
| "Mostra la sezione Corso di laurea (BARB · UNIMI)" | "Mostra insegnamenti e appelli ufficiali del mio corso" |
| hint "Insegnamenti e appelli ufficiali BARB" | "Insegnamenti e date d'esame ufficiali del tuo corso" |
| "Promemoria della password (facoltativo, visibile a chi apre l'app)" | etichetta "Promemoria (facoltativo)" + hint "Lo vede chiunque apra StudyOS: non scrivere la password" |
| "Scegli il file della copia (.json)" | "Scegli il file della copia scaricato da StudyOS" |
| "Studio pianificato" | "Tempo di studio" |
| "Spazio e dati" | "I tuoi dati" |
| conferma OK/Annulla della cancellazione | Drawer con "Cancella ovunque" / "Svuota solo questo dispositivo" / "Annulla" |

### Verifica "ogni funzione in ≤2 passi"

| Funzione | Desktop | Mobile |
|---|---|---|
| Home, Calendario, Attività, Studio | 1 | 1 |
| Materie, Esami, Materiali, Libretto, Il tuo corso | 1 | 2 (Altro → voce) |
| Gruppi, Condivisione | 1 | 2 |
| Obiettivi, Statistiche | 2 ("Altro ▸" → voce, poi ricordato) | 2 |
| Profilo, nome, foto | 1 (avatar/piede → Profilo) | 1 (avatar) |
| Tema | 2 (avatar → Tema) | 2 (avatar → Impostazioni, tema in linea) |
| Stato dei dati, Accedi | 1 (piede) | 2 (Altro → riga di stato) |
| Password dell'app, Copia, Agenti AI, Cancella dati | 2 (Impostazioni → scheda/Drawer) | 2 (avatar → scheda/Drawer) |
| Qualsiasi sezione o categoria di Impostazioni | 2 (ricerca → "Vai a") | 2 |
| Aggiungere qualcosa | 1 (`Aggiungi`) | 1 ("+") |

Unica eccezione voluta: "Dettagli tecnici" e "Risoluzione problemi" a 3 passi; non sono funzioni ma
informazioni e rimedi rari.

---

## 5. Rischi

### File caldi (people-push modifica `AppShell.tsx`, `App.tsx`, `SettingsView.tsx`, `CloudPanel.tsx`, `GroupInvite.tsx`, `ShareDrawer.tsx`, `GroupsView.tsx`, `SharingView.tsx`, `labels.ts`)

| Proposta | File | Quando |
|---|---|---|
| HelpTip, pila dei livelli, Disclosure, StatusPill, TextLink, Field hint, pesi | `ui.tsx`, `Icon.tsx` | subito |
| Home e primo avvio | `DashboardView.tsx`, `src/data/defaults.ts` | subito; testi nuovi in `labels.ts` dopo il merge |
| Agenti AI | `AgentDesk.tsx` | subito |
| Aggiunta rapida | `QuickAddModal.tsx` | subito |
| Notifiche | `NotificationsPanel.tsx`, `NotificationsBell.tsx` | subito |
| Ricerca "Vai a" | `GlobalSearch.tsx` | subito con elenco locale; unificazione con `navGroups` **dopo il merge di people-push** |
| Stato dei dati | `CloudStatusBadge.tsx` | subito |
| Blocco | `LockScreen.tsx` | subito |
| Condividi solo con account | `ShareButton.tsx` (non caldo; `ShareDrawer` sì) | subito |
| Navigazione, piede, menu avatar, slot avvisi, `Aggiungi` contestuale | `AppShell.tsx` | **da fare dopo il merge di people-push** |
| Impostazioni a schede + Drawer, salto alla categoria, esiti vicini | `SettingsView.tsx` (+ `settingsJump.ts`) | **da fare dopo il merge di people-push** |
| Account a una riga + dettagli | `CloudPanel.tsx` | **da fare dopo il merge di people-push** |
| `HELP_TEXT`, `NAV_TEXT`, lessico dello stato | `labels.ts` (people-push aggiunge "in coda": conflitto sicuro se si aggiunge in coda in parallelo) | **da fare dopo il merge di people-push** |
| Gruppi + Condivisione in una sezione | `GroupsView.tsx`, `SharingView.tsx` | **da fare dopo il merge di people-push**, design a parte |

### Altri rischi
- **Onestà sulla protezione**: la nota "nell'account i dati non sono cifrati" (GOTCHAS:8-9) non va spostata
  solo in un HelpTip: deve restare visibile dove si decide (registrazione, attivazione della password
  dell'app con account attivo).
- **Bundle iniziale**: `CloudPanel` importa staticamente `lib/supabase` (`CloudPanel.tsx:4-10`). Se finisse
  in un Drawer della shell (menu avatar) entrerebbe nel bundle iniziale: usare `import()`/`lazy`. `HelpTip`
  e la pila in `ui.tsx` senza import pesanti.
- **Nomi e ancore da non rompere**: categoria "Agenti AI" e id `settings-agenti` (messaggi MCP, `AgentDock`
  `:115`, `settingsJump`); con le schede in Drawer il salto deve aprire il Drawer giusto.
- **Stato UI**: solo chiavi nuove (`shell.moreOpen`, `home.showAll`); `view` e `scroll.*` restano. La guida
  usa già `localStorage` `studyos-getting-started-hidden` (`DashboardView.tsx:466`): tenerla.
- **Scoperta delle funzioni**: chiudere "Altro" e nascondere i riquadri vuoti riduce la visibilità →
  ricerca "Vai a", stato ricordato e `hint` nel foglio mobile.
- **Comportamento dei dati**: togliere la scadenza predefinita delle attività rapide cambia "in scadenza
  oggi", `urgentTasks` e i promemoria: è una decisione di prodotto, non solo di forma.
- **Account**: un badge neutro può ridurre gli accessi e le copie → invito contestuale dopo i primi dati e
  promemoria della copia.
- **Esc annidato**: HelpTip dentro un Drawer dentro un Drawer (es. Invita sopra un gruppo): serve la pila
  comune, non un altro `window.keydown`.
- **Animazioni**: solo `m.` sotto `LazyMotion` strict (`src/main.tsx:10`).
- **Verifica**: non ci sono test sui testi dell'interfaccia (`tests/` copre logica). Dopo ogni passo
  `npm run lint`, `npm test`, `npm run build`, e controllo visivo a 375, 768, 1024 e 1280 px (breakpoint
  di GOTCHAS:44-47), tema chiaro e scuro, con e senza account e password dell'app.
