# Impostazioni, gruppi, notifiche, task: piano di lavoro

## Scelte architetturali

- **Notifiche**: nuova collezione sincronizzata `notifications` nella pipeline
  `studyos_items` esistente (stessa procedura di `preferences`: COLLECTIONS,
  ENTITY_TYPES, Dexie v5, SYNC_SCHEMA 3, backup full). Persistenza globale
  sull'account, gratis su tutti i dispositivi propri.
- **Gruppi**: entità local-first (`studyGroups`, `groupInvites`,
  `groupResources`, `groupActivities`) anch'esse nella pipeline per sync
  propri dispositivi + backup. Condivisione tra utenti diversi via nuove
  tabelle Supabase (`supabase/groups.sql`, da applicare manualmente come
  `schema.sql`): RLS con RPC ` SECURITY DEFINER` per accept/join, realtime
  sugli inviti per recapito immediato. Senza backend condiviso: inviti via
  codice + messaggio copiabile/mailto, join manuale con codice, deep-link
  `?invito=CODICE` letto all'avvio.
- **Task**: nessun cambio al modello dati; solo UX (empty state, TaskModal,
  DurationField valore+unità, gerarchia CTA Nuova task → Crea task).
- **Impostazioni**: solo riorganizzazione UI a categorie, nessuna logica toccata.

## File nuovi

- `src/components/DurationField.tsx` (valore+unità → minuti, fattori documentati)
- `src/components/TaskModal.tsx` (creazione; riuso stile TaskEditorModal)
- `src/components/NotificationsBell.tsx`, `src/components/NotificationsPanel.tsx`
- `src/views/GroupsView.tsx` (lista, inviti, join, dettaglio bacheca/membri/attività)
- `src/lib/groupSync.ts` (probe tabelle condivise, push/pull inviti, realtime)
- `supabase/groups.sql` + `docs/groups-sync.md`
- `tests/groups.test.mjs`, estensioni `tests/` per notifiche/durate se utili

## File modificati

- `src/types.ts` (5 tipi + snapshot + EntityType + AppView `groups`)
- `src/lib/collections.ts`, `src/lib/db.ts` (v5), `src/lib/backup.ts` (label),
  `src/lib/cloudSync.ts` (SYNC_SCHEMA 3)
- `src/store/useStudyStore.ts` (CRUD notifiche/gruppi + accept/decline + activity)
- `src/components/AppShell.tsx` (voce Gruppi + campanella), `src/components/ui.tsx`? no
- `src/views/TasksView.tsx`, `src/components/TaskEditorModal.tsx`
- `src/views/SettingsView.tsx` (categorie), `src/App.tsx` (vista groups)
- `src/index.css` (keyframes campanella), `docs/agent/*` (stato, gotchas se serve)

## Verifica

`npm test`, `npm run lint`, `npm run build`, `npm run barb:validate`,
SQL di groups.sql su Postgres temporaneo, e2e browser (crea gruppo, invita,
accetta, bacheca, notifiche, task modal, durata) + mobile 375px.
