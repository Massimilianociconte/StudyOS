# Gruppi e inviti: sincronizzazione condivisa (opzionale)

I gruppi funzionano sempre in locale. La condivisione **tra account diversi**
richiede questa migrazione, da eseguire una volta nel progetto Supabase
(Dashboard → SQL Editor), dopo `supabase/schema.sql`:

```
supabase/groups.sql
```

**Rieseguilo dopo la revisione del 07/10/2026** se lo avevi già applicato: è
idempotente e senza la nuova versione la condivisione non funziona (il
proprietario non risultava membro, quindi niente elenco membri né inviti
nominali lato server). Aggiorna policy, trigger, indice e le due RPC; le righe
esistenti restano.

Senza migrazione: creazione gruppi, bacheca, membri, attività e inviti via
codice/link restano locali; `groupSync` rileva le tabelle assenti e non mostra
alcun errore.

## Tabelle

- `studyos_groups` (testo come id: stesso spazio degli id locali, nessuna rimappatura)
- `studyos_group_members` (per gruppo: proprietario, amministratori, membri)
- `studyos_group_invites` (nominali per email + codice)
- `studyos_group_resources` (bacheca: link, note, file di riferimento, attività)
- `studyos_group_activity` (append-only)

## Sicurezza

- RLS attiva ovunque; privilegi tabella solo ad `authenticated` (come `schema.sql`).
- Letture limitate a membri del gruppo e destinatari degli inviti
  (`recipient_email` contro `auth.jwt() -> email`); la propria riga membro è
  sempre leggibile (serve all'upsert del proprietario alla creazione).
- Nessuno scrive a nome di altri: risorse con `added_by_user_id = auth.uid()`,
  inviti con `from_user_id = auth.uid()` e stato `pending`, attività con
  `actor_user_id` compilato dal server.
- Bacheca: ogni membro può fissare/sfissare; contenuto, gruppo e autore li
  protegge il trigger `studyos_group_resources_guard` (solo autore o
  owner/admin cambiano il contenuto; gruppo e autore mai). Cancellazione:
  autore o owner/admin.
- Membri: il proprietario promuove/retrocede (admin/membro) ma non cede né
  perde la proprietà da qui; un membro può uscire, il proprietario no (elimina
  il gruppo). Codici di invito univoci (`upper(invite_code)`), generati con
  `crypto.getRandomValues`.
- Gli inviti per email valgono quanto la verifica dell'email del progetto:
  tieni attiva la conferma email in Supabase Auth.
- Scritture delicate solo via RPC `SECURITY DEFINER`:
  `accept_group_invite(p_invite_id, p_display_name)`, `decline_group_invite`,
  `join_group_by_code(p_code, p_display_name)` (verifica destinatario/codice,
  idempotenti, registrano attività col nome di chi entra). Il client riprova
  con la firma vecchia se il progetto non è aggiornato (PGRST202).
- Gli helper `studyos_is_group_member` / `studyos_group_role` sono DEFINER per
  non rientrare nelle policy (sola lettura).
- Realtime abilitato sulle 4 tabelle dati; il client usa gli eventi inviti come
  segnale e ricarica comunque via pull.

## Note per il client

- Upsert (`INSERT … ON CONFLICT DO UPDATE`) applica il controllo di INSERT
  alla riga proposta e quello di SELECT alla riga nuova: per righe di altri
  (ruolo di un membro, fissare la risorsa di un altro) si usa un `update`
  mirato. I membri hanno chiave `group_id,user_id`, non `id`.
- Il pull legge prima le proprie appartenenze sul server, poi gruppi, membri,
  bacheca e cronologia. I membri arrivano sempre dal server; ciò che è già
  stato visto sul server (`sharedAt`) e poi sparisce è stato eliminato (o si è
  stati rimossi) e sparisce anche in locale.

## Verifiche eseguite

07/10/2026, stack Supabase locale (CLI): `schema.sql`, `groups.sql` della
versione precedente e poi quello nuovo (aggiornamento e riesecuzione senza
errori). Script con le stesse chiamate di `groupSync.ts` e tre account
(proprietaria, invitato, membro malintenzionato): 41 controlli superati
(creazione, inviti, accettazione col proprio nome, ruoli, unione con codice,
bacheca, cronologia, codici duplicati, uscita, rimozione, eliminazione). Poi
nell'app su due origini: gruppo creato, invito, accettazione, membro visibile
al proprietario, nota pubblicata, promozione ad admin, cancellazione propagata,
rimozione (il gruppo sparisce a chi è rimosso), rientro con codice.

Verifica precedente:

`groups.sql` applicato su Postgres temporaneo con stub `auth` + ruoli:
creazione gruppo/membro/invito come proprietario, lettura invito come
destinatario, accept via RPC, doppio accept rifiutato, join con codice
(case-insensitive), codice errato rifiutato.

## Limiti noti

- I file condivisi sono riferimenti (nome come testo): nessun bucket Storage.
- La proprietà non si trasferisce: il proprietario può solo eliminare il gruppo.
- Le notifiche push/email non esistono: gli inviti arrivano nel pannello
  Notifiche all'apertura dell'app (realtime se aperta) e via link/email manuale.
- Enforce MFA/SSO: invariato rispetto a `schema.sql`.
