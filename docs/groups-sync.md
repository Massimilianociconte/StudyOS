# Gruppi e inviti: sincronizzazione condivisa (opzionale)

I gruppi funzionano sempre in locale. La condivisione **tra account diversi**
richiede questa migrazione, da eseguire una volta nel progetto Supabase
(Dashboard → SQL Editor), dopo `supabase/schema.sql`:

```
supabase/groups.sql
```

**Rieseguilo dopo la revisione dell'08/10/2026** se lo avevi già applicato: è
idempotente e senza la nuova versione la condivisione non funziona (il
proprietario non risultava membro, quindi niente elenco membri né inviti
nominali lato server). Aggiorna policy, trigger, indice e le RPC (compresa
l'anteprima degli inviti); le righe esistenti restano.

**Rieseguilo anche dopo la revisione del 10/11/2026**: accettare o rifiutare un invito
nominale ora richiede che l'account abbia un'email, uguale a quella dell'invito e
confermata. Ordine: `groups.sql`, poi `sharing.sql` (se usi la condivisione dei dati), poi
`sharing-verify.sql`. Rieseguire `groups.sql` due volte di fila non cambia nulla (provato
sullo stack locale).

## Inviti con link, QR e codice

- Pannello **Invita** (pulsante su ogni gruppo e in cima al dettaglio): link
  da condividere (Condividi di sistema, WhatsApp, Telegram, email, copia), QR
  code (scaricabile o condivisibile come immagine), codice del gruppo e invito
  nominale per email (proprietario/amministratori). Il proprietario può
  generare un nuovo codice: link e QR già inviati smettono di funzionare.
- Link: `…/StudyOS/#invito=GRP-XXXX-XXXX`. Il codice sta nel frammento, che il
  browser non invia ai server (log di GitHub Pages, referrer); i vecchi link
  `?invito=` restano validi.
- All'apertura (anche in una scheda già aperta) l'app ricorda l'invito per 14
  giorni (`studyos-pending-invite` in localStorage), pulisce l'URL e apre
  Gruppi con la scheda **Invito ricevuto**: anteprima dal server (RPC
  `preview_group_invite`: nome, descrizione, membri, responsabile) e un tocco
  su **Entra nel gruppo**. La conferma è voluta: entrando, nome ed email sono
  visibili agli altri membri.
- Senza accesso: **Accedi o registrati per entrare** apre il login nella
  stessa schermata; appena arriva la sessione (login, registrazione o ritorno
  dalla conferma email su questo dispositivo) si entra da soli con quell'account.
  Il link di conferma email porta `?invito=…`, così aprendolo da un altro
  dispositivo si ritrova la scheda dell'invito già con l'account confermato.
- Perché quel link funzioni, in Supabase → Authentication → URL Configuration
  i Redirect URLs devono accettare la query: aggiungi
  `https://massimilianociconte.github.io/StudyOS/**` (altrimenti Supabase usa
  il Site URL e l'invito vale solo sul dispositivo dove è stato aperto).

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
  tieni attiva la conferma email in Supabase Auth. `accept_group_invite` e
  `decline_group_invite` rifiutano anche da sole un account senza email nel token, con
  un'email diversa o non ancora confermata (`auth.users.email_confirmed_at`): entrare in un
  gruppo dà accesso alle condivisioni fatte a quel gruppo.
- Scritture delicate solo via RPC `SECURITY DEFINER`:
  `accept_group_invite(p_invite_id, p_display_name)`, `decline_group_invite`,
  `join_group_by_code(p_code, p_display_name)` (verifica destinatario/codice,
  idempotenti, registrano attività col nome di chi entra). Il client riprova
  con la firma vecchia se il progetto non è aggiornato (PGRST202).
- Gli helper `studyos_is_group_member` / `studyos_group_role` sono DEFINER per
  non rientrare nelle policy (sola lettura).
- Realtime abilitato sulle 4 tabelle dati. Il client usa gli eventi solo come
  segnale e ricarica comunque via pull (con le policy RLS):
  - inviti: canale degli inviti, come prima;
  - bacheca, cronologia e gruppi (`studyos-groups:<id utente>`): INSERT e UPDATE di
    risorse, INSERT di attività e UPDATE di gruppi filtrati con `group_id=in.(…)` /
    `id=in.(…)` sui propri gruppi (al massimo 100, id con soli `A-Za-z0-9_-`, vedi
    `realtimeGroupIds`). I DELETE arrivano a tutti senza filtro e con la sola chiave:
    contano solo se l'id è già in locale. Chi entra o esce scrive una riga di cronologia,
    quindi i membri arrivano con quella.
  - pull 400 ms dopo l'ultimo segnale, uno alla volta (uno solo in coda); al rientro
    della connessione, quando la pagina torna visibile o si torna online dopo 30 s senza
    pull, e ogni 5 minuti a pagina visibile.
  - il canale si rifà quando cambiano i propri gruppi (creazione, ingresso, uscita) e si
    ferma all'uscita dall'account. Il file della bacheca resta solo un nome: i file veri
    passano da «Materiali e note» condivisi al gruppo.

## Note per il client

- Upsert (`INSERT … ON CONFLICT DO UPDATE`) applica il controllo di INSERT
  alla riga proposta e quello di SELECT alla riga nuova: per righe di altri
  (ruolo di un membro, fissare la risorsa di un altro) si usa un `update`
  mirato. I membri hanno chiave `group_id,user_id`, non `id`.
- Il pull legge prima le proprie appartenenze sul server, poi gruppi, membri,
  bacheca (a pagine per `id`, mai troncata) e cronologia. I membri arrivano sempre dal
  server; ciò che è già stato visto sul server (`sharedAt`) e poi sparisce è stato
  eliminato (o si è stati rimossi) e sparisce anche in locale, con i suoi inviti.
- **Una sola fonte di verità** (dal 12/11/2026, `src/lib/syncScope.ts`): gruppi pubblicati
  (`sharedAt`), le loro risorse pubblicate, cronologia e inviti di un gruppo pubblicato (o di
  un gruppo che non è sul dispositivo, cioè gli inviti ricevuti) **non passano più dal cloud
  personale** (`studyos_items`): né in invio, né in lettura, né nel reinvio completo. Prima
  vivevano in due posti e l'eliminazione locale (uscita, rimozione) diventava un tombstone
  personale datato «adesso» che vinceva sul gruppo rientrato con il timbro vecchio del server:
  il gruppo ricompariva e spariva di continuo e ogni pull rinotificava gli inviti. I gruppi mai
  pubblicati (creati senza account) e le proprie risorse non ancora pubblicate restano nel cloud
  personale. Le righe vecchie dei gruppi rimaste in `studyos_items` si ignorano; il connettore
  MCP remoto, che legge solo il cloud personale, non espone più i gruppi.
- **Inviti ricevuti**: si leggono tutti quelli in attesa più quelli risposti negli ultimi 30
  giorni. Un invito accettato o rifiutato da un altro dispositivo si allinea; uno in attesa che
  il server non ha più (ritirato, gruppo eliminato) sparisce. La notifica di un invito ha id
  `notif-group-invite-<id>` (una sola su tutti i dispositivi) e diventa letta quando per quel
  gruppo non resta nessun invito ricevuto in attesa. L'elenco «Inviti ricevuti» mostra solo gli
  inviti alla propria email, e solo con l'account collegato.
- **Il server decide**: accetta/rifiuta usano solo l'RPC. Rete assente = l'invito resta in
  attesa con un messaggio («Invito già gestito», «Invito non trovato», «altro account» hanno
  ciascuno il loro esito, `classifyGroupRpcError`). Uscire, eliminare il gruppo, togliere un
  membro, cambiare ruolo, fissare o eliminare una risorsa condivisa scrivono prima sul server;
  se non riesce la copia locale non cambia e l'app lo dice. Le cancellazioni e gli `update`
  controllano le righe toccate: con la RLS una riga non permessa dà zero righe senza errore. Il
  ruolo si scrive prima del gruppo, così il segnale Realtime non porta un pull col ruolo vecchio.
- **Pubblicazioni da riprovare**: gruppo (con la riga del proprietario), risorsa o invito per
  email creati quando il server non rispondeva entrano in una coda (`groupSync:publishQueue:v1`
  in Dexie `meta`, per account) e si riprovano dopo ogni pull riuscito. Solo il dispositivo che
  li ha creati li riprova: un elemento eliminato sul server non torna da un'altra copia. Dopo il
  pull si ripubblica anche la riga del proprietario se il server non l'ha (creazione interrotta
  tra le due scritture). «Disattiva i vecchi inviti» che non riesce a pubblicare il codice nuovo
  rimette quello vecchio.
- **Ingresso dopo l'accesso**: «Entra» scelto prima di accedere vale 2 ore
  (`CONFIRM_MAX_AGE_MS`): dopo, la scheda dell'invito chiede di nuovo, così chi accede giorni
  dopo sullo stesso computer non entra nel gruppo di un altro. Se il server non risponde
  l'invito resta e si riprova (dopo 15 s, 60 s e al ritorno della rete), invece di finire in
  «Codice non valido». Un gruppo pubblicato si raggiunge solo dal server: niente ingresso «in
  locale».
- Il pull ricontrolla l'account prima di unire i dati e prima delle notifiche: un'uscita a metà
  passata non riempie il profilo svuotato con i gruppi dell'account di prima.

## Verifiche eseguite

10/11/2026, stack Supabase locale: `schema.sql`, `groups.sql`, `sharing.sql`
eseguito due volte e `sharing-verify.sql` tutto `true` (`shared_item_policies` 3,
`own_item_policies` 4). `sharing-check.mjs` con quattro account: 85 controlli superati,
0 falliti. Nell'app su due origini: invito con reciprocità, calendari reciproci in tempo
reale (circa 2 secondi), invito che compare in tempo reale (0,63 s), permesso cambiato e
revocato, appelli condivisi, attività modificata e ripristinata dalla cronologia, uscita,
logout che cancella la cache dei dati altrui.

08/10/2026, stack locale con lo schema aggiornato da quello precedente: link
aperto da un account non registrato → registrazione dal pannello dell'invito →
ingresso automatico (membro col nome dall'email, una sola voce in cronologia);
anteprima e ingresso con un tocco da account già connesso; codice rigenerato:
link vecchio "non più valido", nuovo valido; "Fai già parte del gruppo";
link incollato in una scheda già aperta; QR riletto con un decoder
indipendente (jsQR); pannello a 375 px senza sforamenti.

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

## Condivisione dei propri dati (`sharing.sql`)

Oltre ai gruppi, ognuno può dare accesso a parti dei propri dati a una persona o a un
gruppo, dalla sezione **Condivisione** (gruppo Strumenti) o dal pulsante **Condividi**
delle viste. Serve `supabase/sharing.sql`, eseguito dopo `schema.sql` e `groups.sql`.
Decisione: [ADR](agent/decisions/2026-11-10-condivisione-righe-originali.md); design:
[spec](plans/2026-11-10-sharing-design.md).

- **Sezioni**: Calendario, Appelli ufficiali (solo lettura), Attività, Studio, Progressi
  (esami ancora senza voto), Materiali e note, Obiettivi. Filtro facoltativo per materie,
  tranne per gli obiettivi. La copertura è `studyos_scope_covers` in SQL e `scopeCovers` in
  `src/lib/sharing.ts`, con gli stessi casi di prova.
- **Permessi**: "Può vedere" o "Può modificare", modificabili e revocabili in ogni momento.
  Chi riceve può uscire da una condivisione diretta; una condivisione di gruppo la toglie
  solo chi l'ha data. Chi esce da un gruppo (o ne viene rimosso) perde le condivisioni che
  aveva dato a quel gruppo; eliminare il gruppo le cancella tutte.
- **Una sola copia**: chi riceve legge le righe originali di `studyos_items` tramite RLS
  (`studyos_shares`). Il client scrive solo con l'RPC `push_shared_rows` (stessa regola LWW
  della sync personale, al massimo 200 righe e 900 KB per lotto, per proprietario, esiti
  `stale` e `denied`; un lotto che fallisce non ferma gli altri né il pull, e alla passata dopo
  parte per ultimo; un errore di rete o un timeout ferma i lotti dopo di lui); il server accetta
  anche le scritture dirette sulla tabella che la RLS consente, ripulite dallo stesso trigger
  (vedi sotto). Nel client i dati altrui
  vivono in `useSharedStore` e nelle tabelle Dexie `sharedItems` e `sharedOutbox`, mai
  nelle collezioni personali, nei backup o nei conteggi; con la password dell'app attiva
  restano solo in memoria.
- **Valori scritti da chi riceve**: li controlla il server, non il client. La funzione
  `studyos_recipient_payload` e il trigger `studyos_items_recipient_values` su
  `studyos_items` valgono anche per le scritture dirette sulla tabella che la RLS
  consentirebbe. Chi riceve non può impostare né cambiare `cover`, `dataUrl`, `avatarDataUrl`
  e gli altri `*DataUrl`, `sourceUid`, l'etichetta `appello-importato` e i `links` di un
  evento (restano quelli già salvati; in creazione `links` è `[]`). Il `color` deve essere
  esadecimale (`#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`), i link (anche `externalUrl`) devono essere http(s); in entrambi i casi vale anche un valore uguale a quello già salvato. Una
  data di aggiornamento o eliminazione nel futuro (`updatedAt`, `deletedAt`) viene ridotta
  all'ora del server. Una riga rifiutata esce come `denied`. Anche le viste del proprietario
  ripuliscono colori, immagini e link (`safeCssColor`, `safeImageDataUrl`, `safeHref`).
- **Colonne della riga**: per chi riceve le decide il server, anche nelle scritture dirette.
  In creazione `id` nuovo, `created_at` e `updated_at` all'ora del server, `version` 1,
  `encrypted` falso; in modifica `id`, `created_at` ed `encrypted` restano quelli salvati,
  mentre `updated_at` e `version` li aggiorna il trigger di `schema.sql`. `client_id` riceve
  sempre il prefisso `r:` seguito dall'id di chi scrive e da `:`, così nessuno può far passare
  la propria modifica per una del proprietario (il pull e Realtime del proprietario saltano
  il suo `client_id`).
- **Tipi dei campi**: in modifica un campo già presente non può cambiare tipo JSON (un
  titolo resta testo, una lista resta lista); `null` resta ammesso, tranne per i testi
  obbligatori e le liste. In creazione la funzione conosce i campi di ogni tipo (`src/types.ts`): i
  testi obbligatori (per esempio titolo, inizio e fine di un evento) devono essere testo e
  le liste (`tags`, `checklist`, `subtasks`, `program`…) devono essere liste. Un testo
  obbligatorio o una lista non possono diventare `null` né sparire, perché le viste del
  proprietario li leggono senza controlli. I campi sconosciuti restano liberi. Il client
  toglie già prima dell'invio `cover`, `dataUrl`, gli altri `*DataUrl` e `sourceUid`: il
  server, senza la chiave, tiene il valore salvato.
- **Avvisi a chi riceve**: un rifiuto (`denied`) mostra "Non hai più il permesso di
  modificare i dati di …" in cima a ogni sezione, con il pulsante "Ok" per chiuderlo. Le righe
  rifiutate si rileggono prima di togliere la voce dalla coda (se la rilettura fallisce la voce
  resta e si riprova); un'eliminazione rifiutata di una riga che non c'è più o è già eliminata
  conta come riuscita, senza avviso. Se
  una condivisione è sparita mentre la si cambiava o toglieva, l'app lo dice ("Questa
  condivisione non c'è più.") e ricarica l'elenco.
- **Cronometro**: se chi ha "Può modificare" cambia lo stato di un'attività condivisa, il
  cronometro del proprietario si chiude come nella sua app (`taskStatusTransitionPatch`); su
  un'attività altrui non si può impostare "In corso".
- **Cronologia**: ogni modifica fatta da altri salva la versione precedente in
  `studyos_item_revisions` per 90 giorni. Il proprietario la vede in "Modifiche di altri"
  (le ultime 100) e la ripristina: il ripristino è una nuova versione scritta da lui.
  Copertine, file incorporati e `sourceUid` restano solo nelle eliminazioni
  (`studyos_without_protected`): chi riceve non li può cambiare, quindi il ripristino di una
  modifica li riprende dalla copia del proprietario o, se l'elemento è stato poi eliminato da
  altri, dall'eliminazione salvata. Senza nessuna delle due (eliminato dal proprietario, o non
  ancora arrivato su quel dispositivo) la versione di un evento, un'attività, un esame o un
  allegato non si ripristina e «Ripristina» non compare; sessioni, argomenti, obiettivi e note
  non hanno file e tornano sempre. Il controllo finale sta nel negozio (`restoredPayload`), al
  momento di scrivere. L'elenco scarica solo titoli e id; la versione intera arriva al ripristino.
- **Annulla le modifiche di una persona** ("Modifiche di altri"): scelti la persona e il
  giorno, ogni elemento che ha modificato o eliminato torna alla versione prima della sua
  prima modifica da quel giorno, tutto in un salvataggio. Prima un controllo dice quanti
  elementi tornano, quanti aggiunti da lei restano (si eliminano a mano), quanti hai eliminato
  tu (restano eliminati), quanti non sono ancora sul dispositivo, e tra quelli che tornano su
  quanti hanno cambiato qualcosa dopo altre persone o tu, e quali avevi eliminato tu (tornano).
  Le tue modifiche non lasciano revisioni: si riconoscono dall'ora del server della riga, più
  recente dell'ultima revisione. Si può scegliere di lasciare com'è ciò che è stato cambiato
  dopo. La conferma esegue il controllo letto: se nel frattempo è cambiato qualcosa non scrive
  nulla e mostra il riepilogo nuovo. L'esito dice anche quanti elementi non si sono potuti
  ripristinare. Le persone tra cui scegliere sono chi ha cambiato qualcosa negli ultimi 90
  giorni (anche se non può più modificare) e chi ha «Può modificare».
- **Appelli condivisi** (Corso di laurea → "Appelli condivisi"): una riga per esame e per
  giorno; "Anche tu" compare solo se la data è la stessa; i link mostrano il dominio.
- **Inviti**: `create_share_invite` restituisce un token di 64 caratteri esadecimali; sul
  server resta solo il suo hash (`token_hash`, non leggibile dai client). Link
  `…/StudyOS/#condividi=` seguito dal token, valido 14 giorni; l'invito aperto resta in sospeso in
  `localStorage` (`studyos-pending-share`, 14 giorni) finché non si accede; l'uscita o il cambio
  di account lo cancellano (un link aperto da disconnessi sopravvive invece ad accesso,
  registrazione e conferma email). Un invito con
  email vale solo per quell'account. Chi accetta può condividere qualcosa in cambio, se
  l'invito lo chiede.
- **Senza invito** si può condividere solo con chi si conosce già: un gruppo in comune o
  una condivisione attiva in uno dei due sensi (`studyos_knows_user`).
- **Aggiornamenti**: Realtime su `studyos_shares`, `studyos_share_invites` e sulle righe dei
  proprietari (fino a 100 persone per canale), più un controllo ogni 5 minuti e al ritorno
  sulla scheda. Il confronto con tutti gli id visibili si fa al controllo dei 5 minuti, al
  ritorno sulla scheda se l'ultimo è più vecchio di 5 minuti e quando cambiano i permessi di
  un proprietario: un segnale Realtime scarica solo le righe cambiate. Un elemento che esce da
  un filtro sparisce al controllo successivo. Le cancellazioni vere (`DELETE`, solo account
  eliminati) non arrivano sul canale filtrato per proprietario: la riga vecchia ha solo l'id, e
  arriva invece a ogni iscritto senza filtro. Le toglie il controllo dei 5 minuti.
- **Agenti MCP**: leggono e modificano i dati condivisi secondo i permessi e gestiscono le
  condivisioni esistenti; inviti e accettazioni restano nell'app. `studyos_share_with` e
  `studyos_update_share` chiedono sempre conferma, anche in una sessione con «Modifiche senza
  conferma». Vedi [agent-mcp.md](agent-mcp.md).

Prova automatica sullo stack locale (porte 5542x, mai lo stack di altri progetti):
`scripts/supabase/local-stack.md` e `scripts/supabase/sharing-check.mjs`, che si rifiuta di
girare fuori da localhost.

## Limiti noti

- I file condivisi sono riferimenti (nome come testo): nessun bucket Storage.
- La proprietà non si trasferisce: il proprietario può solo eliminare il gruppo.
- Le notifiche push/email non esistono: gli inviti arrivano nel pannello
  Notifiche all'apertura dell'app (realtime se aperta) e via link/email manuale.
- Enforce MFA/SSO: invariato rispetto a `schema.sql`.
- Chi esce scrive «ha lasciato il gruppo» prima di togliersi (dopo non è più membro e la RLS
  rifiuterebbe la voce) e la cronologia non ha policy di delete: se la rete cade proprio tra le
  due chiamate la voce resta anche se l'uscita non è riuscita (il gruppo resta e l'app lo dice).
  La correzione vera è un trigger sul delete di `studyos_group_members`, da aggiungere in SQL.
- Condivisione, limiti noti: il logout scarta le modifiche a dati altrui non ancora inviate
  (il pannello di uscita lo dice e offre «Sincronizza ora»); blocco, sblocco e cambio della
  password dell'app le conservano in memoria (anche ad app bloccata: nessuna vista le mostra e
  non vanno su disco, ma il blocco non le toglie dalla memoria come i dati personali), ma con la password attiva un ricaricamento o il
  passaggio a un'altra scheda («Usa questa scheda») le perde; dopo lo sblocco con la password dell'app la prima sync non mostra le notifiche di
  "nuova condivisione"; il token di invito viaggia in `?condividi=` nel reindirizzamento
  della conferma email (scelta di design) e può finire nei log di autenticazione o proxy e
  nella cronologia del browser, ma è monouso e scade dopo 14 giorni; la cronologia mostra al
  più le ultime 100 modifiche degli ultimi 90 giorni (l'annullamento delle modifiche di una
  persona ne legge fino a 5000 dal giorno scelto); ripristinare un elemento eliminato da
  un'altra persona usa l'orologio del proprietario (raro caso in cui una modifica più recente va persa se
  l'orologio dell'altra persona era avanti, ora limitato dal controllo del server sulle date future); un lotto di chi riceve
  può fallire con un errore invece di `denied` in una rara corsa, se il proprietario cambia
  nello stesso istante un colore non esadecimale o il tipo di un campo.
- Chi riceve una sezione vede l'id e l'ora di eliminazione degli elementi eliminati di quel
  tipo anche fuori dal suo filtro per materie: l'elemento eliminato conserva solo id e data,
  quindi la materia non si può più controllare. Titoli e contenuti non arrivano.
- Se l'orologio del proprietario è avanti, la modifica di chi riceve a un suo elemento appena
  salvato perde (`stale`) e torna indietro finché l'orologio vero non lo supera. Il client non
  può timbrare «versione + 1 ms»: il trigger `studyos_items_recipient_values` riporta a now()
  ogni timbro futuro dopo averlo accettato e il proprietario ripubblicherebbe la sua copia sopra,
  in silenzio. Serve `greatest(now(), timbro salvato + 1 ms)` nel trigger, poi il client può seguire.
- L'avviso "Non hai più il permesso…" compare anche quando il server rifiuta un valore
  (colore, link, tipo di un campo) con il permesso ancora attivo.
- Le cache dei dati altrui hanno portato il database locale (Dexie) alla versione 6. Non
  tornare mai a una build con la versione 5: il browser rifiuta di aprire un database più
  recente, quindi quella build non caricherebbe i dati locali del dispositivo.
