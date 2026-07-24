# CLAUDE.md

Canonical guide for AI agents (Claude Code, Codex) and humans working in this repo.
This is the single source of truth for architecture, commands, and conventions.
Keep it in sync when you change structure, migrations, env vars, or the data model.

## What this is

**Ksamata Funnels DB** — an internal service for collecting, normalizing, and
editing Ksamata autofunnel data through an admin web UI. The system of record is
a single SQLite database (`ksamata_funnels.db`); the `app/` Next.js service is
the production boundary that reads and edits it. Python tools under `tools/`
build and export the same database from Excel sources.

## Repository layout

| Path | Purpose |
|---|---|
| `app/` | **Production service** — Next.js 15 admin app (App Router), API routes, Drizzle schema, migrations, tests, Docker files. Treat as the service boundary. |
| `ksamata_funnels.db` | Live local SQLite database. Kept at repo root (tests, Python tools, and Docker seed refresh all assume this path). |
| `app/seed/ksamata_funnels.db` | Seed database baked into the production Docker image. |
| `data/source/` | Source Excel workbooks used to build/enrich the DB. |
| `data/generated/` | Generated workbook exports (gitignored). |
| `tools/data-import/` | Python scripts that build or mutate the root SQLite DB. |
| `tools/data-export/` | Python scripts that export the DB to XLSX reports. |
| `docs/` | Development notes, project map, docs index, and historical plans/specs. See [docs/README.md](docs/README.md). |

`ksamata-leak-funnels/` (local reference dataset) and `*.db.bak_*` backups are
gitignored and never committed.

## App commands

Run everything from `app/`:

```sh
npm install
npm run dev          # next dev on :3000
npx tsc --noEmit     # typecheck
npx vitest run       # full test suite
npm run build        # production build
```

The dev server uses `FUNNELS_DB_PATH` when set; otherwise it defaults to the
repo-root database resolved in `app/src/db/client.ts` (relative to `process.cwd()`,
which is `app/`).

## Data model (`app/src/db/schema.ts`)

Drizzle SQLite. Core + lookup + content + tags tables:

- **Lookups:** `sources`, `products`, `contractors`, `tags` (global tag names).
- **`funnels`** — one row per funnel: identity FKs (source/product/contractor),
  `variant`, `productName`, landing/dashboard URLs, raw tag strings
  (`tag19Raw`/`tag15Raw`/`regTagsRaw`), `roomIdsJson`, `bothelpCondition`,
  `status` (`active`/`draft`/`archive`), `frontCode`, `comment`,
  `timeLabelA`/`timeLabelB`, and room toggles `roomsEnabled` / `roomsReplayEnabled`.
- **`funnel_days`** — per-funnel day × time-slot rows (`timeSlot` `19`/`15`,
  `dayNum`) with room fields and legacy content columns.
- **`funnel_blocks`** / **`funnel_block_items`** — structured content blocks
  (see block kinds below); a block has a `kind`, `enabled`, and `mode`
  (`common` / `by_time`); items carry `slot`, `label`, `url`, `position`.
- **Tags system (see below):** `funnel_tags` (resolved per-funnel tags),
  `tag_templates` (global template per scenario), `funnel_tag_overrides`
  (per-funnel add/remove deltas).
- **Other:** `salebot_configs`, `product_durations`.
- **Monitoring (Phase 6):** `monitor_targets` (URL to check, `source_kind`,
  `enabled`, plus `manual_override` — `1` once a human has toggled the target,
  which makes the sync leave `enabled` alone; while it is `0` the sync
  recomputes `enabled` from `source_kind`, so a landing that briefly vanished
  from the funnel data comes back on by itself),
  `monitor_target_funnels` (which funnels use the URL),
  `monitor_state` (current status per target, 1:1), `monitor_events` (status
  **changes** only — never one row per check).
- **Orphaned/inactive:** `channels`, `directions` (present in schema but not
  exposed via `/api/refs`), and `funnel_links` (removed — links are now a
  `funnel_blocks` kind). Do not build on these without checking.

**Block kinds** (`app/src/lib/blocks.ts`, canonical slugs): `landings`,
`records`, `tariffs`, `applications`, `bonuses`, `oto`, `processes`,
`meditation`, `links`.

### Tags: three layers

Tags are resolved, not stored once. Understand the layering before editing:

1. **`tag_templates`** — the global A/B template per scenario (`reg`, `time_15`,
   `time_19`, `messenger`). Edited at `/tags`.
2. **`funnel_tag_overrides`** — per-funnel `add`/`remove` deltas layered on top
   of the template. Edited on the funnel page.
3. **`funnel_tags`** — the materialized result (template + overrides), computed
   by `app/src/lib/ab-tags.ts` (`computeTagSet`) and written on funnel
   create/update. Read-only output; never hand-edit.

Raw tag strings on `funnels` (`*Raw`) are import/export artifacts, not the
source of truth. **Always mutate tags through `createFunnel`/`updateFunnel`
(tsx) or the API, never with raw SQL.**

## Domain helpers (`app/src/lib/`)

- `funnels.ts` — funnel CRUD + business logic (list/get/create/draft/update/
  delete/duplicate, tag resync, `applyTagOverrides`, `resyncAllFunnels`).
- `refs.ts` — lookup-table CRUD + usage counting (`TABLE_MAP`, `VALID_KINDS`).
- `funnel-days.ts` — read/replace `funnel_days`.
- `funnel-blocks.ts` — read/replace blocks and items.
- `blocks.ts` — static block-kind registry.
- `block-fill.ts` — block-editing helpers (parse pasted lines, mirror slots, labels).
- `ab-tags.ts` — A/B tag computation engine (axes ↔ names, `computeTagSet`).
- `tag-templates.ts` / `tag-overrides.ts` — read/replace the two tag layers.
- `status.ts` — funnel status constants/meta (active/draft/archive).
- `rooms-grid.ts` — build/flatten the rooms grid (slot × day).
- `funnel-compact.ts` — grouping/visibility for the compact view.
- `export.ts` — build export rows + CSV serialization.
- `validation.ts` — Zod schemas + `parseRouteId`.
- `http.ts` / `errors.ts` — response/error helpers.
- `clipboard.ts` / `useUnsavedGuard.ts` — client hooks.
- `monitor-status.ts` — monitoring status values, badge metadata, `formatAgo`.
- `monitor-urls.ts` — URL normalization + multi-URL field splitting.
- `monitor-targets.ts` — sync targets from funnel data, enable/disable.
- `monitor-check.ts` — pure HTTP availability check (`checkUrl`).
- `monitor-run.ts` — check cycle, state persistence, event log.
- `monitor-view.ts` — dashboard read models.
- `monitor-scheduler.ts` — env config + `setInterval` (started by `src/instrumentation.ts`).

## API routes (`app/src/app/api/`)

- `GET/POST /api/funnels` — list / create.
- `POST /api/funnels/draft` — create empty draft.
- `GET/PATCH/DELETE /api/funnels/[id]` — detail / update (incl. status/archive
  and rooms toggles) / delete.
- `POST /api/funnels/[id]/duplicate` — duplicate.
- `GET/PUT /api/funnels/[id]/days` — read/replace days.
- `GET/PUT /api/funnels/[id]/blocks/[kind]` — read/replace one block kind.
- `PATCH /api/funnels/[id]/tags` — apply per-funnel tag overrides.
- `GET/POST /api/refs/[kind]` and `PATCH/DELETE /api/refs/[kind]/[id]` — refs CRUD.
- `GET /api/tag-templates` and `PUT /api/tag-templates/[scenario]` — global template.
- `GET /api/export` — CSV export of all funnels.
- `GET /api/monitoring` — summary + targets with state.
- `POST /api/monitoring/run` — start a check cycle. Returns **202** as soon as
  the cycle has started (it is not awaited — a wide scope can take tens of
  minutes and any proxy would cut the request); 409 if one is already running.
  Poll `GET /api/monitoring` and watch `summary.running` for completion.
- `PATCH /api/monitoring/targets` — bulk enable/disable by `sourceKind`.
- `PATCH /api/monitoring/targets/[id]` — enable/disable one target.
- `GET /api/monitoring/events` — incident history.

Rooms and status have **no dedicated endpoints** — they persist through the
funnel `PATCH` and the days `PUT`.

## Pages & components

Pages (`app/src/app/`): `page.tsx` (funnel list), `funnels/[id]/page.tsx`
(edit), `tags/page.tsx` (global template editor), `refs/page.tsx` (lookup
tables), `monitoring/page.tsx` (landing-availability dashboard).

Components (`app/src/components/`): `AppHeader`, `FunnelCard`,
`FunnelCompactView`, `FunnelIdentity`, `FunnelSections`, `BlockEditor`,
`BlockListField`, `RoomsEditor`, `TagTemplateEditor`, `RefSelect`/`RefTable`,
plus UI primitives (`StatusPill`, `CodeChip`, `Segmented`, `Switch`,
`GroupToggle`, `UrlInput`, `Toast`). `monitoring/` (`MonitorStatusPill`,
`MonitorSummary`, `MonitorTable`, `MonitorEvents`) backs the monitoring page.

## Database contract & WAL

`ksamata_funnels.db` stays at the repo root. Keeping it here is intentional:
tests copy `../../ksamata_funnels.db` into a temp fixture, Python tools mutate
the root file, and the Docker seed refresh is based on it. Point elsewhere with
`FUNNELS_DB_PATH`.

**WAL gotcha:** SQLite keeps recent writes in `*.db-wal` while the dev server
runs. Before copying the DB to `app/seed/` or making a backup:

1. Stop the running app.
2. Checkpoint: `sqlite3 ksamata_funnels.db 'PRAGMA wal_checkpoint(TRUNCATE);'`
3. Verify expected tables/counts against the main `.db`.

`*.db-wal` / `*.db-shm` sidecars and `*.db.bak_*` backups are gitignored.

## Migrations (`app/scripts/`)

Migrations are phased and idempotent (guarded by schema markers or `IF NOT
EXISTS`). Each phase has a `migrate-phaseN.ts` (schema, used by tests + local
CLI), a `-data.ts` (shared DDL/seed), and a `-runner.ts` (standalone
better-sqlite3 runner compiled to `.cjs` for Docker).

- **Phase 2** — `channels`/`directions` tables + funnel columns.
- **Phase 3** — new funnel columns + `funnel_blocks`/`funnel_block_items`;
  `migrate-funnel-data.ts` moves legacy day/dashboard content into blocks once
  (marker `phase3_funnel_data`).
- **Phase 4** — `funnels.rooms_enabled` + smart backfill.
- **Phase 5** — `tag_templates` + `funnel_tag_overrides` + template seed,
  followed by `backfill-legacy-tag-overrides.ts` (preserves legacy non-AV tags
  as `add` overrides so Phase 5's resync doesn't drop them).
- **Phase 6** — monitoring tables (`monitor_targets`, `monitor_target_funnels`,
  `monitor_state`, `monitor_events`).

**Docker runs, in order** (`app/docker-entrypoint.sh`): Phase 2 → 3 (+data) →
4 → 5 → legacy-tag-override backfill → 6.

One-off / local-only scripts (NOT in any automated path): `seed-phase1.ts`,
`apply_phase2b.ts`, `apply_phase2c_boo.ts` (both operate on a scratchpad copy,
never the real DB), `migrate-messenger-tagtype.ts`, `backfill-messenger-tags.ts`,
`backfill-status.ts`.

## Auth (`app/src/middleware.ts`)

HTTP Basic Auth in Next.js middleware (Edge). `resolveAuthDecision(env, header)`:

- `ADMIN_AUTH_DISABLED === 'true'` (exact) → **auth OFF everywhere**, including
  production, even if `ADMIN_BASIC_AUTH` is set. Kill-switch. ⚠️ makes the admin
  publicly reachable.
- Else `ADMIN_BASIC_AUTH` must be non-empty and contain `:`:
  - unset/invalid **and `NODE_ENV=production`** → **503 fail-closed** (a
    forgotten credential never yields a public admin).
  - unset/invalid in **dev** → open (pass through, warns once).
  - valid → constant-time compare of the `Authorization: Basic` header; mismatch → 401.

## Deployment

Dokploy builds the production image from `app/Dockerfile` (build context `app/`).
Full notes: [app/DEPLOY.md](app/DEPLOY.md).

- Mount a persistent volume at `/data`; set `FUNNELS_DB_PATH=/data/ksamata_funnels.db`.
- **First start:** entrypoint seeds `/data/ksamata_funnels.db` from the baked-in
  `/app/seed/` DB. Subsequent starts skip the copy and run the idempotent
  migration chain (Phase 2→6 + backfill).
- Container listens on port 3000.
- Background monitoring runs inside the container (`src/instrumentation.ts`),
  every `MONITOR_INTERVAL_MINUTES` (default 15). Set `MONITOR_ENABLED=false`
  to turn it off — only the exact string `false` disables it.
- `app/next.config.ts` carries an Edge-build workaround: because
  `middleware.ts` runs on the Edge runtime, Next also compiles
  `src/instrumentation.ts` with the Edge compiler, and webpack statically
  resolves its dynamic `import('./lib/monitor-scheduler')` into
  `src/db/client.ts` (`fs`/`path`/`better-sqlite3`), which fails the Edge
  build. The config aliases that one file's absolute path to `false` for the
  Edge bundle only. Read the comment there before touching it.

`docker-compose.yml` at the repo root is a **dev** stack (`app/Dockerfile.dev`,
hot-reload, auth off) that bind-mounts the real repo DB at `/data`. It does
**not** run the entrypoint seed/migration flow — that path is production-only.

Env vars: `FUNNELS_DB_PATH`, `ADMIN_BASIC_AUTH`, `ADMIN_AUTH_DISABLED`,
`MONITOR_ENABLED`, `MONITOR_INTERVAL_MINUTES`, `NODE_ENV`, `PORT`. See
[app/.env.example](app/.env.example).

## Data tools (`tools/`)

Python scripts resolve paths from the **repo root** (via their own file
location), so they run from any working directory.

- **Import** (`tools/data-import/`): `ksamata_funnels_db.py` (full build from
  Excel), `add_av_tags.py`, `add_durations.py`, `add_dih_funnel.py`,
  `add_pereliv_funnels.py`, `add_quiz_funnels.py`. All idempotent.
- **Export** (`tools/data-export/`): `ksamata_funnels_export.py` → summary XLSX
  in `data/generated/`.

## Conventions

- Treat `app/` as the production service boundary.
- Keep `ksamata_funnels.db` at the repo root unless a task explicitly migrates
  every path (tests, Python tools, seed, env defaults).
- Do not commit SQLite sidecars, local `*.db.bak_*` backups, `.env.local`,
  generated exports, or the local `ksamata-leak-funnels/` dataset.
- Prefer focused changes verified from `app/`: `npx tsc --noEmit`,
  `npx vitest run`, `npm run build`.
- Mutate funnel data (especially tags) through the app's tsx logic or API, never
  raw SQL against the live DB.
- For non-trivial or resumable work, use Basic Memory (see [AGENTS.md](AGENTS.md)).

## Docs & planning

- [README.md](README.md) — high-level orientation.
- [docs/README.md](docs/README.md) — index of plans and specs (shipped vs active).
- [docs/development.md](docs/development.md) — local setup and DB contract detail.
- [docs/project-map.md](docs/project-map.md) — file-level map.
- [docs/plans/2026-07-18-ux-improvements-backlog.md](docs/plans/2026-07-18-ux-improvements-backlog.md)
  — the current open backlog (the one live planning doc).
