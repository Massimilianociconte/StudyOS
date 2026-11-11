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

11/11/2026, ricerca persone e push: 291 test, lint, build, `barb:validate`; stack locale: `groups.sql`,
`sharing.sql` e `people.sql` due volte e `people-verify.sql`, `people-check.mjs` 109 controlli e
`sharing-check.mjs` 121 controlli, 0 falliti; prova nel browser con tre account (ricerca per email e `@nome`,
profilo non trovabile, invito di gruppo e di dati con accettazione immediata, permesso cambiato, interruttore e
proposta una tantum, `?apri=`, uscita dall'account). Permesso delle notifiche, iscrizione e tocco
sulla notifica si ripetono su un browser vero: il browser integrato li blocca.

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
  della sync personale, al massimo 200 righe, esiti `stale` e `denied`); il server accetta
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
  modificare i dati di …" in cima a ogni sezione, con il pulsante "Ok" per chiuderlo. Se
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
  `localStorage` (`studyos-pending-share`, 14 giorni) finché non si accede. Un invito con
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

## Persone, inviti all'account e notifiche push (`people.sql`)

Serve `supabase/people.sql`, eseguito dopo `schema.sql`, `groups.sql` e `sharing.sql`. Decisione
sulle push: [ADR](agent/decisions/2026-11-11-push-pg-net-worker.md); design:
[spec](plans/2026-11-11-people-search-push-design.md).

**Ordine di pubblicazione:** sul progetto reale esegui `groups.sql`, `sharing.sql` e `people.sql`
(in quest'ordine) e controlla che `people-verify.sql` sia tutto verde **prima** del push su
`main`: il push pubblica il client. Da questa versione il client legge `recipient_user_id`: senza
la colonna si ferma la sincronizzazione dei gruppi e anche il caricamento delle condivisioni
(`shareSync` seleziona la colonna e, se la richiesta fallisce, fallisce l'intero caricamento).

- **Conferma email spenta.** Dall'11/11/2026 gli account nuovi sono attivi alla registrazione:
  l'email non è una prova di identità (chiunque può registrarsi con l'indirizzo di un altro; il
  vero proprietario può solo riprenderlo con il recupero password). Perciò **nessun invito si
  accetta in base all'email**: gli inviti in app (`invite_person_to_group`,
  `invite_person_to_share`) hanno `recipient_user_id` e solo `auth.uid()` può accettarli o
  rifiutarli. `create_share_invite` non crea più inviti per email; link, QR e codice restano.
  Gli inviti per email già pendenti si legano una volta sola all'account con quell'indirizzo
  (migrazione di `people.sql`); gli altri non sono accettabili e il mittente li vede "Scaduto".
- **Profilo**: `studyos_profiles` (nome visibile, `@nome` facoltativo, unico, minuscolo,
  `^[a-z0-9_.]{3,24}$`, interruttore «Gli altri possono trovarmi», acceso di default). RLS: ognuno
  vede e modifica solo la propria riga. Una riga mancante vale «trovabile, senza nome né `@nome`».
- **Ricerca**: `find_person` solo per email esatta o `@nome`, mai sé stessi, mai l'email nel
  risultato; un account non trovabile e uno inesistente danno la stessa risposta. Limiti: 30
  ricerche al minuto per account e 60 per indirizzo IP (`studyos_person_lookups`, senza policy).
- **Notifiche push**: iscrizioni in `studyos_push_subscriptions` (RLS sulle proprie righe).
  Trigger `AFTER` su inviti, accettazioni, ingressi nei gruppi e permessi chiamano
  `studyos_push_notify`, che raccoglie le iscrizioni dei destinatari (mai di chi ha compiuto
  l'azione) e con `pg_net` fa `POST` al Worker `/push` con l'intestazione
  `x-studyos-push-secret`, in lotti di al massimo 40 iscrizioni (il Worker ne accetta al massimo
  49 per richiesta: 49 push più una `push_gone` sono 50 sottorichieste sul piano Free). Segreto e
  URL stanno in Vault (`studyos_push_secret`, `studyos_push_url`). Senza `pg_net` o senza segreti
  non succede nulla e la scrittura che ha fatto scattare il trigger riesce lo stesso. Per chi
  compie l'azione `studyos_push_notify` manda al massimo 30 notifiche all'ora (tabella
  `studyos_push_sends`, le righe più vecchie di un'ora si cancellano): oltre salta la push in
  silenzio e non blocca mai la scrittura, e gli avvisi in app arrivano comunque; serve a non
  inondare qualcuno di push con inviti e annullamenti, o cambi di permessi, ripetuti. Il Worker
  invia la notifica cifrata (RFC 8291, VAPID RFC 8292) e segnala con `push_gone` gli endpoint
  spenti, che il database cancella.
- **Client**: iscrizione e permesso solo dopo un tocco («Notifiche su questo dispositivo» in
  Impostazioni → Profilo, o la proposta dopo il primo invito ricevuto); `src/lib/push.ts` si
  carica con `import()`. Toccare la notifica apre `?apri=notifiche`, `?apri=condivisione` o
  `?apri=gruppi`. Su iPhone e iPad le push funzionano solo con StudyOS aggiunto alla schermata Home.
  Su un dispositivo condiviso, quando l'app si avvia con una sessione `syncPushSubscription` toglie
  dal browser l'iscrizione push se appartiene a un altro account, così le notifiche di un altro account non continuano ad arrivare.
- **Agenti MCP**: nessuno strumento nuovo; non ricevono email, `@nome` cercati né iscrizioni push.

Prova automatica sullo stack locale: `scripts/supabase/local-stack.md` e
`scripts/supabase/people-check.mjs` (ricerca esatta, non trovabile = inesistente, limiti, inviti
solo al destinatario, email rifiutate, migrazione, trigger push verso un Worker finto).

## Limiti noti

- I file condivisi sono riferimenti (nome come testo): nessun bucket Storage.
- La proprietà non si trasferisce: il proprietario può solo eliminare il gruppo.
- Le notifiche email non esistono. Le push funzionano solo con `people.sql`, `pg_net`, i
  segreti in Vault e il Worker distribuito (vedi sopra); senza, gli inviti arrivano comunque
  nel pannello Notifiche all'apertura dell'app (realtime se aperta) e via link, QR o codice.
- Push: il servizio push può non consegnare (dispositivo spento da giorni, TTL di 24 ore):
  l'avviso resta nella campanella. Un cambio della chiave VAPID invalida tutte le iscrizioni:
  chi le aveva attivate si reiscrive al primo avvio, gli altri riattivano l'interruttore.
- Il Worker invia a qualunque endpoint https salvato come iscrizione (nessun elenco dei servizi
  push ammessi): lo limita il tetto di notifiche per chi agisce.
- Se un `@nome` è già preso si può sapere anche salvando direttamente il profilo (vincolo di
  unicità), non solo con `is_handle_available`.
- Il tempo di CPU di un lotto grande di push sul piano Free dei Worker (10 ms) non è stato
  misurato: controllalo con `wrangler tail` dopo il deploy.
- I membri di un gruppo leggono l'email di chi è entrato con codice o link in
  `studyos_group_members` (scelta: entrare è un'azione propria, e la conferma lo dice). Chi accetta
  un invito per `@nome` non scrive la propria email: né nella riga del membro né in quella della
  condivisione (resta vuota).
- L'avviso una tantum (`peopleNoticeSeen`) si ricorda per dispositivo, quindi può comparire una
  volta su ciascun dispositivo.
- Enforce MFA/SSO: invariato rispetto a `schema.sql`.
- Condivisione, limiti noti: il logout scarta le modifiche a dati altrui non ancora inviate;
  dopo lo sblocco con la password dell'app la prima sync non mostra le notifiche di
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
- L'avviso "Non hai più il permesso…" compare anche quando il server rifiuta un valore
  (colore, link, tipo di un campo) con il permesso ancora attivo.
- Le cache dei dati altrui hanno portato il database locale (Dexie) alla versione 6. Non
  tornare mai a una build con la versione 5: il browser rifiuta di aprire un database più
  recente, quindi quella build non caricherebbe i dati locali del dispositivo.
