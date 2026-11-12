#!/bin/zsh
# Postgres usa e getta con stub di auth: applica gli script due volte (devono essere rieseguibili),
# poi esegue le prove. Uso: LC_ALL=C LANG=C zsh scripts/supabase/scratch-pg.sh
# Richiede initdb/pg_ctl/psql (Postgres 15+). Mai sul progetto reale.
set -e
REPO=${0:A:h:h:h}
DATA=$(mktemp -d)/data
PORT=${PORT:-55507}
initdb -D "$DATA" -U postgres -A trust -E UTF8 --locale=C >/dev/null
pg_ctl -D "$DATA" -o "-p $PORT -k '' -c listen_addresses=127.0.0.1" -l "$DATA.log" -w start >/dev/null
trap 'pg_ctl -D "$DATA" -m fast stop >/dev/null; rm -rf "${DATA:h}"' EXIT
URL="postgresql://postgres@127.0.0.1:$PORT/postgres"
psql "$URL" -q -v ON_ERROR_STOP=1 -f "$REPO/scripts/supabase/auth-stub.sql" >/dev/null
for pass in 1 2; do
  for file in schema groups sharing people agent group-exams; do
    psql "$URL" -q -v ON_ERROR_STOP=1 -f "$REPO/supabase/$file.sql" >/dev/null || { echo "FAIL $file.sql (passata $pass)"; exit 1; }
  done
done
echo "script applicati due volte"
psql "$URL" -q -v ON_ERROR_STOP=1 -f "$REPO/scripts/supabase/group-exams-tests.sql"
psql "$URL" -q -f "$REPO/supabase/sharing-verify.sql"
psql "$URL" -q -x -f "$REPO/supabase/verify.sql" | grep -E "^(tables_rls_ready|anon_closed_ready|definer_functions_ready|security_issues) "
