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

# Apply Phase-3 migration (idempotent: guarded ALTER + CREATE IF NOT EXISTS +
# marker-gated data move via schema_migrations['phase3_funnel_data'] — runs once per DB).
if [ -n "$FUNNELS_DB_PATH" ]; then
  echo "[entrypoint] Running Phase-3 migration against $FUNNELS_DB_PATH"
  node /app/migrate-phase3.cjs
  echo "[entrypoint] Phase-3 migration done."
fi

# Apply Phase-5 migration (idempotent: CREATE IF NOT EXISTS + marker-gated seed).
if [ -n "$FUNNELS_DB_PATH" ]; then
  echo "[entrypoint] Running Phase-5 migration against $FUNNELS_DB_PATH"
  node /app/migrate-phase5.cjs
  echo "[entrypoint] Phase-5 migration done."
  echo "[entrypoint] Backfilling legacy tags into overrides against $FUNNELS_DB_PATH"
  node /app/backfill-legacy-tag-overrides.cjs
  echo "[entrypoint] Legacy tag-override backfill done."
fi

exec node server.js
