# StudyOS cloud sync architecture

StudyOS resta pubblicabile su GitHub Pages, ma GitHub Pages deve ospitare solo la static web app. Per account, sessioni e dati condivisi tra dispositivi serve un backend gestito esterno. La scelta consigliata e Supabase:

- Supabase Auth per email/password, magic link e provider OAuth.
- Postgres con Row Level Security per isolare i dati per utente.
- IndexedDB come cache locale e coda offline.
- Web Crypto API per cifrare il contenuto prima dell'upload, se l'utente abilita il vault cloud.
- Nessuna `service_role` key, nessun segreto privato e nessun token amministrativo nel frontend.

## Perche non solo GitHub

Un repository GitHub pubblico o GitHub Pages non e un database privato. Salvare dati personali nel repository, in file JSON pubblici o usando un token GitHub nel frontend esporrebbe dati o credenziali. GitHub Pages puo servire l'app, mentre il cloud sync deve passare da un servizio con autenticazione, regole lato server e storage privato.

## Modello dati cloud

Schema v1: una tabella generica `studyos_items`, con una riga per entita applicativa.

- `user_id`: proprietario, preso da Supabase Auth.
- `entity_type`: `subject`, `task`, `calendarEvent`, `studySession`, ecc.
- `entity_id`: id locale StudyOS.
- `payload`: JSON cifrato o plain JSON, a seconda delle impostazioni workspace.
- `deleted`: tombstone per propagare eliminazioni.
- `version`: contatore semplice per rilevare conflitti.
- `updated_at`: cursore di sync.
- `client_id`: identifica il browser/dispositivo che ha scritto la modifica.

## Sicurezza

Regole minime:

- RLS attiva sulla tabella.
- `select`, `insert`, `update`, `delete` consentiti solo quando `auth.uid() = user_id`.
- Chiave pubblicabile Supabase nel frontend; mai chiave secret/service role.
- Possibile cifratura end-to-end del payload con AES-GCM. In quel caso Supabase salva ciphertext, non dati leggibili.
- Passphrase workspace separata dall'account. L'account autentica, la passphrase decritta i dati.

## Flusso sync offline-first

1. Ogni modifica viene prima applicata a Zustand e IndexedDB.
2. La modifica viene aggiunta a una coda locale `sync_outbox`.
3. Quando `navigator.onLine` e l'utente e autenticato, il sync worker:
   - invia le operazioni locali pendenti;
   - scarica righe remote con `updated_at > lastPulledAt`;
   - applica merge per entita;
   - aggiorna `lastPulledAt`.
4. Se browser o rete cadono, i dati restano in IndexedDB.
5. Al ritorno online, la coda viene riprodotta.

## Strategia conflitti

Per la prima versione:

- Se una sola parte ha modifiche, applica quella.
- Se locale e remoto hanno entrambi modifiche dopo l'ultimo sync, crea un conflitto locale invece di sovrascrivere silenziosamente.
- Mostra una vista "Conflitti" nelle impostazioni per scegliere locale/remoto o duplicare.

Per una versione successiva:

- Merge campo-per-campo su entita semplici.
- CRDT solo per note lunghe o editor markdown collaborativi.

## Allegati

MVP:

- Allegati piccoli cifrati nel `payload`.
- Limite consigliato lato client: 5-10 MB per allegato.

Versione successiva:

- Supabase Storage bucket privato `studyos-attachments`.
- Path `user_id/attachment_id`.
- Metadata cifrati in `studyos_items`.
- File cifrato lato client prima dell'upload.

## UX account

Stati principali:

- Offline locale: funziona senza account, solo su quel browser.
- Account collegato: login Supabase, sync attiva.
- Vault cloud: dopo login serve passphrase workspace per decrittare.
- Sync sospesa: rete assente, modifiche in coda.
- Conflitto: serve scelta utente.

## Variabili ambiente

Vite espone solo variabili con prefisso `VITE_`.

```bash
VITE_SUPABASE_URL=https://project-id.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

Queste non sono segreti amministrativi. La protezione vera deve stare in RLS e nelle policy.

## Passi di implementazione

1. Creare progetto Supabase.
2. Eseguire `supabase/schema.sql`.
3. Configurare Auth: email confirmation, redirect URL GitHub Pages, eventuale OAuth.
4. Aggiungere `@supabase/supabase-js`.
5. Creare `cloudAuthStore` e `cloudSyncService`.
6. Estendere Dexie con `sync_outbox`, `sync_meta`, `conflicts`.
7. Aggiungere UI Account/Sync in Impostazioni.
8. Testare con due browser e rete offline/online.
