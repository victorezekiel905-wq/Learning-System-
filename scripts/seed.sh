#!/usr/bin/env bash
# Apply all EduClass Fusion migrations in numeric order.
# Uses psql against $SUPABASE_DB_URL (the Postgres connection string, NOT the API URL).
#
#   SETUP_DB_URL=postgres://postgres.PROJECT:PASSWORD@aws-0-us-east-1.pooler.supabase.com:6543/postgres \
#     bash scripts/migrate.sh
set -euo pipefail

: "${SUPABASE_DB_URL:?Set SUPABASE_DB_URL in the environment (your Postgres connection string from Supabase project settings → Database).}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

for f in $(ls supabase/migrations/*.sql | sort); do
  echo "▶ $(basename "$f")"
  psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f "$f" || exit 1
done

echo "✓ All migrations applied."
