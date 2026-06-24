#!/usr/bin/env bash
# Idempotent migration: adds status and front_code columns to funnels table
# Run from repo root.

set -euo pipefail

DB="${FUNNELS_DB_PATH:-ksamata_funnels.db}"

add_column_if_missing() {
  local col="$1"
  local sql="$2"
  if sqlite3 "$DB" "PRAGMA table_info(funnels);" | grep -q "^[0-9]*|${col}|"; then
    echo "Column '${col}' already exists — skipping."
  else
    sqlite3 "$DB" "$sql"
    echo "Column '${col}' added."
  fi
}

add_column_if_missing "status"     "ALTER TABLE funnels ADD COLUMN status TEXT DEFAULT 'active';"
add_column_if_missing "front_code" "ALTER TABLE funnels ADD COLUMN front_code TEXT DEFAULT '';"

echo "Migration complete."
