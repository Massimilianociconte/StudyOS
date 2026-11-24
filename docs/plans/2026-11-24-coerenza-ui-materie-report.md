# Rapporto tecnico: coerenza dell'interfaccia e integrità delle materie

- Data: 24 novembre 2026
- Ramo: `claude/ui-coherence` (non ancora pubblicato)
- Decisione collegata: [ADR materie uniche nello store](../agent/decisions/2026-11-24-materie-uniche-nello-store.md)
- Stato e verifiche: [CURRENTSTATE.md](../agent/CURRENTSTATE.md), sezione del 24 novembre

## 1. Pulsanti di creazione nel calendario

**Problema.** In Calendario c'erano due strade per creare un impegno. Il pulsante globale «Aggiungi»
apriva una finestra rapida separata (`QuickAddModal`) con meno campi: senza «tutto il giorno», senza
ripetizione e senza promemoria. Il «Nuovo evento» della sezione apriva invece il modulo completo. Così
lo stesso evento usciva diverso a seconda del pulsante.

**Analisi.** Il pulsante globale serve: è l'unico ingresso rapido che funziona da qualunque vista. La
sua finestra però era un secondo modulo da tenere allineato a mano.

**Scelta.** Il pulsante globale resta, ma non ha più un modulo proprio: è un menu che apre i moduli
canonici.

| Voce | Cosa apre |
|---|---|
| Attività | `TaskModal`, lo stesso di «Nuova attività» in Attività |
| Evento | Il creatore completo del calendario (chiave una tantum `calendar.create`) |
| Materia | `SubjectFormModal`, lo stesso della sezione Materie |
| Materiale | Il campo del link in Materiali, già a fuoco (chiave `materials.add`) |

Sul telefono il pulsante tondo apre lo stesso menu. `QuickAddModal` e i suoi helper sono stati tolti.

**Ingressi doppi controllati in tutta l'app.**

| Ingresso | Esito | Motivo |
|---|---|---|
| Barra rapida in Attività | Resta | Annotazione veloce dentro la sezione, solo titolo |
| Tipo «Attività» nel creatore del calendario | Resta | Pianificare un'attività dal giorno scelto |
| «Aggiungi» nel catalogo BARB | Resta | Crea la materia collegata all'insegnamento |
| «Materia non in elenco» nel libretto | Resta | Il voto si registra senza uscire dal libretto |
| Collegamenti nella Home vuota | Restano | Ora aprono i moduli canonici |

Le tre strade che creano materie passano tutte dal controllo dei doppioni (punto 6).

## 2. Filtro per materia nel calendario

**Prima.** Si poteva scegliere una sola materia.

**Ora** (`CalendarFilters`, `src/lib/calendarFilter.ts`):

- pillole compatte con il segno della materia, se ne accendono quante si vuole;
- «Tutte» azzera la scelta;
- il filtro vale uguale in mese, settimana, giorno e agenda.

La chiave `calendar.subject` salva gli id separati da virgola; vuota vuol dire tutte. Le chiavi salvate
prima, con un solo id, si leggono ancora. Con un filtro attivo, un nuovo evento nasce già legato alla
materia, se è una sola, così non sparisce dalla vista.

## 3. Un solo «Nuovo evento» con la scelta del tipo

**Prima.** Oltre a «Nuovo evento» c'erano le voci «Nuova ricorrenza» e «Nuova vacanza» nel menu ⋯.

**Ora.** In cima a ogni modulo di creazione c'è «Cosa vuoi aggiungere» (`CreateTypeSwitch`), con quattro
scelte: Evento, Attività, Ricorrenza, Vacanza o assenza. Cambiando tipo, il titolo già scritto passa
al nuovo modulo.

**Perché erano separati.** Nei dati sono entità diverse, con campi diversi:

- un evento ha giorno e orario, tipologia (lezione, studio, esame…), ripetizione e promemoria;
- un'attività ha una scadenza e si spunta;
- una ricorrenza (compleanno, anniversario) occupa tutto il giorno e torna ogni anno, senza orario;
- una vacanza è un intervallo dal… al… che il piano di studio salta.

Unire i modelli avrebbe riempito un unico modulo di campi spesso inutili. Si è unito solo l'ingresso;
ogni tipo tiene il suo modulo. Lezione, studio, esame, «tutto il giorno» e «ripetuto» restano tipologie
e opzioni del modulo evento, non tipi separati.

## 4. Tendine con icone

**Nuovi componenti.**

- `IconSelect` (`src/components/IconSelect.tsx`).
  - Sul computer si apre come popover sotto il campo; sotto i 640 px come pannello dal basso, come il
    selettore di date.
  - Tastiera come un `<select>`: frecce, Pagina su/giù, Home/End, lettere per saltare alla voce, Invio
    o spazio per scegliere, Esc, Tab.
  - Il nome viene dall'etichetta del campo, per i lettori di schermo.
- `SubjectSelect` mostra il segno della materia (copertina, icona del corso o icona scelta, sul suo
  colore), lo stesso della sezione Materie.
- Le tipologie dell'evento usano le icone già usate nel calendario (`eventTypeIcon`).
- Il riquadro dell'icona usa i token di tema (`--surface-strong`, `--accent-ink`): provato con il tema
  chiaro e scuro.

**Dove sono applicate:** tipologia e materia dell'evento, nuova attività, modifica attività, esami,
materiali, mazzi, studio, piano d'esame, analisi AI, sessioni di studio e libretto.

**Restano native:**

- il modulo degli appelli dei gruppi, perché usa la validazione nativa (`fieldAttrs`);
- i filtri compatti di Attività, Materiali e Argomenti, dove l'icona non aggiunge informazione e il
  `<select>` nativo occupa meno spazio.

## 5. Menu con una sola voce

`PageActions` con una sola azione ora mostra il pulsante diretto; il menu ⋯ compare da due azioni in su
(`ActionsMenu`, ora esportato e riusato da «Aggiungi»). In Attività «Condividi» è un pulsante.

Tutti i menu ⋯ dell'app passano da `PageActions` (intestazioni delle pagine e schede delle materie, che
hanno sempre almeno tre voci) o da `ActionsMenu` con quattro voci («Aggiungi»). Quindi nessun menu
resta con una voce sola, neanche quando le voci dipendono dai permessi o dallo stato.

## 6. Materie doppie (Anatomia, Fisiologia)

**Causa.**

- `create_subject` (lo strumento degli assistenti) creava sempre una materia nuova, senza guardare
  quelle esistenti, e metteva CFU 0 quando mancavano.
- Un assistente ha quindi creato «Anatomia Umana» accanto a «Anatomia dell'uomo» (quella del catalogo,
  stesso docente con nome e cognome invertiti, CFU 0) e «Principi di Fisiologia» accanto a «Principi di
  fisiologia».
- Attività, esami e preparazione si sono divisi fra le copie: il progresso pre-esame di ciascuna era
  parziale.

**Correzione dei dati.** Nella sezione Materie il pannello «Una materia sembra doppia» propone l'unione.
`mergeSubjects` sposta sulla materia che resta ogni collegamento: attività, esami, eventi, sessioni,
argomenti, materiali, note, promemoria, piani, mazzi, schede, quiz, analisi e il cronometro. Completa
i campi vuoti, unisce le note e poi toglie la copia.

L'unione si rifiuta in due casi:

- le due materie sono insegnamenti diversi del catalogo;
- la materia da togliere è data in condivisione.

«Sono materie diverse» nasconde la coppia per sempre (`distinctSubjectPairs`). Il piano è una funzione
pura (`src/lib/subjectMerge.ts`) provata con i test, e si carica solo quando serve.

**Progresso pre-esame** (`src/lib/subjectProgress.ts`).

- Dopo l'unione esame, attività e preparazione stanno su una materia sola.
- Un esame con la data passata e senza esito non conta più come preparazione in corso. Prima la barra
  restava ferma su quell'esame. Ora il pannello dice «manca l'esito» e offre «Registra l'esito».
- Gli esami con «data da decidere» restano da preparare.

**Prevenzione strutturale.**

- Una sola regola di identità (`src/lib/subjectIdentity.ts`) con tre livelli:
  - doppione certo: stesso nome a meno di maiuscole, accenti, apostrofi e spazi, oppure lo stesso
    insegnamento del catalogo;
  - probabile: stesso docente e una parola significativa in comune, oppure le stesse parole con i
    sinonimi («umana» e «dell'uomo»);
  - indicazione: il resto, che non blocca.
  Le parole generiche (generale, avanzata…) e i numeri diversi («Fisica I» e «Fisica II») non bastano.
- Lo store rifiuta i doppioni certi in `addSubject` e `updateSubject` (`SubjectDuplicateError`). App,
  agenti nel browser e connettore remoto eseguono le stesse azioni, quindi il blocco vale ovunque.
- Strumenti MCP, versione 1.13.0:
  - `studyos_create_subject` e `studyos_update_subject` rispondono `code: "conflict"` con
    `data.reason`:
    - `duplicate`: indica la materia esistente da usare;
    - `similar`: elenca i candidati; dopo la risposta della persona si ripete con
      `confirmDistinct: true`.
  - Nuovo `studyos_merge_subjects`, che chiede conferma.
  - `studyos_add_barb_courses`:
    - collega la materia con lo stesso nome (`linked`) invece di crearne un'altra;
    - per quelle solo simili risponde `needsChoice`;
    - accetta `links` per scegliere.
  - Schemi e descrizioni aggiornati, `docs/agent-mcp.md` aggiornato.
- **Vincolo nel database: non fattibile.** Le righe della sync hanno un `payload` JSON generico, l'app
  lavora anche senza cloud, e il confronto con accenti e sinonimi non è un indice. Motivi completi
  nell'ADR.

## 7. Modulo della materia (crea e modifica)

Gli stessi campi (`SubjectFields`) stanno in «Nuova materia» (`SubjectFormModal`, aperto da Materie e
da «Aggiungi») e nel dettaglio della materia («Dati della materia»), dove si modifica.

- **In vista:** nome, CFU, semestre e docente.
- **In «Altri dettagli»:** icona, colore, stato, voto obiettivo e note. Sono chiusi quando si crea (si
  aggiungono anche dopo) e sempre aperti quando si modifica.

Validazione con le stesse regole degli agenti (`src/lib/subjectFields.ts`):

- CFU da 0 a 60, predefiniti a 6;
- voto obiettivo da 18 a 31;
- colore esadecimale;
- icona da un elenco.

Mentre si scrive il nome compare l'avviso dei doppioni. Con un doppione certo il salvataggio è
disattivato e c'è «Apri «X»» per andare alla materia esistente; con un probabile si può confermare che
è un'altra.

**Parità tra interfaccia e agenti.** Sono gli stessi campi, gli stessi limiti e gli stessi conflitti.

**Non sono nel modello dati**, quindi non sono nel modulo:

- anno accademico;
- anno di corso;
- categoria;
- modalità d'esame.

Aggiungerli richiede un cambio del modello e della sync, da decidere a parte.

## 8. Revisione trasversale

- **«Nuova attività»** ha «Quando la fai?»:
  - da fare;
  - inizia ora: parte il cronometro;
  - già fatta: con il tempo impiegato.
  Così si evita di creare l'attività e poi aprirla di nuovo per avviare il cronometro.
- **Accessibilità:**
  - le etichette dei campi (`Field`, `HelpField`) danno il nome alle tendine;
  - i menu con descrizioni sulle voci usano `aria-describedby`;
  - il focus torna al campo alla chiusura.
- **Bundle:** chunk principale +11,8 kB (+4,1 kB gzip), per il blocco dei doppioni nello store e i
  testi. Il piano dell'unione e i moduli si caricano solo quando servono, il dataset BARB resta un
  chunk separato.

## 9. Verifiche

| Controllo | Esito |
|---|---|
| `npm test` | 1861 test passati, compresi i nuovi su identità, unione, progresso, campi, filtro, tastiera delle tendine, avvio delle attività e strumenti degli agenti |
| `npm run lint` | Pulito |
| `npm run build` | Riuscita |
| `npm run e2e` | 11 su 11 sullo stack Supabase locale, con due account, condivisione delle attività compresa |

Prova della regola sui 14 nomi reali dell'account (solo lettura dal connettore, calcolo in locale):

- escono solo le due coppie vere: Anatomia come «probabile», Principi di fisiologia come «certo»;
- nessun falso positivo: per esempio «Neurofisiologia», che ha lo stesso docente di Principi di
  fisiologia, resta fuori.

Prove nel browser locale:

- tendine sul computer e sul telefono, con tastiera e tema scuro;
- i quattro casi del menu «Aggiungi»;
- avviso e blocco dei doppioni nel modulo;
- unione di due materie;
- filtro multi-materia del calendario.

## Questioni aperte

- **Dati reali.** Le materie doppie dell'account non sono ancora unite. Si fa dall'app dopo la
  pubblicazione, dal pannello «Una materia sembra doppia», scegliendo quale tenere.
  - «Anatomia Umana» ha l'esame del 23/11 e 14 attività; «Anatomia dell'uomo» (catalogo, 6 CFU) ha 7
    eventi. L'unione porta tutto su una sola.
  - Conviene tenere quella del catalogo e il suo nome. Le note uguali non si ripetono.
  - L'esame del 23/11 è passato: dopo l'unione il pannello chiede di registrare l'esito.
  - Il connettore 1.12.1 non mostra l'insegnamento collegato, quindi non ho potuto escludere da qui
    che le due copie siano legate a insegnamenti diversi. In quel caso l'app lo dice e non unisce.
- **Connettore.** Il Worker `studyos-agent` va ripubblicato (1.13.0). Poi il connettore va ricreato
  in ChatGPT e Claude, perché lì restano schemi e descrizioni vecchi.
- **Due dispositivi offline** possono creare la stessa materia prima della sync. Dopo, il pannello la
  segnala e si unisce con un tocco.
- **Campi non nel modello** (anno accademico, anno di corso, categoria, modalità d'esame): servono una
  decisione e una migrazione.
- **Filtri compatti ancora nativi:** si possono passare a `IconSelect` se serve uniformità visiva.
