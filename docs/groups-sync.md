# Gruppi e inviti: sincronizzazione condivisa (opzionale)

I gruppi funzionano sempre in locale. La condivisione **tra account diversi**
richiede questa migrazione, da eseguire una volta nel progetto Supabase
(Dashboard → SQL Editor), dopo `supabase/schema.sql`:

```
supabase/groups.sql
```

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
  (`recipient_email` contro `auth.jwt() -> email`).
- Scritture delicate solo via RPC `SECURITY DEFINER`:
  `accept_group_invite`, `decline_group_invite`, `join_group_by_code`
  (verifica destinatario/codice, idempotenti, registrano attività).
- Gli helper `studyos_is_group_member` / `studyos_group_role` sono DEFINER per
  non rientrare nelle policy (sola lettura).
- Realtime abilitato sulle 4 tabelle dati; il client usa gli eventi inviti come
  segnale e ricarica comunque via pull.

## Verifiche eseguite

`groups.sql` applicato su Postgres temporaneo con stub `auth` + ruoli:
creazione gruppo/membro/invito come proprietario, lettura invito come
destinatario, accept via RPC, doppio accept rifiutato, join con codice
(case-insensitive), codice errato rifiutato.

## Limiti noti

- I file condivisi sono riferimenti (nome come testo): nessun bucket Storage.
- Le notifiche push/email non esistono: gli inviti arrivano nel pannello
  Notifiche all'apertura dell'app (realtime se aperta) e via link/email manuale.
- Enforce MFA/SSO: invariato rispetto a `schema.sql`.
