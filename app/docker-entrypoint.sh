#!/bin/sh
set -e

# Seed the persistent volume on first run.
# If FUNNELS_DB_PATH is set and the file does not yet exist,
# copy the baked-in seed database to that location.
if [ -n "$FUNNELS_DB_PATH" ] && [ ! -f "$FUNNELS_DB_PATH" ]; then
  echo "[entrypoint] $FUNNELS_DB_PATH not found — seeding from /app/seed/ksamata_funnels.db"
  mkdir -p "$(dirname "$FUNNELS_DB_PATH")"
  cp /app/seed/ksamata_funnels.db "$FUNNELS_DB_PATH"
  echo "[entrypoint] Seed complete."
fi

# Apply Phase-2 migration (idempotent: CREATE IF NOT EXISTS + INSERT OR IGNORE).
# Runs after the volume-seed step so FUNNELS_DB_PATH always points to a valid DB.
if [ -n "$FUNNELS_DB_PATH" ]; then
  echo "[entrypoint] Running Phase-2 migration against $FUNNELS_DB_PATH"
  node /app/migrate-phase2.cjs
  echo "[entrypoint] Phase-2 migration done."
fi

exec node server.js
