# Flexible AV-Tags Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let staff add custom AV-tags and remove default AV-tags per funnel (per scenario) and edit the global default template, while auto-generated axis tags keep updating.

**Architecture:** Introduce a "layers" model — `template + axes − removed + added = effective set`. Two new tables (`tag_templates` global static defaults, `funnel_tag_overrides` per-funnel deltas by name). `funnel_tags` stays the materialized output; a single `materializeFunnelTags()` rebuilds it from the layers. Axis tags (`АВ Продукт:` …) remain auto-derived and are **never** removable.

**Tech Stack:** Next.js 15 (App Router), better-sqlite3 + drizzle-orm, zod, vitest, React 19, Tailwind.

## Global Constraints

- All work happens under `app/`; run commands from `app/` unless noted.
- Tests operate on a TEMP COPY of `../ksamata_funnels.db`; never open the real DB in tests.
- Migrations are idempotent (`CREATE TABLE IF NOT EXISTS`, `INSERT OR IGNORE`, marker-gated data moves via `schema_migrations`).
- Every migration ships as: a data module (`scripts/migrate-phase5-data.ts`), a tsx entry (`scripts/migrate-phase5.ts` with `runMigratePhase5(sqlite)` + `require.main` runner), and gets registered in test setups.
- Scenario values are exactly `reg | time_15 | time_19 | messenger` (match `funnel_tags.tagType` enum).
- Tag name bound: trimmed, `min(1)`, `max(120)` (reuse `REF_MAX`).
- Axis prefixes (`АВ Продукт: `, `АВ Подрядчик: `, `АВ Канал: `, `АВ Направление: `) stay in `ab-tags.ts`; axis tags are auto-only and non-removable.
- Run the full suite with `npx vitest run` from `app/`.

---

## File Structure

**New files:**
- `app/scripts/migrate-phase5-data.ts` — DDL for both tables + seed rows for `tag_templates`.
- `app/scripts/migrate-phase5.ts` — `runMigratePhase5(sqlite)` + CLI runner.
- `app/src/lib/tag-templates.ts` — `listTemplate`, `replaceTemplateScenario`.
- `app/src/lib/tag-overrides.ts` — `listOverrides`, `replaceOverrides`.
- `app/src/app/api/tag-templates/route.ts` — `GET`.
- `app/src/app/api/tag-templates/[scenario]/route.ts` — `PUT`.
- `app/src/app/api/funnels/[id]/tags/route.ts` — `PATCH`.
- `app/src/components/TagTemplateEditor.tsx` — per-scenario chip editor for `/tags`.
- `app/src/app/tags/page.tsx` — global template screen.
- Tests: `migrate-phase5.test.ts`, `tag-templates.test.ts`, `tag-overrides.test.ts`, `materialize-tags.test.ts`, `api-tag-templates-route.test.ts`, `api-funnels-tags-route.test.ts`.

**Modified files:**
- `app/src/db/schema.ts` — add `tagTemplates`, `funnelTagOverrides` + type exports.
- `app/src/lib/ab-tags.ts` — remove hardcoded static tags; add `Scenario`, `SCENARIOS`, `isAxisTag`, `axisTagNames`, `computeTagSet`, layer types.
- `app/src/lib/funnels.ts` — `syncAvTags → materializeFunnelTags`, `resyncAllFunnels`, `getFunnel` returns `tagSets`, wire create/update/duplicate/resync, `copyFunnelChildren` copies overrides.
- `app/src/lib/validation.ts` — `tagTemplatePutSchema`, `tagsPatchSchema`.
- `app/src/components/FunnelIdentity.tsx` — editable tags block + own save.
- `app/src/components/AppHeader.tsx` — nav link to `/tags`.
- `app/docker-entrypoint.sh` — run Phase-5 migration.
- Test setups that create/update funnels: add `runMigratePhase5(sqlite)` (listed in Task 5).

---

## Task 1: Schema + Phase-5 migration (tables + template seed)

**Files:**
- Create: `app/scripts/migrate-phase5-data.ts`
- Create: `app/scripts/migrate-phase5.ts`
- Modify: `app/src/db/schema.ts` (append after `funnelBlockItems`, before Type exports; add type exports)
- Test: `app/tests/migrate-phase5.test.ts`

**Interfaces:**
- Produces: `runMigratePhase5(sqlite: import('better-sqlite3').Database): void`; tables `tag_templates(id, scenario, name, position)` and `funnel_tag_overrides(id, funnel_id, tag_type, name, op, position)`; drizzle tables `tagTemplates`, `funnelTagOverrides`; seeded `tag_templates` rows.

- [ ] **Step 1: Write the failing test**

```ts
// app/tests/migrate-phase5.test.ts
import { describe, it, expect, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { copyFileSync, unlinkSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { runMigratePhase5 } from '../scripts/migrate-phase5';

const REAL_DB = join(__dirname, '../../ksamata_funnels.db');
const TMP_DB = join(tmpdir(), `p5_${Date.now()}_${process.pid}.db`);
copyFileSync(REAL_DB, TMP_DB);
const sqlite = new Database(TMP_DB);
sqlite.pragma('foreign_keys = ON');

afterAll(() => { sqlite.close(); if (existsSync(TMP_DB)) unlinkSync(TMP_DB); });

describe('migrate-phase5', () => {
  it('creates both tables and seeds the template idempotently', () => {
    runMigratePhase5(sqlite);
    runMigratePhase5(sqlite); // idempotent — second run must not throw or double-seed

    const tables = sqlite.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name IN ('tag_templates','funnel_tag_overrides')`
    ).all() as { name: string }[];
    expect(tables.map((t) => t.name).sort()).toEqual(['funnel_tag_overrides', 'tag_templates']);

    const reg = sqlite.prepare(
      `SELECT name FROM tag_templates WHERE scenario='reg' ORDER BY position`
    ).all() as { name: string }[];
    expect(reg.map((r) => r.name)).toEqual(['автоворонки', 'АВ Автоворонка', 'АВ Этап: Регистрация']);

    const time15 = sqlite.prepare(
      `SELECT name FROM tag_templates WHERE scenario='time_15' ORDER BY position`
    ).all() as { name: string }[];
    expect(time15.map((r) => r.name)).toEqual(['автоворонки', 'АВ Автоворонка', 'АВ Этап: Оплата', 'АВ Время: 15']);

    const count = sqlite.prepare(`SELECT COUNT(*) AS c FROM tag_templates`).get() as { c: number };
    expect(count.c).toBe(3 + 4 + 4 + 3); // reg + time_15 + time_19 + messenger, seeded once
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/migrate-phase5.test.ts`
Expected: FAIL — cannot resolve `../scripts/migrate-phase5`.

- [ ] **Step 3: Create the data module**

```ts
// app/scripts/migrate-phase5-data.ts
/**
 * Shared DDL + template seed for Phase-5 (flexible AV-tags).
 * Single source of truth for migrate-phase5.ts (tsx/tests) and the Docker runner.
 */

export const PHASE5_DDL = `
CREATE TABLE IF NOT EXISTS tag_templates (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  scenario TEXT    NOT NULL CHECK(scenario IN ('reg','time_15','time_19','messenger')),
  name     TEXT    NOT NULL,
  position INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_tag_templates_scenario ON tag_templates(scenario);

CREATE TABLE IF NOT EXISTS funnel_tag_overrides (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  funnel_id INTEGER NOT NULL REFERENCES funnels(id) ON DELETE CASCADE,
  tag_type  TEXT    NOT NULL CHECK(tag_type IN ('reg','time_15','time_19','messenger')),
  name      TEXT    NOT NULL,
  op        TEXT    NOT NULL CHECK(op IN ('add','remove')),
  position  INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS funnel_tag_overrides_unique
  ON funnel_tag_overrides(funnel_id, tag_type, name);
CREATE INDEX IF NOT EXISTS idx_fto_funnel ON funnel_tag_overrides(funnel_id);
`;

/** Template seed — mirrors the previously hardcoded COMMON_TAGS + stage + time tags. */
export const PHASE5_TEMPLATE_SEED: { scenario: string; name: string; position: number }[] = [
  { scenario: 'reg',       name: 'автоворонки',        position: 0 },
  { scenario: 'reg',       name: 'АВ Автоворонка',     position: 1 },
  { scenario: 'reg',       name: 'АВ Этап: Регистрация', position: 2 },

  { scenario: 'time_15',   name: 'автоворонки',        position: 0 },
  { scenario: 'time_15',   name: 'АВ Автоворонка',     position: 1 },
  { scenario: 'time_15',   name: 'АВ Этап: Оплата',    position: 2 },
  { scenario: 'time_15',   name: 'АВ Время: 15',       position: 3 },

  { scenario: 'time_19',   name: 'автоворонки',        position: 0 },
  { scenario: 'time_19',   name: 'АВ Автоворонка',     position: 1 },
  { scenario: 'time_19',   name: 'АВ Этап: Оплата',    position: 2 },
  { scenario: 'time_19',   name: 'АВ Время: 19',       position: 3 },

  { scenario: 'messenger', name: 'автоворонки',        position: 0 },
  { scenario: 'messenger', name: 'АВ Автоворонка',     position: 1 },
  { scenario: 'messenger', name: 'АВ Этап: Мессенджер', position: 2 },
];

/**
 * Seed tag_templates ONCE per DB, gated by a schema_migrations marker so a
 * second run never double-inserts (there is no natural UNIQUE key on the row).
 */
export function seedTagTemplates(sqlite: import('better-sqlite3').Database): void {
  sqlite.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY)`);
  const done = sqlite.prepare(`SELECT 1 FROM schema_migrations WHERE name='phase5_template_seed'`).get();
  if (done) return;
  const insert = sqlite.prepare(`INSERT INTO tag_templates (scenario, name, position) VALUES (?, ?, ?)`);
  const tx = sqlite.transaction(() => {
    for (const r of PHASE5_TEMPLATE_SEED) insert.run(r.scenario, r.name, r.position);
    sqlite.prepare(`INSERT INTO schema_migrations (name) VALUES ('phase5_template_seed')`).run();
  });
  tx();
}
```

- [ ] **Step 4: Create the migration entry**

```ts
// app/scripts/migrate-phase5.ts
/**
 * Phase-5 schema migration: tag_templates + funnel_tag_overrides + template seed.
 * Idempotent. Run AFTER Phase-3.
 *
 *   cd app/
 *   FUNNELS_DB_PATH=../ksamata_funnels.db npx tsx scripts/migrate-phase5.ts
 */
import { PHASE5_DDL, seedTagTemplates } from './migrate-phase5-data';

export function runMigratePhase5(sqlite: import('better-sqlite3').Database): void {
  sqlite.pragma('foreign_keys = ON');
  sqlite.exec(PHASE5_DDL);
  seedTagTemplates(sqlite);
}

if (require.main === module) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Database = require('better-sqlite3');
  const dbPath = process.env.FUNNELS_DB_PATH ?? '../ksamata_funnels.db';
  const sqlite = new Database(dbPath);
  console.log(`Phase-5 schema migration on: ${dbPath}`);
  runMigratePhase5(sqlite);
  sqlite.close();
  console.log('Phase-5 schema migration done.');
}
```

- [ ] **Step 5: Add drizzle tables + type exports to schema.ts**

In `app/src/db/schema.ts`, insert before the `// ─── Type exports ───` section:

```ts
// ─── tag_templates / funnel_tag_overrides (Phase 5) ──────────────────────────

export const tagTemplates = sqliteTable(
  'tag_templates',
  {
    id:       integer('id').primaryKey({ autoIncrement: true }),
    scenario: text('scenario', { enum: ['reg', 'time_15', 'time_19', 'messenger'] }).notNull(),
    name:     text('name').notNull(),
    position: integer('position').notNull().default(0),
  },
  (t) => ({
    scenarioIdx: index('idx_tag_templates_scenario').on(t.scenario),
  }),
);

export const funnelTagOverrides = sqliteTable(
  'funnel_tag_overrides',
  {
    id:       integer('id').primaryKey({ autoIncrement: true }),
    funnelId: integer('funnel_id').notNull().references(() => funnels.id, { onDelete: 'cascade' }),
    tagType:  text('tag_type', { enum: ['reg', 'time_15', 'time_19', 'messenger'] }).notNull(),
    name:     text('name').notNull(),
    op:       text('op', { enum: ['add', 'remove'] }).notNull(),
    position: integer('position').notNull().default(0),
  },
  (t) => ({
    uniq:      uniqueIndex('funnel_tag_overrides_unique').on(t.funnelId, t.tagType, t.name),
    funnelIdx: index('idx_fto_funnel').on(t.funnelId),
  }),
);
```

And in the Type exports section add:

```ts
export type TagTemplate       = typeof tagTemplates.$inferSelect;
export type FunnelTagOverride = typeof funnelTagOverrides.$inferSelect;
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run tests/migrate-phase5.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add app/scripts/migrate-phase5.ts app/scripts/migrate-phase5-data.ts app/src/db/schema.ts app/tests/migrate-phase5.test.ts
git commit -m "feat(tags): phase-5 schema — tag_templates + funnel_tag_overrides + seed"
```

---

## Task 2: ab-tags.ts — layer types + computeTagSet

Add pure layer helpers alongside the existing generator. This task is **purely additive**: the legacy `axesToTagNames` (which hardcoded the static tags) is **kept in place** because `funnels.ts` (`syncAvTags`) and `FunnelIdentity.tsx` still import it on the current base — they are migrated off it in Tasks 5 and 9, and Task 9 deletes `axesToTagNames` once its last caller is gone. Removing it here would break the build/suite.

**Files:**
- Modify: `app/src/lib/ab-tags.ts` (additive — keep `axesToTagNames`)
- Test: `app/tests/ab-tags.test.ts` (replace body with the new tests below; `axesToTagNames`'s dedicated tests are dropped now and the function is removed in Task 9 — it stays exercised via the funnels/backfill integration tests until then)

**Interfaces:**
- Consumes: `AbAxes`, `AXIS_PREFIXES`, `tagNamesToAxes` (kept).
- Produces:
  - `type Scenario = 'reg' | 'time_15' | 'time_19' | 'messenger'`
  - `const SCENARIOS: Scenario[]`
  - `function isAxisTag(name: string): boolean`
  - `function axisTagNames(axes: AbAxes): string[]`
  - `type TagChip = { name: string; source: 'axis' | 'default' | 'custom' }`
  - `type ScenarioTags = { tags: TagChip[]; suppressed: string[] }`
  - `type TagSets = Record<Scenario, ScenarioTags>`
  - `type TemplateMap = Record<Scenario, string[]>`
  - `type ScenarioOverride = { add: string[]; remove: string[] }`
  - `type OverrideMap = Record<Scenario, ScenarioOverride>`
  - `function computeTagSet(template: TemplateMap, axes: AbAxes, overrides: OverrideMap): TagSets`

- [ ] **Step 1: Write the failing test**

Replace the body of `app/tests/ab-tags.test.ts` with:

```ts
import { describe, test, expect } from 'vitest';
import {
  tagNamesToAxes,
  axisTagNames,
  isAxisTag,
  computeTagSet,
  SCENARIOS,
  type AbAxes,
  type TemplateMap,
  type OverrideMap,
} from '../src/lib/ab-tags';

const axes: AbAxes = { product: 'ТКМ', contractor: 'НИМБ', channel: 'Яндекс', direction: 'РСЯ' };

const emptyOverrides = (): OverrideMap => ({
  reg: { add: [], remove: [] },
  time_15: { add: [], remove: [] },
  time_19: { add: [], remove: [] },
  messenger: { add: [], remove: [] },
});

const template: TemplateMap = {
  reg: ['автоворонки', 'АВ Автоворонка', 'АВ Этап: Регистрация'],
  time_15: ['автоворонки', 'АВ Автоворонка', 'АВ Этап: Оплата', 'АВ Время: 15'],
  time_19: ['автоворонки', 'АВ Автоворонка', 'АВ Этап: Оплата', 'АВ Время: 19'],
  messenger: ['автоворонки', 'АВ Автоворонка', 'АВ Этап: Мессенджер'],
};

describe('axisTagNames', () => {
  test('emits one tag per non-empty axis', () => {
    expect(axisTagNames(axes)).toEqual([
      'АВ Продукт: ТКМ', 'АВ Подрядчик: НИМБ', 'АВ Канал: Яндекс', 'АВ Направление: РСЯ',
    ]);
  });
  test('omits empty axes', () => {
    expect(axisTagNames({ product: 'ТКМ', contractor: '', channel: '', direction: '' }))
      .toEqual(['АВ Продукт: ТКМ']);
  });
});

describe('isAxisTag', () => {
  test('true for axis-prefixed, false otherwise', () => {
    expect(isAxisTag('АВ Продукт: ТКМ')).toBe(true);
    expect(isAxisTag('автоворонки')).toBe(false);
    expect(isAxisTag('АВ Этап: Регистрация')).toBe(false);
  });
});

describe('computeTagSet', () => {
  test('reg = template then axis tags, all source-flagged', () => {
    const s = computeTagSet(template, axes, emptyOverrides());
    expect(s.reg.tags.map((t) => t.name)).toEqual([
      'автоворонки', 'АВ Автоворонка', 'АВ Этап: Регистрация',
      'АВ Продукт: ТКМ', 'АВ Подрядчик: НИМБ', 'АВ Канал: Яндекс', 'АВ Направление: РСЯ',
    ]);
    expect(s.reg.tags.find((t) => t.name === 'автоворонки')!.source).toBe('default');
    expect(s.reg.tags.find((t) => t.name === 'АВ Продукт: ТКМ')!.source).toBe('axis');
    expect(s.reg.suppressed).toEqual([]);
  });

  test('remove suppresses a default and lists it in suppressed', () => {
    const ov = emptyOverrides();
    ov.reg.remove = ['автоворонки'];
    const s = computeTagSet(template, axes, ov);
    expect(s.reg.tags.map((t) => t.name)).not.toContain('автоворонки');
    expect(s.reg.suppressed).toEqual(['автоворонки']);
  });

  test('add appends a custom tag at the end', () => {
    const ov = emptyOverrides();
    ov.reg.add = ['промо-январь'];
    const s = computeTagSet(template, axes, ov);
    const last = s.reg.tags[s.reg.tags.length - 1];
    expect(last).toEqual({ name: 'промо-январь', source: 'custom' });
  });

  test('remove of an axis tag is ignored (axes are non-suppressible)', () => {
    const ov = emptyOverrides();
    ov.reg.remove = ['АВ Продукт: ТКМ'];
    const s = computeTagSet(template, axes, ov);
    expect(s.reg.tags.map((t) => t.name)).toContain('АВ Продукт: ТКМ');
    expect(s.reg.suppressed).toEqual([]); // axis names never counted as suppressed
  });

  test('dedupes: an add equal to an existing default is not duplicated', () => {
    const ov = emptyOverrides();
    ov.reg.add = ['автоворонки'];
    const s = computeTagSet(template, axes, ov);
    expect(s.reg.tags.filter((t) => t.name === 'автоворонки')).toHaveLength(1);
  });

  test('covers all four scenarios', () => {
    const s = computeTagSet(template, axes, emptyOverrides());
    for (const sc of SCENARIOS) expect(s[sc].tags.length).toBeGreaterThan(0);
    expect(s.messenger.tags.map((t) => t.name)).toContain('АВ Этап: Мессенджер');
    expect(s.time_15.tags.map((t) => t.name)).toContain('АВ Время: 15');
  });
});

describe('tagNamesToAxes (unchanged)', () => {
  test('round-trips axis tags', () => {
    expect(tagNamesToAxes(['АВ Продукт: ТКМ', 'АВ Канал: Яндекс', 'автоворонки']))
      .toEqual({ product: 'ТКМ', contractor: '', channel: 'Яндекс', direction: '' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/ab-tags.test.ts`
Expected: FAIL — `axisTagNames`/`computeTagSet`/`isAxisTag` not exported.

- [ ] **Step 3: Edit ab-tags.ts additively**

Set the file contents to the block below, **then append the existing `axesToTagNames` function verbatim** at the end (copy it unchanged — e.g. `git show main:app/src/lib/ab-tags.ts` — it must keep its current `{ reg, time19, time15, messenger }` return shape so `funnels.ts`/`FunnelIdentity.tsx` keep compiling). Do NOT delete `axesToTagNames`; Task 9 removes it. The new-code block:

```ts
export type AbAxes = {
  product: string;
  contractor: string;
  channel: string;
  direction: string;
};

export const AXIS_PREFIXES = {
  product: 'АВ Продукт: ',
  contractor: 'АВ Подрядчик: ',
  channel: 'АВ Канал: ',
  direction: 'АВ Направление: ',
} as const satisfies Record<keyof AbAxes, string>;

export type Scenario = 'reg' | 'time_15' | 'time_19' | 'messenger';
export const SCENARIOS: Scenario[] = ['reg', 'time_15', 'time_19', 'messenger'];

export type TagChip = { name: string; source: 'axis' | 'default' | 'custom' };
export type ScenarioTags = { tags: TagChip[]; suppressed: string[] };
export type TagSets = Record<Scenario, ScenarioTags>;

export type TemplateMap = Record<Scenario, string[]>;
export type ScenarioOverride = { add: string[]; remove: string[] };
export type OverrideMap = Record<Scenario, ScenarioOverride>;

/** True when a tag name is an auto-derived axis tag (never removable). */
export function isAxisTag(name: string): boolean {
  return Object.values(AXIS_PREFIXES).some((p) => name.startsWith(p));
}

/**
 * Axis tags for a funnel, one per non-empty axis. An empty axis emits nothing
 * (a bare "АВ Продукт: " would pollute the tags table).
 */
export function axisTagNames(axes: AbAxes): string[] {
  return (
    [
      ['product', axes.product],
      ['contractor', axes.contractor],
      ['channel', axes.channel],
      ['direction', axes.direction],
    ] as [keyof AbAxes, string][]
  )
    .filter(([, value]) => value.trim() !== '')
    .map(([axis, value]) => `${AXIS_PREFIXES[axis]}${value}`);
}

/**
 * Effective tag set per scenario from the three layers:
 *   default = template[scenario] ++ axisTagNames(axes)
 *   effective = (default − removed) ++ added
 * - Axis tags are NEVER suppressed (they carry channel/direction identity).
 * - Dedup by exact name; first occurrence wins (template/axis over add).
 * - `suppressed` lists template defaults currently removed (for the restore UI).
 */
export function computeTagSet(template: TemplateMap, axes: AbAxes, overrides: OverrideMap): TagSets {
  const axisTags = axisTagNames(axes);
  const out = {} as TagSets;

  for (const scenario of SCENARIOS) {
    const staticTags = template[scenario] ?? [];
    const ov = overrides[scenario] ?? { add: [], remove: [] };
    // Only non-axis removes count — axis tags are identity and never suppressed.
    const removeSet = new Set(ov.remove.filter((n) => !isAxisTag(n)));

    const tags: TagChip[] = [];
    const seen = new Set<string>();

    const pushIfNew = (name: string, source: TagChip['source']) => {
      if (seen.has(name)) return;
      seen.add(name);
      tags.push({ name, source });
    };

    for (const name of staticTags) {
      if (removeSet.has(name)) continue;
      pushIfNew(name, 'default');
    }
    for (const name of axisTags) pushIfNew(name, 'axis');
    for (const name of ov.add) pushIfNew(name, 'custom');

    const suppressed = staticTags.filter((n) => removeSet.has(n));
    out[scenario] = { tags, suppressed };
  }

  return out;
}

/**
 * Parse the 4 axis values back out of a tag-name list (typically the reg list).
 * Tags that don't match any axis prefix are ignored. Missing axis → ''.
 */
export function tagNamesToAxes(tagNames: string[]): AbAxes {
  const result: AbAxes = { product: '', contractor: '', channel: '', direction: '' };
  for (const name of tagNames) {
    for (const [axis, prefix] of Object.entries(AXIS_PREFIXES) as [keyof AbAxes, string][]) {
      if (name.startsWith(prefix)) {
        result[axis] = name.slice(prefix.length);
        break;
      }
    }
  }
  return result;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/ab-tags.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/ab-tags.ts app/tests/ab-tags.test.ts
git commit -m "feat(tags): computeTagSet layer model + axis-tag guards in ab-tags"
```

---

## Task 3: tag-templates.ts — global template read/write

**Files:**
- Create: `app/src/lib/tag-templates.ts`
- Test: `app/tests/tag-templates.test.ts`

**Interfaces:**
- Consumes: `TemplateMap`, `Scenario`, `SCENARIOS` from `ab-tags`; `tagTemplates` from schema.
- Produces:
  - `function listTemplate(db: AnyDB): TemplateMap`
  - `function replaceTemplateScenario(db: AnyDB, scenario: Scenario, names: string[]): void`

- [ ] **Step 1: Write the failing test**

```ts
// app/tests/tag-templates.test.ts
import { describe, it, expect, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { copyFileSync, unlinkSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import * as schema from '../src/db/schema';
import { runMigratePhase5 } from '../scripts/migrate-phase5';
import { listTemplate, replaceTemplateScenario } from '../src/lib/tag-templates';

const REAL_DB = join(__dirname, '../../ksamata_funnels.db');
const TMP_DB = join(tmpdir(), `tpl_${Date.now()}_${process.pid}.db`);
copyFileSync(REAL_DB, TMP_DB);
const sqlite = new Database(TMP_DB);
sqlite.pragma('foreign_keys = ON');
runMigratePhase5(sqlite);
const db = drizzle(sqlite, { schema });

afterAll(() => { sqlite.close(); if (existsSync(TMP_DB)) unlinkSync(TMP_DB); });

describe('tag-templates', () => {
  it('lists the seeded template grouped by scenario in order', () => {
    const t = listTemplate(db);
    expect(t.reg).toEqual(['автоворонки', 'АВ Автоворонка', 'АВ Этап: Регистрация']);
    expect(t.messenger).toEqual(['автоворонки', 'АВ Автоворонка', 'АВ Этап: Мессенджер']);
  });

  it('replaceTemplateScenario swaps the whole ordered list for one scenario', () => {
    replaceTemplateScenario(db, 'reg', ['автоворонки', 'АВ Этап: Регистрация', 'новый-дефолт']);
    const t = listTemplate(db);
    expect(t.reg).toEqual(['автоворонки', 'АВ Этап: Регистрация', 'новый-дефолт']);
    expect(t.messenger).toEqual(['автоворонки', 'АВ Автоворонка', 'АВ Этап: Мессенджер']); // untouched
  });

  it('replace with empty list clears the scenario', () => {
    replaceTemplateScenario(db, 'time_15', []);
    expect(listTemplate(db).time_15).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/tag-templates.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement tag-templates.ts**

```ts
// app/src/lib/tag-templates.ts
import { eq, asc } from 'drizzle-orm';
import { type AnyDB } from '../db/client';
import { tagTemplates } from '../db/schema';
import { SCENARIOS, type Scenario, type TemplateMap } from './ab-tags';

/** Whole global template grouped by scenario, ordered by position. */
export function listTemplate(db: AnyDB): TemplateMap {
  const rows = db
    .select({ scenario: tagTemplates.scenario, name: tagTemplates.name })
    .from(tagTemplates)
    .orderBy(asc(tagTemplates.scenario), asc(tagTemplates.position))
    .all() as { scenario: Scenario; name: string }[];

  const out = { reg: [], time_15: [], time_19: [], messenger: [] } as TemplateMap;
  for (const r of rows) out[r.scenario].push(r.name);
  return out;
}

/**
 * Replace the entire ordered list of static tags for one scenario.
 * Deletes existing rows for the scenario and re-inserts by array order.
 * Must be self-contained (wraps its own transaction).
 */
export function replaceTemplateScenario(db: AnyDB, scenario: Scenario, names: string[]): void {
  if (!SCENARIOS.includes(scenario)) throw new Error(`Invalid scenario "${scenario}"`);
  db.transaction((tx) => {
    tx.delete(tagTemplates).where(eq(tagTemplates.scenario, scenario)).run();
    names.forEach((name, position) => {
      tx.insert(tagTemplates).values({ scenario, name, position }).run();
    });
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/tag-templates.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/tag-templates.ts app/tests/tag-templates.test.ts
git commit -m "feat(tags): tag-templates lib — list + replace scenario"
```

---

## Task 4: tag-overrides.ts — per-funnel overrides read/write

**Files:**
- Create: `app/src/lib/tag-overrides.ts`
- Test: `app/tests/tag-overrides.test.ts`

**Interfaces:**
- Consumes: `OverrideMap`, `Scenario`, `SCENARIOS`, `isAxisTag` from `ab-tags`; `funnelTagOverrides` from schema.
- Produces:
  - `function listOverrides(db: AnyDB, funnelId: number): OverrideMap`
  - `function replaceOverrides(db: AnyDB, funnelId: number, overrides: OverrideMap): void` — self-contained tx; drops axis-tag removes defensively.

- [ ] **Step 1: Write the failing test**

```ts
// app/tests/tag-overrides.test.ts
import { describe, it, expect, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { copyFileSync, unlinkSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import * as schema from '../src/db/schema';
import { runMigratePhase5 } from '../scripts/migrate-phase5';
import { listOverrides, replaceOverrides } from '../src/lib/tag-overrides';
import type { OverrideMap } from '../src/lib/ab-tags';

const REAL_DB = join(__dirname, '../../ksamata_funnels.db');
const TMP_DB = join(tmpdir(), `ovr_${Date.now()}_${process.pid}.db`);
copyFileSync(REAL_DB, TMP_DB);
const sqlite = new Database(TMP_DB);
sqlite.pragma('foreign_keys = ON');
runMigratePhase5(sqlite);
const db = drizzle(sqlite, { schema });

// Any existing funnel id from the seeded DB.
const FID = (sqlite.prepare(`SELECT id FROM funnels LIMIT 1`).get() as { id: number }).id;

afterAll(() => { sqlite.close(); if (existsSync(TMP_DB)) unlinkSync(TMP_DB); });

const empty = (): OverrideMap => ({
  reg: { add: [], remove: [] },
  time_15: { add: [], remove: [] },
  time_19: { add: [], remove: [] },
  messenger: { add: [], remove: [] },
});

describe('tag-overrides', () => {
  it('round-trips add/remove per scenario', () => {
    const ov = empty();
    ov.reg.add = ['промо-январь'];
    ov.reg.remove = ['автоворонки'];
    ov.time_15.add = ['xmas'];
    replaceOverrides(db, FID, ov);

    const back = listOverrides(db, FID);
    expect(back.reg.add).toEqual(['промо-январь']);
    expect(back.reg.remove).toEqual(['автоворонки']);
    expect(back.time_15.add).toEqual(['xmas']);
    expect(back.messenger).toEqual({ add: [], remove: [] });
  });

  it('replace fully swaps previous overrides', () => {
    replaceOverrides(db, FID, empty());
    const back = listOverrides(db, FID);
    expect(back.reg).toEqual({ add: [], remove: [] });
  });

  it('drops axis-tag removes defensively', () => {
    const ov = empty();
    ov.reg.remove = ['АВ Продукт: ТКМ', 'автоворонки'];
    replaceOverrides(db, FID, ov);
    expect(listOverrides(db, FID).reg.remove).toEqual(['автоворонки']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/tag-overrides.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement tag-overrides.ts**

```ts
// app/src/lib/tag-overrides.ts
import { eq, asc } from 'drizzle-orm';
import { type AnyDB } from '../db/client';
import { funnelTagOverrides } from '../db/schema';
import { SCENARIOS, isAxisTag, type Scenario, type OverrideMap } from './ab-tags';

function emptyOverrideMap(): OverrideMap {
  return {
    reg: { add: [], remove: [] },
    time_15: { add: [], remove: [] },
    time_19: { add: [], remove: [] },
    messenger: { add: [], remove: [] },
  };
}

/** All overrides for a funnel, grouped by scenario, add/remove ordered by position. */
export function listOverrides(db: AnyDB, funnelId: number): OverrideMap {
  const rows = db
    .select({
      tagType: funnelTagOverrides.tagType,
      name: funnelTagOverrides.name,
      op: funnelTagOverrides.op,
    })
    .from(funnelTagOverrides)
    .where(eq(funnelTagOverrides.funnelId, funnelId))
    .orderBy(asc(funnelTagOverrides.tagType), asc(funnelTagOverrides.position))
    .all() as { tagType: Scenario; name: string; op: 'add' | 'remove' }[];

  const out = emptyOverrideMap();
  for (const r of rows) {
    if (r.op === 'add') out[r.tagType].add.push(r.name);
    else out[r.tagType].remove.push(r.name);
  }
  return out;
}

/**
 * Replace ALL overrides for a funnel. Axis-tag removes are dropped defensively
 * (axes are identity — suppressing them would corrupt getAxesForFunnel).
 * Self-contained transaction.
 */
export function replaceOverrides(db: AnyDB, funnelId: number, overrides: OverrideMap): void {
  db.transaction((tx) => {
    tx.delete(funnelTagOverrides).where(eq(funnelTagOverrides.funnelId, funnelId)).run();
    for (const scenario of SCENARIOS) {
      const ov = overrides[scenario] ?? { add: [], remove: [] };
      ov.add.forEach((name, position) => {
        tx.insert(funnelTagOverrides)
          .values({ funnelId, tagType: scenario, name, op: 'add', position })
          .onConflictDoNothing()
          .run();
      });
      ov.remove
        .filter((name) => !isAxisTag(name))
        .forEach((name, position) => {
          tx.insert(funnelTagOverrides)
            .values({ funnelId, tagType: scenario, name, op: 'remove', position })
            .onConflictDoNothing()
            .run();
        });
    }
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/tag-overrides.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/tag-overrides.ts app/tests/tag-overrides.test.ts
git commit -m "feat(tags): tag-overrides lib — list + replace per funnel"
```

---

## Task 5: funnels.ts — materialize from layers + tagSets on read (Variant A)

Swap `syncAvTags` for `materializeFunnelTags` (reads template + overrides, rewrites all `funnel_tags`), add `resyncAllFunnels`, expose `tagSets` from `getFunnel`, and copy overrides on duplicate. This is where existing funnel tests need Phase-5 seeded.

**Files:**
- Modify: `app/src/lib/funnels.ts`
- Test: `app/tests/materialize-tags.test.ts` (new — materialize + Variant A)
- Modify (test setups — add `runMigratePhase5(sqlite)` right after the existing `runMigrateMessengerTagType(sqlite)` line): `app/tests/api-funnels.test.ts`, `app/tests/api-funnels-route.test.ts`, `app/tests/export.test.ts`, `app/tests/backfill.test.ts`, `app/tests/backfill-messenger-tags.test.ts`

**Interfaces:**
- Consumes: `computeTagSet`, `axisTagNames`, `SCENARIOS`, `Scenario`, `TagSets` from `ab-tags`; `listTemplate` from `tag-templates`; `listOverrides` from `tag-overrides`; `createRef` from `refs`.
- Produces:
  - `function materializeFunnelTags(db: AnyDB, funnelId: number, axes: AbAxes): void` (inside a tx)
  - `function resyncAllFunnels(db: DB): void`
  - `FunnelDetail` gains `tagSets: TagSets`
  - `getFunnel` returns `tagSets`
  - `resyncFunnelAvTags(db, id)` re-materializes (unchanged signature)

- [ ] **Step 1: Write the failing test (materialize + Variant A)**

```ts
// app/tests/materialize-tags.test.ts
import { describe, it, expect, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { copyFileSync, unlinkSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import * as schema from '../src/db/schema';
import { runMigratePhase3 } from '../scripts/migrate-phase3';
import { runMigrateMessengerTagType } from '../scripts/migrate-messenger-tagtype';
import { runMigratePhase5 } from '../scripts/migrate-phase5';
import { createFunnel, updateFunnel, getFunnel } from '../src/lib/funnels';
import { replaceOverrides } from '../src/lib/tag-overrides';
import type { OverrideMap } from '../src/lib/ab-tags';

const REAL_DB = join(__dirname, '../../ksamata_funnels.db');
const TMP_DB = join(tmpdir(), `mat_${Date.now()}_${process.pid}.db`);
copyFileSync(REAL_DB, TMP_DB);
const sqlite = new Database(TMP_DB);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');
runMigratePhase3(sqlite);
runMigrateMessengerTagType(sqlite);
runMigratePhase5(sqlite);
const db = drizzle(sqlite, { schema });

afterAll(() => { sqlite.close(); if (existsSync(TMP_DB)) unlinkSync(TMP_DB); });

const nextNum = () => (sqlite.prepare(`SELECT COALESCE(MAX(num),0)+1 AS n FROM funnels`).get() as { n: number }).n;

function makeFunnel(product: string) {
  return createFunnel(db, {
    num: nextNum(), frontCode: '', status: 'active', productName: '', variant: '',
    landingUrl: '', startDate: '', blockName: '',
    product, contractor: 'НИМБ', channel: 'Яндекс', direction: 'РСЯ',
  } as any);
}

describe('materialize on create', () => {
  it('reg tagSet = template defaults + axis tags', () => {
    const f = makeFunnel('СУСТАВЫ');
    const d = getFunnel(db, f.id)!;
    const names = d.tagSets.reg.tags.map((t) => t.name);
    expect(names).toContain('автоворонки');
    expect(names).toContain('АВ Этап: Регистрация');
    expect(names).toContain('АВ Продукт: СУСТАВЫ');
  });
});

describe('Variant A — overrides survive an axis change', () => {
  it('keeps added, keeps removed, updates axis tag', () => {
    const f = makeFunnel('СУСТАВЫ');

    // User adds a custom tag and removes a default, then re-materialize.
    const ov: OverrideMap = {
      reg: { add: ['промо-январь'], remove: ['автоворонки'] },
      time_15: { add: [], remove: [] },
      time_19: { add: [], remove: [] },
      messenger: { add: [], remove: [] },
    };
    replaceOverrides(db, f.id, ov);
    updateFunnel(db, f.id, { product: 'СУСТАВЫ' } as any); // re-materialize, axis unchanged

    let names = getFunnel(db, f.id)!.tagSets.reg.tags.map((t) => t.name);
    expect(names).toContain('промо-январь');
    expect(names).not.toContain('автоворонки');
    expect(names).toContain('АВ Продукт: СУСТАВЫ');

    // Change the product axis — overrides must persist, axis tag must update.
    updateFunnel(db, f.id, { product: 'ЖКТ' } as any);
    names = getFunnel(db, f.id)!.tagSets.reg.tags.map((t) => t.name);
    expect(names).toContain('промо-январь');       // added survives
    expect(names).not.toContain('автоворонки');     // removed stays removed
    expect(names).toContain('АВ Продукт: ЖКТ');      // axis updated
    expect(names).not.toContain('АВ Продукт: СУСТАВЫ');
    expect(getFunnel(db, f.id)!.tagSets.reg.suppressed).toContain('автоворонки');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/materialize-tags.test.ts`
Expected: FAIL — `getFunnel(...).tagSets` is undefined / `materializeFunnelTags` not present.

- [ ] **Step 3: Update funnels.ts imports**

In `app/src/lib/funnels.ts`, replace the `ab-tags` import and add the two lib imports:

```ts
import {
  type AbAxes,
  type TagSets,
  type Scenario,
  SCENARIOS,
  computeTagSet,
  tagNamesToAxes,
} from './ab-tags';
import { listTemplate } from './tag-templates';
import { listOverrides } from './tag-overrides';
```

Also add `funnelTagOverrides` to the `../db/schema` import list (used by copy):

```ts
import {
  funnels,
  funnelTags,
  funnelTagOverrides,
  funnelDays,
  funnelBlocks,
  funnelBlockItems,
  salebotConfigs,
  tags,
  type Funnel,
} from '../db/schema';
```

- [ ] **Step 4: Replace `syncAvTags` with `materializeFunnelTags`**

Delete the entire `syncAvTags` function (lines defining it) and insert:

```ts
/**
 * Rebuild a funnel's materialized tags in `funnel_tags` from the three layers:
 * global template + axis tags + per-funnel overrides (see computeTagSet).
 * Wipes ALL funnel_tags for the funnel and rewrites — the effective set is
 * self-contained. Axes MUST be passed by the caller, read BEFORE any rewrite
 * (channel/direction live only in these tags).
 * Must be called INSIDE a transaction.
 */
function materializeFunnelTags(db: AnyDB, funnelId: number, axes: AbAxes): void {
  const template = listTemplate(db);
  const overrides = listOverrides(db, funnelId);
  const sets: TagSets = computeTagSet(template, axes, overrides);

  db.delete(funnelTags).where(eq(funnelTags.funnelId, funnelId)).run();

  for (const scenario of SCENARIOS) {
    sets[scenario].tags.forEach((chip, position) => {
      const tagRow = createRef(db, 'tags', chip.name);
      db.insert(funnelTags)
        .values({ funnelId, tagId: tagRow.id, tagType: scenario as Scenario, position })
        .onConflictDoNothing()
        .run();
    });
  }
}
```

- [ ] **Step 5: Point every `syncAvTags` caller at `materializeFunnelTags`**

Replace the three call sites (`createFunnel`, `updateFunnel`, `duplicateFunnel`) — the signature is identical `(tx, id, axes)`:

- In `createFunnel`: `syncAvTags(tx, inserted.id, axes);` → `materializeFunnelTags(tx, inserted.id, axes);`
- In `updateFunnel`: `syncAvTags(tx, id, axes);` → `materializeFunnelTags(tx, id, axes);`
- In `duplicateFunnel`: `syncAvTags(tx, inserted.id, sourceAxes);` → `materializeFunnelTags(tx, inserted.id, sourceAxes);`
- In `resyncFunnelAvTags`: `syncAvTags(tx, id, axes);` → `materializeFunnelTags(tx, id, axes);`

- [ ] **Step 6: Add `resyncAllFunnels`**

Insert after `resyncFunnelAvTags`:

```ts
/**
 * Re-materialize every funnel's tags. Used after a global template change so
 * new defaults propagate everywhere; per-funnel overrides are preserved
 * (they are read fresh inside materializeFunnelTags). Cheap at this DB's scale.
 */
export function resyncAllFunnels(db: DB): void {
  const rows = db.select({ id: funnels.id }).from(funnels).all() as { id: number }[];
  db.transaction((tx) => {
    for (const { id } of rows) {
      const axes = getAxesForFunnel(tx, id);
      materializeFunnelTags(tx, id, axes);
    }
  });
}
```

- [ ] **Step 7: Add `tagSets` to `FunnelDetail` and `getFunnel`**

In the `FunnelDetail` type, add:

```ts
  tagSets: TagSets;
```

In `getFunnel`, before the `return {`, compute the sets from current axes + overrides:

```ts
  const template = listTemplate(db);
  const overrides = listOverrides(db, row.id);
  const tagSets = computeTagSet(template, axes, overrides);
```

and add `tagSets,` to the returned object.

- [ ] **Step 8: Replace legacy-tag copy in `copyFunnelChildren` with override copy**

In `copyFunnelChildren`, delete the "Legacy non-AV funnel_tags" block (the `legacyTags` select + loop) and replace with:

```ts
  // Copy per-funnel tag overrides so a duplicate keeps the source's custom
  // additions and removed defaults (AV tags themselves are re-materialized
  // from the copied axes by the caller).
  const overrideRows = tx
    .select({
      tagType: funnelTagOverrides.tagType,
      name: funnelTagOverrides.name,
      op: funnelTagOverrides.op,
      position: funnelTagOverrides.position,
    })
    .from(funnelTagOverrides)
    .where(eq(funnelTagOverrides.funnelId, srcId))
    .all() as { tagType: 'reg' | 'time_15' | 'time_19' | 'messenger'; name: string; op: 'add' | 'remove'; position: number }[];
  for (const o of overrideRows) {
    tx.insert(funnelTagOverrides)
      .values({ funnelId: dstId, tagType: o.tagType, name: o.name, op: o.op, position: o.position })
      .onConflictDoNothing()
      .run();
  }
```

Note: in `duplicateFunnel`, `copyFunnelChildren` currently runs AFTER `syncAvTags`. Move the `materializeFunnelTags(tx, inserted.id, sourceAxes);` call to run AFTER `copyFunnelChildren(tx, id, inserted.id);` so the copied overrides are applied. (Swap the two lines.)

Now the unused imports `like`, `notLike` may remain used elsewhere — leave `and`, `like` if still referenced (`syncAvTags` used `like`; if nothing else uses `like`/`notLike`, remove them from the drizzle import to satisfy lint). Run lint in Step 11.

- [ ] **Step 9: Seed Phase-5 in affected test setups**

In each of these files, add the line `runMigratePhase5(sqlite);` immediately after the existing `runMigrateMessengerTagType(sqlite);` line, and add the import `import { runMigratePhase5 } from '../scripts/migrate-phase5';` near the other migration imports:

- `app/tests/api-funnels.test.ts`
- `app/tests/api-funnels-route.test.ts`
- `app/tests/export.test.ts`
- `app/tests/backfill.test.ts`
- `app/tests/backfill-messenger-tags.test.ts`

(If any of these does not call `runMigrateMessengerTagType`, add `runMigratePhase5(sqlite);` right after its last `runMigratePhaseN(...)` setup line instead.)

- [ ] **Step 10: Run the new + affected tests**

Run: `npx vitest run tests/materialize-tags.test.ts tests/api-funnels.test.ts tests/export.test.ts tests/backfill.test.ts tests/backfill-messenger-tags.test.ts`
Expected: PASS.

- [ ] **Step 11: Lint + full suite**

Run: `npm run lint && npx vitest run`
Expected: lint clean (remove any now-unused `like`/`notLike` imports if flagged), all tests PASS.

- [ ] **Step 12: Commit**

```bash
git add app/src/lib/funnels.ts app/tests/materialize-tags.test.ts app/tests/api-funnels.test.ts app/tests/api-funnels-route.test.ts app/tests/export.test.ts app/tests/backfill.test.ts app/tests/backfill-messenger-tags.test.ts
git commit -m "feat(tags): materialize funnel_tags from layers, tagSets on read, Variant A"
```

---

## Task 6: Validation schemas

**Files:**
- Modify: `app/src/lib/validation.ts`
- Test: `app/tests/validation.test.ts` (append cases)

**Interfaces:**
- Produces:
  - `tagTemplatePutSchema` → `{ names: string[] }` (each trimmed 1..120)
  - `tagsPatchSchema` → `Record<Scenario, { add: string[]; remove: string[] }>` (all four scenarios optional; strings trimmed 1..120)
  - types `TagTemplatePut`, `TagsPatch`

- [ ] **Step 1: Write the failing test (append to validation.test.ts)**

```ts
import { tagTemplatePutSchema, tagsPatchSchema } from '../src/lib/validation';

describe('tagTemplatePutSchema', () => {
  it('accepts a list of trimmed names', () => {
    const r = tagTemplatePutSchema.safeParse({ names: ['автоворонки', 'АВ Этап: Регистрация'] });
    expect(r.success).toBe(true);
  });
  it('rejects empty and over-long names', () => {
    expect(tagTemplatePutSchema.safeParse({ names: [''] }).success).toBe(false);
    expect(tagTemplatePutSchema.safeParse({ names: ['x'.repeat(121)] }).success).toBe(false);
  });
});

describe('tagsPatchSchema', () => {
  it('accepts a partial per-scenario add/remove map', () => {
    const r = tagsPatchSchema.safeParse({ reg: { add: ['промо'], remove: ['автоворонки'] } });
    expect(r.success).toBe(true);
  });
  it('rejects unknown scenario keys', () => {
    expect(tagsPatchSchema.safeParse({ nope: { add: [], remove: [] } }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/validation.test.ts`
Expected: FAIL — schemas not exported.

- [ ] **Step 3: Add schemas to validation.ts**

Append to `app/src/lib/validation.ts`:

```ts
const tagNameSchema = z.string().trim().min(1).max(REF_MAX);

export const tagTemplatePutSchema = z.object({
  names: z.array(tagNameSchema),
});

const scenarioOverrideSchema = z.object({
  add: z.array(tagNameSchema).default([]),
  remove: z.array(tagNameSchema).default([]),
});

// All four scenarios optional; unknown keys rejected (strict).
export const tagsPatchSchema = z
  .object({
    reg: scenarioOverrideSchema.optional(),
    time_15: scenarioOverrideSchema.optional(),
    time_19: scenarioOverrideSchema.optional(),
    messenger: scenarioOverrideSchema.optional(),
  })
  .strict();

export type TagTemplatePut = z.infer<typeof tagTemplatePutSchema>;
export type TagsPatch = z.infer<typeof tagsPatchSchema>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/validation.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/validation.ts app/tests/validation.test.ts
git commit -m "feat(tags): zod schemas for template PUT and tags PATCH"
```

---

## Task 7: API — global template GET + PUT

**Files:**
- Create: `app/src/app/api/tag-templates/route.ts`
- Create: `app/src/app/api/tag-templates/[scenario]/route.ts`
- Test: `app/tests/api-tag-templates-route.test.ts`

**Interfaces:**
- Consumes: `listTemplate`, `replaceTemplateScenario`, `resyncAllFunnels`, `tagTemplatePutSchema`, `SCENARIOS`, `internalError`.
- Produces: `GET /api/tag-templates` → `TemplateMap`; `PUT /api/tag-templates/[scenario]` → `{ ok: true, names: string[] }`.

- [ ] **Step 1: Write the failing test**

```ts
// app/tests/api-tag-templates-route.test.ts
import { describe, it, expect, afterAll, vi } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { copyFileSync, unlinkSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import * as schema from '../src/db/schema';
import { runMigratePhase3 } from '../scripts/migrate-phase3';
import { runMigrateMessengerTagType } from '../scripts/migrate-messenger-tagtype';
import { runMigratePhase5 } from '../scripts/migrate-phase5';

const REAL_DB = join(__dirname, '../../ksamata_funnels.db');
const TMP_DB = join(tmpdir(), `apitpl_${Date.now()}_${process.pid}.db`);
copyFileSync(REAL_DB, TMP_DB);
const sqlite = new Database(TMP_DB);
sqlite.pragma('foreign_keys = ON');
runMigratePhase3(sqlite);
runMigrateMessengerTagType(sqlite);
runMigratePhase5(sqlite);
const testDb = drizzle(sqlite, { schema });

vi.mock('@/db/client', () => ({ db: testDb, get AnyDB() { return undefined; } }));

afterAll(() => { sqlite.close(); if (existsSync(TMP_DB)) unlinkSync(TMP_DB); });

// Import routes AFTER the mock is registered.
const { GET } = await import('../src/app/api/tag-templates/route');
const { PUT } = await import('../src/app/api/tag-templates/[scenario]/route');

describe('GET /api/tag-templates', () => {
  it('returns the template grouped by scenario', async () => {
    const res = await GET();
    const body = await res.json();
    expect(body.reg).toContain('автоворонки');
    expect(body.messenger).toContain('АВ Этап: Мессенджер');
  });
});

describe('PUT /api/tag-templates/[scenario]', () => {
  it('replaces a scenario and 200s', async () => {
    const req = new Request('http://x', { method: 'PUT', body: JSON.stringify({ names: ['автоворонки', 'новый'] }) });
    const res = await PUT(req as any, { params: Promise.resolve({ scenario: 'reg' }) });
    expect(res.status).toBe(200);
    const after = await (await GET()).json();
    expect(after.reg).toEqual(['автоворонки', 'новый']);
  });

  it('rejects an invalid scenario with 400', async () => {
    const req = new Request('http://x', { method: 'PUT', body: JSON.stringify({ names: [] }) });
    const res = await PUT(req as any, { params: Promise.resolve({ scenario: 'nope' }) });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/api-tag-templates-route.test.ts`
Expected: FAIL — route modules not found.

- [ ] **Step 3: Implement GET route**

```ts
// app/src/app/api/tag-templates/route.ts
import { NextResponse } from 'next/server';
import { db } from '@/db/client';
import { listTemplate } from '@/lib/tag-templates';
import { internalError } from '@/lib/http';

export async function GET() {
  try {
    return NextResponse.json(listTemplate(db));
  } catch (err: unknown) {
    return internalError('GET /api/tag-templates', err);
  }
}
```

- [ ] **Step 4: Implement PUT route**

```ts
// app/src/app/api/tag-templates/[scenario]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db/client';
import { SCENARIOS, type Scenario } from '@/lib/ab-tags';
import { tagTemplatePutSchema } from '@/lib/validation';
import { replaceTemplateScenario } from '@/lib/tag-templates';
import { resyncAllFunnels } from '@/lib/funnels';
import { internalError } from '@/lib/http';

type Params = { params: Promise<{ scenario: string }> };

export async function PUT(req: NextRequest, { params }: Params) {
  const { scenario } = await params;
  if (!SCENARIOS.includes(scenario as Scenario)) {
    return NextResponse.json(
      { error: `Invalid scenario "${scenario}". Must be one of: ${SCENARIOS.join(', ')}.` },
      { status: 400 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = tagTemplatePutSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', issues: parsed.error.issues }, { status: 400 });
  }

  try {
    replaceTemplateScenario(db, scenario as Scenario, parsed.data.names);
    resyncAllFunnels(db); // propagate the new defaults to every funnel (overrides preserved)
    return NextResponse.json({ ok: true, names: parsed.data.names });
  } catch (err: unknown) {
    return internalError('PUT /api/tag-templates/[scenario]', err);
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/api-tag-templates-route.test.ts`
Expected: PASS. (If the `vi.mock('@/db/client')` alias does not resolve in the test, mirror the exact mock style already used in `tests/api-funnels-route.test.ts` — open it and copy its mock setup verbatim.)

- [ ] **Step 6: Commit**

```bash
git add app/src/app/api/tag-templates app/tests/api-tag-templates-route.test.ts
git commit -m "feat(tags): API — GET template + PUT scenario with resync-all"
```

---

## Task 8: API — per-funnel tags PATCH

**Files:**
- Create: `app/src/app/api/funnels/[id]/tags/route.ts`
- Test: `app/tests/api-funnels-tags-route.test.ts`

**Interfaces:**
- Consumes: `parseRouteId`, `tagsPatchSchema`, `replaceOverrides`, `getFunnel`, `getAxesForFunnel`(internal — use exported path), `materializeFunnelTags`(internal). To keep the route thin, add one exported wrapper in `funnels.ts`.
- Produces:
  - New exported `applyTagOverrides(db: DB, id: number, patch: OverrideMap): FunnelDetail | null` in `funnels.ts`.
  - `PATCH /api/funnels/[id]/tags` → updated `FunnelDetail` (incl. `tagSets`) or 404.

- [ ] **Step 1: Write the failing test**

```ts
// app/tests/api-funnels-tags-route.test.ts
import { describe, it, expect, afterAll, vi } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { copyFileSync, unlinkSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import * as schema from '../src/db/schema';
import { runMigratePhase3 } from '../scripts/migrate-phase3';
import { runMigrateMessengerTagType } from '../scripts/migrate-messenger-tagtype';
import { runMigratePhase5 } from '../scripts/migrate-phase5';

const REAL_DB = join(__dirname, '../../ksamata_funnels.db');
const TMP_DB = join(tmpdir(), `apitags_${Date.now()}_${process.pid}.db`);
copyFileSync(REAL_DB, TMP_DB);
const sqlite = new Database(TMP_DB);
sqlite.pragma('foreign_keys = ON');
runMigratePhase3(sqlite);
runMigrateMessengerTagType(sqlite);
runMigratePhase5(sqlite);
const testDb = drizzle(sqlite, { schema });
vi.mock('@/db/client', () => ({ db: testDb }));

const FID = (sqlite.prepare(`SELECT id FROM funnels LIMIT 1`).get() as { id: number }).id;

afterAll(() => { sqlite.close(); if (existsSync(TMP_DB)) unlinkSync(TMP_DB); });

const { PATCH } = await import('../src/app/api/funnels/[id]/tags/route');

describe('PATCH /api/funnels/[id]/tags', () => {
  it('adds a custom tag and removes a default, reflected in tagSets', async () => {
    const req = new Request('http://x', {
      method: 'PATCH',
      body: JSON.stringify({ reg: { add: ['промо-тест'], remove: ['автоворонки'] } }),
    });
    const res = await PATCH(req as any, { params: Promise.resolve({ id: String(FID) }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    const names = body.tagSets.reg.tags.map((t: { name: string }) => t.name);
    expect(names).toContain('промо-тест');
    expect(names).not.toContain('автоворонки');
    expect(body.tagSets.reg.suppressed).toContain('автоворонки');
  });

  it('404 for a missing funnel', async () => {
    const req = new Request('http://x', { method: 'PATCH', body: JSON.stringify({}) });
    const res = await PATCH(req as any, { params: Promise.resolve({ id: '99999999' }) });
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/api-funnels-tags-route.test.ts`
Expected: FAIL — route not found.

- [ ] **Step 3: Add `applyTagOverrides` to funnels.ts**

Add the import at the top of `funnels.ts`:

```ts
import { type OverrideMap } from './ab-tags';
import { replaceOverrides } from './tag-overrides';
```

Insert after `resyncFunnelAvTags`:

```ts
/**
 * Replace a funnel's tag overrides and re-materialize its funnel_tags.
 * Axes are read from current reg tags FIRST (channel/direction live there),
 * then tags are rewritten. Returns the updated FunnelDetail, or null if absent.
 */
export function applyTagOverrides(db: DB, id: number, patch: OverrideMap): FunnelDetail | null {
  const existing = db.select({ id: funnels.id }).from(funnels).where(eq(funnels.id, id)).get();
  if (!existing) return null;
  db.transaction((tx) => {
    const axes = getAxesForFunnel(tx, id);
    replaceOverrides(tx, id, patch);
    materializeFunnelTags(tx, id, axes);
  });
  return getFunnel(db, id);
}
```

- [ ] **Step 4: Implement the PATCH route**

```ts
// app/src/app/api/funnels/[id]/tags/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db/client';
import { parseRouteId, tagsPatchSchema } from '@/lib/validation';
import { applyTagOverrides } from '@/lib/funnels';
import { internalError } from '@/lib/http';
import { SCENARIOS, type OverrideMap } from '@/lib/ab-tags';

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const funnelId = parseRouteId(id);
  if (funnelId === null) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = tagsPatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', issues: parsed.error.issues }, { status: 400 });
  }

  // Normalize the partial patch into a full OverrideMap (missing scenarios cleared).
  const patch = {} as OverrideMap;
  for (const s of SCENARIOS) {
    patch[s] = { add: parsed.data[s]?.add ?? [], remove: parsed.data[s]?.remove ?? [] };
  }

  try {
    const updated = applyTagOverrides(db, funnelId, patch);
    if (!updated) return NextResponse.json({ error: 'Funnel not found' }, { status: 404 });
    return NextResponse.json(updated);
  } catch (err: unknown) {
    return internalError('PATCH /api/funnels/[id]/tags', err);
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/api-funnels-tags-route.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/src/app/api/funnels/\[id\]/tags app/src/lib/funnels.ts app/tests/api-funnels-tags-route.test.ts
git commit -m "feat(tags): API — PATCH per-funnel tag overrides (full-replace semantics)"
```

---

## Task 9: FunnelIdentity — editable tags block

Replace the read-only AV-tags block with an editable one driven by `funnel.tagSets`: per-scenario chips with `×` (except axis chips), an add input, faint restore row for suppressed defaults, and its own "Сохранить теги" save via `PATCH /api/funnels/[id]/tags`.

**Files:**
- Modify: `app/src/components/FunnelIdentity.tsx`

**Interfaces:**
- Consumes: `funnel.tagSets: TagSets` (from `FunnelDetail`), `PATCH /api/funnels/[id]/tags`, `copyText`, `Segmented`.

- [ ] **Step 1: Add tag-edit state + scenario mapping**

At the top of the component body (after the existing scenario/timeSlot state), add editable-tags state seeded from `funnel.tagSets`. The UI scenario tabs map to a `Scenario`:

```tsx
// Map the visible tab (+ pay timeSlot) to the canonical Scenario key.
const activeScenario: 'reg' | 'time_15' | 'time_19' | 'messenger' =
  scenario === 'reg' ? 'reg'
    : scenario === 'messenger' ? 'messenger'
      : timeSlot === '15' ? 'time_15' : 'time_19';

// Working copy of overrides, keyed by scenario. Seeded from the server tagSets:
// custom chips → add[]; suppressed defaults → remove[].
type Ov = { add: string[]; remove: string[] };
const seedOverrides = (): Record<'reg'|'time_15'|'time_19'|'messenger', Ov> => {
  const out = { reg: { add: [], remove: [] }, time_15: { add: [], remove: [] },
    time_19: { add: [], remove: [] }, messenger: { add: [], remove: [] } } as Record<'reg'|'time_15'|'time_19'|'messenger', Ov>;
  (['reg','time_15','time_19','messenger'] as const).forEach((s) => {
    out[s].add = funnel.tagSets[s].tags.filter((t) => t.source === 'custom').map((t) => t.name);
    out[s].remove = [...funnel.tagSets[s].suppressed];
  });
  return out;
};
const [ov, setOv] = useState(seedOverrides);
const [savedOv, setSavedOv] = useState(seedOverrides);
const [tagInput, setTagInput] = useState('');
const [savingTags, setSavingTags] = useState(false);
const [tagsError, setTagsError] = useState<string | null>(null);

const tagsDirty = JSON.stringify(ov) !== JSON.stringify(savedOv);
```

- [ ] **Step 2: Derive the visible chip list from server defaults + working overrides**

Replace the old `axesToTagNames`/`currentTags` computation with a derivation from `funnel.tagSets` (the server's default set) plus the working `ov`:

```tsx
// Server-provided effective set already encodes template + axes. To reflect
// live edits without a round-trip, re-derive: start from server tags of this
// scenario, drop those in ov.remove, and append ov.add customs not already shown.
const serverSet = funnel.tagSets[activeScenario];
const removeSet = new Set(ov[activeScenario].remove);
const shown = serverSet.tags
  .filter((t) => !(t.source !== 'axis' && removeSet.has(t.name)))
  .filter((t) => t.source !== 'custom'); // customs come from ov.add below
const shownNames = new Set(shown.map((t) => t.name));
const customChips = ov[activeScenario].add
  .filter((n) => !shownNames.has(n))
  .map((n) => ({ name: n, source: 'custom' as const }));
const visibleChips = [...shown, ...customChips];

// Suppressed defaults available to restore = server suppressed ∪ ov.remove (non-axis),
// minus any the user re-added. Server 'default' names currently in removeSet.
const suppressedNames = Array.from(new Set([...serverSet.suppressed, ...ov[activeScenario].remove]))
  .filter((n) => removeSet.has(n));

const currentTags = visibleChips.map((c) => c.name); // for copy-all / copy-tag
```

- [ ] **Step 3: Add edit handlers**

```tsx
function removeTag(name: string, source: 'axis' | 'default' | 'custom') {
  if (source === 'axis') return; // axis tags are identity — not removable
  setOv((prev) => {
    const next = { ...prev, [activeScenario]: { ...prev[activeScenario] } };
    if (source === 'custom') {
      next[activeScenario].add = prev[activeScenario].add.filter((n) => n !== name);
    } else {
      next[activeScenario].remove = [...new Set([...prev[activeScenario].remove, name])];
    }
    return next;
  });
}
function restoreTag(name: string) {
  setOv((prev) => ({
    ...prev,
    [activeScenario]: { ...prev[activeScenario], remove: prev[activeScenario].remove.filter((n) => n !== name) },
  }));
}
function addTag() {
  const name = tagInput.trim();
  if (!name) return;
  setOv((prev) => {
    const s = prev[activeScenario];
    // Re-adding a suppressed default = restore; a brand-new name = custom add.
    if (s.remove.includes(name)) {
      return { ...prev, [activeScenario]: { ...s, remove: s.remove.filter((n) => n !== name) } };
    }
    if (currentTags.includes(name) || s.add.includes(name)) return prev; // no dup
    return { ...prev, [activeScenario]: { ...s, add: [...s.add, name] } };
  });
  setTagInput('');
}

async function saveTags() {
  setSavingTags(true);
  setTagsError(null);
  try {
    const res = await fetch(`/api/funnels/${funnel.id}/tags`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ov),
    });
    if (!res.ok) {
      const b = await res.json().catch(() => null);
      throw new Error(b?.error ?? `Не удалось сохранить теги (${res.status})`);
    }
    setSavedOv(ov);
  } catch (e) {
    setTagsError(e instanceof Error ? e.message : 'Не удалось сохранить теги');
  } finally {
    setSavingTags(false);
  }
}
```

- [ ] **Step 4: Fold tag-dirty into the component dirty signal**

Extend the effect that reports dirtiness so the unsaved-guard also covers tag edits:

```tsx
useEffect(() => { onDirtyChangeRef.current?.(dirty || tagsDirty); }, [dirty, tagsDirty]);
```

- [ ] **Step 5: Render the editable chips, add-input, restore row, and save button**

Replace the chips container (`<div className="flex flex-wrap gap-1.5">…</div>` and the trailing hint) with:

```tsx
<div className="flex flex-wrap items-center gap-1.5">
  {visibleChips.map((chip) => {
    const flash = copyFlash?.marker === chip.name ? copyFlash : null;
    const removable = chip.source !== 'axis';
    return (
      <span key={chip.name}
        className={`inline-flex items-center gap-1 rounded-full px-2 py-[3px] text-[10px] transition ${
          flash
            ? flash.ok ? 'bg-[#DFF3E7] text-[#087443]' : 'bg-[#FEF3F2] text-[#B42318]'
            : chip.source === 'custom'
              ? 'bg-[#EAF1FB] text-[#1B4F9C]'
              : 'bg-[var(--chip)] text-[var(--muted)]'
        }`}>
        <button type="button" onClick={() => copyTag(chip.name)} title="Клик — скопировать тег" className="inline-flex items-center gap-1">
          {flash && (flash.ok ? <Check size={10} /> : <AlertCircle size={10} />)}
          {chip.name}
        </button>
        {removable && (
          <button type="button" aria-label={`Убрать ${chip.name}`} onClick={() => removeTag(chip.name, chip.source)}
            className="ml-0.5 text-[var(--faint)] hover:text-[#B42318]">
            <X size={10} />
          </button>
        )}
      </span>
    );
  })}
  <span className="inline-flex items-center gap-1">
    <input value={tagInput} onChange={(e) => setTagInput(e.target.value)}
      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } }}
      placeholder="+ тег" aria-label="Добавить тег"
      className="h-[22px] w-[92px] rounded-full border border-dashed border-[var(--line)] bg-white px-2 text-[10px] text-[var(--ink)]" />
  </span>
</div>

{suppressedNames.length > 0 && (
  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
    <span className="text-[10px] text-[var(--faint)]">Скрытые дефолты:</span>
    {suppressedNames.map((name) => (
      <button key={name} type="button" onClick={() => restoreTag(name)} title="Клик — вернуть тег"
        className="inline-flex items-center gap-1 rounded-full bg-transparent px-2 py-[3px] text-[10px] text-[var(--faint)] line-through hover:text-[var(--ink)] hover:no-underline">
        <RotateCcw size={10} /> {name}
      </button>
    ))}
  </div>
)}

<div className="mt-2 flex items-center gap-2">
  <span className="text-[10px] text-[var(--faint)]">Клик по тегу — скопировать · × — убрать</span>
  <span className="ml-auto flex items-center gap-2">
    {tagsDirty && (
      <span className="inline-flex items-center gap-1 text-[10px] text-[var(--orange)]">
        <span className="h-1.5 w-1.5 rounded-full bg-[var(--orange)]" /> теги изменены
      </span>
    )}
    <button type="button" onClick={saveTags} disabled={savingTags || !tagsDirty}
      className="rounded-[8px] border border-[var(--line)] bg-white px-3 py-1 text-[11px] font-semibold text-[var(--ink)] disabled:opacity-50">
      {savingTags ? 'Сохранение…' : 'Сохранить теги'}
    </button>
  </span>
</div>
{tagsError && <div role="alert" className="mt-1 text-right text-[11px] font-medium text-[#B42318]">{tagsError}</div>}
```

Update the icon import at the top of the file:

```tsx
import { Wand2, Copy, Check, AlertCircle, X, RotateCcw } from 'lucide-react';
```

Remove the now-unused `import { axesToTagNames } from '@/lib/ab-tags';` line.

- [ ] **Step 6: Add a hint when axes are unsaved**

The default set depends on saved axes. Directly under the scenario `Segmented` row, add:

```tsx
{dirty && (
  <div className="mb-2 text-[10px] text-[var(--orange)]">
    Набор дефолтных тегов обновится после «Сохранить идентификацию».
  </div>
)}
```

- [ ] **Step 7: Remove the now-orphaned `axesToTagNames`**

After this task, `FunnelIdentity.tsx` was the last caller of the legacy `axesToTagNames` (Task 5 already migrated `funnels.ts`). Delete it now:
- In `app/src/lib/ab-tags.ts`, delete the `axesToTagNames` function (kept transitionally in Task 2). Leave everything else (`AbAxes`, `AXIS_PREFIXES`, `isAxisTag`, `axisTagNames`, `computeTagSet`, `tagNamesToAxes`, all types) untouched.
- Confirm nothing else imports it: `grep -rn "axesToTagNames" app/src app/tests` must return no hits (the Task 2 test replacement already dropped its unit tests). If any hit remains, STOP and report it — do not edit unrelated files blindly.

- [ ] **Step 8: Verify in the browser**

Start the dev server and check the funnel card renders, chips have `×`, adding/removing/restoring works, and "Сохранить теги" persists (reload keeps changes).

Run: use `preview_start` with the dev server, open a funnel detail page, exercise the block, then `read_console_messages` for errors.
Expected: no console errors; edits persist across reload.

- [ ] **Step 9: Lint + full suite**

Run: `npm run lint && npx vitest run`
Expected: clean + green (including `tests/ab-tags.test.ts` after the `axesToTagNames` removal).

- [ ] **Step 10: Commit**

```bash
git add app/src/components/FunnelIdentity.tsx app/src/lib/ab-tags.ts
git commit -m "feat(tags): editable AV-tags block — add/remove/restore + save; drop legacy axesToTagNames"
```

---

## Task 10: Global template screen at /tags

**Files:**
- Create: `app/src/components/TagTemplateEditor.tsx`
- Create: `app/src/app/tags/page.tsx`
- Modify: `app/src/components/AppHeader.tsx` (add nav link)

**Interfaces:**
- Consumes: `GET /api/tag-templates`, `PUT /api/tag-templates/[scenario]`.

- [ ] **Step 1: Implement the per-scenario editor component**

```tsx
// app/src/components/TagTemplateEditor.tsx
'use client';

import { useState } from 'react';
import { X } from 'lucide-react';

interface Props {
  label: string;
  scenario: 'reg' | 'time_15' | 'time_19' | 'messenger';
  initial: string[];
}

export default function TagTemplateEditor({ label, scenario, initial }: Props) {
  const [names, setNames] = useState<string[]>(initial);
  const [saved, setSaved] = useState<string[]>(initial);
  const [input, setInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = JSON.stringify(names) !== JSON.stringify(saved);

  function add() {
    const n = input.trim();
    if (!n || names.includes(n)) { setInput(''); return; }
    setNames([...names, n]);
    setInput('');
  }
  function remove(n: string) { setNames(names.filter((x) => x !== n)); }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/tag-templates/${scenario}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ names }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => null);
        throw new Error(b?.error ?? `Не удалось сохранить (${res.status})`);
      }
      setSaved(names);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось сохранить');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-[12px] border border-[var(--line-soft)] bg-[var(--card)] p-4">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-[13px] font-semibold text-[var(--ink)]">{label}</span>
        {dirty && <span className="h-1.5 w-1.5 rounded-full bg-[var(--orange)]" />}
        <button type="button" onClick={save} disabled={saving || !dirty}
          className="ml-auto rounded-[8px] bg-[var(--orange)] px-3 py-1 text-[11px] font-semibold text-white disabled:opacity-50">
          {saving ? 'Сохранение…' : 'Сохранить'}
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {names.map((n) => (
          <span key={n} className="inline-flex items-center gap-1 rounded-full bg-[var(--chip)] px-2 py-[3px] text-[11px] text-[var(--muted)]">
            {n}
            <button type="button" aria-label={`Убрать ${n}`} onClick={() => remove(n)} className="text-[var(--faint)] hover:text-[#B42318]">
              <X size={11} />
            </button>
          </span>
        ))}
        <input value={input} onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
          placeholder="+ тег" aria-label="Добавить тег"
          className="h-[24px] w-[110px] rounded-full border border-dashed border-[var(--line)] bg-white px-2 text-[11px]" />
      </div>
      <div className="mt-2 text-[10px] text-[var(--faint)]">
        АВ Продукт / Подрядчик / Канал / Направление добавляются автоматически из осей воронки.
      </div>
      {error && <div role="alert" className="mt-1 text-[11px] font-medium text-[#B42318]">{error}</div>}
    </div>
  );
}
```

- [ ] **Step 2: Implement the /tags page**

```tsx
// app/src/app/tags/page.tsx
import { db } from '@/db/client';
import { listTemplate } from '@/lib/tag-templates';
import TagTemplateEditor from '@/components/TagTemplateEditor';

export default function TagsPage() {
  const t = listTemplate(db);
  const sections: { label: string; scenario: 'reg' | 'time_15' | 'time_19' | 'messenger' }[] = [
    { label: 'Регистрация', scenario: 'reg' },
    { label: 'Оплата · 15:00', scenario: 'time_15' },
    { label: 'Оплата · 19:00', scenario: 'time_19' },
    { label: 'Мессенджер', scenario: 'messenger' },
  ];

  return (
    <main className="mx-auto max-w-[1120px] px-6 py-8">
      <h1 className="mb-1 text-[18px] font-semibold text-[var(--ink)]">Шаблон АВ-тегов</h1>
      <p className="mb-4 text-[12px] text-[var(--muted)]">
        Дефолтные теги для всех воронок по сценариям. Изменения применяются ко всем воронкам сразу
        (ручные правки на воронках сохраняются).
      </p>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {sections.map((s) => (
          <TagTemplateEditor key={s.scenario} label={s.label} scenario={s.scenario} initial={t[s.scenario]} />
        ))}
      </div>
    </main>
  );
}
```

- [ ] **Step 3: Add the nav link in AppHeader**

In `app/src/components/AppHeader.tsx`, find where `navLink('/refs', …)` is rendered (the nav cluster) and add alongside it:

```tsx
{navLink('/tags', 'Теги')}
```

(If a `/refs` link is not yet present in the header, add both the existing refs link pattern and this one next to the brand/nav area following the `navLink` helper already defined.)

- [ ] **Step 4: Verify in the browser**

Start the dev server, open `/tags`, add/remove a default in one scenario, save, then open a funnel card and confirm the new default appears (and a previously customized funnel keeps its overrides).

Run: `preview_start` dev server → navigate `/tags` → edit + save → navigate to a funnel → `read_page` to confirm chips.
Expected: template edit reflects on funnels; overrides preserved.

- [ ] **Step 5: Lint + full suite**

Run: `npm run lint && npx vitest run`
Expected: clean + green.

- [ ] **Step 6: Commit**

```bash
git add app/src/components/TagTemplateEditor.tsx app/src/app/tags/page.tsx app/src/components/AppHeader.tsx
git commit -m "feat(tags): global template screen at /tags + header link"
```

---

## Task 11: Production migration wiring + baked seed refresh

Register Phase-5 in the Docker entrypoint (mirroring the phase-3 `.cjs` runner), apply the migration to the committed dev DB and the baked seed, and run the full suite once more.

**Files:**
- Modify: `app/docker-entrypoint.sh`
- Create: `app/migrate-phase5-runner.ts` (compiled to `.cjs` like the phase-2/3 runners — follow `scripts/migrate-phase3-runner.ts`)
- Modify (binary): `ksamata_funnels.db`, `app/seed/ksamata_funnels.db`

**Interfaces:**
- Consumes: `runMigratePhase5`.

- [ ] **Step 1: Inspect the existing runner + build step**

Read `app/scripts/migrate-phase3-runner.ts` and the Dockerfile step that emits `migrate-phase3.cjs`. Mirror it for phase-5: a runner that opens `FUNNELS_DB_PATH` and calls `runMigratePhase5`.

Run: `sed -n '1,60p' app/scripts/migrate-phase3-runner.ts && grep -n "migrate-phase3" app/Dockerfile`
Expected: shows the runner shape and the Docker compile/copy line to replicate.

- [ ] **Step 2: Create the phase-5 runner**

Create `app/scripts/migrate-phase5-runner.ts` modeled exactly on `migrate-phase3-runner.ts`, calling `runMigratePhase5(sqlite)` against `process.env.FUNNELS_DB_PATH`. Add the matching compile/copy line to `app/Dockerfile` so it produces `/app/migrate-phase5.cjs` (copy the phase-3 line and change `3`→`5`).

- [ ] **Step 3: Wire the entrypoint**

In `app/docker-entrypoint.sh`, after the Phase-3 block and before `exec node server.js`, add:

```sh
# Apply Phase-5 migration (idempotent: CREATE IF NOT EXISTS + marker-gated seed).
if [ -n "$FUNNELS_DB_PATH" ]; then
  echo "[entrypoint] Running Phase-5 migration against $FUNNELS_DB_PATH"
  node /app/migrate-phase5.cjs
  echo "[entrypoint] Phase-5 migration done."
fi
```

- [ ] **Step 4: Migrate the committed dev DB**

Run: `cd app && FUNNELS_DB_PATH=../ksamata_funnels.db npx tsx scripts/migrate-phase5.ts`
Expected: "Phase-5 schema migration done."

- [ ] **Step 5: Refresh the baked seed DB**

Copy the migrated dev DB over the baked seed (matches prior "refresh baked seed DB" practice), or run the migration directly against the seed. Verify both carry the template:

Run: `sqlite3 ksamata_funnels.db "SELECT COUNT(*) FROM tag_templates;" && cp ksamata_funnels.db app/seed/ksamata_funnels.db && sqlite3 app/seed/ksamata_funnels.db "SELECT COUNT(*) FROM tag_templates;"`
Expected: both print `14`.

(If `sqlite3` CLI is unavailable, use a one-off tsx script that opens each DB and logs the count.)

- [ ] **Step 6: Full suite + lint**

Run: `cd app && npm run lint && npx vitest run`
Expected: clean, all tests green.

- [ ] **Step 7: Commit**

```bash
git add app/docker-entrypoint.sh app/scripts/migrate-phase5-runner.ts app/Dockerfile ksamata_funnels.db app/seed/ksamata_funnels.db
git commit -m "chore(tags): wire phase-5 migration into Docker + refresh baked seed"
```

---

## Self-Review Notes

- **Spec coverage:** layers model (Task 2), global template + editing (Tasks 3, 7, 10), per-funnel overrides + editing (Tasks 4, 8, 9), Variant A (Task 5 test), per-scenario granularity (scenario key everywhere), static-only template with axis auto-tags (Task 2 `isAxisTag`/`axisTagNames`), suppressed-default restore UI (Task 9), separate "Сохранить теги" button (Task 9), template edit resyncs all funnels (Task 7), migration + baked seed (Tasks 1, 11), tests enumerated (all tasks).
- **Refinement vs spec:** axis tags are non-removable (protects `getAxesForFunnel`); the spec's "remove any default by name" edge is narrowed to non-axis defaults. Enforced in `computeTagSet`, `replaceOverrides`, and the UI.
- **Type consistency:** `Scenario`, `TagChip`, `ScenarioTags`, `TagSets`, `TemplateMap`, `OverrideMap`, `materializeFunnelTags`, `resyncAllFunnels`, `applyTagOverrides`, `listTemplate`, `replaceTemplateScenario`, `listOverrides`, `replaceOverrides` are used identically across tasks.
