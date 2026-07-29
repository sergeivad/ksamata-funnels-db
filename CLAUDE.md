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
| `tools/audit/` | Tag drift map: reconciles the GetCourse offer registry, `deal_export` history, and the DB. Read-only; output is an XLSX in `data/generated/`. See [tools/audit/README.md](tools/audit/README.md). |
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

- **Lookups:** `sources`, `products`, `contractors`, `funnel_types` (funnel-type
  marker, `{id, name}` — `name` holds the GetCourse marker text verbatim, e.g.
  `АВ Автоворонка`/`АВ Прямые`/`АВ Квиз`/`АВ Квиз-Лайт`), `tags` (global tag names).
- **`funnels`** — one row per funnel: identity FKs (source/product/contractor),
  nullable `funnelTypeId` FK into `funnel_types` (`NULL` = type not chosen, no
  marker emitted at all — same rule as an empty axis), `variant`, `productName`,
  landing/dashboard URLs, raw tag strings (`tag19Raw`/`tag15Raw`/`regTagsRaw`),
  `roomIdsJson`, `bothelpCondition`, `status` (`active`/`draft`/`archive`),
  `frontCode`, `comment`, `timeLabelA`/`timeLabelB`, and room toggles
  `roomsEnabled` / `roomsReplayEnabled`.
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
  `enabled`, plus `manual_override` — set to `1` only when `setTargetEnabled`
  requests an `enabled` value that differs from **the group's default**;
  requesting the default clears it back to `0`. So `manual_override = 1` reads
  as "this one target differs from its group". `manual_override = 1` makes the
  sync leave `enabled` alone; while it is `0` the sync recomputes `enabled`
  from the group default, so a landing that briefly vanished from the funnel
  data comes back on by itself),
  `monitor_source_kind_prefs` (the human's decision for a whole `source_kind`,
  written by `setSourceKindEnabled` — this is what makes a URL added to a
  block **later** inherit the group and start being checked without anyone
  clicking; no row = fall back to "landings on, everything else off". A group
  click also clears `manual_override` across the group: the group decision
  beats per-target toggles inside it),
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

Поверх трёх слоёв лежит **слой идентичности**: четыре осевых тега
(`АВ Продукт:` и три остальных) и **маркер типа воронки** — пятая ось,
выводимая из `funnels.funnel_type_id` (справочник `funnel_types`,
`app/src/lib/funnel-type.ts`). Теги идентичности нельзя ни удалить
оверрайдом, ни положить в шаблон: `computeTagSet` гасит их в обоих слоях.
Значения типа расширяемы через `/refs` — набор маркеров задаёт GetCourse.

## Domain helpers (`app/src/lib/`)

- `funnels.ts` — funnel CRUD + business logic (list/get/create/draft/update/
  delete/duplicate, tag resync, `applyTagOverrides`, `resyncAllFunnels`).
  A `num` collision always surfaces as `ConflictError` → 409, whether the
  pre-check catches it or another writer of the same DB file (a Python tool, a
  second instance) takes the number between that check and the INSERT — the
  transaction is wrapped in `asNumConflict`. Where `num` is allocated rather
  than given (`createDraftFunnel`, `duplicateFunnel`), the wrapper is
  `withNumRetry` instead: recomputing MAX+1 is the right answer there, while a
  user-specified `num` must fail rather than silently become a different one.
  `resyncAllFunnels` **skips funnels whose four axes are all empty** — that is a
  blank draft, and `createDraftFunnel` leaves it without AV tags on purpose.
  Materializing the template into it would make a draft's contents depend on
  whether someone edited the global template between its creation and its
  first save.
- `refs.ts` — lookup-table CRUD + usage counting (`TABLE_MAP`, `VALID_KINDS`),
  plus `IMMUTABLE_KINDS` / `isImmutableKind`: `tags` is read-only through the
  refs API for **every** method. `POST` used to be open while `PATCH`/`DELETE`
  were blocked, so a tag created by hand could never be removed through the API.
  Tags are owned by the template/override engine.
- `funnel-days.ts` — read/replace `funnel_days`.
- `funnel-blocks.ts` — read/replace blocks and items.
- `blocks.ts` — static block-kind registry.
- `block-fill.ts` — block-editing helpers (parse pasted lines, mirror slots, labels).
- `url-field.ts` — hygiene of a block item's URL field, shared by `BlockEditor`/
  `BlockListField` and the blocks `PUT` route. Two classes: **A** — a label glued
  into an http(s) URL (`…/a (ADS)`, a trailing quote) is rejected, because
  `normalizeUrl` percent-encodes it instead of dropping it and monitoring then
  tracks a permanently-404 ghost target; **B** — plain text in the URL field
  (`сайты`, `геткурс`) only warns: such notes predate the field and create no
  targets. Never make class B blocking without cleaning the data first.
- `ab-tags.ts` — A/B tag computation engine (axes ↔ names, `computeTagSet`).
- `tag-templates.ts` / `tag-overrides.ts` — read/replace the two tag layers.
- `status.ts` — funnel status constants/meta (active/draft/archive).
- `rooms-grid.ts` — build/flatten the rooms grid (slot × day).
- `funnel-compact.ts` — grouping/visibility for the compact view.
- `export.ts` — build export rows + CSV serialization. Fields starting with
  `=`, `+`, `-`, `@`, TAB or CR get a leading apostrophe: the route serves a BOM
  and `;` so Excel opens the file, and Excel executes such a cell on open.
  RFC 4180 quoting does not prevent that — it strips the quotes and evaluates.
- `validation.ts` — Zod schemas + `parseRouteId`. `landingUrl` accepts `''` or
  an **http(s)** URL up to `URL_MAX` (4096) — `new URL()` alone happily accepts
  `javascript:` and `data:`. The cap is 4096 rather than the customary 2000
  because the live DB holds a genuine 2019-character GetCourse segment link.
- `http.ts` / `errors.ts` — response/error helpers.
- `clipboard.ts` / `useUnsavedGuard.ts` — client hooks.
- `monitor-status.ts` — monitoring status values, badge metadata, `formatAgo`.
- `monitor-urls.ts` — URL normalization + multi-URL field splitting. A checkable
  target is http(s), has a dotted hostname (no IP literals) and a standard port —
  otherwise the dashboard becomes an SSRF oracle and a port scanner for the
  container's own network. `resolveRedirectTarget` applies the very same rule to
  each redirect hop; keep the two in one place, a hop that skips the check
  reopens the whole hole.
- `monitor-targets.ts` — sync targets from funnel data, enable/disable, group defaults.
  Only funnels with `status = 'active'` are collected (`MONITORED_FUNNEL_STATUS`);
  drafts and archive are out of scope, and a URL left behind by a funnel leaving
  `active` goes through the normal retirement path (muted, unlinked, history kept,
  auto-revived when the funnel comes back) — **unless** `manual_override = 1`,
  in which case retirement unlinks it but leaves `enabled` alone, same as the
  live branch. Muting an overridden target would strand it: the override stays
  set, so the live branch would then refuse to recompute `enabled` and the
  returning URL would never come back on. Exports `collectFunnelUrls` so the
  dashboard can collect URLs of **non**-active funnels through the very same
  normalization. The retirement branch touches only targets that are still
  `enabled = 1`, so `retired` counts what this run actually muted and the
  `updatedAt` of a long-retired target is not rewritten by every sync —
  otherwise the stamp could never tell you when a target actually dropped out.
- `monitor-kinds.ts` — Russian labels for source kinds (reuses `BLOCK_KINDS`
  titles) + `sourceKindTone`, which decides how a group chip reads: any group
  with at least one checked target is orange (`on`/`partial`), only a fully
  disabled one is grey. `partial` differs from `on` in wording and
  `aria-pressed="mixed"`, not in colour — a partially enabled group must not
  look switched off.
- `monitor-check.ts` — pure HTTP availability check (`checkUrl`). Follows
  redirects itself (`redirect: 'manual'`, ≤ `MAX_REDIRECTS`), validating every
  hop through `resolveRedirectTarget`; a refused hop reports a generic error and
  never echoes the destination back to the dashboard. One `AbortSignal.timeout`
  covers the whole chain, so N hops cannot stretch into N timeouts.
  **Before every connection — including each redirect hop — the hostname is
  resolved and every returned address checked** (`lookupImpl`, default
  `resolveHostAddresses`). A hostname is a promise, not an address:
  `10.0.0.5.nip.io` passes `normalizeUrl` (dotted name, no literal) and lands in
  the private network, so the literal filter alone is not a defence. A refused
  host reports the same generic "внутренняя сеть" error — never the IP.
  `dns.lookup` ignores `AbortSignal`, so the lookup gets its own budget equal to
  `timeoutMs`; without it a hung resolver would hold a cycle worker for as long
  as the system `getaddrinfo` felt like. Residual risk, accepted knowingly: the
  connection re-resolves, so an attacker controlling DNS with a very short TTL
  could still rebind between check and connect. Closing that needs pinning the
  connection to the vetted IP (a custom `undici` dispatcher, a new dependency).
- `monitor-dns.ts` — pure address classifier (`isPrivateAddress`) + the
  `LookupFn` type. Fails closed: an address it cannot parse counts as private.
  Understands IPv4 embedded in IPv6 (`::ffff:127.0.0.1`, NAT64, 6to4), because
  the wrapper form is exactly how a loopback address sneaks past a naive check.
  No network here — that is why it is testable and stays in the edge bundle.
- `monitor-resolver.ts` — the real `node:dns` lookup, alone in its own file.
  It is the second Node-only leaf after `db/client.ts`, and `next.config.ts`
  aliases it away for the edge build (see below). Keep it that way: put
  anything checkable-without-network in `monitor-dns.ts` instead.
- `monitor-run.ts` — check cycle, state persistence, event log. The cycle ends
  with `pruneEvents`: `monitor_events` older than `EVENT_RETENTION_DAYS` (90)
  are dropped. Events are written only on a **change** of status, but a flapping
  target still produces ~190 rows a day and there are ~600 targets, so without a
  bound the table never stops growing. Pruning rides the cycle because the cycle
  is the table's only writer — no separate cleanup schedule to forget about.
- `monitor-view.ts` — dashboard read models. Group counters (`sourceKinds`) count
  **only pages of active funnels**: archiving a funnel is itself the decision that
  its pages leave monitoring, so they drop out of the denominator, as do orphaned
  URLs — otherwise "41 из 45" implies four broken pages that no longer exist. A
  target that a human enabled by hand still counts, so `enabled` can never exceed
  `total`. Each target also carries `usage` — `active` / `inactive` (held only by
  a draft/archive funnel) / `orphan` (held by nobody) — used **only** to explain
  in the table why a row is off. `inactive` vs `orphan` is resolved by
  re-collecting funnel URLs for non-active statuses via `collectFunnelUrls`
  (same normalization as the sync), not from a stored column.
- `monitor-scheduler.ts` — env config + `setInterval` (started by `src/instrumentation.ts`).

## API routes (`app/src/app/api/`)

- `GET/POST /api/funnels` — list / create.
- `POST /api/funnels/draft` — create empty draft.
- `GET/PATCH/DELETE /api/funnels/[id]` — detail / update (incl. status/archive
  and rooms toggles) / delete.
- `POST /api/funnels/[id]/duplicate` — duplicate.
- `GET/PUT /api/funnels/[id]/days` — read/replace days. A true replace within the
  funnel: a day absent from the payload is deleted, so callers send the whole grid.
- `GET/PUT /api/funnels/[id]/blocks/[kind]` — read/replace one block kind.
- `PATCH /api/funnels/[id]/tags` — apply per-funnel tag overrides. Genuinely
  partial: a scenario the body omits keeps its stored overrides; clear one by
  naming it with empty `add`/`remove`.
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

**Monitoring gotcha:** the tracked DB's `monitor_*` tables are intentionally
**empty**. Running the dev server starts the background scheduler, which syncs
~600 targets and writes check results straight into that same tracked file. So
after any live run — `npm run dev`, a manual cycle, a browser check — restore it
before committing anything:

```sh
sqlite3 ksamata_funnels.db 'PRAGMA wal_checkpoint(TRUNCATE);'
git checkout -- ksamata_funnels.db
rm -f ksamata_funnels.db-wal ksamata_funnels.db-shm
```

Verify with `sqlite3 ksamata_funnels.db "select count(*) from monitor_targets;"`
→ must print `0`, and `git status --porcelain` must be clean. Set
`MONITOR_ENABLED=false` in `.env.local` to keep the dev server from doing this
(and from hitting live landing pages) in the first place.

The monitoring tests no longer depend on that hygiene: every one of them wipes
the `monitor_*` tables of its own temp copy right after `runMigratePhase6`, via
`clearMonitoringState` in [app/tests/helpers/monitoring.ts](app/tests/helpers/monitoring.ts).
Those tables are the tests' own state, not source data, so clearing them is
correct — keep new monitoring tests on the same helper, and do not extend it to
funnel data (that stays as it is in the copied DB).

## Process state must be a real singleton

Module-level state is **not** a singleton in the production bundle. Because
`middleware.ts` runs on Edge, Next compiles `src/instrumentation.ts` with the
Edge compiler too, and webpack ends up emitting **separate module copies** for
the instrumentation graph and the API-route graph. Two copies means two
`let` variables and two `better-sqlite3` connections.

This is why `app/src/db/client.ts` (the DB handle) and `app/src/lib/monitor-run.ts`
(the in-flight cycle flag) park their state on typed `globalThis` slots. Before
the fix, the guard that stops the scheduler and the manual "check now" button
from running concurrent cycles silently did nothing in production.

**Unit tests cannot catch this** — vitest gives every importer the same module
instance, so a module-level flag looks perfectly correct under test. If you add
process-wide state (a cache, a lock, a connection, a queue), put it on
`globalThis` and verify against `.next/standalone`, not against the test suite.

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
  `monitor_state`, `monitor_events`, `monitor_source_kind_prefs`).
- **Phase 7** — `funnel_types` (seeded with the four GetCourse markers) +
  `funnels.funnel_type_id`, plus a backfill of `АВ Автоворонка` onto every
  existing funnel. The backfill is not a decision about type — it preserves
  what the database already asserted (the marker was already hardcoded into
  every `tag_templates` scenario), so `funnel_tags` does not change by a
  single row; only where the marker comes from changes.

**Docker runs, in order** (`app/docker-entrypoint.sh`): Phase 2 → 3 (+data) →
4 → 5 → legacy-tag-override backfill → 6 → 7.

**Running a migration by hand** resolves its DB through `scripts/cli-db-path.ts`:
the default is the repo-root DB **relative to the script**, not to `cwd`, and a
path that does not exist is a hard error. Before this, running from the repo
root instead of `app/` pointed at nothing, better-sqlite3 created an empty file
next to the repo, and phases 5/6 reported success without touching the real
database — their DDL is all `CREATE TABLE IF NOT EXISTS`, and SQLite only checks
foreign keys on DML. Docker and tests are unaffected: they always pass the path
explicitly.

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
  build. The config aliases that file's absolute path to `false` for the
  Edge bundle only — plus `src/lib/monitor-resolver.ts`, reached by the same
  chain and Node-only for the same reason (`node:dns`). Read the comment there
  before touching it. **Adding a Node-only import anywhere under
  `monitor-*.ts` will break `npm run build` even though tests and `tsc` stay
  green** — isolate it in its own leaf file and alias that, rather than
  widening the alias to a whole subtree.

`docker-compose.yml` at the repo root is a **dev** stack (`app/Dockerfile.dev`,
hot-reload, auth off) that bind-mounts the real repo DB at `/data`. It does
**not** run the entrypoint seed/migration flow — that path is production-only.

Env vars: `FUNNELS_DB_PATH`, `ADMIN_BASIC_AUTH`, `ADMIN_AUTH_DISABLED`,
`MONITOR_ENABLED`, `MONITOR_INTERVAL_MINUTES`, `NODE_ENV`, `PORT`. See
[app/.env.example](app/.env.example).

## Data tools (`tools/`)

Python scripts resolve paths from the **repo root** (via their own file
location), so they run from any working directory.

- **Import** (`tools/data-import/`): `add_av_tags.py`, `add_durations.py`,
  `add_dih_funnel.py`, `add_pereliv_funnels.py`, `add_quiz_funnels.py` — all
  idempotent. **They no longer write `funnel_tags`**: `guard_tag_write`
  (`tag_write_guard.py`) stops them with an explanation, because that table is
  the materialized result of template + overrides and the first resync in the
  admin wipes anything written by hand — silently. Escape hatch `--force-tags`
  for a deliberate one-off, mirroring the `--force` idiom below.
  `ksamata_funnels_db.py` is **not** idempotent: it rebuilds the whole DB from
  Excel and therefore deletes the existing file, wiping everything edited through
  the admin UI. It refuses to run when the DB exists unless given `--force`.
  Tests: `python3 -m pytest tools/data-import/tests`.
- **Export** (`tools/data-export/`): `ksamata_funnels_export.py` → summary XLSX
  in `data/generated/`. Opens the DB **read-only** (`mode=ro`), like
  `tools/audit`: a plain `connect` would create an empty database where the real
  one is missing and then fail on the first SELECT.
  Tests: `python3 -m pytest tools/data-export/tests`.
- **Audit** (`tools/audit/`): `run_audit.py` builds a tag drift map across
  three sources — the GetCourse offer registry, `deal_export` history, and
  the DB — into an XLSX report with 16 finding classes; it fixes nothing, in
  the DB or in GetCourse. The DB is opened read-only; GetCourse credentials
  are read from the environment (`GC_DEV_KEY`, `GC_API_KEY`, `GC_DOMAIN`) and
  never committed. `--no-api` skips GetCourse (classes 9-12 and 14 stay
  empty). Tests: `python3 -m pytest tools/audit/tests`.

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
- Never leave `ksamata_funnels.db` modified after a live run — restore it (see
  the monitoring gotcha above). Its `monitor_*` tables must stay empty.
- Put process-wide state on `globalThis`, not in a module-level `let` — the
  production bundle duplicates modules (see above).
- Tests run against a temp **copy** of the DB, never the live file. Make that
  copy with `copyDbForTest` ([app/tests/helpers/db.ts](app/tests/helpers/db.ts)),
  not `copyFileSync`: the plain copy takes only the main file and leaves behind
  everything sitting in `*.db-wal` — which, with a dev server running, is every
  recent write. `VACUUM INTO` gives a consistent snapshot regardless of WAL
  state and is synchronous, which module-level fixtures need.
- For non-trivial or resumable work, use Basic Memory (see [AGENTS.md](AGENTS.md)).

## Docs & planning

- [README.md](README.md) — high-level orientation.
- [docs/README.md](docs/README.md) — index of plans and specs (shipped vs active).
- [docs/development.md](docs/development.md) — local setup and DB contract detail.
- [docs/project-map.md](docs/project-map.md) — file-level map.
- [docs/plans/2026-07-18-ux-improvements-backlog.md](docs/plans/2026-07-18-ux-improvements-backlog.md)
  — the current open backlog (the one live planning doc).
