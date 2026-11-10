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
SUPABASE_URL=http://127.0.0.1:55421 SUPABASE_KEY=<ANON_KEY o PUBLISHABLE_KEY di supabase status> \
  node scripts/supabase/sharing-check.mjs
```

Per l'app su due origini non creare `.env.local` (un file dimenticato punterebbe ogni
`npm run dev` allo stack locale): passa le variabili in linea, una per origine.

```bash
VITE_SUPABASE_URL=http://127.0.0.1:55421 VITE_SUPABASE_PUBLISHABLE_KEY=<chiave publishable locale> npx vite --port 5180 --strictPort
VITE_SUPABASE_URL=http://127.0.0.1:55421 VITE_SUPABASE_PUBLISHABLE_KEY=<chiave publishable locale> npx vite --port 5181 --strictPort
```

In build la CSP accetta solo l'URL configurato. Alla fine:

```bash
cd .cache/ai/supabase-sharing && supabase stop --no-backup
```
