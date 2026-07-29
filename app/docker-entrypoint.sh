#!/bin/sh
set -e

# Seed the persistent volume on first run.
# If FUNNELS_DB_PATH is set and the file does not yet exist,
# copy the baked-in seed database to that location.
#
# Copy to a temp file and rename, never straight onto the target: a container
# killed mid-cp would leave a truncated file that still satisfies `[ ! -f ]` on
# the next start, so seeding would be skipped and every migration would run
# against a corrupt database. Rename within one directory is atomic, so the
# target either does not exist yet or is a complete DB.
if [ -n "$FUNNELS_DB_PATH" ] && [ ! -f "$FUNNELS_DB_PATH" ]; then
  echo "[entrypoint] $FUNNELS_DB_PATH not found — seeding from /app/seed/ksamata_funnels.db"
  mkdir -p "$(dirname "$FUNNELS_DB_PATH")"
  seed_tmp="$FUNNELS_DB_PATH.seed.$$"
  rm -f "$FUNNELS_DB_PATH".seed.*   # остатки прерванных попыток
  trap 'rm -f "$seed_tmp"' EXIT INT TERM
  cp /app/seed/ksamata_funnels.db "$seed_tmp"
  mv "$seed_tmp" "$FUNNELS_DB_PATH"
  trap - EXIT INT TERM
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

# Apply Phase-4 migration (idempotent: guarded ALTER + marker-gated one-time
# backfill of rooms_enabled via schema_migrations['phase4_rooms_enabled']).
if [ -n "$FUNNELS_DB_PATH" ]; then
  echo "[entrypoint] Running Phase-4 migration against $FUNNELS_DB_PATH"
  node /app/migrate-phase4.cjs
  echo "[entrypoint] Phase-4 migration done."
fi

# Apply Phase-5 migration (idempotent: CREATE IF NOT EXISTS + marker-gated seed),
# then backfill legacy non-AV tags into overrides (after phase-5 seeds the template).
if [ -n "$FUNNELS_DB_PATH" ]; then
  echo "[entrypoint] Running Phase-5 migration against $FUNNELS_DB_PATH"
  node /app/migrate-phase5.cjs
  echo "[entrypoint] Phase-5 migration done."
  echo "[entrypoint] Backfilling legacy tags into overrides against $FUNNELS_DB_PATH"
  node /app/backfill-legacy-tag-overrides.cjs
  echo "[entrypoint] Legacy tag-override backfill done."
fi

# Apply Phase-6 migration (idempotent: CREATE TABLE/INDEX IF NOT EXISTS).
# Adds the landing-availability monitoring tables.
if [ -n "$FUNNELS_DB_PATH" ]; then
  echo "[entrypoint] Running Phase-6 migration against $FUNNELS_DB_PATH"
  node /app/migrate-phase6.cjs
  echo "[entrypoint] Phase-6 migration done."
fi

# Apply Phase-7 migration (idempotent: normalize + dedupe + CREATE UNIQUE INDEX
# IF NOT EXISTS). Makes funnels.front_code unique among non-empty codes.
if [ -n "$FUNNELS_DB_PATH" ]; then
  echo "[entrypoint] Running Phase-7 migration against $FUNNELS_DB_PATH"
  node /app/migrate-phase7.cjs
  echo "[entrypoint] Phase-7 migration done."
fi

# Apply Phase-8 migration (idempotent: CREATE TABLE IF NOT EXISTS + INSERT OR IGNORE).
# Adds the funnel-type lookup (fifth AV axis) and backfills it with «АВ Автоворонка».
if [ -n "$FUNNELS_DB_PATH" ]; then
  echo "[entrypoint] Running Phase-8 migration against $FUNNELS_DB_PATH"
  node /app/migrate-phase8.cjs
  echo "[entrypoint] Phase-8 migration done."
fi

exec node server.js
