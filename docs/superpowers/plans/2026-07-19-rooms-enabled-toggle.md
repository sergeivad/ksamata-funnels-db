# Rooms Enabled Toggle — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an on/off toggle to the «Вебинарные комнаты» block so funnels without webinar rooms can collapse it, mirroring the existing per-block enable toggle.

**Architecture:** New funnel column `rooms_enabled` (mirror of `rooms_replay_enabled`), applied by a new idempotent Phase-4 migration with a marker-gated smart backfill (enable where `funnel_days` rows exist, disable otherwise). Server model (`funnels.ts`), validation, and the `RoomsEditor`/`FunnelSections`/`FunnelCompactView` UI carry the flag through; the toggle autosaves via the existing `PATCH /api/funnels/[id]` — no new endpoint.

**Tech Stack:** Next.js (App Router), TypeScript, Drizzle ORM, better-sqlite3, Zod, Vitest, esbuild (Docker migration bundling), Tailwind, lucide-react.

## Global Constraints

- All work is under `app/` (run commands from `app/`). Test runner: `npx vitest run <file>`.
- Column mirrors `rooms_replay_enabled` exactly: Drizzle `integer('rooms_enabled')`, SQL `INTEGER DEFAULT 1`.
- `DEFAULT 1` — new funnels start enabled (preserves today's always-shown behavior).
- Backfill is **one-time**, marker-gated in `schema_migrations` (name = `phase4_rooms_enabled`), and **must not** modify `funnel_days`.
- Migrations are idempotent: re-running must not throw or double-apply. Follow the Phase-3 pattern (`addColumnIfMissing`, marker row).
- The toggle **autosaves the flag immediately** (like `BlockEditor`), non-destructively (day rows are never deleted on disable).
- Russian UI copy verbatim: block title «Вебинарные комнаты».

### Critical ordering note (read before starting)

Adding `roomsEnabled` to the Drizzle schema (Task 4) makes **every** funnels query `SELECT rooms_enabled`. The test suite copies the tracked seed DB `ksamata_funnels.db` (16 test files do this), and that DB won't have the column until migrated. Therefore **Task 3 (apply Phase-4 to the seed DBs) MUST run before Task 4**, exactly as Phase-3 columns were baked into the seed DB. Do not reorder Tasks 3 and 4.

---

### Task 1: Phase-4 migration module (schema column + smart backfill)

**Files:**
- Create: `app/scripts/migrate-phase4-data.ts`
- Create: `app/scripts/migrate-phase4.ts`
- Test: `app/tests/migrate-phase4.test.ts`

**Interfaces:**
- Consumes: `addColumnIfMissing(sqlite, table, column, ddl)` from `./migrate-phase3-data`.
- Produces:
  - `PHASE4_FUNNEL_COLUMNS: { name: string; ddl: string }[]` (in `migrate-phase4-data.ts`)
  - `ROOMS_ENABLED_MIGRATION: string` (= `'phase4_rooms_enabled'`)
  - `backfillRoomsEnabled(sqlite: import('better-sqlite3').Database): void`
  - `runMigratePhase4(sqlite: import('better-sqlite3').Database): void` (in `migrate-phase4.ts`) — adds columns then runs backfill.

- [ ] **Step 1: Write the failing test**

Create `app/tests/migrate-phase4.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { runMigratePhase3 } from '../scripts/migrate-phase3';
import { runMigratePhase4 } from '../scripts/migrate-phase4';

const REAL_DB = path.resolve(process.cwd(), '..', 'ksamata_funnels.db');
let tmp: string;
let sqlite: Database.Database;

beforeEach(() => {
  tmp = path.join(os.tmpdir(), `ph4-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  fs.copyFileSync(REAL_DB, tmp);
  sqlite = new Database(tmp);
  runMigratePhase3(sqlite); // Phase-4 assumes Phase-3 tables/columns exist.
});

afterEach(() => {
  sqlite.close();
  fs.rmSync(tmp, { force: true });
});

function cols(table: string): string[] {
  return (sqlite.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((r) => r.name);
}

describe('runMigratePhase4', () => {
  it('adds the rooms_enabled column', () => {
    runMigratePhase4(sqlite);
    expect(cols('funnels')).toEqual(expect.arrayContaining(['rooms_enabled']));
  });

  it('backfill: funnel WITH day rows -> 1, funnel WITHOUT -> 0', () => {
    const withDays = sqlite
      .prepare(`SELECT funnel_id AS id FROM funnel_days GROUP BY funnel_id LIMIT 1`)
      .get() as { id: number } | undefined;
    const withoutDays = sqlite
      .prepare(`SELECT id FROM funnels WHERE id NOT IN (SELECT DISTINCT funnel_id FROM funnel_days) LIMIT 1`)
      .get() as { id: number } | undefined;

    runMigratePhase4(sqlite);

    if (withDays) {
      const r = sqlite.prepare(`SELECT rooms_enabled AS e FROM funnels WHERE id = ?`).get(withDays.id) as { e: number };
      expect(r.e).toBe(1);
    }
    if (withoutDays) {
      const r = sqlite.prepare(`SELECT rooms_enabled AS e FROM funnels WHERE id = ?`).get(withoutDays.id) as { e: number };
      expect(r.e).toBe(0);
    }
    expect(Boolean(withDays) || Boolean(withoutDays)).toBe(true);
  });

  it('records the backfill marker', () => {
    runMigratePhase4(sqlite);
    const marker = sqlite.prepare(`SELECT 1 FROM schema_migrations WHERE name = 'phase4_rooms_enabled'`).get();
    expect(marker).toBeTruthy();
  });

  it('is idempotent and does not re-run the backfill', () => {
    runMigratePhase4(sqlite);
    const disabled = sqlite.prepare(`SELECT id FROM funnels WHERE rooms_enabled = 0 LIMIT 1`).get() as { id: number } | undefined;
    if (disabled) sqlite.prepare(`UPDATE funnels SET rooms_enabled = 1 WHERE id = ?`).run(disabled.id);
    expect(() => runMigratePhase4(sqlite)).not.toThrow();
    expect(cols('funnels').filter((c) => c === 'rooms_enabled')).toHaveLength(1);
    if (disabled) {
      const r = sqlite.prepare(`SELECT rooms_enabled AS e FROM funnels WHERE id = ?`).get(disabled.id) as { e: number };
      expect(r.e).toBe(1); // untouched by the second run
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/migrate-phase4.test.ts`
Expected: FAIL — cannot resolve `../scripts/migrate-phase4`.

- [ ] **Step 3: Create the data module**

Create `app/scripts/migrate-phase4-data.ts`:

```typescript
/**
 * Shared column list + backfill for Phase-4 migration. Single source of truth
 * for both migrate-phase4.ts (tsx/tests) and migrate-phase4-runner.ts (Docker).
 *
 * Adds funnels.rooms_enabled (mirror of rooms_replay_enabled) and, once per DB,
 * backfills it: enabled where the funnel already has funnel_days rows, disabled
 * otherwise. The backfill never touches funnel_days.
 */

type DB = import('better-sqlite3').Database;

export const PHASE4_FUNNEL_COLUMNS: { name: string; ddl: string }[] = [
  { name: 'rooms_enabled', ddl: `ALTER TABLE funnels ADD COLUMN rooms_enabled INTEGER DEFAULT 1` },
];

/** Marker recorded in schema_migrations once the one-time backfill completes. */
export const ROOMS_ENABLED_MIGRATION = 'phase4_rooms_enabled';

/**
 * One-time smart backfill: collapse funnels that have no day rows. Marker-gated
 * so it runs at most once per DB — later manual toggles are never overwritten.
 * Assumes the rooms_enabled column already exists.
 */
export function backfillRoomsEnabled(sqlite: DB): void {
  sqlite.exec(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       name       TEXT PRIMARY KEY,
       applied_at TEXT NOT NULL DEFAULT (datetime('now'))
     )`,
  );

  const already = sqlite
    .prepare(`SELECT 1 FROM schema_migrations WHERE name = ? LIMIT 1`)
    .get(ROOMS_ENABLED_MIGRATION);
  if (already) return;

  const run = sqlite.transaction(() => {
    sqlite.exec(
      `UPDATE funnels SET rooms_enabled = 0
         WHERE id NOT IN (SELECT DISTINCT funnel_id FROM funnel_days)`,
    );
    sqlite.prepare(`INSERT INTO schema_migrations (name) VALUES (?)`).run(ROOMS_ENABLED_MIGRATION);
  });
  run();
}
```

- [ ] **Step 4: Create the runner function**

Create `app/scripts/migrate-phase4.ts`:

```typescript
/**
 * Phase-4 schema migration: funnels.rooms_enabled column + smart backfill.
 * Idempotent. Run AFTER Phase-3 (needs the funnels table as migrated).
 *
 * Run against the real DB:
 *   cd app/
 *   FUNNELS_DB_PATH=../ksamata_funnels.db npx tsx scripts/migrate-phase4.ts
 */

import { PHASE4_FUNNEL_COLUMNS, backfillRoomsEnabled } from './migrate-phase4-data';
import { addColumnIfMissing } from './migrate-phase3-data';

export function runMigratePhase4(sqlite: import('better-sqlite3').Database): void {
  sqlite.pragma('foreign_keys = ON');
  for (const col of PHASE4_FUNNEL_COLUMNS) {
    addColumnIfMissing(sqlite, 'funnels', col.name, col.ddl);
  }
  backfillRoomsEnabled(sqlite);
}

if (require.main === module) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Database = require('better-sqlite3');
  const dbPath = process.env.FUNNELS_DB_PATH ?? '../ksamata_funnels.db';
  const sqlite = new Database(dbPath);
  console.log(`Phase-4 schema migration on: ${dbPath}`);
  runMigratePhase4(sqlite);
  sqlite.close();
  console.log('Phase-4 schema migration done.');
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/migrate-phase4.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add app/scripts/migrate-phase4-data.ts app/scripts/migrate-phase4.ts app/tests/migrate-phase4.test.ts
git commit -m "feat(rooms): Phase-4 migration — rooms_enabled column + smart backfill

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Wire Phase-4 migration into Docker

**Files:**
- Create: `app/scripts/migrate-phase4-runner.ts`
- Modify: `app/Dockerfile` (esbuild step after the Phase-3 esbuild ~line 42-46; COPY after the Phase-3 COPY ~line 78)
- Modify: `app/docker-entrypoint.sh` (add a Phase-4 block after the Phase-3 block, before `exec node server.js`)

**Interfaces:**
- Consumes: `runMigratePhase4` from `./migrate-phase4`.
- Produces: `/app/migrate-phase4.cjs` bundle invoked by the entrypoint.

Infrastructure task — no unit test; verify with an esbuild dry-run.

- [ ] **Step 1: Create the Docker runner**

Create `app/scripts/migrate-phase4-runner.ts`:

```typescript
/**
 * Standalone Phase-4 migration for the Docker runner image.
 * Compiled to migrate-phase4.cjs via esbuild in the builder stage:
 *   npx esbuild scripts/migrate-phase4-runner.ts \
 *     --bundle --platform=node --external:better-sqlite3 --outfile=migrate-phase4.cjs
 * Invoked by docker-entrypoint.sh as: node /app/migrate-phase4.cjs
 */

import Database from 'better-sqlite3';
import { runMigratePhase4 } from './migrate-phase4';

const dbPath = process.env.FUNNELS_DB_PATH;
if (!dbPath) {
  console.error('[migrate-phase4] FUNNELS_DB_PATH is not set — skipping.');
  process.exit(0);
}

console.log(`[migrate-phase4] Running Phase-4 migration on: ${dbPath}`);
const sqlite = new Database(dbPath);
sqlite.pragma('journal_mode = WAL');
runMigratePhase4(sqlite);
sqlite.close();
console.log('[migrate-phase4] Done.');
```

- [ ] **Step 2: Verify the bundle builds**

Run from `app/`:
`npx esbuild scripts/migrate-phase4-runner.ts --bundle --platform=node --external:better-sqlite3 --outfile=/tmp/migrate-phase4.cjs && echo OK && rm -f /tmp/migrate-phase4.cjs`
Expected: prints `OK` with no bundling errors.

- [ ] **Step 3: Add the esbuild step to the Dockerfile**

In `app/Dockerfile`, immediately after the Phase-3 esbuild block (`RUN npx esbuild scripts/migrate-phase3-runner.ts ... --outfile=migrate-phase3.cjs`, ~line 42-46), add:

```dockerfile
# Compile the standalone Phase-4 migration for the runner image.
# better-sqlite3 is kept external so the runner's native .node binary is used.
RUN npx esbuild scripts/migrate-phase4-runner.ts \
      --bundle \
      --platform=node \
      --external:better-sqlite3 \
      --outfile=migrate-phase4.cjs
```

- [ ] **Step 4: Add the COPY step to the Dockerfile**

In `app/Dockerfile`, immediately after `COPY --from=builder /build/migrate-phase3.cjs /app/migrate-phase3.cjs` (~line 78), add:

```dockerfile
# Copy the compiled Phase-4 migration bundle into the runner image.
COPY --from=builder /build/migrate-phase4.cjs /app/migrate-phase4.cjs
```

- [ ] **Step 5: Add the entrypoint block**

In `app/docker-entrypoint.sh`, after the Phase-3 migration block and before `exec node server.js`, add:

```sh
# Apply Phase-4 migration (idempotent: guarded ALTER + marker-gated one-time
# backfill of rooms_enabled via schema_migrations['phase4_rooms_enabled']).
if [ -n "$FUNNELS_DB_PATH" ]; then
  echo "[entrypoint] Running Phase-4 migration against $FUNNELS_DB_PATH"
  node /app/migrate-phase4.cjs
  echo "[entrypoint] Phase-4 migration done."
fi
```

- [ ] **Step 6: Commit**

```bash
git add app/scripts/migrate-phase4-runner.ts app/Dockerfile app/docker-entrypoint.sh
git commit -m "build(rooms): wire Phase-4 migration into Docker entrypoint

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Apply Phase-4 to the seed DBs (MUST precede Task 4)

**Files:** none edited by hand. Mutates the tracked seed DB(s) — same approach used for the Phase-3 columns already in them.

Why now: Task 4 adds `roomsEnabled` to the Drizzle schema, after which all funnels queries select `rooms_enabled`. The 16 test files copy `ksamata_funnels.db`; that column must exist in the seed before the suite runs.

- [ ] **Step 1: Back up the root seed DB**

Run from repo root:
`cp ksamata_funnels.db ksamata_funnels.db.bak`

- [ ] **Step 2: Migrate the root seed DB (used by tests)**

Run from `app/`:
`FUNNELS_DB_PATH=../ksamata_funnels.db npx tsx scripts/migrate-phase4.ts`
Expected: prints `Phase-4 schema migration done.`

- [ ] **Step 3: Migrate the Docker seed DB if present**

Run from `app/`:
`[ -f seed/ksamata_funnels.db ] && FUNNELS_DB_PATH=seed/ksamata_funnels.db npx tsx scripts/migrate-phase4.ts || echo "no app/seed DB — skipping"`
Expected: either `Phase-4 schema migration done.` or the skip message. (The entrypoint re-runs Phase-4 in prod regardless, so this is just to keep the baked seed current.)

- [ ] **Step 4: Spot-check the backfill split**

Run from `app/`:
```bash
FUNNELS_DB_PATH=../ksamata_funnels.db npx tsx -e "const D=require('better-sqlite3');const db=new D(process.env.FUNNELS_DB_PATH);console.log(db.prepare('SELECT rooms_enabled e, COUNT(*) n FROM funnels GROUP BY rooms_enabled').all());"
```
Expected: rows for `e:1` (funnels with days) and `e:0` (funnels without). No error.

- [ ] **Step 5: Confirm the full suite still passes with the migrated seed (schema unchanged yet)**

Run from `app/`: `npx vitest run`
Expected: all tests pass. (Schema not yet touched — this confirms the migrated seed didn't break anything.)

- [ ] **Step 6: Commit the seed DB(s) and remove the backup**

```bash
rm -f ksamata_funnels.db.bak
git add ksamata_funnels.db
# Only if app/seed/ksamata_funnels.db exists and is tracked:
git add app/seed/ksamata_funnels.db 2>/dev/null || true
git commit -m "chore(rooms): apply Phase-4 backfill to seed DB(s)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Server model + validation for `roomsEnabled`

**Files:**
- Modify: `app/src/db/schema.ts:69` (add column after `roomsReplayEnabled`)
- Modify: `app/src/lib/funnels.ts` (type ~53, read map ~190, create ~240, draft create ~310, update ~366, createFrom ~560)
- Modify: `app/src/lib/validation.ts:68` (add field to `funnelCreateSchema`)
- Test: `app/tests/api-funnels.test.ts`

**Interfaces:**
- Consumes: helpers already in `api-funnels.test.ts` — `createFunnel(testDb, data)`, `getFunnel(testDb, id)`, `updateFunnel(testDb, id, patch)`, `duplicateFunnel(testDb, id)`; `BASE_FUNNEL_DATA`.
- Produces: `FunnelDetail.roomsEnabled: boolean`; update accepts `roomsEnabled?: boolean`; validation field `roomsEnabled: z.boolean().optional()`.

- [ ] **Step 1: Write the failing test**

Append to `app/tests/api-funnels.test.ts` (uses the module-level `testDb`, `createFunnel`, `getFunnel`, `updateFunnel`, `duplicateFunnel`, and `BASE_FUNNEL_DATA` already defined in that file):

```typescript
describe('roomsEnabled flag', () => {
  it('defaults to true on create and round-trips through update', () => {
    const created = createFunnel(testDb, { ...BASE_FUNNEL_DATA, num: 9955 });
    expect(getFunnel(testDb, created.id)!.roomsEnabled).toBe(true);

    updateFunnel(testDb, created.id, { roomsEnabled: false });
    expect(getFunnel(testDb, created.id)!.roomsEnabled).toBe(false);

    updateFunnel(testDb, created.id, { roomsEnabled: true });
    expect(getFunnel(testDb, created.id)!.roomsEnabled).toBe(true);
  });

  it('duplicateFunnel copies roomsEnabled from the source', () => {
    const src = createFunnel(testDb, { ...BASE_FUNNEL_DATA, num: 9956 });
    updateFunnel(testDb, src.id, { roomsEnabled: false });
    const dup = duplicateFunnel(testDb, src.id)!;
    expect(getFunnel(testDb, dup.id)!.roomsEnabled).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/api-funnels.test.ts`
Expected: FAIL — `roomsEnabled` is `undefined` on the detail and/or `updateFunnel` ignores it. (The `rooms_enabled` column already exists from Task 3, so failure is about the missing model wiring, not a missing column.)

- [ ] **Step 3: Add the schema column**

In `app/src/db/schema.ts`, after line 69 (`roomsReplayEnabled: integer('rooms_replay_enabled').default(0),`) add:

```typescript
    roomsEnabled:       integer('rooms_enabled').default(1),
```

- [ ] **Step 4: Add the type field**

In `app/src/lib/funnels.ts`, after `roomsReplayEnabled: boolean;` (~line 53) add:

```typescript
  roomsEnabled: boolean;
```

- [ ] **Step 5: Map the column on read**

In `app/src/lib/funnels.ts`, after `roomsReplayEnabled: (row.roomsReplayEnabled ?? 0) === 1,` (~line 190) add:

```typescript
    roomsEnabled: (row.roomsEnabled ?? 1) === 1,
```

- [ ] **Step 6: Set it on create (full create)**

In `app/src/lib/funnels.ts`, in the create insert object after `roomsReplayEnabled: data.roomsReplayEnabled ? 1 : 0,` (~line 240) add:

```typescript
        roomsEnabled:       data.roomsEnabled === false ? 0 : 1,
```

(Defaults to enabled unless the caller explicitly passes `false`.)

- [ ] **Step 7: Set it on draft create**

In `app/src/lib/funnels.ts`, in the draft-create insert object after `roomsReplayEnabled: 0,` (~line 310) add:

```typescript
        roomsEnabled: 1,
```

- [ ] **Step 8: Handle it on update**

In `app/src/lib/funnels.ts`, after `if (data.roomsReplayEnabled !== undefined) scalarUpdate.roomsReplayEnabled = data.roomsReplayEnabled ? 1 : 0;` (~line 366) add:

```typescript
    if (data.roomsEnabled       !== undefined) scalarUpdate.roomsEnabled       = data.roomsEnabled ? 1 : 0;
```

- [ ] **Step 9: Copy it in createFrom**

In `app/src/lib/funnels.ts`, in the `createFrom` insert object after `roomsReplayEnabled: source.roomsReplayEnabled ?? 0,` (~line 560) add:

```typescript
        roomsEnabled:       source.roomsEnabled ? 1 : 0,
```

- [ ] **Step 10: Add the validation field**

In `app/src/lib/validation.ts`, after `roomsReplayEnabled: z.boolean().optional(),` (line 68) add:

```typescript
  roomsEnabled: z.boolean().optional(),
```

- [ ] **Step 11: Run tests to verify they pass**

Run: `npx vitest run tests/api-funnels.test.ts tests/validation.test.ts`
Expected: PASS (including the two new `roomsEnabled` tests).

- [ ] **Step 12: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 13: Commit**

```bash
git add app/src/db/schema.ts app/src/lib/funnels.ts app/src/lib/validation.ts app/tests/api-funnels.test.ts
git commit -m "feat(rooms): carry roomsEnabled through schema, model, validation

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: UI — collapse `RoomsEditor` when disabled + wire the flag through

**Files:**
- Modify: `app/src/components/RoomsEditor.tsx`
- Modify: `app/src/components/FunnelSections.tsx:127-134` (pass `enabled` prop)
- Modify: `app/src/components/FunnelCompactView.tsx` (gate rooms on `funnel.roomsEnabled`)

**Interfaces:**
- Consumes: `FunnelDetail.roomsEnabled` (Task 4); `Switch` (`checked`, `onChange`, optional `label`); `Tv` icon (already imported in `RoomsEditor`).
- Produces: `RoomsEditor` prop `enabled: boolean`.

UI task — verify in the browser preview (no component-test harness exists in this repo).

- [ ] **Step 1: Add the `enabled` prop and state to `RoomsEditor`**

In `app/src/components/RoomsEditor.tsx`, extend `Props` (add `enabled` after `replayEnabled`):

```typescript
interface Props {
  funnelId: number;
  initialDays: DayCell[];
  enabled: boolean;
  replayEnabled: boolean;
  timeLabelA: string;
  timeLabelB: string;
  onDirtyChange?: (dirty: boolean) => void;
}
```

Update the signature (alias to `enabledProp` to avoid clashing with state):

```typescript
export default function RoomsEditor({ funnelId, initialDays, enabled: enabledProp, replayEnabled, timeLabelA, timeLabelB, onDirtyChange }: Props) {
```

Add state right after `const [replay, setReplay] = useState(replayEnabled);`:

```typescript
  const [enabled, setEnabled] = useState(enabledProp);
```

- [ ] **Step 2: Fold `enabled` into the saved snapshot + dirty check**

Change the `SavedSnapshot` type:

```typescript
type SavedSnapshot = { enabled: boolean; replay: boolean; cells: DayCell[] };
```

Change the `saved` initializer:

```typescript
  const [saved, setSaved] = useState<SavedSnapshot>(() => ({
    enabled: enabledProp,
    replay: replayEnabled,
    cells: cellsFromGrid(buildGrid(initialDays, clampedInitialDayCount), clampedInitialDayCount),
  }));
```

Change `dirty`:

```typescript
  const dirty =
    enabled !== saved.enabled ||
    replay !== saved.replay ||
    JSON.stringify(cellsFromGrid(grid, dayCount)) !== JSON.stringify(saved.cells);
```

- [ ] **Step 3: Add an autosaving flag toggle handler**

Add this function inside the component, just before `async function save()`:

```typescript
  // Toggling the block on/off autosaves the flag immediately (like BlockEditor),
  // without PUTting days — disabling never erases stored rooms.
  async function setEnabledPersist(v: boolean) {
    setEnabled(v);
    setError(null);
    try {
      const res = await fetch(`/api/funnels/${funnelId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ roomsEnabled: v }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Не удалось сохранить (${res.status})`);
      }
      setSaved((s) => ({ ...s, enabled: v }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось сохранить');
    }
  }
```

- [ ] **Step 4: Include `enabled` in the explicit save**

In `save()`, capture the submitted flag alongside `submittedReplay`:

```typescript
    const submittedReplay = replay;
    const submittedEnabled = enabled;
    const cells = cellsFromGrid(grid, dayCount);
```

Change the funnel PATCH body to send both flags:

```typescript
      const flagRes = await fetch(`/api/funnels/${funnelId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomsReplayEnabled: submittedReplay, roomsEnabled: submittedEnabled }),
      });
```

Change the success snapshot:

```typescript
      setSaved({ enabled: submittedEnabled, replay: submittedReplay, cells });
```

- [ ] **Step 5: Render the collapsed row when disabled**

Add an early return immediately before the main `return (` (mirrors `BlockEditor`'s disabled row):

```typescript
  if (!enabled) {
    return (
      <div className="mb-2.5 flex items-center gap-2 rounded-[10px] border border-[var(--line-soft)] bg-[var(--card)] px-3.5 py-2.5 opacity-60">
        <Tv size={16} className="text-[var(--faint)]" />
        <span className="text-[13px] font-medium text-[var(--muted)]">Вебинарные комнаты</span>
        <span className="ml-auto">
          <Switch checked={false} onChange={(v) => setEnabledPersist(v)} />
        </span>
      </div>
    );
  }
```

- [ ] **Step 6: Add the on/off switch to the expanded header**

Replace the header's replay `<span className="ml-auto">…</span>` (currently line ~167) with a group holding both switches — «повтор» plus the on/off switch on the far right:

```tsx
        <span className="ml-auto flex items-center gap-3">
          <Switch checked={replay} onChange={setReplay} label="повтор" />
          <Switch checked={enabled} onChange={(v) => setEnabledPersist(v)} />
        </span>
```

- [ ] **Step 7: Pass the prop from `FunnelSections`**

In `app/src/components/FunnelSections.tsx`, add `enabled` to `<RoomsEditor>` (after `initialDays`, ~line 129):

```tsx
        <RoomsEditor
          funnelId={funnelId}
          initialDays={initialDays}
          enabled={funnel.roomsEnabled}
          replayEnabled={funnel.roomsReplayEnabled}
          timeLabelA={funnel.timeLabelA}
          timeLabelB={funnel.timeLabelB}
          onDirtyChange={(d) => setSectionDirty('rooms', d)}
        />
```

- [ ] **Step 8: Gate rooms in the compact (view) mode**

In `app/src/components/FunnelCompactView.tsx`, right after `const dayGroups = groupDaysByDay(initialDays);` (~line 30) add:

```typescript
  const showRooms = funnel.roomsEnabled && dayGroups.length > 0;
```

Replace the rooms-section guard `{dayGroups.length > 0 && (` (~line 54) with:

```tsx
      {showRooms && (
```

Replace the empty-state guard `{dayGroups.length === 0 && blocks.length === 0 && (` (~line 93) with:

```tsx
      {!showRooms && blocks.length === 0 && (
```

- [ ] **Step 9: Typecheck and lint**

Run from `app/`: `npx tsc --noEmit && npx next lint`
Expected: no errors.

- [ ] **Step 10: Verify in the browser preview**

Start the dev server (preview_start with the project's dev config; create `.claude/launch.json` for `npm run dev` if absent) and open a funnel card:
1. A funnel WITH rooms shows the expanded block with both switches («повтор» and the on/off switch on the right).
2. Toggle the on/off switch off → the block collapses to the thin disabled row. Reload the page → it stays collapsed (flag autosaved). Toggle back on → the day grid returns unchanged (rows not lost).
3. Switch to «Просмотр» on a disabled funnel → the rooms section is hidden.
4. Check the Network tab: the toggle fires `PATCH /api/funnels/<id>` with `{ roomsEnabled: false }` → 200.

Capture a screenshot of the collapsed row as proof.

- [ ] **Step 11: Commit**

```bash
git add app/src/components/RoomsEditor.tsx app/src/components/FunnelSections.tsx app/src/components/FunnelCompactView.tsx
git commit -m "feat(rooms): on/off toggle collapses the webinar-rooms block

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Full test sweep + final verification

**Files:** none.

- [ ] **Step 1: Run the full suite**

Run from `app/`: `npx vitest run`
Expected: all tests pass (including `migrate-phase4` and the new `roomsEnabled` tests).

- [ ] **Step 2: Production build sanity**

Run from `app/`: `npx next build`
Expected: build succeeds with no type/lint errors.

- [ ] **Step 3: Confirm no stray files**

Run: `git status`
Expected: clean working tree (all changes committed; no leftover `.bak` or `/tmp` artifacts).

---

## Notes for the implementer

- The «повтор» toggle stays **local** (persisted only via the explicit «Сохранить»), exactly as today. Only the new on/off switch autosaves — this matches `BlockEditor`, where `enabled` autosaves but `mode`/`items` need the button.
- Disabling is non-destructive: `setEnabledPersist` never calls the days PUT, and the backfill never writes `funnel_days`.
- `Switch` takes an optional `label` prop (used by «повтор»); the on/off switch is unlabeled, matching `BlockEditor`.
- No rooms-specific API endpoint — the existing `PATCH /api/funnels/[id]` accepts arbitrary funnel fields validated by `funnelUpdateSchema` (the partial of `funnelCreateSchema`).
- Task order matters: the seed DB must be migrated (Task 3) before the Drizzle schema gains the column (Task 4), or the 16 DB-copying tests fail on a missing `rooms_enabled` column.
