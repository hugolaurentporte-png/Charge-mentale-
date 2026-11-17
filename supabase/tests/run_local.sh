#!/usr/bin/env bash
# Applique la migration sur une base Postgres locale neuve (faux schéma auth)
# puis joue les parcours SQL à deux comptes.
# Usage : PGHOST=... PGPORT=... ./supabase/tests/run_local.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
db="$(./e2e/setup-db.sh)"
psql -U "${PGUSER:-postgres}" -v ON_ERROR_STOP=1 -q -d "${db}" -f supabase/tests/01_scenarios.sql | grep -E "TOUS|ERROR" || { echo "Échec"; exit 1; }
