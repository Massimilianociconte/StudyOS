# File dei materiali fuori dal JSON sincronizzato (Supabase Storage o link)

- Data: 12/11/2026
- Stato: implementato (agente A5, wave 2)
- Codice: `src/lib/attachments.ts` (regole pure), `src/lib/attachmentFiles.ts` (copia locale in
  Dexie), `src/lib/attachmentSync.ts` (caricamenti, download, eliminazioni; caricato con `import()`),
  `src/lib/attachmentStatus.ts` (stato per la UI), `src/components/MaterialFile.tsx`,
  `supabase/storage.sql`.

## Modello di prima

Un materiale (`Attachment`) è un file o un link. Il file stava come data URL Base64 in
`attachment.dataUrl`, quindi:

- dentro la riga `studyos_items.payload` inviata da `push_studyos_rows` (fino a ~800 KB di testo
  per un file di 600 KiB): righe lente, lotti al limite di 900 KB, coda che può restare bloccata;
- dentro le tabelle Dexie, la copia cifrata del vault e ogni backup;
- a chi riceve una condivisione arriva il payload completo, Base64 compreso.

I link (`externalUrl`, `studyos_add_link`, `addExternalAttachment`) passano già da
`normalizeExternalUrl`/`safeHref`: restano come sono. I gruppi (`groupResources`) condividono solo
link: nessun cambiamento.

## Modello scelto

Il materiale tiene solo i metadati (nome, tipo, dimensione) e un segno:

```ts
storedFile?: "local" | "cloud";
```

- `"local"`: il file è solo sul dispositivo che l'ha aggiunto (in coda per il caricamento, o
  ospite senza account).
- `"cloud"`: il file è nel bucket privato `studyos-files`, percorso `<uid del proprietario>/<id del
  materiale>`. Il percorso non sta mai nella riga: si ricava da proprietario e id.
- assente con `dataUrl`: materiale vecchio, ancora incorporato (si migra, vedi sotto).

`storedFile` è una **chiave protetta** della condivisione, come `dataUrl` e `cover`
(`PROTECTED_KEY` in `src/lib/sharing.ts`, `v_protected` in `supabase/sharing.sql`): chi riceve non
la cambia né la toglie con una copia vecchia, e il ripristino dalla cronologia la riprende dalla
copia del proprietario. Senza, una modifica di chi riceve fatta su una copia precedente alla
migrazione (o il ripristino di quella versione) avrebbe tolto il riferimento al file.

### Copia locale (Dexie v7)

- `attachmentFiles` (solo metadati, letti spesso): `id`, `pending`, `uploadedFor` (uid in cui il
  caricamento è confermato), dimensione, tipo, ultimo uso, tentativi, prossimo tentativo, errore,
  `sealed` (IV e salt se cifrato).
- `attachmentBytes`: `id` → `ArrayBuffer` (i byte stanno in una tabella a parte così leggere lo
  stato non carica in memoria tutti i file).
- `attachmentDeletes`: eliminazioni da fare sul bucket (`path`, proprietario, tentativi).

`pending = true` vuol dire «unica copia»: non si toglie mai per spazio, account cambiato o
cancellazione solo da questo dispositivo. Le altre righe sono cache, tolte per prime oltre 150 MB
(LRU) o quando il materiale non c'è più.

**Vault.** Con il vault attivo i byte locali sono cifrati con la stessa chiave AES-GCM della copia
cifrata (IV per file, salt della chiave salvato con la riga). Attivando il vault i file si cifrano;
disattivandolo si decifrano *prima* di togliere il record del vault (un'interruzione lascia file in
chiaro, mai file illeggibili); allo sblocco si cifrano quelli rimasti in chiaro. Con il vault
bloccato non si apre e non si carica nulla.

## Flussi

**Nuovo file.** `addAttachment(file)` controlla dimensione e tipo, ripulisce il nome, scrive i byte in
Dexie (scrittura confermata), poi crea il materiale con `storedFile: "local"` e senza `dataUrl`.
I byte non arrivano mai nella coda della sync: nessuna modifica a `cloudSync.ts`.

**Caricamento** (`attachmentSync.ts`, solo con account collegato *e* dati locali legati a
quell'account, `cloud:boundUser`, primo pull della sessione finito, online, vault sbloccato, scheda
attiva): carica con `upsert` in `<uid>/<id>`; a caricamento confermato la riga locale diventa cache
(`uploadedFor = uid`) e il materiale passa a `"cloud"` (`markAttachmentsStored`, timbro della riga
+1 ms). Se il materiale intanto non c'è più (eliminato, dispositivo svuotato) non si toglie nulla:
né l'oggetto né la copia (fix 1, H1). Errore → nuovo tentativo con attesa crescente (30 s →
30 min); il motivo si vede sulla scheda.

**Migrazione dei file incorporati (lazy).** Stesse condizioni. Per ogni materiale con `dataUrl`
valido e senza `storedFile`: decodifica, carica, e solo a caricamento confermato riscrive la riga
senza `dataUrl` e con `"cloud"` (solo se il `dataUrl` in memoria è ancora lo stesso). I byte restano
anche in cache su questo dispositivo. Pochi per passata, poi si riprende. Ospite: nulla cambia, il
file resta incorporato e locale. Un tipo fuori dall'elenco ammesso si carica come
`application/octet-stream` (si scarica, non si apre).

**Apertura.** Copia locale o file incorporato → subito, senza rete e senza caricare supabase-js
(`useOpenMaterial` in `MaterialFile.tsx`). `"cloud"` senza copia: download (account + rete), poi
cache. Offline senza copia: «Questo file non è ancora su questo dispositivo: si scarica quando torni
online.» `"local"` senza copia (aggiunto da un altro dispositivo): online si prova lo stesso il
download (una modifica vecchia può aver riportato il segno a `"local"` dopo il caricamento); se
l'oggetto c'è, il file si apre e la riga torna `"cloud"`, altrimenti «Il file è ancora solo sul
dispositivo dove l'hai aggiunto…». Ogni file si **scarica** (`<a download>` con URL `blob:`), mai
aperto nella pagina: un HTML o SVG aperto da `blob:` girerebbe con l'origine dell'app.

**Eliminazione.** `deleteAttachment` (UI, agenti locali) toglie la copia locale. L'oggetto nel
bucket resta per 90 giorni, come la cronologia: un ripristino ritrova il file. Lo toglie la pulizia
quotidiana del proprietario (fix 1, L1/L2) solo quando la riga nel cloud è eliminata da almeno 90
giorni, chiunque l'abbia eliminata (anche chi riceve o il connettore remoto). Un'eliminazione
arrivata da un altro dispositivo toglie solo la cache.

**Cancellazioni di tutto.**
- «Cancella anche dall'account»: oltre a `erase_studyos_account_items`, `eraseAccountFiles` elenca e
  rimuove gli oggetti sotto `<uid>/` creati prima della richiesta (la richiesta resta in `meta` e si
  riprova finché non riesce; i file aggiunti dopo non si toccano). Copie locali tutte tolte.
- «Togli i dati da qui» e cambio di account con «solo il nuovo account»: si toglie la cache, i file
  `pending` restano (sono l'unica copia; tornano a caricarsi quando torna il loro materiale).
- «Cancella tutti i dati» senza account: tolto tutto.

**Backup.** Il backup completo **include i file**: per ogni materiale con file si prende la copia
locale o si scarica (senza metterla in cache), e si mette come `dataUrl` solo nel file esportato.
Al massimo 100 MB di file (`BACKUP_FILES_LIMIT_BYTES`): tutto finisce in una sola stringa JSON in
Base64. Se un file non si può avere (offline, mai scaricato) o non ci sta, il backup parte comunque e
il messaggio dice quanti mancano; se la copia con i file non si riesce a creare, si scarica quella
senza file. All'import i
file incorporati diventano copie locali `pending` (caricate con l'account), mai righe sincronizzate
con i byte.

**Agenti MCP.** Vedono nome, tipo, dimensione (`publicAttachment` è già una lista chiusa).
`storedFile` è anche in `HIDDEN_FIELDS` (`src/agent/project.ts`) e `NEVER_KEYS`
(`src/agent/shared.ts`). Nessun percorso, URL o byte. Connettore remoto (`supabase/agent.sql`):
`studyos_agent_pull` toglie anche `storedFile` e `studyos_agent_push` lo rimette dalla riga
attuale se il payload non lo porta, come per `dataUrl`. Senza questo una copia dell'agente letta
prima della migrazione (senza `dataUrl`, tolto dal pull, e senza `storedFile`) toglieva alla riga
il segno del file: il materiale restava senza file pur con l'oggetto nel bucket. Pronto:
`stored_file_kept_ready` in `agent-verify.sql`.

## Condivisione: decisione

Oggi chi riceve un materiale riceve i byte (payload completo). Scelta: **chi può leggere la riga del
materiale può scaricare il file**, scrive ed elimina solo il proprietario.

```sql
-- select su storage.objects
(storage.foldername(name))[1] = auth.uid()::text
or public.studyos_can_read_file(name)   -- security invoker: exists su studyos_items con la RLS di chi chiede
```

Perché: stessa visibilità di prima senza byte nelle righe; la revoca vale subito (RLS di
`studyos_items`); vale anche per i gruppi; non usa le tabelle di `sharing.sql` (senza quella
migrazione l'utente vede solo le proprie righe, già coperte dalla cartella). Un URL firmato chiesto
dal proprietario non funziona offline e scade; «il file resta al proprietario» toglieva a chi riceve
una cosa che oggi ha. Chi riceve scarica solo online e non tiene copie (i dati altrui con il vault
restano solo in memoria). Anche un file `"local"` del proprietario si prova a scaricare (il segno può
essere rimasto indietro); se non c'è, «non ancora caricato». Il nome scaricato ha un'estensione
sicura (`sharedDownloadName`: `.bin` se il tipo non è ammesso). Limite noto: chi riceve può
chiedere a Storage un URL firmato, che resta valido fino alla scadenza anche dopo la revoca della
condivisione (comportamento di Supabase Storage).

## Limiti

- 25 MB per file (`file_size_limit` del bucket = `MAX_FILE_BYTES`). Il piano Free ha 1 GB di Storage
  in tutto e 50 MB massimi per file.
- Tipi ammessi (bucket e app, stesso elenco): PDF, immagini (PNG, JPEG, GIF, WebP, AVIF, HEIC/HEIF,
  BMP), testo (txt, md, csv), Office e OpenDocument, RTF, EPUB, ZIP, audio (mp3, m4a, wav, ogg,
  webm), video (mp4, webm, mov). `application/octet-stream` solo per i file vecchi migrati. Mai HTML,
  SVG, script o eseguibili.
- Nome ripulito: niente separatori di percorso, caratteri di controllo e `<>:"/\|?*`, massimo 120
  caratteri con l'estensione.

## Cosa può andare storto

| Caso | Effetto |
| --- | --- |
| `storage.sql` non eseguito | I caricamenti falliscono con un messaggio chiaro; i file restano locali (`pending`), quelli vecchi incorporati. Gli altri dispositivi non li vedono finché non si esegue lo script. |
| Dispositivo perso prima del caricamento | Il file è perso, come ogni modifica mai inviata. La scheda lo dice: «Solo su questo dispositivo». |
| Riscrittura della riga fallita dopo il caricamento | Alla passata dopo la cache dice `uploadedFor`: si rimarca senza ricaricare. |
| Copia vecchia di chi riceve, ripristino dalla cronologia | `storedFile` è protetta: resta quella del proprietario. |
| Copia vecchia del connettore remoto | `agent.sql` non dà `storedFile` e lo rimette dalla riga attuale. |
| Modifica offline su un altro proprio dispositivo con la riga ancora `"local"` (LWW la fa vincere dopo il caricamento) | Il dispositivo che ha caricato lo rimarca `"cloud"` finché ha la cache (`uploadedFor`); altrove, aprire il file lo trova comunque nel bucket e corregge la riga. |
| Versione vecchia dell'app su un altro dispositivo | Non mostra il download (manca `dataUrl`) ma conserva i campi; dopo l'aggiornamento funziona. |
| Unione di due account | I file `"cloud"` del primo account restano nella sua cartella: il dispositivo che ne ha la copia li ricarica nel nuovo account (`uploadedFor` diverso); gli altri vedono «non trovato». |
| Oggetti orfani | Materiali eliminati da chi riceve, dal connettore remoto (`cloudRunner`, senza Storage) o caricamenti battuti da un'eliminazione: l'oggetto resta 90 giorni (ripristino dalla cronologia), poi lo toglie la pulizia quotidiana del proprietario. Riga viva o assente: resta. |

## Revisione, fix 1 (12/11/2026)

Dalla revisione indipendente (H1, M1–M4, L1–L5). Decisioni:

1. **Nessuna rimozione per un materiale che manca in memoria (H1).** Prima, un caricamento finito
   dopo «Svuota questo dispositivo» toglieva oggetto e copia locale (unica copia persa). Ora la
   passata prende `localResetGuard()` e lo controlla prima di ogni scrittura (anche dentro la
   transazione di `markUploaded` e `deleteLocalFiles`); `markStored` non tocca mai nulla per i
   `missing`. Un oggetto si toglie solo con la pulizia (punto 5) o con «Cancella anche
   dall'account».
2. **Riscritture in sottofondo con timbro della riga +1 ms e solo dopo il primo pull (M1).**
   `backgroundStamp` (come `tieBreakStamp`): una modifica o un'eliminazione vera fatta altrove dopo
   quel timbro vince. Caricamenti, migrazioni e correzioni del segno (anche all'apertura) partono
   solo dopo una passata della sync finita per quell'account in questa pagina (`pullTransition`:
   `lastSync` nuovo rispetto all'inizio della passata) e senza svuotamenti del dispositivo da allora.
   Un segno perso così torna con la passata dopo o con la regola 3.
3. **«cloud» non torna «local» (M2).** `push_studyos_rows` (`schema.sql`) e `studyos_agent_push`
   (`agent.sql`, dentro il ciclo che rimette le chiavi) tengono `"cloud"` su una riga viva se arriva
   `"local"`; il resto della modifica vale. Un id non riceve mai un altro file, quindi il passo
   indietro è sempre una copia vecchia. Il dispositivo che ha inviato «local» lo vede fino al pull
   seguente o finché non riapre il file. Pronto: `stored_file_guard_ready` in `verify.sql`.
4. **Vault cambiato durante una scrittura (M3), senza toccare lo store.** Le chiavi usate in questa
   pagina restano in memoria finché servono (mai con il vault bloccato: al blocco si dimenticano).
   Dopo ogni scrittura `saveLocalFile` ricontrolla il vault e riscrive com'è adesso; ogni passata
   esegue `reconcileLocalSealing` (riscrive, cifra o toglie). Una cache illeggibile si toglie e si
   riscarica dall'account; una copia da caricare illeggibile resta, con «Questo file non si può più
   leggere…» sulla scheda (`FileUnreadableError`).
5. **Pulizia degli oggetti (L1/L2).** Al più una volta al giorno (`files:cleanup:<uid>`) la passata
   elenca la cartella dell'account; per i nomi senza materiale chiede al cloud solo
   `deleted`/`updated_at`/`deletedAt` (100 per richiesta) e toglie quelli eliminati da almeno 90
   giorni (`objectFate`). Una copia da caricare il cui materiale è stato eliminato da poco si carica
   prima di toglierla (`orphanCopyFate`). La coda `attachmentDeletes` dell'account non serve più.
   Limite: la cronologia toglie le revisioni oltre i 90 giorni solo alla scrittura seguente; un
   ripristino di una revisione più vecchia può non trovare il file. Un'eliminazione propria prima del
   caricamento (file mai arrivato nell'account) non si può ripristinare con il file.
6. **«Cancella anche dall'account» offline (L3).** La richiesta (`files:erase:<uid>`) si scrive in
   `SettingsView` prima di caricare il modulo dei file; un errore dello svuotamento non ferma più
   caricamenti e migrazioni.
7. **Uscita con la password dell'app (L5).** «Togli i dati da qui» con il vault attivo e file non
   ancora caricati: lo svuotamento li decifra (unica copia) e poi toglie il vault, quindi
   resterebbero in chiaro. `CloudPanel` chiede prima: OK li elimina da qui (non si può annullare),
   Annulla resta collegato e aspetta il caricamento. «Svuota questo dispositivo» (account ancora
   collegato) li tiene: tutti i dati tornano in chiaro con il vault tolto, e si caricano appena torna
   il loro materiale.
