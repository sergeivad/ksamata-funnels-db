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
- `src/app/login/page.tsx` - форма входа редактора.
- `src/app/{refs,tags,monitoring}/layout.tsx` - серверный `EditorGate`:
  анонима уводит на `/login` (эти страницы читают БД, минуя API).
- `src/app/robots.ts` - `Disallow: /` для публично читаемого сервиса.
- `src/app/api/` - Next.js route handlers (funnels, days, blocks, tags,
  tag-templates, refs, export, monitoring, auth).
- `src/db/schema.ts` - Drizzle table definitions.
- `src/db/client.ts` - DB path resolution (`FUNNELS_DB_PATH` / repo-root default).
- `src/lib/` - domain helpers: funnels, refs, days, blocks (+ block-fill,
  url-field), the three-layer tags system (`ab-tags`, `tag-templates`,
  `tag-overrides`) plus the identity-layer fifth axis (`funnel-type.ts` -
  `funnel_types` seed values and label, no `db`/network access of its own),
  status, rooms-grid, funnel-compact, export, validation, авторизация
  (`auth` - чистое Edge-безопасное ядро, `auth-server` - Node-обвязка), plus
  http/errors and client hooks; monitoring (`monitor-status`, `monitor-urls`,
  `monitor-kinds`, `monitor-targets`, `monitor-check`, `monitor-run`,
  `monitor-view`, `monitor-scheduler`). See CLAUDE.md for the full module list.
- `src/instrumentation.ts` - Next server-start hook; starts the monitoring
  scheduler on the Node runtime.
- `src/components/` - client UI components and primitives, including
  `AuthProvider` (`useCanEdit` - режим просмотра), `EditorGate`, `LoginForm`
  и `monitoring/` (`MonitorStatusPill`, `MonitorSummary`, `MonitorTable`,
  `MonitorEvents`).
- `src/middleware.ts` - первый рубеж доступа: публичное чтение воронок,
  правка и приватные разделы только по сессии (`ADMIN_USERS` /
  `ADMIN_SESSION_SECRET`; `PUBLIC_READ_ENABLED`, `ADMIN_BASIC_AUTH`,
  `ADMIN_AUTH_DISABLED`). Решение — `resolveAccess` из `src/lib/auth.ts`,
  тот же, что у `requireEditor` в роутах.
- `next.config.ts` - webpack config; aliases `src/db/client.ts` away for the
  Edge bundle so `instrumentation.ts` compiles under the Edge runtime forced
  by `middleware.ts` (see CLAUDE.md Deployment section).
- `scripts/` - phased migrations (Phase 2–8), data backfills, and seed/runners
  used by tests and Docker. Also dated one-off sync scripts (e.g.
  `sync-leak-2026-08-02.ts`) — idempotent, guarded by an axis check, run by
  hand with `--dry-run` first; not part of any automated path.
- `tests/` - Vitest suite (routes, lib, migrations, middleware);
  `tests/helpers/` holds fixtures shared between suites (e.g. `monitoring.ts`,
  which wipes the copied DB's `monitor_*` tables before each test).
- `seed/` - seed database baked into the production Docker image.
- `Dockerfile` / `Dockerfile.dev` / `docker-entrypoint.sh` - prod image, dev
  image, and prod seed+migration entrypoint.

## Data

- `data/source/` - source workbooks.
- `data/generated/` - generated summary workbooks (gitignored).

## Tools

- `tools/data-import/` - Python scripts that build or mutate the SQLite database.
- `tools/data-export/` - Python scripts that export the database to XLSX reports.
- `tools/audit/` - tag drift map across the GetCourse offer registry,
  `deal_export` history and the DB. Read-only; output is an XLSX in
  `data/generated/`.

## Docs & planning

- `docs/README.md` - index of plans and specs (shipped vs active).
- `docs/development.md` - local setup and database contract.
- `docs/leak-engine.md` - LeakEngine: эталон F-кодов, чтение реестра и путь
  на запись (заведение воронки + набора правил).
- `docs/superpowers/specs/` & `docs/superpowers/plans/` - shipped design specs
  and implementation plans (historical record).
- `docs/reviews/` - service-wide reviews (закрытый разбор от 2026-07-26).
- `docs/plans/` - Codex planning notes. Живых четыре:
  `2026-07-18-ux-improvements-backlog.md` (бэклог),
  `2026-07-25-tag-drift-triage.md` (теги),
  `2026-08-02-leak-sync.md` и `2026-08-02-leak-todo.md` (сверка с ЛИК).
