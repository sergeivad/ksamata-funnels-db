# Project Map

## Root

- `README.md` - high-level orientation.
- `AGENTS.md` - shared instructions for Codex and Claude Code.
- `ksamata_funnels.db` - local live SQLite database.

## App

- `app/src/app/page.tsx` - funnel list UI.
- `app/src/app/funnels/[id]/page.tsx` - funnel edit page composition.
- `app/src/app/api/` - Next.js route handlers.
- `app/src/components/` - client UI components.
- `app/src/db/schema.ts` - Drizzle table definitions.
- `app/src/lib/` - domain helpers for funnels, refs, days, blocks, tags, and validation.
- `app/scripts/` - TypeScript migrations and seed/migration runners used by tests and Docker.
- `app/tests/` - Vitest suite.
- `app/seed/` - Docker seed database.

## Data

- `data/source/` - source workbooks.
- `data/generated/` - generated summary workbooks.

## Tools

- `tools/data-import/` - Python scripts that build or mutate the SQLite database.
- `tools/data-export/` - Python scripts that export the SQLite database to workbook reports.

## Historical Planning

- `docs/superpowers/specs/` - design specs from previous Claude Code work.
- `docs/superpowers/plans/` - implementation plans from previous Claude Code work.
- `docs/plans/` - current Codex/Codex-Desktop planning notes.
