#!/usr/bin/env bash
# Applique la migration sur un Postgres local nu (avec un faux schéma auth)
# puis joue les parcours à deux comptes. Usage : PGHOST=... PGPORT=... ./supabase/tests/run_local.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
P="psql -U ${PGUSER:-postgres} -v ON_ERROR_STOP=1 -q"
$P -c "drop database if exists couple_test" -c "create database couple_test"
$P -d couple_test -f supabase/tests/00_local_stub.sql 2>&1 | grep -v -e wal_level -e "Set wal_level" || true
for f in supabase/migrations/*.sql; do $P -d couple_test -f "$f"; done
$P -d couple_test -f supabase/tests/01_scenarios.sql
