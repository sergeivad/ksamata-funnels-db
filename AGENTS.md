# AGENTS.md

Instructions for AI agents (Codex, Claude Code) working in this repo.

## Read this first

**[CLAUDE.md](CLAUDE.md) is the canonical guide** — architecture, commands,
data model, migrations, auth, deployment, and conventions all live there. Read
it before non-trivial work. This file only adds the shared-memory workflow.

## Shared Memory

Use the `using-basic-memory` skill for non-trivial project work, resumed
context, durable decisions, reusable discoveries, and work that should be
visible to both Codex and Claude Code. Search Basic Memory before deep
exploration, verify memory against current evidence, and write back only
durable, non-secret context.

## Project rules (summary — full detail in CLAUDE.md)

- Treat `app/` as the production service boundary.
- Keep `ksamata_funnels.db` at the repo root unless a task explicitly covers the
  full path migration (tests, Python tools, seed, env defaults all assume it).
- Do not commit SQLite sidecars, local `*.db.bak_*` backups, `.env.local`,
  generated exports, or local raw/leak datasets.
- Verify from `app/`: `npx tsc --noEmit`, `npx vitest run`, `npm run build`.
- Mutate funnel data (especially tags) through the app's tsx logic or API, never
  raw SQL against the live DB.
- Python tools under `tools/` resolve paths from the repo root, not the CWD.
