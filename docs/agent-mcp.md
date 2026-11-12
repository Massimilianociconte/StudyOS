# Agenti MCP

StudyOS può essere usato da ChatGPT, Claude, Cursor e da qualunque client MCP.
I dati restano nel browser. Il programma locale non legge IndexedDB: porta le
richieste all'app aperta, che le esegue con le stesse funzioni dell'interfaccia.

## Avvio

Nella cartella del progetto:

```bash
npm run dev
npm run agent
```

`npm run agent` ascolta solo su `127.0.0.1:47321`. Nel terminale compare un codice
di 8 caratteri, valido 15 minuti e usabile una volta. In StudyOS apri
**Impostazioni → Agenti** e incollalo. Il codice non viene salvato.

Il token che resta nel browser serve solo a ricevere le richieste. Non autorizza
da solo le chiamate MCP. I token OAuth e il token del client locale stanno in
`~/.studyos/` con permessi ristretti, mai nel repository.

## Cosa può fare un agente

Gli strumenti coprono lo stato, la panoramica, la ricerca e la gestione di
materie, task, eventi, esami personali, sessioni, ripasso, materiali (solo
link), note, obiettivi, preferenze di studio, notifiche, bacheca dei gruppi,
libretto con medie e proiezione di laurea, insegnamenti e appelli BARB. Gli
eventi ripetuti compaiono come singole occorrenze. «Tutta la serie» fa come «Tutti» nel
calendario: eliminando una serie senza indicare il giorno spariscono anche le parti divise
prima con «Questo e i successivi»; modificandola (senza giorno o con `scope=all`) quelle parti
restano come sono e la risposta le elenca in `keptParts`. I link della bacheca dei gruppi
arrivano all'agente solo se sono http, https o mailto. Ogni risposta riporta il nome
della materia accanto all'id, e `studyos_status` e `studyos_overview` danno data,
ora e fuso orario della persona. Le letture, di base, passano. Modifiche ed eliminazioni chiedono
conferma nell'app. Si può consentire le sole modifiche per 15 minuti. Le
eliminazioni chiedono comunque conferma, e un agente non può cambiare queste
regole. Valgono per il connettore `/mcp`, non per il connettore remoto (vedi sotto), che non
chiede conferme.

In **Impostazioni → Agenti** c'è prima l'essenziale: «Collega ChatGPT o Claude» con un solo
stato («Non ancora collegato» finché non provi a collegarti, poi «Collegato» o «Collegamento
non raggiungibile»), la chiave (o il codice di `npm run agent`) e l'indirizzo `/mcp` da
copiare, poi il connettore remoto e le revoche. Regole di conferma, i 15 minuti, più persone
sullo stesso connettore e ultime azioni sono in «Avanzate»; i dettagli per lo sviluppo in
«Istruzioni tecniche».

Con un account e `supabase/sharing.sql` attivo, l'agente vede anche i dati che altre
persone condividono con te (`studyos_list_shares`, `studyos_list_shared_items`) e, solo
dove hai «Può modificare», li aggiunge, modifica o elimina
(`studyos_create_shared_item`, `studyos_update_shared_item`,
`studyos_delete_shared_item`). Può condividere sezioni dei tuoi dati con persone già
collegate o con un gruppo (`studyos_share_with`), cambiare o togliere una condivisione
(`studyos_update_share`, `studyos_revoke_share`). `studyos_share_with` e
`studyos_update_share` chiedono sempre conferma nell'app, anche con «Modifiche senza
conferma»; le eliminazioni hanno solo `id` e `confirm`. Le persone compaiono con un
`personId` opaco (`person_` più 16 cifre esadecimali), mai con email o id dell'account, e gli
elementi di persone nascoste non si vedono nemmeno all'agente. Le risposte sui dati
condivisi contengono solo campi consentiti: niente file, copertine, cronometri,
`sourceUid` né link non sicuri. Gli strumenti condivisi si caricano solo quando servono.
Gli elenchi personali (attività, eventi, esami…) restano solo tuoi. Il server è alla
versione 1.8.0 (`/health` la mostra dopo il deploy). La 1.8.0 aggiunge `studyos_split_pages` (vedi
«Pagine da studiare») e, sul connettore remoto, il registro del server con il ripristino (vedi
«Registro e ripristino del connettore remoto»). Dalla 1.7.0, negli elenchi di attività, eventi,
sessioni, argomenti e obiettivi descrizioni e note oltre 300 caratteri arrivano accorciate con
«…» e il campo compare in `truncated`; `fullText: true` (o il dettaglio, es. `studyos_get_task`)
le dà intere. Una modifica che riscrive il testo partendo dalla copia accorciata viene
rifiutata (`invalid`, niente salvato): cancellerebbe la parte dopo il taglio. Prima l'agente
non sapeva del taglio e contava le pagine scritte in fondo alla descrizione su metà testo.
Dalla 1.6.0 la revoca in
Impostazioni → Agenti toglie solo gli accessi approvati da quel browser (vedi «Revocare gli
accessi»). La 1.5.0 aveva corretto fuso orario, serie ripetute, link della bacheca e limiti di
`/register` e `/authorize`; la 1.4.0 aveva aggiunto il connettore remoto di un solo account
(vedi sotto). La 1.7.0 aggiunge il parametro `fullText` agli elenchi e cambia le descrizioni
di elenchi e modifiche di attività, eventi e obiettivi: ricrea il connettore perché
l'assistente le legga (vedi «Ripubblicare dopo una modifica»). Anche la 1.8.0 cambia l'elenco
degli strumenti e le istruzioni del server: ricrea il connettore dopo il deploy.

## Pagine da studiare

Quando pianificava lo studio nel calendario («pp. 120–180 in 4 giorni»), un assistente a volte
scriveva intervalli spostati di una pagina, che andavano corretti una o due volte. Una causa era il
testo accorciato degli elenchi (risolta nella 1.7.0), l'altra l'aritmetica degli intervalli
inclusivi. Dalla 1.8.0 le istruzioni del server (su tutti e due i connettori) dicono: «Conta le
pagine includendo prima e ultima (10–20 = 11 pagine). Per dividere un intervallo usa
studyos_split_pages invece di calcolare.»

`studyos_split_pages` (sola lettura, non tocca i dati) divide `from`–`to` (interi da 1, estremi
compresi) in parti contigue, senza buchi né sovrapposizioni, la cui somma è sempre `to - from + 1`.
Una modalità alla volta:

- `parts`: quante parti; il resto va alle prime (61 pagine in 4 = 16, 15, 15, 15). Più parti che
  pagine è un errore che lo dice.
- `perPart`: pagine per parte; l'ultima prende il resto (1–100 da 30 = 30, 30, 30, 10).
- `startDate` + `endDate` (giorni compresi, al massimo 366): una parte per ogni giorno utile.
  `skipWeekdays` salta giorni della settimana (es. `["SA","SU"]`), `days` usa solo quelli (es.
  `["MO","WE","FR"]`). Con `startDate` senza `endDate`, `parts` o `perPart` ricevono i giorni utili
  in ordine.

`labels` (facoltativo) dà un'etichetta a ogni parte, in ordine. Ogni parte ha `from`, `to`,
`pages`, `date` e `weekday` quando ci sono giorni, e `text` pronto per titolo o descrizione
(«pp. 120–135 (16 pagine)», «p. 7 (1 pagina)»); `summary` riassume il conto («… in 4 parti: 16 + 15
+ 15 + 15 = 61 pagine.», con una parte sola solo «… in 1 parte.»). Gli errori citano l'intervallo una
volta («Le pagine sono 3 (pp. 1–3), meno delle parti (4)…»). I giorni sono date civili: il cambio
d'ora non sposta niente. È un calcolo puro: sul connettore remoto risponde senza leggere il cloud. La
logica è in `src/agent/pageSplit.ts`, i test in `tests/pageSplit.test.mjs`.

Ogni eliminazione deve arrivare con `confirm: true` e va comunque approvata,
salvo una policy impostata da te su «Consenti».

Non sono esposti il vault, il reset, l'import di backup, l'ingresso nei gruppi,
i codici di invito, gli inviti alla condivisione (creazione, link, accettazione), la ricerca di persone, le iscrizioni push e il caricamento di file. Le risposte non includono file,
foto, email dei membri o passphrase. Le note si possono leggere e scrivere, ma
non hanno ancora una schermata dedicata nell'app.

Se una conferma tarda, l'agente riceve `pending_approval` e deve rileggere
l'esito con `studyos_approval_status`, senza ripetere l'azione. Sul connettore
`/mcp` il registro delle azioni resta in questo browser: `studyos_list_audit` lo legge (il più
recente prima, filtri `tool`, `since`, `until`, paginato con `limit` e `offset`; `itemId` e
`callId` qui danno errore, perché il browser non salva gli id). Il ripristino (`studyos_restore_change`) c'è solo sul
connettore remoto, che salva prima e dopo di ogni modifica: su `/mcp` non compare in
`tools/list`.

A vault bloccato l'app risponde che i dati non sono disponibili e non mostra
conteggi vuoti come se fossero veri.

## Indirizzo da usare

Ogni client remoto usa lo stesso indirizzo, mostrato in **Impostazioni → Agenti**
del sito pubblicato: `https://studyos-agent.<account>.workers.dev/mcp`. È l'hub
Cloudflare sempre acceso. Non serve `npm run dev`, `npm run agent` né un tunnel.
Apri il sito pubblicato (`https://massimilianociconte.github.io/StudyOS/`),
anche dal telefono, incolla la chiave di collegamento una volta e tieni la
pagina aperta mentre l'agente lavora: i dati restano nel suo IndexedDB. La chiave è il
secret `STUDYOS_PAIR_KEY` del Worker: la dà chi gestisce StudyOS, ed è la stessa per tutte le
persone che usano lo stesso connettore.

L'accesso è OAuth 2.1 con PKCE e registrazione dinamica del client. Al primo
collegamento la conferma compare in Impostazioni → Agenti del browser
collegato. Sono accettati redirect https, loopback con qualsiasi porta
(`http://127.0.0.1:…`, `http://localhost:…`) e schemi delle app native come
`cursor://`. La registrazione è aperta a chiunque, quindi ha dei limiti: al massimo 50
client; oltre, l'hub toglie quelli senza token, consensi o codici validi, dal più vecchio, ma
mai uno registrato da meno di 2 minuti, e una registrazione mai usata scade dopo 24 ore. Una
richiesta di consenso vale 5 minuti; ne restano aperte al massimo 5 per client (la nuova prende
il posto della più vecchia) e 20 in tutto: oltre, la nuova prende il posto della più vecchia,
prima tra quelle di client che non hanno mai ottenuto un accesso, così chi si collega davvero
non resta fuori. Il server risponde ai protocolli MCP dal 2024-11-05 al 2026-07-28
(`initialize` per i client precedenti, `server/discover` per il 2026), sempre in
JSON e mai in stream.

## Revocare gli accessi

In **Impostazioni → Agenti** ci sono tre revoche, tutte con il browser collegato:

- **«Revoca gli accessi di questo browser»** toglie gli assistenti approvati con «Consenti» in
  questo browser, anche il connettore remoto approvato qui, e i permessi remoti del tuo account
  nel cloud. Gli assistenti approvati da altri browser restano, anche quelli tuoi su un altro
  dispositivo: revocali da lì, oppure usa «Scollega gli assistenti di tutti». Un client che
  resta senza accessi viene tolto: per ridare l'accesso, togli il connettore StudyOS
  nell'assistente e aggiungilo di nuovo.
- **«Scollega il connettore remoto»** toglie solo il connettore remoto del tuo account (vedi
  sotto); il connettore principale resta.
- **«Scollega gli assistenti di tutti»**, in «Avanzate» e dopo una conferma che lo dice, toglie
  token, consensi e client di tutte le persone: ognuno dovrà ricollegare il connettore.

### Il segreto del browser

L'hub riconosce chi ha approvato un accesso da un segreto del browser, non dal nome del profilo
(che chiunque può scrivere uguale o cambiare):

- `/pair` restituisce, oltre al token del ponte, un segreto casuale di 256 bit (`secret`, 43
  caratteri base64url). Un browser collegato prima lo chiede da solo all'avvio con
  `/bridge/secret` (serve il token del ponte), senza ricollegarsi. Il browser lo tiene in
  `localStorage` accanto al collegamento, e lo tiene anche dopo «Scollega questo browser», così
  quello che ha approvato resta revocabile da lì.
- `/oauth/decide` con «Consenti» manda `secret`. L'hub ne salva solo lo SHA-256 (`approver`) su
  consenso, codice, token di accesso e di rinnovo. Il segreto in chiaro non viene salvato, non
  va mai agli agenti MCP né in un URL: viaggia solo nel corpo delle richieste dal browser all'hub.
- `/oauth/revoke` limitato (senza `scope`, o `scope: "cloud"` per i soli remoti) richiede
  `secret` e toglie solo ciò che quel segreto ha approvato. Senza segreto valido risponde 400 e
  non tocca niente: un'app di prima non scollega più tutti per sbaglio. La risposta conta solo
  le concessioni di chi chiede (`revoked`) e quelle senza approvatore (`legacy`).
- Gli accessi approvati prima, o da un'app senza segreto, non hanno approvatore: la revoca
  limitata non li tocca, li conta in `legacy` e l'app spiega che per toglierli serve «Scollega
  gli assistenti di tutti».

Cosa protegge: chi conosce la chiave di collegamento (la stessa per tutti) non può revocare gli
assistenti degli altri scrivendo il loro nome nel profilo, e rinominare il proprio profilo non
fa perdere la revoca. Cosa non è: non è un'identità cloud né un account. Vale per un solo
browser: un altro dispositivo della stessa persona ha un altro segreto, e chi cancella i dati
del sito ne riceve uno nuovo (gli accessi approvati con il vecchio si tolgono solo con
«Scollega gli assistenti di tutti»). Chi ha la chiave può comunque scollegare tutti con `scope:
"all"`, come prima.

Un hub di prima della 1.6.0 tratta qualunque `/oauth/revoke` come «scollega tutti». Per questo
l'app rilegge `/health` prima di «Revoca gli accessi di questo browser»: se la versione è sotto la
1.6.0 o manca, non manda una revoca limitata, ma apre la stessa conferma di «Scollega gli
assistenti di tutti», con una riga che dice che questo collegamento, finché non è aggiornato, sa
solo scollegare tutti. Allo stesso modo manda «Scollega il connettore remoto» all'hub solo dalla
1.6.0: prima toglie solo il permesso nel cloud, che basta a fermare il connettore.

## Più account sullo stesso connettore

Più persone possono usare lo stesso connettore, anche dallo stesso account ChatGPT.
Ognuna apre il sito pubblicato nel proprio browser, scrive il suo nome in
**Impostazioni → Profilo e obiettivi** e collega il browser in **Impostazioni →
Agenti** con la stessa chiave. Il nome del profilo è il nome dell'account in chat.
Browser con lo stesso nome, per esempio il telefono e il computer della stessa persona,
sono lo stesso account.

In chat basta dire di chi è l'account: «nel planning di Camilla Rossi aggiungi…».
ChatGPT passa `account` con quel nome e l'hub manda l'azione solo ai browser di
quell'account. La richiesta di conferma compare in quello StudyOS, e la risposta
riporta `account` con il nome usato.

- Ogni strumento ha il parametro facoltativo `account`. L'hub lo toglie prima di
  passare l'azione all'app, che non cambia.
- `studyos_list_accounts` elenca gli account collegati, con il nome e se il loro StudyOS è
  aperto ora.
- Con un solo account `account` si può omettere, come prima. Con più account è
  obbligatorio: senza nome la risposta elenca gli account e chiede quale usare. Un nome
  che non corrisponde dà errore e non esegue niente.
- Il confronto ignora maiuscole, accenti e ordine delle parole. «Camilla» trova
  «Camilla Rossi», e «Camilla Rossi» trova un profilo chiamato solo «Camilla». Se il
  nome corrisponde a più account, serve il nome completo.
- I dati di ogni account restano nel suo browser: per lavorare sull'account di Camilla,
  il suo StudyOS deve essere aperto. Altrimenti la risposta è `not_connected` con il
  suo nome.
- «Scollega questo browser» toglie subito il browser dall'elenco. L'hub dimentica da
  solo i browser che non vede da 30 giorni.
- Chi usa il connettore può agire su tutti gli account collegati. Il limite sono le
  conferme di ogni StudyOS, che seguono le regole scelte da quella persona in
  Impostazioni → Agenti.

## Connettore remoto di un solo account (StudyOS chiuso)

Un secondo connettore, distinto dal primo, lavora su un solo account e non ha bisogno di
StudyOS aperto: legge e scrive direttamente i dati cloud di quell'account. L'indirizzo è

`https://studyos-agent.<account>.workers.dev/u/<nome>/mcp`

dove `<nome>` è il nome del profilo con i trattini al posto degli spazi, per esempio
`/u/camilla-rossi/mcp`. Il nome segue le regole della sezione precedente (maiuscole,
accenti e ordine delle parole non contano).

In **Impostazioni → Agenti** del sito pubblicato il riquadro «Connettore remoto (app chiusa)»
dice cosa fa, avvisa che non chiede conferme nell'app, mostra questo indirizzo con il nome
del profilo, pronto da copiare, e ha «Scollega il connettore remoto». Senza nome nel profilo
chiede di scriverlo; se `/health` dice `cloud: false` spiega che chi gestisce StudyOS deve
attivarlo; nella finestra di sviluppo rimanda al sito pubblicato.

Una volta sola, prima del primo collegamento:

1. Esegui `supabase/agent.sql` nel SQL Editor del progetto (vedi `supabase/README.md`).
2. Imposta sul Worker l'URL del progetto Supabase e la chiave publishable (`sb_publishable_…`,
   mai `service_role`). `wrangler` chiede il valore a terminale, mai nella riga di comando:

   ```bash
   npx wrangler secret put STUDYOS_SUPABASE_URL -c worker/wrangler.jsonc
   npx wrangler secret put STUDYOS_SUPABASE_KEY -c worker/wrangler.jsonc
   ```

   Senza, `/u/<nome>/mcp` risponde che il connettore remoto non è attivo.
3. `npx wrangler deploy -c worker/wrangler.jsonc`.

Collegamento, come per il primo connettore e senza password:

- In ChatGPT aggiungi un connettore con l'indirizzo `/u/<nome>/mcp`. ChatGPT apre la
  pagina di autorizzazione dell'hub.
- La richiesta compare solo nello StudyOS di quell'account (browser collegato in
  Impostazioni → Agenti, con quel nome nel profilo), con l'etichetta «Connettore remoto».
  Il browser deve aver fatto l'accesso al cloud (Impostazioni → Account e
  sincronizzazione).
- «Consenti» crea su Supabase un permesso per l'assistente e ne passa il segreto all'hub.
  Nel database resta solo l'hash SHA-256 del segreto. Lettura e scrittura si scelgono
  nella stessa richiesta, come per il primo connettore.

Da quel momento StudyOS può restare chiuso. L'hub legge le righe dell'account con
`studyos_agent_pull` e scrive con `studyos_agent_push`, con le stesse regole della
sincronizzazione (vince la modifica più recente). Le date usano il fuso del browser che
ha dato il consenso, anche il fuso che le serie nuove e le divisioni si portano dietro: una
lezione alle 9 resta alle 9 dopo il cambio d'ora. L'app vede le modifiche alla sincronizzazione successiva.

Differenze dal primo connettore:

- Nessuna conferma nell'app: il consenso iniziale vale per tutte le azioni dello scope
  scelto. Le eliminazioni chiedono comunque `confirm: true`.
- Gli strumenti non hanno il parametro `account`: il connettore è già legato a un account.
- Non ci sono gli strumenti dei dati condivisi, i gruppi (elenco, bacheca e risorse), il
  cronometro, `studyos_approval_status` e `studyos_list_accounts`. `studyos_list_audit` c'è dalla
  1.8.0, ma legge il registro del server (vedi sotto); in più c'è `studyos_restore_change`.
  I gruppi condivisi stanno nelle tabelle dei gruppi e non nel cloud personale che l'hub legge:
  da lì si vedrebbe una copia vecchia. Panoramica e ricerca remote non contano i gruppi.
- File, copertine e foto non arrivano all'hub. Quando l'hub modifica un elemento, il
  database li rimette dalla riga attuale.
- Se l'app ha cambiato lo stesso elemento dopo l'ultima lettura dell'hub, la scrittura è
  rifiutata: la risposta è un errore di conflitto, l'hub rilegge i dati e l'azione si può
  ripetere.

### Registro e ripristino del connettore remoto

Dalla 1.8.0 (con `agent.sql` rieseguito, vedi `supabase/README.md`) ogni riga che il connettore
remoto cambia lascia una voce nella tabella `studyos_agent_audit`: quando, quale permesso
(etichetta del connettore, es. «ChatGPT»), quale strumento, in quale chiamata, tipo e id
dell'elemento, azione `create`/`update`/`delete`, l'elemento prima e dopo. La scrive
`studyos_agent_push` nella stessa transazione della modifica: l'hub non può saltarla, e le
riscritture che non cambiano niente non lasciano voci. Nessun client scrive o cancella voci; la
persona legge le sue (RLS).

**Una chiamata, più elementi.** Uno strumento può cambiare più elementi in una volta: per esempio
`studyos_delete_session` elimina la sessione e la toglie da obiettivi, note, materiali e
promemoria collegati. L'hub manda con ogni push l'id della chiamata (`p_call`, uguale su tutte le
push della stessa richiesta) e il database lo scrive su ogni voce (`call_id`). Elenco e ripristino
lavorano per chiamata, così una sessione non torna mai senza i suoi collegamenti. Le voci scritte da
un hub di prima (senza `p_call`) sono ciascuna una chiamata da sola.

**Immagini e file.** Le immagini prima e dopo non contengono file, copertine né foto, neanche
quelle di un'eliminazione. Solo un'eliminazione tiene a parte i file dell'elemento eliminato
(`before_files`), per poterlo rimettere intero. È uno scambio voluto: il ripristino di un materiale
eliminato funziona davvero, ma occupa spazio nel database. Oggi i file sono incorporati nelle righe
(fino a 600 KiB l'uno), quindi un «elimina tutti i materiali» tiene quei file per 90 giorni e un
account molto attivo può occupare decine di MB di registro (circa 2000 voci da qualche decina di
kB). Sul piano Free (500 MB di database) va tenuto d'occhio. Quando gli allegati passeranno a
Supabase Storage, `before_files` terrà solo il riferimento al file, non il file: il registro
tornerà leggero senza cambiare il modo di ripristinare.

**Quanto resta.** Le voci restano 90 giorni e circa le ultime 2000 per account. A ogni scrittura
che lascia voci il database toglie quelle oltre 90 giorni (un tratto dell'indice
`(user_id, created_at desc, id desc)`, di solito vuoto) e conta al massimo 2101 voci dell'account
dall'indice; solo quando sono più di 2100 riporta il registro alle 2000 più recenti. Così
l'ordinamento e la cancellazione grossa capitano circa una volta ogni 100 voci nuove, non a ogni
scrittura; tra una potatura e l'altra un account può avere fino a 2100 voci.

- `studyos_list_audit` (remoto) chiama `studyos_agent_audit_list` col segreto e risponde **per
  chiamata**, dalla più recente: ogni elemento di `items` ha `callId`, `at`, `tool`, `by`,
  `connector`, `size` (modifiche della chiamata), `canRestore` (si annulla intera), `restoredAt`
  se è già stata annullata, e `changes`. Ogni modifica ha `id`, `collection`, `itemId`, `title`,
  `action`, `canRestore` (si annulla da sola); un aggiornamento ha `changed` e solo quei campi in
  `before`/`after`, una creazione l'elemento in `after`, un'eliminazione l'elemento in `before`
  (testi oltre 300 caratteri accorciati, con `truncated`). `changes` ne mostra al massimo 5
  (prima le eliminazioni, poi le creazioni, poi gli aggiornamenti) e `moreChanges` dice quante
  mancano; con il filtro `callId` arrivano tutte (fino a 200). Filtri `itemId`, `tool`, `since`,
  `until` (senza offset valgono nell'ora locale della persona) e `callId`: una chiamata entra se
  almeno una sua modifica li rispetta. `limit` (al massimo 50), `offset` e `total` contano le
  chiamate. Prima di arrivare all'agente le immagini passano dalle proiezioni degli altri strumenti
  e perdono, a ogni profondità, email, codici di invito, token, iscrizioni push, id di account e
  file.
- `studyos_restore_change` (`id`, `confirm: true`, `onlyThisChange` facoltativo; distruttivo, serve
  lo scope di scrittura) annulla **l'intera chiamata** che contiene `id` (un `callId` o l'id di una
  sua modifica) con `studyos_agent_restore_call`, tutto o niente: per ogni elemento controlla che
  abbia ancora il timbro dell'ultima modifica della chiamata; se anche uno solo è cambiato dopo,
  risponde `conflict` con `conflicts` (gli elementi cambiati, com'erano adesso) e non scrive niente.
  Altrimenti rimette ogni elemento com'era prima della chiamata, con un timbro nuovo (oltre quello
  attuale): una creazione si annulla eliminando, un'eliminazione rimettendo l'elemento (file
  compresi), un aggiornamento tornando ai valori di prima. Con `onlyThisChange: true` annulla solo
  quella modifica (`studyos_agent_restore`), come prima. Il ripristino lascia a sua volta voci con un
  loro `callId` (e `restoreOf`), quindi si può annullare anche lui; la chiamata annullata ha
  `restoredAt` e non si ripristina due volte.
- Nell'app, **Impostazioni → Agenti → Connettore remoto → «Modifiche del connettore»** (con
  l'accesso all'account fatto) apre un pannello caricato solo al tocco, con una riga per richiesta:
  quando, chi (il connettore o «Tu, dall'app»), cosa è cambiato in parole semplici («Ha eliminato la
  sessione di studio «Ripasso».», «Ha modificato l'obiettivo «Esame»: sessioni collegate.»; i
  ripristini fatti dalla persona: «Hai rimesso…», «Hai eliminato…») e «Ripristina» con conferma, che
  annulla tutta la richiesta. Usa `studyos_agent_audit_own` e `studyos_agent_restore_call_own` (solo
  le voci di chi ha fatto l'accesso); le righe ripristinate hanno `client_id` vuoto, così arrivano
  anche al dispositivo che l'ha chiesto, e l'app chiede subito una sincronizzazione. Dopo un
  ripristino l'elenco si rilegge per intero, comprese le righe aperte con «Mostra altre».

Con `agent.sql` di prima il Worker 1.8.0 scrive come prima: una push rifiutata (PGRST202) si ripete
senza `p_tool` e `p_call`, e per 10 minuti si scrive così; poi si riprova la push nuova, quindi dopo
aver rieseguito `agent.sql` il registro torna completo senza riavviare l'hub. Senza
`studyos_agent_restore_call` (agent.sql della prima revisione 1.8.0, senza chiamate) il ripristino
annulla la singola voce, che lì è la sua chiamata; senza registro `studyos_list_audit` risponde che
non è ancora attivo. Un Worker di prima con `agent.sql` nuovo scrive lo stesso il registro, con lo
strumento vuoto e ogni voce come chiamata da sola. Prova su Postgres usa e getta:
`scripts/supabase/agent-audit-check.sql`.

`studyos_split_pages` sul connettore remoto non legge il cloud: è un calcolo, risponde anche se il
cloud è lento o non risponde.

«Scollega il connettore remoto» e «Revoca gli accessi di questo browser» in Impostazioni →
Agenti revocano tutti i permessi remoti dell'account (anche senza browser collegato, con
l'accesso all'account fatto) e i token remoti dell'hub approvati da questo browser: da lì il
connettore risponde che il collegamento non è più valido, e per riaverlo serve un nuovo
«Consenti».

Limite di CPU del piano Free: 10 ms per richiesta. Su un account di prova con 1340 righe
(935 KB) ogni chiamata a Worker caldo costa 0,2–6 ms, la prima lettura completa
dell'account circa 5 ms. La prima richiesta di un Worker appena avviato può arrivare a
25–50 ms per la compilazione del codice: se Cloudflare la ferma, la chiamata fallisce e
si può ripetere. Il piano Workers Paid alza il limite a 30 secondi. Un secondo account
Cloudflare non aiuta, perché il limite vale per ogni singola richiesta.

## Collegare i client

**ChatGPT** (web, app desktop e mobile): Impostazioni → App e connettori →
Avanzate → attiva la modalità sviluppatore, poi Crea connettore con l'indirizzo
`/mcp` e autenticazione OAuth. In una chat nuova premi + e aggiungi StudyOS.
Una chat già aperta non lo vede. Se l'elenco azioni era già fallito o è
cambiato, elimina il connettore e crealo di nuovo: Aggiorna riusa l'elenco
vecchio.

**Claude** (web, desktop, mobile): Impostazioni → Connettori → Aggiungi
connettore personalizzato con l'indirizzo `/mcp`. L'app mobile usa i connettori
aggiunti dal web.

**Claude Code**:

```bash
claude mcp add --transport http studyos https://studyos-agent.<account>.workers.dev/mcp
```

Poi in Claude Code esegui `/mcp` e completa il login.

**Codex** (CLI, app e estensione IDE) in `~/.codex/config.toml`, poi
`codex mcp login studyos`:

```toml
[mcp_servers.studyos]
url = "https://studyos-agent.<account>.workers.dev/mcp"
```

**Cursor** in `~/.cursor/mcp.json`. **Antigravity** in
`~/.gemini/antigravity/mcp_config.json`, con `serverUrl` al posto di `url`.
**Gemini CLI** in `~/.gemini/settings.json`, con `httpUrl` al posto di `url`,
poi `/mcp auth studyos`:

```json
{
  "mcpServers": {
    "studyos": { "url": "https://studyos-agent.<account>.workers.dev/mcp" }
  }
}
```

**VS Code** (Copilot) in `.vscode/mcp.json` o nel profilo utente:

```json
{
  "servers": {
    "studyos": { "type": "http", "url": "https://studyos-agent.<account>.workers.dev/mcp" }
  }
}
```

**Grok**: su grok.com apri Connettori, aggiungi un connettore personalizzato con
l'indirizzo `/mcp` e completa l'OAuth.

## Tempi delle conferme

Le conferme rispondono entro 45 secondi, sotto il timeout di 60 secondi della
maggior parte dei client. Se la persona non ha ancora deciso, l'agente riceve
`pending_approval` e richiama `studyos_approval_status`, che aspetta fino a 40
secondi la decisione. Le letture non aspettano le conferme in corso: più
modifiche si mettono in coda nel riquadro di conferma. Un'azione che nessun
browser ritira entro 2 minuti non parte più. Una conferma lasciata aperta 30
minuti scade senza eseguire nulla.

## Client locali con stdio (sviluppo)

`npm run agent` serve la finestra di sviluppo (`npm run dev`), che ha un
IndexedDB suo, distinto da quello del sito pubblicato. Per un client che avvia
un comando, con percorsi assoluti:

```json
{
  "mcpServers": {
    "studyos-locale": {
      "command": "node",
      "args": [
        "--import", "/percorso/assoluto/StudyOS/scripts/lib/register-ts.mjs",
        "/percorso/assoluto/StudyOS/scripts/agent.ts", "--stdio"
      ]
    }
  }
}
```

Per Claude Code:

```bash
claude mcp add studyos-locale -- node --import /percorso/assoluto/StudyOS/scripts/lib/register-ts.mjs /percorso/assoluto/StudyOS/scripts/agent.ts --stdio
```

Lo stdio usa un messaggio JSON per riga, come vuole MCP, e accetta ancora il
vecchio framing `Content-Length`. Le richieste partono in parallelo. Legge la
chiave da `~/.studyos/agent.json` senza riscriverla. Se l'hub non è avviato lo
avvia; il codice di collegamento si legge meglio con `npm run agent`. Dopo un
aggiornamento chiudi l'hub vecchio e riavvia `npm run agent`.

## Build pubblicata

localhost e GitHub Pages non condividono i dati: ognuno ha il suo IndexedDB.
ChatGPT, collegato all'hub pubblico, modifica solo la scheda pubblicata aperta
e collegata. La finestra di sviluppo non riceve quelle azioni.

La build pubblicata non chiama `127.0.0.1`. L'origine dell'hub arriva da
`VITE_AGENT_HUB_ORIGIN` al momento del deploy. La CSP di quella build deve
includere quell'origine esatta: `https://*.workers.dev` non copre un nome con
due etichette. Dopo una modifica alla CSP serve una nuova build, pubblicata
dal workflow su `main`.

## Notifiche push: route `/push` del Worker

Lo stesso Worker `studyos-agent` espone `POST /push`: non è uno strumento MCP e gli agenti non
lo vedono. Lo chiama solo il database (`pg_net`) con l'intestazione `x-studyos-push-secret`; il
Worker cifra e invia le notifiche push e non legge né scrive altro. Accetta al massimo 49
iscrizioni per richiesta (49 push più una `push_gone` sono 50 sottorichieste sul piano Free);
il database ne manda al massimo 40 per volta. Servono quattro secret, da
impostare una volta (ognuno dopo il via dell'utente; `wrangler` chiede il valore a terminale,
mai nella riga di comando):

```bash
npx wrangler secret put STUDYOS_PUSH_SECRET -c worker/wrangler.jsonc
npx wrangler secret put STUDYOS_VAPID_PRIVATE_KEY -c worker/wrangler.jsonc
npx wrangler secret put STUDYOS_SUPABASE_URL -c worker/wrangler.jsonc
npx wrangler secret put STUDYOS_SUPABASE_KEY -c worker/wrangler.jsonc
npx wrangler deploy -c worker/wrangler.jsonc
```

- `STUDYOS_PUSH_SECRET`: lo stesso valore del segreto `studyos_push_secret` in Vault.
- `STUDYOS_VAPID_PRIVATE_KEY`: la chiave privata stampata da `node scripts/push-keys.mjs`
  (la pubblica sta in `src/lib/pushKeys.ts`).
- `STUDYOS_SUPABASE_URL` e `STUDYOS_SUPABASE_KEY`: URL del progetto e chiave publishable
  (`sb_publishable_…`): gli stessi secret del connettore remoto (`/u/<nome>/mcp`); se ci sono già,
  non vanno rimessi. La route `/push` li usa solo per chiamare `push_gone`. Mai `service_role`. Se
  mancano, la pulizia degli endpoint spenti si salta e le notifiche partono lo stesso.

I secret `STUDYOS_PAIR_KEY` e lo stato del Durable Object non cambiano. Il Worker registra solo
i conteggi `{ sent, gone }`, mai contenuti o endpoint.

## Ripubblicare dopo una modifica

1. Verifica: `npm test`, `npm run lint`, `npm run build`.
2. Hub: `npx wrangler deploy -c worker/wrangler.jsonc` (la prima volta
   `npx wrangler login`). I secret (`STUDYOS_PAIR_KEY` e quelli delle push) e lo stato
   del Durable Object restano: client OAuth e collegamento del browser non cambiano.
3. Sito: push su `main`. Il workflow Pages costruisce con
   `VITE_AGENT_HUB_ORIGIN` delle variabili Actions.
4. Ricarica la scheda del sito pubblicato collegata: è lei a eseguire gli
   strumenti, e una scheda vecchia esegue il codice vecchio.
5. Se l'elenco strumenti è cambiato: in ChatGPT elimina e ricrea il connettore;
   negli altri client riconnetti il server o apri una sessione nuova.
