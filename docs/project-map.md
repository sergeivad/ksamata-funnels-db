# Project Map

File-level map of the repo. For architecture and conventions see
[CLAUDE.md](../CLAUDE.md).

## Root

- `CLAUDE.md` - canonical guide for agents and humans (source of truth).
- `AGENTS.md` - agent shared-memory workflow; points to `CLAUDE.md`.
- `README.md` - high-level orientation.
- `ksamata_funnels.db` - live local SQLite database.
- `docker-compose.yml` - dev hot-reload stack (uses `app/Dockerfile.dev`).

## App (`app/`)

- `src/app/page.tsx` - funnel list (home).
- `src/app/funnels/[id]/page.tsx` - funnel edit page.
- `src/app/tags/page.tsx` - global tag-template editor.
- `src/app/refs/page.tsx` - lookup/reference tables management.
- `src/app/monitoring/page.tsx` - landing-availability monitoring dashboard.
- `src/app/api/` - Next.js route handlers (funnels, days, blocks, tags,
  tag-templates, refs, export, monitoring).
- `src/db/schema.ts` - Drizzle table definitions.
- `src/db/client.ts` - DB path resolution (`FUNNELS_DB_PATH` / repo-root default).
- `src/lib/` - domain helpers: funnels, refs, days, blocks (+ block-fill),
  the three-layer tags system (`ab-tags`, `tag-templates`, `tag-overrides`),
  status, rooms-grid, funnel-compact, export, validation, plus http/errors and
  client hooks; monitoring (`monitor-status`, `monitor-urls`,
  `monitor-targets`, `monitor-check`, `monitor-run`, `monitor-view`,
  `monitor-scheduler`). See CLAUDE.md for the full module list.
- `src/instrumentation.ts` - Next server-start hook; starts the monitoring
  scheduler on the Node runtime.
- `src/components/` - client UI components and primitives, including
  `monitoring/` (`MonitorStatusPill`, `MonitorSummary`, `MonitorTable`,
  `MonitorEvents`).
- `src/middleware.ts` - HTTP Basic Auth (`ADMIN_BASIC_AUTH` / `ADMIN_AUTH_DISABLED`).
- `next.config.ts` - webpack config; aliases `src/db/client.ts` away for the
  Edge bundle so `instrumentation.ts` compiles under the Edge runtime forced
  by `middleware.ts` (see CLAUDE.md Deployment section).
- `scripts/` - phased migrations (Phase 2–6), data backfills, and seed/runners
  used by tests and Docker.
- `tests/` - Vitest suite (routes, lib, migrations, middleware).
- `seed/` - seed database baked into the production Docker image.
- `Dockerfile` / `Dockerfile.dev` / `docker-entrypoint.sh` - prod image, dev
  image, and prod seed+migration entrypoint.

## Data

- `data/source/` - source workbooks.
- `data/generated/` - generated summary workbooks (gitignored).

## Tools

- `tools/data-import/` - Python scripts that build or mutate the SQLite database.
- `tools/data-export/` - Python scripts that export the database to XLSX reports.

## Docs & planning

- `docs/README.md` - index of plans and specs (shipped vs active).
- `docs/development.md` - local setup and database contract.
- `docs/superpowers/specs/` & `docs/superpowers/plans/` - shipped design specs
  and implementation plans (historical record).
- `docs/plans/` - Codex planning notes; `2026-07-18-ux-improvements-backlog.md`
  is the one live backlog.
