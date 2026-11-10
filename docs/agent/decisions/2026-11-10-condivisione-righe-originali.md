# ADR: condivisione tra account sulle righe originali di `studyos_items`

- Stato: accettata
- Data: 10/11/2026
- Sostituisce: nessuna
- Design completo: [2026-11-10-sharing-design.md](../../plans/2026-11-10-sharing-design.md)

## Contesto

StudyOS è local-first. La sync opzionale salva una riga per entità in
`studyos_items`, con RLS sul solo proprietario e merge LWW su `updatedAt`.
I gruppi (`supabase/groups.sql`) condividono bacheca, membri e cronologia, ma non
i dati personali. Serve condividere sezioni dei propri dati (calendario, appelli
BARB, attività, studio, progressi, materiali, obiettivi) con una persona o un
gruppo, con permesso di sola lettura o di modifica, aggiornamenti in tempo reale,
revoca immediata e nessuna duplicazione.

## Decisione

1. **Una sola copia sul server.** Chi riceve legge e scrive le righe originali del
   proprietario in `studyos_items`. Nuove policy RLS, che si aggiungono a quelle
   del proprietario, consultano `studyos_shares` (sezione, materie, permesso,
   persona o gruppo). Il client di chi riceve scrive solo con `push_shared_rows`, con la
   stessa regola LWW della sync personale; il server accetta anche le scritture dirette
   sulla tabella che la RLS consente, ripulite dallo stesso trigger
   (`studyos_items_recipient_values`). Il trigger fissa le colonne della riga (`id`,
   `created_at`, `updated_at`, `version`, `encrypted`, `client_id` con prefisso di chi
   scrive), toglie o conserva i campi protetti e controlla i tipi dei campi, così chi
   riceve non può nascondere una modifica al proprietario né lasciargli un valore che le sue
   viste non sanno leggere.
2. **Dati altrui separati nel client.** Una cache dedicata (`useSharedStore`,
   Dexie `sharedItems` e `sharedOutbox`) fuori da `COLLECTIONS`, dalla coda di
   sync personale e dai backup. Con il vault attivo resta solo in memoria.
3. **Copertura definita una volta per sezione.** Una funzione SQL immutable
   (`studyos_scope_covers`) e il suo specchio TypeScript (`src/lib/sharing.ts`),
   provati con gli stessi casi. Gli appelli BARB sono il sottoinsieme degli eventi
   con `sourceUid` `barb-exam-*`; i progressi escludono gli esami con voto.
4. **Cronologia sul server.** Un trigger salva la versione precedente di ogni
   riga modificata da una persona diversa dal proprietario
   (`studyos_item_revisions`, 90 giorni); il ripristino è una nuova versione
   scritta dal proprietario con la sync normale. Copertine, file e `sourceUid`
   restano solo nelle eliminazioni: chi riceve non li cambia, quindi il ripristino
   di una modifica li riprende dalla copia del proprietario (o dall'eliminazione
   successiva). Si può annullare in un colpo tutto ciò che una persona ha cambiato
   da un giorno, con lo stesso ripristino.
5. **Revoca = cancellare la condivisione.** L'accesso cade subito via RLS; la cache
   di chi riceveva si riallinea confrontando gli id visibili quando cambiano i
   permessi e al controllo dei 5 minuti (non a ogni segnale Realtime).
6. **Agente MCP.** Legge e modifica i dati condivisi rispettando i permessi e
   gestisce le condivisioni esistenti. Inviti e accettazioni restano nell'app,
   così email e token non arrivano mai agli agenti.

## Alternative considerate

- **Copiare le righe verso chi riceve** (fan-out). Scartata: duplicati, modifiche
  bidirezionali da riconciliare, una revoca che non cancella le copie già fatte.
- **Spazi condivisi di proprietà comune** (calendari condivisi come entità
  separate). Scartata: obbligherebbe a spostare i dati dai propri spazi e
  cambierebbe il modello local-first di ogni vista.
- **Inserire i dati altrui nelle collezioni personali** con un campo `ownerId`.
  Scartata: finirebbero nella coda di sync, nei backup e nei conteggi personali.
- **Permessi a tre livelli** (vedere, modificare, eliminare). Scartata in favore
  di due livelli con cronologia e ripristino, scelta dall'utente.

## Conseguenze

- `supabase/sharing.sql` va eseguito a mano nel SQL Editor dopo `schema.sql` e
  `groups.sql`. Senza migrazione la condivisione non è disponibile, mentre il
  resto dell'app è invariato.
- La RLS di `studyos_items` diventa più costosa per chi riceve dati. La sync del
  proprietario non paga questo costo: l'espressione del proprietario viene
  valutata prima e le funzioni di condivisione hanno costo alto.
- Realtime applica la RLS a ogni modifica e a ogni iscritto. Il canale di chi
  riceve filtra fino a 100 proprietari; oltre, vale il controllo periodico.
- Un elemento che esce da un filtro non genera un evento realtime per chi lo
  vedeva. Sparisce al pull successivo (al più 5 minuti).
- Il JSON sul server resta in chiaro (limite già noto). Chi riceve vede il
  payload completo delle righe coperte, compresi gli allegati incorporati.
- Sia chi condivide sia chi riceve devono avere un account con la sync attiva.
- Un elemento eliminato conserva solo id e data di eliminazione, quindi chi riceve una
  sezione vede questi due dati anche per gli elementi fuori dal suo filtro per materie.
- La cache separata porta Dexie alla versione 6: tornare a una build con la versione 5 non
  è possibile senza perdere l'accesso al database locale.
- Il controllo dei tipi in `studyos_recipient_payload` ripete i campi di `src/types.ts`:
  un campo obbligatorio nuovo in un tipo condivisibile va aggiunto anche lì.

## Componenti interessati

`supabase/sharing.sql`, `supabase/sharing-verify.sql`,
`scripts/supabase/sharing-check.mjs`, `src/lib/sharing.ts`,
`src/lib/shareSync.ts`, `src/store/useSharedStore.ts`, `src/lib/db.ts` (v6),
`src/lib/labels.ts`, `src/types.ts`, `src/views/SharingView.tsx`,
`src/views/CalendarView.tsx`, `src/views/BarbView.tsx`, le viste Attività, Studio,
Esami, Materiali e Obiettivi, `src/components/AppShell.tsx`, `src/App.tsx`,
`src/agent/catalog.ts`, `src/agent/execute.ts`, `src/agent/constants.ts`, il
Worker `studyos-agent` (nuovo deploy).
