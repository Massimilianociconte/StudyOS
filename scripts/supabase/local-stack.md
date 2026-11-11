# Stack Supabase locale per le prove della condivisione

Porte proprie (5542x) per non toccare altri stack locali già attivi sulle 5432x.
La cartella sta in `.cache/` (ignorata da git).

```bash
mkdir -p .cache/ai/supabase-sharing && cd .cache/ai/supabase-sharing
supabase init
sed -i '' -e 's/project_id = ".*"/project_id = "studyos-sharing"/' -e 's/543\([0-9][0-9]\)/554\1/g' supabase/config.toml
supabase start -x studio,imgproxy,edge-runtime,analytics,vector,storage,functions,inbucket
supabase status -o env
```

Dalla radice del repository:

```bash
export PGURL=postgresql://postgres:postgres@127.0.0.1:55422/postgres
psql "$PGURL" -v ON_ERROR_STOP=1 -f supabase/schema.sql
psql "$PGURL" -v ON_ERROR_STOP=1 -f supabase/groups.sql
psql "$PGURL" -v ON_ERROR_STOP=1 -f supabase/sharing.sql
psql "$PGURL" -v ON_ERROR_STOP=1 -f supabase/people.sql
SUPABASE_URL=http://127.0.0.1:55421 SUPABASE_KEY=<ANON_KEY o PUBLISHABLE_KEY di supabase status> \
  node scripts/supabase/sharing-check.mjs
SUPABASE_URL=http://127.0.0.1:55421 SUPABASE_KEY=<ANON_KEY o PUBLISHABLE_KEY di supabase status> PGURL="$PGURL" \
  node scripts/supabase/people-check.mjs
```

`people-check.mjs` usa anche `psql` (inviti vecchi per email, segreti in Vault, rilancio di
`people.sql`) e avvia un Worker finto su `127.0.0.1:55428`: pg_net, dentro il container del
database, lo raggiunge come `host.docker.internal:55428`. I segreti di prova restano in Vault
dello stack locale; il Worker finto si chiude alla fine dello script.

Per l'app su due origini non creare `.env.local` (un file dimenticato punterebbe ogni
`npm run dev` allo stack locale): passa le variabili in linea, una per origine.

```bash
VITE_SUPABASE_URL=http://127.0.0.1:55421 VITE_SUPABASE_PUBLISHABLE_KEY=<chiave publishable locale> npx vite --port 5180 --strictPort
VITE_SUPABASE_URL=http://127.0.0.1:55421 VITE_SUPABASE_PUBLISHABLE_KEY=<chiave publishable locale> npx vite --port 5181 --strictPort
```

Account di prova per l'app (solo stack locale, nessuna conferma email): `alice@studyos.test` e
`bob@studyos.test`, password `Prova-Locale-2026!` per entrambi.

In build la CSP accetta solo l'URL configurato. Alla fine:

```bash
cd .cache/ai/supabase-sharing && supabase stop --no-backup
```
