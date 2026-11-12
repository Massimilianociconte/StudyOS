#!/bin/zsh
# Postgres usa e getta con stub di auth: applica gli script due volte (devono essere rieseguibili),
# poi esegue le prove, due volte: nel database di prova con locale C e in uno con en_US.UTF-8 (dove
# lower('İ') = 'i': le prove sulle email non devono dipendere dal locale). Se il locale non esiste
# sulla macchina, la seconda passata si salta.
# Uso: LC_ALL=C LANG=C zsh scripts/supabase/scratch-pg.sh
# Richiede initdb/pg_ctl/psql (Postgres 15+). Mai sul progetto reale.
# HOOK (facoltativo): comando eseguito in ogni database dopo gli script, con DB_URL esportato (prove di carico,
# confronti con il client); con HOOK_ONLY=1 si esegue solo quello, senza le prove.
set -e
REPO=${0:A:h:h:h}
DATA=$(mktemp -d)/data
PORT=${PORT:-55507}
initdb -D "$DATA" -U postgres -A trust -E UTF8 --locale=C >/dev/null
pg_ctl -D "$DATA" -o "-p $PORT -k '' -c listen_addresses=127.0.0.1" -l "$DATA.log" -w start >/dev/null
trap 'pg_ctl -D "$DATA" -m fast stop >/dev/null; rm -rf "${DATA:h}"' EXIT
BASE="postgresql://postgres@127.0.0.1:$PORT"

run_db() {
  local URL="$BASE/$1"
  psql "$URL" -q -v ON_ERROR_STOP=1 -f "$REPO/scripts/supabase/auth-stub.sql" >/dev/null
  for pass in 1 2; do
    for file in schema groups sharing people agent group-exams; do
      psql "$URL" -q -v ON_ERROR_STOP=1 -f "$REPO/supabase/$file.sql" >/dev/null || { echo "FAIL $file.sql (passata $pass)"; exit 1; }
    done
  done
  echo "script applicati due volte ($1)"
  if [[ -n "${HOOK:-}" ]]; then
    DB_URL="$URL" zsh -c "$HOOK" || { echo "FAIL hook ($1)"; exit 1; }
    [[ "${HOOK_ONLY:-}" == 1 ]] && return 0
  fi
  psql "$URL" -q -v ON_ERROR_STOP=1 -f "$REPO/scripts/supabase/email-vectors-tests.sql"
  psql "$URL" -q -v ON_ERROR_STOP=1 -f "$REPO/scripts/supabase/group-exams-tests.sql"
  psql "$URL" -q -f "$REPO/supabase/sharing-verify.sql"
  psql "$URL" -q -x -f "$REPO/supabase/verify.sql" | grep -E "^(tables_rls_ready|anon_closed_ready|definer_functions_ready|security_issues) "
}

run_db postgres
if psql "$BASE/postgres" -q -v ON_ERROR_STOP=1 -c "create database lc_utf8 template template0 encoding 'UTF8' lc_collate 'en_US.UTF-8' lc_ctype 'en_US.UTF-8'" >/dev/null 2>&1; then
  run_db lc_utf8
else
  echo "locale en_US.UTF-8 non disponibile: seconda passata saltata"
fi
