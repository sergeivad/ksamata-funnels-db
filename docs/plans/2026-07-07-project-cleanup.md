# Project Cleanup Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Organize the repository for continued Ksamata funnels service development without changing the live database location.

**Architecture:** Keep the Next.js app isolated in `app/`, move data artifacts and Python tooling into purpose-named folders, and document the current contracts. Preserve `ksamata_funnels.db` at the repository root to avoid broad test and runtime churn.

**Tech Stack:** Next.js 15, React 19, TypeScript, Drizzle ORM, better-sqlite3, Vitest, Python 3, openpyxl, SQLite.

---

### Task 1: Documentation

**Files:**
- Create: `README.md`
- Create: `AGENTS.md`
- Create: `docs/development.md`
- Create: `docs/project-map.md`

**Steps:**
1. Write a concise root README with service purpose, layout, quick commands, and database notes.
2. Write AGENTS.md with shared instructions for Codex and Claude Code.
3. Write docs/development.md with local setup, verification commands, DB/seed gotchas, and deployment pointers.
4. Write docs/project-map.md with the current module map.

**Verification:**
- Read the files and confirm paths match the repository.

### Task 2: Repository Hygiene

**Files:**
- Modify: `.gitignore`
- Remove from working tree: `.DS_Store`

**Steps:**
1. Add ignores for OS files, editor folders, app build/cache state, env files, SQLite sidecars, backups, generated exports, and local raw/leak folders.
2. Remove `.DS_Store` from the working tree.

**Verification:**
- Run `git status --short` and confirm ignored local noise no longer appears.

### Task 3: Data And Tool Layout

**Files:**
- Move: `ksamata_funnels_db.py` -> `tools/data-import/ksamata_funnels_db.py`
- Move: `add_av_tags.py` -> `tools/data-import/add_av_tags.py`
- Move: `add_pereliv_funnels.py` -> `tools/data-import/add_pereliv_funnels.py`
- Move: `add_quiz_funnels.py` -> `tools/data-import/add_quiz_funnels.py`
- Move: `add_durations.py` -> `tools/data-import/add_durations.py`
- Move: `add_dih_funnel.py` -> `tools/data-import/add_dih_funnel.py` if present
- Move: `ksamata_funnels_export.py` -> `tools/data-export/ksamata_funnels_export.py`
- Move source workbooks into `data/source/`
- Move generated summary workbook into `data/generated/`

**Steps:**
1. Create the target directories.
2. Move tracked files with `git mv` and untracked files with `mv`.
3. Update Python path resolution to use repo root, root `ksamata_funnels.db`, `data/source/`, and `data/generated/`.

**Verification:**
- Run `python3 -m py_compile` over moved Python tools.
- Use `rg` to confirm stale root workbook paths are gone from active Python tools.

### Task 4: Basic Memory

**Files:**
- Basic Memory note: `main/projects/ksamata-funnels-db`

**Steps:**
1. Write a durable Basic Memory note covering purpose, layout, runtime contracts, verification commands, and DB/WAL gotchas.
2. Keep the note free of secrets and transient logs.

**Verification:**
- Read the note back through Basic Memory.

### Task 5: Final Verification

**Commands:**
- `cd app && npx tsc --noEmit`
- `cd app && npx vitest run`
- `cd app && npm run build`
- `git status --short`

**Expected:**
- TypeScript, tests, and build pass.
- Remaining dirty files are intentional cleanup changes plus pre-existing user changes.
