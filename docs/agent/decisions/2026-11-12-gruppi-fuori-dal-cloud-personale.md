# ADR: i gruppi pubblicati non passano dal cloud personale

- Stato: accettata
- Data: 12/11/2026
- Sostituisce: nessuna
- Codice: `src/lib/syncScope.ts`, `src/lib/persistence.ts` (`buildOutbox`, `advanceStamps`),
  `src/lib/cloudSync.ts` (`skipServerBacked`, `enqueueAllLocal`), `src/lib/groupSync.ts`

## Contesto

I gruppi hanno le loro tabelle (`supabase/groups.sql`), lette dal client con la RLS. Le stesse
entità (`studyGroups`, `groupResources`, `groupActivities`, `groupInvites`) erano però anche
collezioni personali, sincronizzate in `studyos_items` con LWW su `updatedAt`. Due fonti di verità
per lo stesso dato davano errori che nessuna correzione locale chiudeva:

- uscire da un gruppo (o esserne tolti) creava un tombstone personale datato «adesso»; al rientro
  il gruppo arrivava dal server con il suo timbro vecchio e il tombstone vinceva: il gruppo
  compariva e spariva di continuo, su ogni dispositivo dell'account;
- un invito in attesa tolto dalla sync personale tornava «nuovo» a ogni pull e rinotificava;
- il merge dei gruppi cambiava membri e `sharedAt` senza un timbro nuovo e il cloud personale
  rifiutava la riga per sempre («Conflitto cloud irrisolto»).

## Decisione

Un'entità dei gruppi la cui verità è sul server dei gruppi non entra nel cloud personale:
`studyGroups` e `groupResources` con `sharedAt`; `groupActivities` di un gruppo pubblicato;
`groupInvites` di un gruppo pubblicato o che non è sul dispositivo (gli inviti ricevuti). Non si
accodano (`buildOutbox`, eliminazioni comprese), non si riaccodano (`enqueueAllLocal`), il pull li
ignora (`planMerge` con `skip`), e il push toglie dalla coda le voci rimaste da prima. I gruppi mai
pubblicati (creati senza account) e le proprie risorse non ancora pubblicate restano personali.

Il server dei gruppi decide anche le azioni: accettare, rifiutare, uscire, eliminare, togliere un
membro, cambiare ruolo, fissare ed eliminare una risorsa condivisa scrivono prima sul server; se non
riesce la copia locale non cambia. Le pubblicazioni fallite (gruppo, risorsa, invito) restano in una
coda per account e si riprovano dopo ogni pull, solo dal dispositivo che le ha create.

## Alternative considerate

- **Timbro «adesso» per ciò che il merge aggiunge**: chiude il caso del rientro, non gli altri
  (un'eliminazione sul server non riuscita, una risposta troncata, gli inviti); le due copie
  restano in gara.
- **Gruppi solo nel cloud personale**: perde la RLS tra account e il tempo reale tra membri.
- **Gruppi solo nelle tabelle dei gruppi, anche quelli mai pubblicati**: un gruppo creato senza
  account non avrebbe più copia sugli altri dispositivi; lasciati personali finché non si pubblicano.

## Conseguenze

- Le righe dei gruppi già in `studyos_items` restano e si ignorano; non serve una migrazione SQL.
- Ogni dispositivo scarica i propri gruppi dal server (serve l'account); le notifiche degli inviti
  hanno un id stabile (`notif-group-invite-<id>`) perché ogni dispositivo le crea da sé.
- Il connettore MCP remoto legge solo il cloud personale: non espone più i gruppi
  (`studyos_list_groups`, `studyos_list_group_board` in `CLOUD_UNAVAILABLE`) e la panoramica remota
  non li conta.
- Un gruppo appena pubblicato lascia nel cloud personale la sua ultima copia non pubblicata: un
  dispositivo nuovo la riceve, poi il pull dei gruppi la completa con `sharedAt`. Se nel frattempo il
  gruppo è stato eliminato sul server, quella copia resta come gruppo solo locale finché l'utente
  non la elimina; non viene ripubblicata da sola (la coda di pubblicazione è del dispositivo che
  l'ha creata), solo se il proprietario apre «Invita» su quel gruppo.

## Componenti toccati

`syncScope.ts` (regola), `persistence.ts`, `cloudSync.ts`, `syncMerge.ts` (`skip`), `groupSync.ts`,
`groups.ts`, `GroupsView.tsx`, `GroupInvite.tsx`, `agent/catalog.ts`, `agent/cloudRunner.ts`,
`agent/execute.ts`. Documentazione: [groups-sync.md](../../groups-sync.md), [GOTCHAS.md](../GOTCHAS.md).
