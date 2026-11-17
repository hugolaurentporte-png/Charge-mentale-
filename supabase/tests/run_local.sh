#!/usr/bin/env bash
# Applique les migrations sur une base Postgres locale neuve (faux schéma auth)
# puis joue les parcours SQL à deux comptes.
# Usage : PGHOST=... PGPORT=... ./supabase/tests/run_local.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
db="$(./e2e/setup-db.sh)"
for f in supabase/tests/01_scenarios.sql supabase/tests/02_push.sql supabase/tests/03_notes_recurrence_agenda.sql; do
  psql -U "${PGUSER:-postgres}" -v ON_ERROR_STOP=1 -q -d "${db}" -f "$f" 2>&1 | grep -E "TOUS|ERROR|ERREUR" || { echo "Échec : $f"; exit 1; }
done
