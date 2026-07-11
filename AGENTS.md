# AGENTS.md

## Shared Memory

Use the `using-basic-memory` skill for non-trivial project work, resumed context, durable decisions, reusable discoveries, and work that should be visible to both Codex and Claude Code. Search Basic Memory before deep exploration, verify memory against current evidence, and write back only durable, non-secret context.

## Project Rules

- Treat `app/` as the production service boundary.
- Keep `ksamata_funnels.db` in the repository root unless a task explicitly covers the full path migration.
- Do not commit SQLite sidecars, local backups, `.env.local`, generated exports, or local raw/leak datasets.
- Prefer focused changes with verification from `app/`: `npx tsc --noEmit`, `npx vitest run`, and `npm run build`.
- Python scripts under `tools/` are data maintenance utilities. They should resolve paths from the repository root, not from the current shell directory.

## Current Service

The admin app manages autofunnel identity, room links, replay settings, and structured block lists for landings, records, tariffs, applications, processes, OTO, bonuses, meditations, and extra links.
