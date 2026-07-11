# Ksamata Funnels DB

Internal service for collecting, normalizing, and editing Ksamata autofunnel data with a convenient admin UI.

## Current Shape

- `app/` - Next.js 15 admin application, API routes, Drizzle schema, tests, Docker files.
- `ksamata_funnels.db` - current local SQLite database used by app tests and legacy data scripts.
- `app/seed/ksamata_funnels.db` - seed database baked into the Docker image.
- `data/source/` - source Excel workbooks used to build or enrich the database.
- `data/generated/` - generated workbook exports.
- `tools/data-import/` - Python scripts that create or mutate the root SQLite database.
- `tools/data-export/` - Python scripts that export SQLite data to workbooks.
- `docs/` - development notes, project map, and historical plans/specs.

## App Commands

Run from `app/`:

```sh
npm install
npm run dev
npx tsc --noEmit
npx vitest run
npm run build
```

The local dev server uses `FUNNELS_DB_PATH` when set. Without it, the app code defaults to the repository database path configured in `app/src/db/client.ts`.

## Database Notes

Keep `ksamata_funnels.db` at the repository root unless you intentionally update all scripts, tests, seed steps, and environment defaults. Several test fixtures copy this file directly.

SQLite WAL sidecars (`*.db-wal`, `*.db-shm`) are ignored. Before copying or baking a database seed, stop any running dev server and run a WAL checkpoint so the main `.db` file contains the latest data.

## Deployment

Dokploy deployment notes live in `app/DEPLOY.md`. The Docker image seeds `/data/ksamata_funnels.db` on first start and runs idempotent Phase 2/Phase 3 migrations through `app/docker-entrypoint.sh`.
