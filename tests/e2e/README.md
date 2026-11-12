# Prove end-to-end con due account (stack Supabase locale)

Playwright apre l'app vera (server Vite) in più browser separati, uno per dispositivo, con due
account di prova: Alice e Bob. Parla solo con lo **stack Supabase locale** sulle porte 5542x.
Non tocca mai il progetto Supabase reale né le porte 5432x (un altro progetto).

## Cosa provano

| File | Scenario |
| --- | --- |
| `01-accounts.spec.ts` | Alice e Bob accedono; ognuno vede solo le sue attività, anche dopo un ricaricamento e su un secondo dispositivo di Alice. |
| `02-group-join.spec.ts` | Alice crea un gruppo, Bob entra dal link di invito (`#invito=…`); tutti e due vedono i due membri, Alice senza ricaricare. Una sola voce «è entrato nel gruppo». |
| `03-group-board-live.spec.ts` | Alice aggiunge una nota in bacheca e Bob la vede comparire dal vivo; Bob aggiunge e fissa la sua nota e Alice vede il fissaggio dal vivo. Il fissaggio resta dopo un ricaricamento. |
| `04-share-task.spec.ts` | Alice condivide le sue attività con Bob («Può modificare», invito con link); Bob modifica un'attività di Alice e Alice vede la modifica; Alice smette di condividere e la modifica successiva di Bob non passa, con l'avviso giusto. |
| `05-group-leave.spec.ts` | Bob esce dal gruppo; Alice vede «bob ha lasciato il gruppo» nella cronologia (voce scritta dal trigger del server) e un solo membro. |
| `06-account-erase.spec.ts` | Bob usa «Cancella anche dall'account» dal telefono: spariscono anche le attività create sul portatile, il portatile le perde dal vivo, e né un ricaricamento né un accesso da un dispositivo nuovo le riportano. |
| `07-group-join-catchup.spec.ts` | Con la rete di Bob lenta, Alice aggiunge una nota mentre Bob sta entrando nel gruppo: la nota compare a Bob appena il suo canale è pronto, senza ricaricare. |

Ogni prova crea i propri dati (nomi con un suffisso unico) e parte e finisce con i due account
azzerati sul server (`resetAccounts` in `support/stack.ts`): dati personali, gruppi, condivisioni,
inviti e cronologie dei soli due account di prova. Gli account restano.

## Cosa serve

- Docker Desktop avviato, Supabase CLI, `psql` (es. `brew install libpq`), Node 22.
- Dipendenze del progetto: `npm ci`.
- Chromium di Playwright 1.64.1 (build 1248). Se manca: `npx playwright install chromium`.

## Avviare lo stack locale

Dalla radice del repository (come in `scripts/supabase/local-stack.md`):

```bash
mkdir -p .cache/ai/supabase-sharing && cd .cache/ai/supabase-sharing
supabase init
sed -i '' -e 's/project_id = ".*"/project_id = "studyos-sharing"/' -e 's/543\([0-9][0-9]\)/554\1/g' supabase/config.toml
# Solo per le prove: una passata fa una ventina di accessi e il limite locale è 30 ogni 5 minuti.
sed -i '' -e 's/^sign_in_sign_ups = 30$/sign_in_sign_ups = 1000/' -e 's/^token_refresh = 150$/token_refresh = 1000/' supabase/config.toml
supabase start -x studio,imgproxy,edge-runtime,analytics,vector,functions,inbucket
cd ../../..
```

Poi lo schema, nell'ordine:

```bash
export PGURL=postgresql://postgres:postgres@127.0.0.1:55422/postgres
psql "$PGURL" -v ON_ERROR_STOP=1 -f supabase/schema.sql
psql "$PGURL" -v ON_ERROR_STOP=1 -f supabase/groups.sql
psql "$PGURL" -v ON_ERROR_STOP=1 -f supabase/sharing.sql
psql "$PGURL" -v ON_ERROR_STOP=1 -f supabase/people.sql
psql "$PGURL" -v ON_ERROR_STOP=1 -f supabase/storage.sql
psql "$PGURL" -v ON_ERROR_STOP=1 -f supabase/agent.sql
psql "$PGURL" -v ON_ERROR_STOP=1 -f supabase/push-reminders.sql
```

`people.sql` serve sempre: senza, la sincronizzazione di gruppi e condivisioni dell'app attuale
non parte. Gli altri tre tengono lo stack uguale al progetto reale (file, collegamenti agli agenti,
promemoria). In locale `push-reminders-verify.sql` mostra `vault_ready` e `cron_ready` falsi: è
normale, il job e i segreti esistono solo sul progetto reale. Per i file serve anche il servizio
storage: per questo il comando sopra non lo esclude.

Gli account di prova (`alice@studyos.test`, `bob@studyos.test`, password in
`scripts/supabase/local-stack.md`) li crea il global setup se mancano.

## Eseguire

```bash
npm run e2e                 # tutte le prove
npm run e2e -- 04           # solo i file che contengono «04»
npm run e2e -- --headed     # con il browser visibile
```

Il global setup (`global-setup.ts`):

1. legge URL e chiave publishable da `supabase status -o env` nella cartella dello stack (la chiave
   non si stampa e non si salva in nessun file);
2. controlla che l'URL sia `http://127.0.0.1:5542x` e che lo schema ci sia;
3. crea i due account se mancano e li azzera;
4. avvia un solo `vite` su `http://127.0.0.1:5190` con `VITE_SUPABASE_URL` e
   `VITE_SUPABASE_PUBLISHABLE_KEY` passate in linea (mai `.env.local`), e lo ferma alla fine.

Variabili facoltative: `E2E_SUPABASE_URL` (predefinito `http://127.0.0.1:55421`; la configurazione
rifiuta di partire con qualsiasi URL che non sia `http://127.0.0.1:5542x`), `E2E_SUPABASE_DIR`
(cartella dello stack, predefinita `.cache/ai/supabase-sharing`), `E2E_APP_PORT` (5190).

Durante le prove ogni richiesta che non va all'app o allo stack locale viene bloccata; una
richiesta a un Supabase non locale, un `confirm`/`alert` del browser inatteso o un errore nella
pagina fanno fallire la prova.

Risultati, report HTML, trace e screenshot degli errori: `.cache/ai/e2e/` (ignorata da git).
Per aprire una trace: `npx playwright show-trace .cache/ai/e2e/test-results/<prova>/trace.zip`.

Le prove unitarie non cambiano: `npm test` legge solo `tests/*.test.mjs`.

## Alla fine

```bash
cd .cache/ai/supabase-sharing && supabase stop --no-backup
```
