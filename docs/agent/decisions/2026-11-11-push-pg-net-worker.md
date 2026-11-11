# ADR: notifiche push dal database al Worker con `pg_net`, senza `service_role`

- Stato: accettata
- Data: 11/11/2026
- Sostituisce: nessuna
- Design completo: [2026-11-11-people-search-push-design.md](../../plans/2026-11-11-people-search-push-design.md)

## Contesto

StudyOS è una PWA su GitHub Pages con Supabase (piano Free) e un Worker Cloudflare
(`studyos-agent`) già in uso. Gli inviti (gruppi e condivisione), le accettazioni e i cambi di
permesso devono arrivare anche ad app chiusa. Una Web Push va cifrata (RFC 8291) e firmata
(VAPID, RFC 8292) da un server con una chiave privata, e va spedita agli endpoint che ogni
dispositivo ha registrato. Chi decide *quando* inviare è il database: gli eventi nascono lì
(inserimenti in `studyos_group_invites`, `studyos_share_invites`, `studyos_group_members`,
cambi in `studyos_shares`). Vincolo del progetto: nel client, in CI e nel Worker solo la chiave
publishable, mai `service_role`.

## Decisione

1. **Trigger SQL → `pg_net` → Worker.** Un trigger `AFTER` per evento chiama
   `studyos_push_notify` (`security definer`, senza privilegi per `anon` e `authenticated`):
   toglie chi ha compiuto l'azione e i doppioni, raccoglie le iscrizioni dei destinatari da
   `studyos_push_subscriptions` e le spedisce nel corpo di un `POST` a `<worker>/push`.
2. **Il Worker non legge il database.** Riceve le iscrizioni nella richiesta, cifra, firma e
   invia. Si autentica chi lo chiama con `x-studyos-push-secret`; segreto e URL stanno in Vault
   (`studyos_push_secret`, `studyos_push_url`) e nei secret del Worker. L'unica chiamata verso
   Supabase è `push_gone(p_secret, p_endpoints)` con la chiave publishable, che cancella le
   iscrizioni spente (404/410) solo se il segreto coincide.
3. **Mai un errore a monte.** Senza `pg_net`, senza segreti o con il Worker irraggiungibile,
   `studyos_push_notify` non fa nulla o ignora l'errore: la scrittura che ha fatto scattare il
   trigger riesce comunque. `people-verify.sql` segnala cosa manca.
4. **Contenuto minimo e cifrato.** Il messaggio è `{ kind, title, body, url, tag }`, cifrato fino
   al dispositivo; il `tag` diventa anche l'intestazione `Topic`, così una notifica nuova
   sostituisce la vecchia. Il Worker registra solo `{ sent, gone }`.
5. **Client.** Permesso e iscrizione solo dopo un tocco; riga upsert su `endpoint`; riallineamento
   all'avvio; `public/sw.js` mostra la notifica e al tocco apre `?apri=…`.

## Alternative considerate

- **Edge Function di Supabase.** Avrebbe letto le iscrizioni con la chiave di servizio e
  inviato lei le push: richiede `service_role` in un ambiente esterno al database e non è
  disponibile sullo stack locale minimale usato per le prove.
- **Il Worker legge le iscrizioni con `service_role`.** Spostava la chiave più potente del
  progetto in un secret di Cloudflare: escluso dal vincolo.
- **Servizio terzo (OneSignal, Firebase).** Cede a terzi iscrizioni e contenuti e aggiunge una
  dipendenza e un account; la Web Push standard basta.
- **Solo Realtime e campanella.** Non raggiunge chi ha l'app chiusa: è il motivo della funzione.
- **Invio dal client del mittente.** Il mittente non conosce né deve leggere le iscrizioni
  degli altri.

## Conseguenze

- Le iscrizioni dei destinatari (endpoint e chiavi pubbliche del dispositivo) viaggiano dal
  database al Worker su HTTPS: servono per cifrare e non sono un segreto d'account.
- `pg_net` è asincrono e senza ritentativi: la consegna è al meglio; TTL 24 ore, urgenza
  `normal`. L'avviso resta comunque nella campanella dell'app.
- Tetti: il database manda lotti di al massimo 40 iscrizioni e il Worker ne accetta al massimo
  49 per richiesta (49 push più una `push_gone` sono 50 sottorichieste sul piano Free). Per chi
  compie l'azione `studyos_push_notify` manda al massimo 30 notifiche all'ora
  (`studyos_push_sends`, righe più vecchie di un'ora cancellate): oltre salta la push in
  silenzio e non blocca la scrittura, le notifiche in app arrivano comunque. Serve a non
  inondare qualcuno con inviti e annullamenti, o cambi di permessi, ripetuti.
- Limiti noti: il Worker invia a qualunque endpoint https salvato come iscrizione (nessun
  elenco dei servizi push ammessi; lo limita il tetto per chi agisce); il tempo di CPU di un
  lotto grande sul piano Free (10 ms) non è stato misurato, da controllare con `wrangler tail`
  dopo il deploy; se un `@nome` è preso si può sapere anche salvando direttamente il profilo
  (vincolo di unicità), non solo con `is_handle_available`; i membri di un gruppo leggono
  l'email di ogni membro in `studyos_group_members` (già così prima), quindi chi è invitato per
  `@nome` la rivela al gruppo quando accetta; l'avviso una tantum (`peopleNoticeSeen`) si
  ricorda per dispositivo.
- Ordine di pubblicazione: `people.sql` sul progetto reale **prima** del nuovo client, che
  legge `recipient_user_id`.
- Rotazione del segreto: aggiornare Vault (`vault.update_secret`) e `STUDYOS_PUSH_SECRET` nello
  stesso momento. Rotazione della chiave VAPID: nuova coppia, nuovo `src/lib/pushKeys.ts`,
  `STUDYOS_VAPID_PRIVATE_KEY` e deploy; le iscrizioni vecchie si rifanno all'avvio successivo.
- Un nuovo evento da notificare è un trigger in `people.sql` che chiama `studyos_push_notify`
  con `kind`, testo, `url` (`?apri=notifiche|condivisione|gruppi`) e `tag`.
- Su iPhone e iPad le push richiedono StudyOS nella schermata Home.
- Su un dispositivo condiviso, all'accesso l'iscrizione lasciata da un altro account viene
  tolta dal browser.

## Componenti interessati

`supabase/people.sql`, `supabase/people-verify.sql`, `worker/webPush.ts`, `worker/push.ts`,
`worker/index.ts`, `scripts/push-keys.mjs`, `src/lib/pushKeys.ts`, `src/lib/push.ts`,
`src/lib/openLink.ts`, `src/components/PushToggle.tsx`, `src/components/PushPrompt.tsx`,
`public/sw.js`.
