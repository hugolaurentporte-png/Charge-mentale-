#!/usr/bin/env bash
# Crée une base locale neuve (nom horodaté) avec le faux schéma auth et la
# migration, puis affiche son nom. Usage : DB=$(./e2e/setup-db.sh)
set -euo pipefail
cd "$(dirname "$0")/.."
name="couple_e2e_$(date +%s)"
psql -U "${PGUSER:-postgres}" -v ON_ERROR_STOP=1 -q -c "create database ${name}" >&2
psql -U "${PGUSER:-postgres}" -v ON_ERROR_STOP=1 -q -d "${name}" -f supabase/tests/00_local_stub.sql >/dev/null 2>&1
for f in supabase/migrations/*.sql; do
  psql -U "${PGUSER:-postgres}" -v ON_ERROR_STOP=1 -q -d "${name}" -f "$f" >&2
done
echo "${name}"
