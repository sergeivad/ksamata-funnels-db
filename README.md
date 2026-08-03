# Ksamata Funnels DB

Internal service for collecting, normalizing, and editing Ksamata autofunnel data with a convenient admin UI.

> **AI agents & contributors:** [CLAUDE.md](CLAUDE.md) is the canonical guide
> (architecture, data model, migrations, auth, conventions). This README is a
> high-level orientation.

## Current Shape

- `app/` - Next.js 15 admin application, API routes, Drizzle schema, tests, Docker files.
- `ksamata_funnels.db` - current local SQLite database used by app tests and legacy data scripts.
- `app/seed/ksamata_funnels.db` - seed database baked into the Docker image.
- `data/source/` - source Excel workbooks used to build or enrich the database.
- `data/generated/` - generated workbook exports.
- `tools/data-import/` - Python scripts that create or mutate the root SQLite database.
- `tools/data-export/` - Python scripts that export SQLite data to workbooks.
- `tools/audit/` - read-only tag drift map (GetCourse registry vs order history vs DB).
- `docs/` - development notes, project map, and historical plans/specs.

## External Systems

Two systems this database is reconciled against; neither is a dependency of the
running service.

- **LeakEngine** (`leak.besales.ai`) - attribution system, and the **source of
  truth for F codes** (`funnels.front_code`). Read and write are both possible
  through its internal admin API; the write path is gated on the owner's
  request, because activating a rules pack triggers a recalculation. See
  [docs/leak-engine.md](docs/leak-engine.md).
- **GetCourse** - where the AV tags and the offer registry actually live.
  `tools/audit/` builds the drift map against it; API limits and polling rules
  matter, so read the audit README before writing anything that calls it.

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

## Local Development in Docker

Hot-reload dev stack (run from the repository root):

```sh
docker compose up            # first run builds the image (compiles better-sqlite3)
docker compose up --build    # rebuild after changing app/package.json or the lockfile
docker compose down          # stop
```

Open http://localhost:3000. Editing files under `app/` hot-reloads inside the
container (polling is enabled for macOS bind mounts). The container uses your
real `ksamata_funnels.db` (live-mounted from the repo root at `/data`), so data
edited in the admin UI persists to your local file.

Config lives in [docker-compose.yml](docker-compose.yml) and
[app/Dockerfile.dev](app/Dockerfile.dev). This is the dev image; the production
image (`app/Dockerfile`) is unchanged — see [Deployment](#deployment).

## Database Notes

Keep `ksamata_funnels.db` at the repository root unless you intentionally update all scripts, tests, seed steps, and environment defaults. Several test fixtures copy this file directly.

SQLite WAL sidecars (`*.db-wal`, `*.db-shm`) are ignored. Before copying or baking a database seed, stop any running dev server and run a WAL checkpoint so the main `.db` file contains the latest data.

A running dev server (local or the Docker dev stack, which live-mounts the same file) also starts the background monitoring scheduler: it fills the `monitor_*` tables and hits real landing pages. Set `MONITOR_ENABLED=false` in `app/.env.local` if you don't want that, and restore the database before committing — see the monitoring gotcha in [CLAUDE.md](CLAUDE.md).

## Deployment

Dokploy deployment notes live in [app/DEPLOY.md](app/DEPLOY.md). The production
Docker image seeds `/data/ksamata_funnels.db` on first start, then on every start
runs the idempotent migration chain through `app/docker-entrypoint.sh`:
Phase 2 → 3 (+ data) → 4 → 5 → legacy tag-override backfill → 6 → 7 → 8.

Note: the root `docker-compose.yml` is a **dev** stack (hot-reload, real repo DB)
and does not run the seed/migration entrypoint — that path is production-only.
