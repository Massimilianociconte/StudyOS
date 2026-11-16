# Flashcard, quiz, ripasso e richieste agli agenti — design

Data: 16 novembre 2026. Ramo: `claude/flashcards-quiz` (da `origin/main` 47647e3 + docs f32623e).

## 1. Diagnosi dell'esistente (cosa si riusa)

StudyOS è una PWA local-first: i dati personali vivono nello store zustand (`useStudyStore`),
in IndexedDB (Dexie, versione 8) e, con un account, nella tabella generica `studyos_items`
(una riga per entità, `entity_type` testo libero, payload JSON, RLS per proprietario, LWW con
`push_studyos_rows`). Non esistono flashcard, quiz o tabelle di ripasso (solo gli argomenti
`studyTopic` con un SM-2 semplificato in `src/lib/review.ts`).

| Pezzo | Stato | Uso per questa funzione |
| --- | --- | --- |
| `studyos_items` + sync per entità | riusabile così com'è | nuovi `entity_type`, nessuna tabella nuova |
| Condivisione righe originali (`sharing.sql`, `useSharedStore`) | da estendere | nuova sezione `flashcards` |
| Cronologia 90 giorni delle modifiche altrui, ripristino | riusabile | vale anche per raccolte e schede condivise |
| Hub MCP `/mcp` (Worker → browser) | da estendere | strumenti nuovi eseguiti nel browser |
| Connettore remoto `/u/<nome>/mcp` (Worker legge il cloud) | da estendere | stessi strumenti, pull per gruppi di tipi |
| Materie (`subjects`) | riusabile | le raccolte puntano a `subjectId`, nessun duplicato |
| Storage `studyos-files` | non usato ora | le immagini restano link https (vedi §5) |

Nessuna tabella nuova: contenuti, progressi, analisi e richieste sono entità sincronizzate.
Ne seguono gratis RLS, sync tra dispositivi, condivisione, cronologia, backup e i due connettori.

## 2. Entità (`src/types.ts`)

Contenuti (condivisibili, sezione `flashcards`):

- `studyDeck` (collezione `decks`) — raccolta gerarchica: `parentId`, `subjectId`, `kind`
  (`collection` | `topic` | `chapter` | `paragraph` | `subtopic`), `title`, `description`,
  `position`, `color`, `icon`, `tags`, `source` (documento, capitolo, sezione, pagine),
  `meta` (chiave→testo, al massimo 20). La gerarchia Materia → Argomento → Capitolo → Paragrafo →
  Sottoargomento è materia + catena di raccolte; `kind` dice il livello senza imporlo.
- `flashcard` (`flashcards`) — `deckId`, `subjectId` (copiato dalla raccolta: serve al filtro
  della condivisione), `title`, `front` e `back` (blocchi, §4), `explanation` (blocchi pubblicati
  nella raccolta), `difficulty` 1–5, `position`, `sources`, `author` (`person` | `agent`, nome,
  modello), `revision` (sale a ogni modifica del contenuto), `externalRef` (chiave dell'agente per
  l'idempotenza, unica nella raccolta).
- `quiz` (`quizzes`) — `deckId`, `subjectId`, `title`, `description`, `difficulty`, `position`,
  `sources`, `author`, `revision`, `externalRef`.
- `quizQuestion` (`quizQuestions`) — `quizId`, `subjectId`, `kind` (`single` | `multiple`),
  `prompt` (blocchi), `options` [{`id` stabile, `text`, `correct`, `feedback`}], `explanation`,
  `mistakes` (errori comuni), `difficulty`, `position`, `sources`, `revision`, `externalRef`.

Personali (mai condivise, mai nelle sezioni di condivisione):

- `flashcardState` (`cardStates`) — id = id della scheda; ripasso a intervalli e contatori.
- `studyRun` (`studyRuns`) — una sessione di ripasso o un tentativo di quiz con gli eventi
  compatti (scheda, esito, ms, istante, revisione). Al massimo 400 eventi per riga: le sessioni più
  lunghe continuano in una riga nuova. Lo storico non si sovrascrive.
- `aiAnalysis` (`aiAnalyses`) — analisi qualitative scritte dagli agenti.
- `aiRequest` (`aiRequests`) — richieste «Spiegami meglio» e «Analizza» create nell'app.

Le spiegazioni personali sono il risultato delle richieste (`aiRequest.result`); «Pubblica nella
raccolta» le copia in `flashcard.explanation` (serve il permesso di modifica).

## 3. Ripasso a intervalli (deterministico, `src/lib/srs.ts`)

Variante di SM-2 a tre esiti, senza AI e senza casualità:

- Sbagliata: ripetizioni a 0, `lapses` +1, facilità −0,20 (min 1,30), di nuovo dopo 10 minuti.
- Dubbia: facilità −0,15; intervallo 1 giorno se nuova, altrimenti ×1,2 (min 1). Non conta come
  acquisita.
- Corretta: 1 giorno, poi 3, poi intervallo × facilità; facilità +0,05 (max 3,00).
- Salta: non cambia la pianificazione e non entra nella correttezza.
- Intervallo massimo 365 giorni. Le date sono istanti; «oggi» è il giorno locale.

Stati: nuova (mai valutata), da ripassare oggi, in ritardo (scadenza prima di oggi), difficile
(≥3 errori o facilità < 1,8), dubbia (ultimo esito dubbio), consolidata (intervallo ≥ 21 giorni e
ultimo esito corretto), in apprendimento (il resto).

## 4. Contenuti strutturati (`src/lib/cardBlocks.ts`)

Schema versionato (`v: 1`) di blocchi: `text` (markdown ridotto: `**grassetto**`, `*corsivo*`,
`` `codice` ``, `$formula$`, `^apice^`, `~pedice~`), `heading`, `list`, `formula` (LaTeX, anche
`\ce{}` per la chimica, KaTeX caricato solo dalla sezione), `image` (solo https, `alt`
obbligatorio), `svg`, `code`, `table`, `callout`, `reference`.

Limiti: 30 blocchi per lato, testo 4000 caratteri, SVG 60 kB, tabella 20×8, scheda intera 96 kB.
Validazione pura (gira anche nel Worker) all'ingresso degli strumenti e dell'editor; il rendering
non usa mai `innerHTML` per i testi. Gli SVG passano da un sanitizzatore a elenco consentito con
`DOMParser` (tag e attributi ammessi, niente script, `foreignObject`, eventi, `style` con `url(`,
riferimenti esterni) prima di essere inseriti; all'ingresso un controllo leggero rifiuta i casi
evidenti. Le immagini sono `<img loading="lazy" referrerpolicy="no-referrer">` con segnaposto ed
errore; quelle in raccolte di altre persone si caricano al tocco. La CSP aggiunge `https:` a
`img-src` (nessun'altra origine).

## 5. Immagini

Nel database solo URL, testo alternativo, didascalia e proporzioni. Niente base64 (rifiutato
dalla validazione). Lo Storage resta per i materiali: un caricamento di immagini per le schede
richiederebbe la sessione dell'utente e non è disponibile al connettore remoto; resta un passo
successivo documentato.

## 6. Quiz

Punteggio: risposta singola = 1 se l'opzione scelta è quella corretta; multipla = 1 solo se
l'insieme scelto coincide con quello corretto (nessun punteggio parziale, regola dichiarata
nell'app e nella guida per gli agenti). Non data = 0 e contata a parte. «Dubbia» è un segno
dell'utente, non cambia il punteggio. Modalità: allenamento (esito subito), simulazione d'esame
(esiti alla fine, tempo facoltativo), ripasso degli errori, casuale da più quiz, personalizzata.
Domande e opzioni si mescolano; le risposte giuste sono id stabili delle opzioni.

## 7. Statistiche (`src/lib/learningStats.ts`)

Calcolate nell'app dai dati locali (nessuna rete), memorizzate per riferimento. Correttezza =
corrette ÷ (corrette + sbagliate + dubbie); dubbie e sbagliate mostrate a parte; saltate escluse.
Tendenza = correttezza degli ultimi 14 giorni contro i 14 precedenti (almeno 5 risposte per
lato). Agli agenti arrivano solo aggregati paginati.

## 8. Strumenti MCP (versione 1.10.0)

Pochi strumenti parametrici, gli stessi sui due connettori:

`studyos_learning_guide`, `studyos_list_decks`, `studyos_save_decks`, `studyos_delete_deck`,
`studyos_copy_deck`, `studyos_list_flashcards`, `studyos_get_flashcards`,
`studyos_save_flashcards`, `studyos_delete_flashcards`, `studyos_find_duplicate_flashcards`,
`studyos_list_quizzes`, `studyos_get_quiz`, `studyos_save_quiz`, `studyos_delete_quiz_items`,
`studyos_learning_stats`, `studyos_list_ai_analyses`, `studyos_save_ai_analysis`,
`studyos_delete_ai_analysis`, `studyos_list_ai_requests`, `studyos_take_ai_request`,
`studyos_finish_ai_request`.

- Batch: fino a 100 schede o 60 domande per chiamata (il corpo resta sotto i 256 kB dell'hub);
  risposta per elemento (`created`, `updated`, `unchanged`, `duplicate`, `conflict`, `error`).
- Idempotenza: `externalRef` per elemento; rimandare lo stesso lotto non duplica.
- Concorrenza: `expectedRevision` per elemento; se è cambiata risponde `conflict` con la
  revisione attuale e non scrive quell'elemento.
- Sul connettore remoto due assistenti (due Durable Object) possono leggere la stessa revisione e
  scrivere insieme: il controllo nel runner non basta. `studyos_agent_push` rifiuta, nella WHERE
  dell'upsert (vede la riga bloccata, anche se creata nello stesso momento), una revisione più
  bassa o la stessa revisione con contenuto diverso (`front, back, explanation, prompt, options,
  kind, title, mistakes`, come `CONTENT_KEYS`); stessa revisione e stesso contenuto passano (retry
  idempotente). Scenario D prima del controllo: 25 modifiche «salvate» poi perse e 2 schede per la
  stessa `externalRef`; dopo: nessuna persa, una sola scheda.
- Id stabili per `externalRef` (`stableId`, FNV-1a doppio, ambito raccolta o quiz): due creazioni
  simultanee della stessa scheda scrivono la stessa riga; se l'id è già preso da altro, id casuale.
- Le richieste «Spiegami meglio» sono un consenso già dato: `take` e `finish` non chiedono
  conferma nell'app (salvo divieto delle modifiche). Le altre scritture seguono le regole esistenti.

## 9. Flusso inverso (StudyOS → agente)

Fatti verificati (16/11/2026): nella revisione MCP 2026-07-28 il sampling è deprecato (SEP-2577),
le richieste avviate dal server sono sostituite da `input_required` dentro una chiamata del
client, i task sono un'estensione con polling (`tasks/get`) e il flusso GET SSE è stato tolto.
L'hub risponde solo in JSON, senza stream. Nessun client (ChatGPT, Claude, Gemini) avvia un turno
del modello per un evento del server. Quindi:

1. «Spiegami meglio» crea un `aiRequest` (in attesa, scade dopo 14 giorni).
2. Un agente collegato la vede con `studyos_list_ai_requests` (e un contatore in
   `studyos_overview`/`studyos_status`), la prende con `studyos_take_ai_request` (lease di 15
   minuti, token di presa), produce la spiegazione e la salva con `studyos_finish_ai_request`.
3. La scheda mostra la spiegazione al prossimo aggiornamento dello store (subito con `/mcp`, alla
   sync successiva con il connettore remoto).

Automazione reale: un'attività pianificata dell'assistente (es. Claude Code/Claude Desktop
«scheduled tasks») sul connettore remoto può elaborare la coda con l'app chiusa. L'app non promette
esecuzioni immediate: mostra «In attesa di un assistente» e come farla elaborare.

## 10. Connettore remoto e CPU

`studyos_agent_pull` riceve `p_types` (facoltativo): il runner tiene una cache per gruppo di tipi
(base, raccolte, schede, progressi, AI) e carica solo i gruppi dello strumento chiamato. Gli
strumenti esistenti non leggono mai i dati di studio: il loro costo non cambia con il numero di
schede. Con `agent.sql` vecchio (PGRST202) si torna al pull unico.

Misure (16/11/2026, stack locale, ultima esecuzione di `learning-stress.mjs` sul codice finale):
CPU del processo Node per chiamata, una stima e non il `cpuTime` del Worker; mediana (p95).
`studyos_learning_stats` con 1000 schede e 3000 risposte: a cache calda 4,4 ms (17,3), a cache
vuota 11,7 ms, prima chiamata del processo (compilazione) ~50 ms. `studyos_list_flashcards` calda
2,9 ms, a freddo con 1000 schede 7,4 ms (11,6). `studyos_overview` calda 1,0 ms, a freddo 3,2 ms.
`studyos_save_flashcards` da 100 schede 6,9 ms (12,3); con 3 account insieme 9,7 ms (14,7).
`take`/`finish` di una richiesta ~2 ms. Rischio: le chiamate a freddo di account grandi e i lotti da
100 stanno vicino o sopra i 10 ms del piano Free. Se `wrangler tail` lo conferma, le strade sono
lotti più piccoli e una proiezione delle statistiche sul server (non un piano a pagamento). Il
parse delle date con «Z» salta la regex di `zonedDate` (le statistiche ne leggono migliaia).

## 11. Condivisione

Nuova sezione `flashcards` («Flashcard e quiz»), `view` o `edit`, **sempre per tutte le materie**:
una raccolta può non avere materia e un filtro per materia lascerebbe fuori schede e domande senza
`subjectId` (vincolo `studyos_shares_subjects_check` e `studyos_validate_share_items` rifiutano
`subject_ids`). Copre `studyDeck`, `flashcard`, `quiz`, `quizQuestion`: chi riceve vede le righe
originali (nessuna copia), studia con i propri `flashcardState` e `studyRun`, che non entrano mai
nella sezione (`studyos_scope_types`). «Duplica» crea una copia personale indipendente.

Con «Può modificare» chi riceve scrive con `push_shared_rows`: `studyos_recipient_payload`
controlla per tipo i campi obbligatori, quelli facoltativi e il loro tipo JSON (blocchi e opzioni
come array; la forma di ogni blocco la ricontrolla chi legge con `safeBlocks`/`safeOptions`). La
cronologia del proprietario registra chi ha cambiato cosa. Le modifiche condivise restano
«l'ultima scrittura vince»: il controllo di revisione (§8) vale solo per la push degli agenti.
Una raccolta condivisa si elimina solo se vuota (le schede degli altri non spariscono con lei).

Prove: `scripts/supabase/learning-share-tests.sql` (FC1–FC11, in `scratch-pg.sh`), blocco
flashcard di `sharing-check.mjs` (anche Realtime), scenario B di `learning-stress.mjs`.

## 12. Fuori ambito di questa iterazione

Caricamento di immagini su Storage, punteggio parziale dei quiz a risposta multipla, statistiche
comparative tra membri di una raccolta condivisa (richiederebbero regole di privacy esplicite).

## 13. Avvio, sessione e fine del ripasso (UI, semplificata il 16/11/2026)

- **Scheda Ripasso**: «N schede per oggi» (da ripassare, in ritardo, nuove) e un solo pulsante
  «Ripassa N schede»: coda `today` di `buildQueue` (scadute e di oggi per urgenza, poi le mai viste
  nell'ordine della raccolta), al massimo le schede per sessione scelte (10/20/30/50/tutte, 20 di
  partenza, `learn.sessionSize` sul dispositivo). Senza nulla per oggi: «Sei in pari», la prossima
  scadenza e «Ripassa comunque» (tutte, prima le più vicine). «Per raccolta»: un tocco e si parte
  sulla raccolta. Anche «Ripassa» nelle Raccolte parte subito, senza altre scelte.
- **Personalizza**: raccolte, cinque scelte con conteggio e spiegazione (Consigliate, Da ripassare,
  Nuove, Difficili o dubbie, Tutte; quelle a 0 disattivate), quante per sessione, «Mescola l'ordine».
  Scelta e mescolamento restano sul dispositivo (`learn.filter`, `learn.shuffle`).
- **Sessione**: «Mostra la risposta»; sul retro la domanda resta in piccolo sopra la risposta.
  «Com'è andata?» Sbagliata / Dubbia / Corretta, ognuna con «torna tra …» calcolato da `applyReview`
  (`nextWaits`), anche come descrizione accessibile. Tasti nell'ordine dei pulsanti: 1 sbagliata,
  2 dubbia, 3 corretta, 4 salta (Salta anche prima di girare). «Termina», Esc e Indietro portano al
  riepilogo senza conferma (ogni risposta è già salvata); senza risposte si esce.
- **Riepilogo**: completato o terminato, «X di Y schede in …» (tempo misurato per scheda, tetto di
  un'ora come nel salvataggio), percentuale di corrette sulle risposte date (le saltate non contano),
  conteggi, schede «Da rivedere» (sbagliate e dubbie). Azioni sempre in vista nella barra in basso:
  «Ripassa le N da rivedere», «Continua con altre N» (stesso ambito e scelte, escluse le schede viste
  in questa sessione), «Fine».
- **Materia**: ogni scheda, raccolta e quiz mostra il segno della sua materia come nella sezione
  Materie (`SubjectMark`: copertina, icona del corso BARB caricata a parte, icona scelta, sul colore
  della materia). Le raccolte condivise da altre persone hanno materie non tue: icona di riserva.
