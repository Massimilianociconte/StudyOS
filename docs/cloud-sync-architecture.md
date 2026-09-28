# Sincronizzazione cloud di StudyOS

La PWA conserva i dati in IndexedDB. La sincronizzazione opzionale usa
Supabase Auth e la tabella `studyos_items` definita in `supabase/schema.sql`,
con RLS per proprietario. GitHub Pages ospita soltanto i file statici.

Prima di usare una build con questa versione del client, applica il contenuto
aggiornato di `supabase/schema.sql` nel progetto Supabase. La funzione
`push_studyos_rows` controlla e scrive ogni versione nella stessa operazione
SQL; se manca, il client segnala errore e conserva le modifiche in coda.

Le variabili pubbliche della build sono `VITE_SUPABASE_URL` e
`VITE_SUPABASE_PUBLISHABLE_KEY`. La chiave `service_role` non deve entrare nel
frontend. Ogni modifica locale crea una voce in `syncOutbox`; il servizio
`src/lib/cloudSync.ts` invia le righe, scarica le modifiche con un cursore
`updated_at` e le fonde per entità. I tombstone propagano le eliminazioni;
realtime segnala che è utile fare un pull, con un controllo periodico di
riserva. Un errore di invio lascia la voce in coda e viene ritentato.
Il server respinge una versione più vecchia rispetto a quella già salvata;
il client rilegge la riga in conflitto. Un batch troppo grande viene isolato,
così le altre modifiche continuano a partire. I nuovi file incorporati hanno
un limite di 600 KiB; per file più grandi usa un link esterno.

Al primo collegamento e quando cambia account viene eseguito un pull completo.
Il cambio account chiede se unire o sostituire i dati locali. Il vault bloccato
sospende la sync; prima di bloccarlo le modifiche devono essere salvate.
Un cambio account con modifiche ancora in coda viene fermato finché l'account
precedente non completa la sincronizzazione, per non perdere i tombstone.
Un reset solo locale forza un nuovo pull dal cloud; un reset propagato crea
tombstone e li invia quando la connessione è disponibile.

**Limite di privacy attuale:** il vault cifra lo snapshot in IndexedDB e i
backup possono essere cifrati, ma la sync Supabase invia il payload JSON in
chiaro (`encrypted: false`). Le policy RLS controllano l'accesso; non c'è
ancora cifratura end-to-end del cloud. La UI lo segnala esplicitamente.

Garanzie aggiuntive (revisione del 28 settembre 2026):

- con il vault bloccato o durante il caricamento lo stato in memoria è vuoto: la
  sync si sospende (niente pull applicati, cursore fermo, nessuna voce dell'outbox
  trasformata in eliminazione) e riparte allo sblocco;
- una voce "put" senza entità in memoria non diventa mai un tombstone;
- il primo collegamento di un nuovo dispositivo non ricarica le entità appena
  scaricate (prima veniva re-inviato l'intero dataset, allegati compresi);
- il ripristino di un backup assegna `updatedAt` = adesso alle entità cambiate,
  altrimenti il server (LWW) le rifiuterebbe e il pull annullerebbe il ripristino;
- richieste Supabase con timeout di 30 s; errori di rete mostrati in italiano;
- il logout funziona anche offline (la sessione viene rimossa dal dispositivo);
- supabase-js e il motore di sync sono caricati dopo l'avvio (bundle iniziale ~50 KB gz più leggero).

Verifica end-to-end eseguita con stack Supabase locale (CLI, Postgres 17 + Auth +
Realtime) e due origini browser come due dispositivi: upload iniziale di dati
creati prima del login, merge bidirezionale, realtime, eliminazioni, modifica
durante un'interruzione del server + reload + recupero automatico, vault
bloccato durante modifiche remote, ripristino backup, logout offline. Lo schema
è stato provato anche sull'immagine Postgres ufficiale Supabase: LWW, retry
idempotente, id incoerente rifiutato, RLS tra utenti, `anon` senza accesso.
