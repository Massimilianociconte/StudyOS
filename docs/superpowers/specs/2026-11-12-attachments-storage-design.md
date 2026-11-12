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
quell'account, `cloud:boundUser`, online, vault sbloccato, scheda attiva): carica con `upsert` in
`<uid>/<id>`; a caricamento confermato la riga locale diventa cache (`uploadedFor = uid`) e il
materiale passa a `"cloud"` (`markAttachmentsStored`). Se il materiale è stato eliminato durante il
caricamento, l'oggetto si elimina subito. Errore → nuovo tentativo con attesa crescente (30 s →
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

**Eliminazione.** `deleteAttachment` (UI, agenti locali) toglie la copia locale e mette in coda
l'eliminazione dell'oggetto (proprietario = account legato ai dati). Un'eliminazione arrivata da un
altro dispositivo toglie solo la cache: l'oggetto lo elimina chi ha eliminato.

**Cancellazioni di tutto.**
- «Cancella anche dall'account»: oltre a `erase_studyos_account_items`, `eraseAccountFiles` elenca e
  rimuove gli oggetti sotto `<uid>/` creati prima della richiesta (la richiesta resta in `meta` e si
  riprova finché non riesce; i file aggiunti dopo non si toccano). Copie locali tutte tolte.
- «Togli i dati da qui» e cambio di account con «solo il nuovo account»: si toglie la cache, i file
  `pending` restano (sono l'unica copia; tornano a caricarsi quando torna il loro materiale).
- «Cancella tutti i dati» senza account: tolto tutto.

**Backup.** Il backup completo **include i file**: per ogni materiale con file si prende la copia
locale o si scarica, e si mette come `dataUrl` solo nel file esportato. Se un file non si può avere
(offline, mai scaricato) il backup parte comunque e il messaggio dice quanti mancano. All'import i
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
restano solo in memoria); un file `"local"` del proprietario mostra «non ancora caricato».

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
| Oggetti orfani | Materiali eliminati da chi riceve o dal connettore remoto (`cloudRunner`, senza Storage): l'oggetto resta (serve anche al ripristino dalla cronologia) fino alla cancellazione dell'account. Nessuna pulizia automatica per ora. |
