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

La funzione SQL è stata provata in un PostgreSQL temporaneo con scrittura nuova,
scrittura obsoleta e retry. Per verificare l'intero percorso servono un progetto
Supabase configurato con lo schema e due sessioni browser/autenticazioni reali.
