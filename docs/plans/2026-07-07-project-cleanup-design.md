# Ksamata Funnels Project Cleanup Design

Date: 2026-07-07

## Goal

Make the repository easier to continue in Codex and Claude Code without changing the runtime contract of the current service.

## Chosen Approach

Use a moderate cleanup:

- Keep the live SQLite database at `ksamata_funnels.db` in the repository root because the Next.js tests, Python scripts, and deployment seed flow currently assume that location.
- Move one-off Python data tools out of the root into `tools/data-import/` and `tools/data-export/`.
- Move Excel inputs and generated workbook outputs into `data/source/` and `data/generated/`.
- Add human-readable project orientation docs at the root and under `docs/`.
- Expand `.gitignore` for local app state, OS files, SQLite sidecars, local env files, build artifacts, and generated exports.

## Target Layout

```text
app/                  Next.js 15 admin service, API routes, tests, Docker files
data/source/          Source workbooks used to create or enrich the database
data/generated/       Generated export workbooks
docs/                 Project notes, development guide, historical plans/specs
tools/data-import/    Python scripts that mutate or build ksamata_funnels.db
tools/data-export/    Python scripts that export data from ksamata_funnels.db
ksamata_funnels.db    Current live development database, intentionally kept at root
```

## Path Contract

Python tools should resolve the repository root from their new location and keep using the root database by default. Source workbook paths should point at `data/source/`. Export scripts should write generated workbooks to `data/generated/`.

The app continues to use `FUNNELS_DB_PATH` when set. In local tests and scripts, the root database remains the default.

## Out Of Scope

- Moving `ksamata_funnels.db`.
- Rewriting historical SDD plans.
- Refactoring app code or changing UI behavior.
- Merging/rebasing `main`, which is currently ahead and behind `origin/main`.
