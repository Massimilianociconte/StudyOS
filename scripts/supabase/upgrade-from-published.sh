#!/bin/zsh
# Aggiornamento dal SQL pubblicato a quello di questo repository, su un Postgres usa e getta con stub di
# Supabase (auth-stub.sql e upgrade-stubs.sql: auth, sessioni, storage, Realtime; niente pg_net, Vault e
# pg_cron, come il progetto prima di accendere le notifiche):
# 1. applica gli script pubblicati (cartella OLD) nell'ordine di allora: schema, groups, sharing, agent,
#    keepalive (quelli che mancano nella cartella si saltano);
# 2. scrive righe come le scrivevano i client di allora (upgrade-seed.sql);
# 3. applica due volte gli 8 script attuali, nell'ordine di supabase/README.md;
# 4. esegue i 5 script di verifica e mostra i valori false o vuoti;
# 5. controlla le righe migrate e prova le RPC sui dati di prima (upgrade-checks.sql), poi esegue sul
#    database aggiornato le prove di scratch-pg.sh che non contano le righe di prima.
# OLD: cartella con i file .sql della versione pubblicata, presi uno per uno con git show, es.:
#   git show c28f036:supabase/schema.sql > /percorso/old/schema.sql
# Uso: LC_ALL=C LANG=C PORT=55518 zsh scripts/supabase/upgrade-from-published.sh /percorso/old
# Richiede initdb/pg_ctl/psql (Postgres 15+). Mai sul progetto reale né sullo stack locale (porte 5542x).
set -e
REPO=${0:A:h:h:h}
OLD=${1:?"serve la cartella con gli script pubblicati, vedi in cima a questo file"}
OLD=${OLD:A}
PORT=${PORT:-55518}
WORK=$(mktemp -d "${TMPDIR:-/tmp}/studyos-upgrade.XXXXXX")
DATA=$WORK/data
initdb -D "$DATA" -U postgres -A trust -E UTF8 --locale=C >/dev/null
pg_ctl -D "$DATA" -o "-p $PORT -k '' -c listen_addresses=127.0.0.1" -l "$WORK/pg.log" -w start >/dev/null
trap 'pg_ctl -D "$DATA" -m fast stop >/dev/null; rm -rf "$WORK"' EXIT
URL="postgresql://postgres@127.0.0.1:$PORT/postgres"
run() { psql "$URL" -X -q -v ON_ERROR_STOP=1 "$@"; }
# Avvisi di un passaggio, senza le righe «già esiste / non esiste, si salta».
notices() { grep -h -E "(NOTICE|WARNING)" "$@" | grep -v -E "skipping" | sed -E 's/^psql:[^ ]+ //' | sort -u | sed 's/^/   /' || true; }

run -f "$REPO/scripts/supabase/auth-stub.sql" >/dev/null
run -f "$REPO/scripts/supabase/upgrade-stubs.sql" >/dev/null

for file in schema groups sharing agent keepalive; do
  if [[ ! -f "$OLD/$file.sql" ]]; then
    echo "pubblicato: $file.sql assente, saltato"
    continue
  fi
  run -f "$OLD/$file.sql" >/dev/null 2>"$WORK/old-$file.err" || { echo "FAIL $file.sql pubblicato"; cat "$WORK/old-$file.err"; exit 1; }
done
echo "1. script pubblicati applicati"
run -f "$REPO/scripts/supabase/upgrade-seed.sql" >/dev/null
echo "2. righe di prima scritte"

for pass in 1 2; do
  for file in schema groups sharing people storage agent push-reminders group-exams; do
    run -f "$REPO/supabase/$file.sql" >/dev/null 2>"$WORK/new-$file-$pass.err" \
      || { echo "FAIL $file.sql (passata $pass)"; cat "$WORK/new-$file-$pass.err"; exit 1; }
  done
  echo "3. passata $pass: 8 script applicati; avvisi:"
  notices "$WORK"/new-*-$pass.err
done

echo "4. verifiche (valori false o vuoti):"
for file in verify sharing-verify people-verify agent-verify push-reminders-verify; do
  out=$(run -x -f "$REPO/supabase/$file.sql") || { echo "FAIL $file.sql"; exit 1; }
  echo " - $file: $(print -r -- "$out" | grep -c -E '\| t$') colonne true"
  print -r -- "$out" | grep -E '\| f$|\| *$' | sed 's/^/     /' || echo "     nessun valore false o vuoto"
done

out=$(run -f "$REPO/scripts/supabase/upgrade-checks.sql" 2>&1) || { print -r -- "$out" | grep -v "^ok "; exit 1; }
echo "5. upgrade-checks: $(print -r -- "$out" | grep -c '^ok ') controlli ok"
# group-exams-tests.sql no: conta i gruppi di Bea (uno solo) e qui Bea è anche nei gruppi di prima; gira
# su un database pulito in scratch-pg.sh.
for file in email-vectors-tests push-notify-tests stored-file-tests; do
  out=$(run -f "$REPO/scripts/supabase/$file.sql" 2>&1) || { print -r -- "$out" | grep -v "^ok "; echo "FAIL $file.sql"; exit 1; }
  echo "   $file sul database aggiornato: $(print -r -- "$out" | grep -c '^ok ') ok $(print -r -- "$out" | grep 'tutto ok' || true)"
done
