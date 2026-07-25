# AGENTS.md

Instructions for AI agents (Codex, Claude Code) working in this repo.

## Read this first

**[CLAUDE.md](CLAUDE.md) is the canonical guide** — architecture, commands,
data model, migrations, auth, deployment, and conventions all live there. Read
it before non-trivial work. This file adds the shared-memory workflow and the
handful of rules agents most often trip over.

## Shared Memory

Durable project context lives in **Basic Memory** (MCP server `basic-memory`,
project `main`), so it is visible to both Codex and Claude Code:

- **Dossier:** `projects/ksamata-funnels-db` — status, architecture, current
  state, unresolved problems, decision log, next steps.
- **Observations:** `projects/funnels_admin.observations` — typed entries
  (`decision` / `bugfix` / `feature` / `discovery` / `problem`).

Search Basic Memory before deep exploration. Verify what you read against the
current code — memory records what was true when written. Write back only
durable, non-secret context; never store tokens, passwords, or API keys.

## Rules that bite agents specifically

These are not style preferences — each one caused a real defect in this repo.

- **Restore the database after any live run.** Starting the dev server runs the
  monitoring scheduler, which writes ~600 rows into the tracked
  `ksamata_funnels.db` — rows that have no business in a commit, and that the
  Docker seed refresh would carry into production. Checkpoint WAL,
  `git checkout --` the file, drop the sidecars, and confirm `monitor_targets` is
  back to 0. Better: set `MONITOR_ENABLED=false` in `app/.env.local`, or point
  `FUNNELS_DB_PATH` at a scratch copy, so the run never touches the tracked file.
  (Monitoring tests no longer break on a polluted fixture — they wipe the
  `monitor_*` tables of their own temp copy via `tests/helpers/monitoring.ts`.
  That applies to monitoring's own tables only: funnel data in the copy is
  fixture input and must be left alone.)
- **Process-wide state goes on `globalThis`.** A module-level `let` is not a
  singleton in the production bundle: webpack emits separate module copies for
  the instrumentation graph and the API-route graph. Unit tests cannot catch
  this (vitest shares one module instance), so verify against
  `.next/standalone`. See the section in CLAUDE.md.
- **Mutate funnel data through the app's logic**, never raw SQL — tags are
  materialized from several layers and hand-edits desync them.
- **Tests use a temp copy** of the DB, never the live file.
- **No new npm dependencies** without asking. The repo has no jsdom or React
  testing library on purpose; UI work is verified by typecheck, build, and a
  real browser check.

## Project rules (summary — full detail in CLAUDE.md)

- Treat `app/` as the production service boundary.
- Keep `ksamata_funnels.db` at the repo root unless a task explicitly covers the
  full path migration (tests, Python tools, seed, env defaults all assume it).
- Do not commit SQLite sidecars, local `*.db.bak_*` backups, `.env.local`,
  generated exports, or local raw/leak datasets.
- Verify from `app/`: `npx tsc --noEmit`, `npx vitest run`, `npm run build`.
- Python tools under `tools/` resolve paths from the repo root, not the CWD.
- Code comments are Russian (matching the existing files); commit messages and
  these docs are English.
