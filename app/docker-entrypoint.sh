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

exec node server.js
