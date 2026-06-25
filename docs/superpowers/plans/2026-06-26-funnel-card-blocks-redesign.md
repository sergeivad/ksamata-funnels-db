# Funnel Card Blocks Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Пересобрать карточку воронки в одну форму (идентификация + время + тематические блоки ссылок), добавить гибкую модель блоков (`funnel_blocks`/`funnel_block_items`) и перенести в неё существующие 300 строк `funnel_days`.

**Architecture:** Продолжение Фаз 1–2 в `app/` (Next.js 15 App Router + Drizzle + better-sqlite3). Чистые helper-функции с инъекцией `db` (тестируются на temp-копии БД); тонкие route-хендлеры; миграция «Фаза 3» по образцу Фазы 2 (общий data-файл + tsx-скрипт для тестов/CLI + esbuild-бандл `.cjs` для Docker, вызывается из `docker-entrypoint.sh`).

**Tech Stack:** Next.js 15, TypeScript, Tailwind, lucide-react, Drizzle ORM, better-sqlite3, Vitest, esbuild.

**Спека:** `docs/superpowers/specs/2026-06-25-funnel-card-blocks-redesign-design.md`. Прототип: `funnel_card_final_v11`.

## Global Constraints

- **НЕ мутировать боевую `ksamata_funnels.db` из тестов.** Тесты всегда копируют файл во временную директорию (`fs.copyFileSync` + `os.tmpdir()`), как в существующих тестах (`tests/funnel-links.test.ts`, `tests/migrate-phase2.test.ts`).
- **НЕ трогать** пользовательские файлы в корне репо: `add_durations.py`, `add_dih_funnel.py`.
- **Все helper-функции принимают `db: AnyDB` первым аргументом** и НИКОГДА не импортируют singleton `db` из `client.ts` (кроме route-хендлеров).
- **Внутренние ключи слотов времени неизменны:** `A = '15'`, `B = '19'` (строки-идентификаторы). Отображаемая подпись — `funnels.time_label_a`/`time_label_b` (деф. `'15:00'`/`'19:00'`).
- **Каталог видов блоков (точные значения), порядок = порядок в карточке:**
  `landings`(Лендинги, 1 поле, [common], деф.вкл) · `records`(Записи, 1, [common,by_time], выкл) · `tariffs`(Страницы тарифов, 1, [common,by_time], вкл) · `applications`(Оформление заявки, 1, [common,by_time], вкл) · `bonuses`(Бонусы, 1, [common,by_time], выкл) · `oto`(ОТО, 1, [common,by_time], выкл) · `processes`(Процессы, 2, [common,by_time], выкл) · `meditation`(Медитация / дожим, 1, [common,by_time], выкл) · `links`(Ссылки / дашборды, 2, [common,by_time], вкл). Комнаты в этот каталог НЕ входят (особый блок).
- **Имя воронки** не хранится — выводится как `«{product} / {contractor} / {channel} / {direction}»`.
- **Миграция идемпотентна** (ALTER guard по `pragma table_info`, `CREATE TABLE IF NOT EXISTS`, перенос данных только если у воронки ещё нет `funnel_blocks`).
- **Поля ввода — светлая схема** (`color-scheme: light` на корне), сегментные переключатели светлые (белый активный сегмент на `#EDE7DA`).
- Команды запускать из `app/`. Тесты: `npx vitest run <file>`. Сборка: `npm run build`.

---

### Task 1: Каталог видов блоков (`blocks.ts`)

Чистый модуль-константа: список видов блоков и хелперы. Используется и UI, и миграцией, и API-валидацией.

**Files:**
- Create: `app/src/lib/blocks.ts`
- Test: `app/tests/blocks.test.ts`

**Interfaces:**
- Produces:
  - `type BlockKind = 'landings'|'records'|'tariffs'|'applications'|'bonuses'|'oto'|'processes'|'meditation'|'links'`
  - `type BlockMode = 'common'|'by_time'`
  - `interface BlockKindDef { kind: BlockKind; title: string; icon: string; fields: 1|2; modes: BlockMode[]; defaultEnabled: boolean }`
  - `const BLOCK_KINDS: BlockKindDef[]` (в порядке карточки)
  - `function isBlockKind(k: string): k is BlockKind`
  - `function getBlockDef(k: BlockKind): BlockKindDef`

- [ ] **Step 1: Write the failing test**

`app/tests/blocks.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { BLOCK_KINDS, isBlockKind, getBlockDef } from '../src/lib/blocks';

describe('blocks catalog', () => {
  it('lists the 9 kinds in card order', () => {
    expect(BLOCK_KINDS.map((b) => b.kind)).toEqual([
      'landings', 'records', 'tariffs', 'applications', 'bonuses',
      'oto', 'processes', 'meditation', 'links',
    ]);
  });

  it('landings is single-field, common-only, default enabled', () => {
    const d = getBlockDef('landings');
    expect(d.fields).toBe(1);
    expect(d.modes).toEqual(['common']);
    expect(d.defaultEnabled).toBe(true);
  });

  it('processes and links are two-field', () => {
    expect(getBlockDef('processes').fields).toBe(2);
    expect(getBlockDef('links').fields).toBe(2);
  });

  it('records supports by_time and defaults disabled', () => {
    const d = getBlockDef('records');
    expect(d.modes).toEqual(['common', 'by_time']);
    expect(d.defaultEnabled).toBe(false);
  });

  it('isBlockKind validates membership', () => {
    expect(isBlockKind('tariffs')).toBe(true);
    expect(isBlockKind('rooms')).toBe(false);
    expect(isBlockKind('nope')).toBe(false);
  });

  it('getBlockDef throws on unknown kind', () => {
    expect(() => getBlockDef('rooms' as never)).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run tests/blocks.test.ts`
Expected: FAIL — `Cannot find module '../src/lib/blocks'`.

- [ ] **Step 3: Write minimal implementation**

`app/src/lib/blocks.ts`:
```ts
export type BlockKind =
  | 'landings' | 'records' | 'tariffs' | 'applications' | 'bonuses'
  | 'oto' | 'processes' | 'meditation' | 'links';

export type BlockMode = 'common' | 'by_time';

export interface BlockKindDef {
  kind: BlockKind;
  title: string;
  icon: string;          // lucide-react icon name
  fields: 1 | 2;         // 1 = url only; 2 = label + url
  modes: BlockMode[];    // ['common'] or ['common','by_time']
  defaultEnabled: boolean;
}

const C: BlockMode[] = ['common'];
const CB: BlockMode[] = ['common', 'by_time'];

export const BLOCK_KINDS: BlockKindDef[] = [
  { kind: 'landings',     title: 'Лендинги',          icon: 'Globe',      fields: 1, modes: C,  defaultEnabled: true  },
  { kind: 'records',      title: 'Записи',            icon: 'Video',      fields: 1, modes: CB, defaultEnabled: false },
  { kind: 'tariffs',      title: 'Страницы тарифов',  icon: 'Tag',        fields: 1, modes: CB, defaultEnabled: true  },
  { kind: 'applications', title: 'Оформление заявки', icon: 'FileText',   fields: 1, modes: CB, defaultEnabled: true  },
  { kind: 'bonuses',      title: 'Бонусы',            icon: 'Gift',       fields: 1, modes: CB, defaultEnabled: false },
  { kind: 'oto',          title: 'ОТО',               icon: 'Flame',      fields: 1, modes: CB, defaultEnabled: false },
  { kind: 'processes',    title: 'Процессы',          icon: 'Settings',   fields: 2, modes: CB, defaultEnabled: false },
  { kind: 'meditation',   title: 'Медитация / дожим', icon: 'Sparkles',   fields: 1, modes: CB, defaultEnabled: false },
  { kind: 'links',        title: 'Ссылки / дашборды', icon: 'Link',       fields: 2, modes: CB, defaultEnabled: true  },
];

const BY_KIND = new Map<string, BlockKindDef>(BLOCK_KINDS.map((d) => [d.kind, d]));

export function isBlockKind(k: string): k is BlockKind {
  return BY_KIND.has(k);
}

export function getBlockDef(k: BlockKind): BlockKindDef {
  const d = BY_KIND.get(k);
  if (!d) throw new Error(`Unknown block kind: ${k}`);
  return d;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run tests/blocks.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/blocks.ts app/tests/blocks.test.ts
git commit -m "feat: block-kinds catalog (Phase 3)"
```

---

### Task 2: Drizzle-схема — новые колонки и таблицы блоков

Описать новые объекты БД в Drizzle (схема — источник типов; саму БД меняет миграция в Task 3).

**Files:**
- Modify: `app/src/db/schema.ts` (добавить колонки в `funnels` после `frontCode`; добавить две таблицы и типы в конец файла)
- Test: `app/tests/schema-types.test.ts`

**Interfaces:**
- Produces (Drizzle tables): `funnelBlocks`, `funnelBlockItems`; новые поля `funnels.comment`, `funnels.timeLabelA`, `funnels.timeLabelB`, `funnels.roomsReplayEnabled`. Типы `FunnelBlock`, `FunnelBlockItem`.

- [ ] **Step 1: Write the failing test**

`app/tests/schema-types.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { funnels, funnelBlocks, funnelBlockItems } from '../src/db/schema';

describe('schema additions', () => {
  it('funnels has new columns', () => {
    const cols = Object.keys(funnels);
    expect(cols).toContain('comment');
    expect(cols).toContain('timeLabelA');
    expect(cols).toContain('timeLabelB');
    expect(cols).toContain('roomsReplayEnabled');
  });

  it('funnel_blocks table exists with kind/enabled/mode', () => {
    const cols = Object.keys(funnelBlocks);
    expect(cols).toEqual(expect.arrayContaining(['id', 'funnelId', 'kind', 'enabled', 'mode']));
  });

  it('funnel_block_items table exists with slot/label/url/position', () => {
    const cols = Object.keys(funnelBlockItems);
    expect(cols).toEqual(expect.arrayContaining(['id', 'blockId', 'slot', 'label', 'url', 'position']));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run tests/schema-types.test.ts`
Expected: FAIL — `funnelBlocks`/`funnelBlockItems` not exported.

- [ ] **Step 3: Write minimal implementation**

In `app/src/db/schema.ts`, inside the `funnels` table column object, **after** the `frontCode` line (`frontCode: text('front_code').default(''),`) add:
```ts
    // Phase 3 columns
    comment:            text('comment').default(''),
    timeLabelA:         text('time_label_a').default('15:00'),
    timeLabelB:         text('time_label_b').default('19:00'),
    roomsReplayEnabled: integer('rooms_replay_enabled').default(0),
```

At the **end** of `app/src/db/schema.ts`, before the `// ─── Type exports ───` block, add:
```ts
// ─── funnel_blocks / funnel_block_items (Phase 3) ────────────────────────────

export const funnelBlocks = sqliteTable(
  'funnel_blocks',
  {
    id:       integer('id').primaryKey({ autoIncrement: true }),
    funnelId: integer('funnel_id').notNull().references(() => funnels.id, { onDelete: 'cascade' }),
    kind:     text('kind').notNull(),
    enabled:  integer('enabled').notNull().default(0),
    mode:     text('mode', { enum: ['common', 'by_time'] }).notNull().default('common'),
  },
  (t) => ({
    uniq:      uniqueIndex('funnel_blocks_funnel_kind_unique').on(t.funnelId, t.kind),
    funnelIdx: index('idx_funnel_blocks_funnel').on(t.funnelId),
  }),
);

export const funnelBlockItems = sqliteTable(
  'funnel_block_items',
  {
    id:       integer('id').primaryKey({ autoIncrement: true }),
    blockId:  integer('block_id').notNull().references(() => funnelBlocks.id, { onDelete: 'cascade' }),
    slot:     text('slot', { enum: ['15', '19'] }),
    label:    text('label').notNull().default(''),
    url:      text('url').notNull().default(''),
    position: integer('position').notNull().default(0),
  },
  (t) => ({
    blockIdx: index('idx_fbi_block').on(t.blockId),
  }),
);
```

In the `// ─── Type exports ───` block append:
```ts
export type FunnelBlock     = typeof funnelBlocks.$inferSelect;
export type FunnelBlockItem = typeof funnelBlockItems.$inferSelect;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run tests/schema-types.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add app/src/db/schema.ts app/tests/schema-types.test.ts
git commit -m "feat: Drizzle schema for funnel blocks + new funnels columns"
```

---

### Task 3: Миграция «Фаза 3» — DDL + ALTER (общий data-файл + tsx-скрипт)

Создать DDL и идемпотентную функцию `runMigratePhase3(sqlite)`, которая добавляет колонки `funnels` (guard) и создаёт таблицы блоков. По образцу `migrate-phase2.ts` + `migrate-phase2-data.ts`. Перенос данных — отдельная функция в Task 4.

**Files:**
- Create: `app/scripts/migrate-phase3-data.ts` (DDL + список новых колонок)
- Create: `app/scripts/migrate-phase3.ts` (`runMigratePhase3(sqlite)` + CLI)
- Test: `app/tests/migrate-phase3.test.ts`

**Interfaces:**
- Consumes: `migrate-phase3-data` exports.
- Produces:
  - `migrate-phase3-data.ts`: `PHASE3_DDL: string`, `PHASE3_FUNNEL_COLUMNS: { name: string; ddl: string }[]`
  - `migrate-phase3.ts`: `export function runMigratePhase3(sqlite: import('better-sqlite3').Database): void`

- [ ] **Step 1: Write the failing test**

`app/tests/migrate-phase3.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { runMigratePhase3 } from '../scripts/migrate-phase3';

const REAL_DB = path.resolve(process.cwd(), '..', 'ksamata_funnels.db');
let tmp: string;
let sqlite: Database.Database;

beforeEach(() => {
  tmp = path.join(os.tmpdir(), `ph3-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  fs.copyFileSync(REAL_DB, tmp);
  sqlite = new Database(tmp);
});

afterEach(() => {
  sqlite.close();
  fs.rmSync(tmp, { force: true });
});

function cols(table: string): string[] {
  return (sqlite.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((r) => r.name);
}
function tableExists(name: string): boolean {
  return !!sqlite.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(name);
}

describe('runMigratePhase3', () => {
  it('adds new funnels columns', () => {
    runMigratePhase3(sqlite);
    expect(cols('funnels')).toEqual(expect.arrayContaining([
      'comment', 'time_label_a', 'time_label_b', 'rooms_replay_enabled',
    ]));
  });

  it('creates block tables', () => {
    runMigratePhase3(sqlite);
    expect(tableExists('funnel_blocks')).toBe(true);
    expect(tableExists('funnel_block_items')).toBe(true);
  });

  it('sets default time labels 15:00/19:00', () => {
    runMigratePhase3(sqlite);
    const row = sqlite.prepare('SELECT time_label_a, time_label_b FROM funnels LIMIT 1').get() as {
      time_label_a: string; time_label_b: string;
    };
    expect(row.time_label_a).toBe('15:00');
    expect(row.time_label_b).toBe('19:00');
  });

  it('is idempotent (second run does not throw)', () => {
    runMigratePhase3(sqlite);
    expect(() => runMigratePhase3(sqlite)).not.toThrow();
    expect(cols('funnels').filter((c) => c === 'comment')).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run tests/migrate-phase3.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

`app/scripts/migrate-phase3-data.ts`:
```ts
/**
 * Shared DDL + column list for Phase-3 migration. Single source of truth for
 * both migrate-phase3.ts (tsx/tests) and migrate-phase3-runner.ts (Docker .cjs).
 */

export const PHASE3_FUNNEL_COLUMNS: { name: string; ddl: string }[] = [
  { name: 'comment',              ddl: `ALTER TABLE funnels ADD COLUMN comment TEXT DEFAULT ''` },
  { name: 'time_label_a',         ddl: `ALTER TABLE funnels ADD COLUMN time_label_a TEXT DEFAULT '15:00'` },
  { name: 'time_label_b',         ddl: `ALTER TABLE funnels ADD COLUMN time_label_b TEXT DEFAULT '19:00'` },
  { name: 'rooms_replay_enabled', ddl: `ALTER TABLE funnels ADD COLUMN rooms_replay_enabled INTEGER DEFAULT 0` },
];

export const PHASE3_DDL = `
CREATE TABLE IF NOT EXISTS funnel_blocks (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  funnel_id INTEGER NOT NULL REFERENCES funnels(id) ON DELETE CASCADE,
  kind      TEXT    NOT NULL,
  enabled   INTEGER NOT NULL DEFAULT 0,
  mode      TEXT    NOT NULL DEFAULT 'common' CHECK(mode IN ('common','by_time'))
);

CREATE UNIQUE INDEX IF NOT EXISTS funnel_blocks_funnel_kind_unique ON funnel_blocks(funnel_id, kind);
CREATE INDEX IF NOT EXISTS idx_funnel_blocks_funnel ON funnel_blocks(funnel_id);

CREATE TABLE IF NOT EXISTS funnel_block_items (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  block_id INTEGER NOT NULL REFERENCES funnel_blocks(id) ON DELETE CASCADE,
  slot     TEXT    DEFAULT NULL CHECK(slot IN ('15','19') OR slot IS NULL),
  label    TEXT    NOT NULL DEFAULT '',
  url      TEXT    NOT NULL DEFAULT '',
  position INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_fbi_block ON funnel_block_items(block_id);
`;

/** Add a column only if it is not already present (SQLite has no ADD COLUMN IF NOT EXISTS). */
export function addColumnIfMissing(
  sqlite: import('better-sqlite3').Database,
  table: string,
  column: string,
  ddl: string,
): void {
  const present = (sqlite.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[])
    .some((r) => r.name === column);
  if (!present) sqlite.exec(ddl);
}
```

`app/scripts/migrate-phase3.ts`:
```ts
/**
 * Phase-3 schema migration: new funnels columns + funnel_blocks /
 * funnel_block_items tables. Idempotent. Data migration lives in
 * migrate-funnel-data.ts (called separately after this).
 *
 * Run against the real DB:
 *   cd app/
 *   FUNNELS_DB_PATH=../ksamata_funnels.db npx tsx scripts/migrate-phase3.ts
 */

import { PHASE3_DDL, PHASE3_FUNNEL_COLUMNS, addColumnIfMissing } from './migrate-phase3-data';

export function runMigratePhase3(sqlite: import('better-sqlite3').Database): void {
  sqlite.pragma('foreign_keys = ON');
  for (const col of PHASE3_FUNNEL_COLUMNS) {
    addColumnIfMissing(sqlite, 'funnels', col.name, col.ddl);
  }
  sqlite.exec(PHASE3_DDL);
}

if (require.main === module) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Database = require('better-sqlite3');
  const dbPath = process.env.FUNNELS_DB_PATH ?? '../ksamata_funnels.db';
  const sqlite = new Database(dbPath);
  console.log(`Phase-3 schema migration on: ${dbPath}`);
  runMigratePhase3(sqlite);
  sqlite.close();
  console.log('Phase-3 schema migration done.');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run tests/migrate-phase3.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add app/scripts/migrate-phase3-data.ts app/scripts/migrate-phase3.ts app/tests/migrate-phase3.test.ts
git commit -m "feat: Phase-3 schema migration (columns + block tables)"
```

---

### Task 4: Перенос данных в модель блоков (`migrate-funnel-data.ts`)

Идемпотентная функция переноса `funnel_days` + дашборд-колонок `funnels` в `funnel_blocks`/`funnel_block_items`. Пропускает воронку, если у неё уже есть блоки. Работает на сырых SQL (better-sqlite3), чтобы годилось и для Docker-раннера.

**Files:**
- Create: `app/scripts/migrate-funnel-data.ts`
- Test: `app/tests/migrate-funnel-data.test.ts`

**Interfaces:**
- Consumes: схема таблиц `funnel_blocks`/`funnel_block_items` (созданы Task 3).
- Produces: `export function migrateFunnelData(sqlite: import('better-sqlite3').Database): void`

**Mapping (см. спеку §5.2):**
- `funnels.landing_url` → `landings` (common, slot=null), если непусто.
- `funnel_days.sales_page` → `applications`; `.tariffs` → `tariffs`; `.oto` → `oto`; `.bonuses` → `bonuses`; `.meditation` → `meditation` (одно поле, label=''). `.mission` → `processes` (label = `mission_type` или ''). Для каждого — slot = `time_slot` строки.
- Режим: если у вида есть значения в обоих слотах ('15' и '19') → `by_time` (slot сохраняем); если только в одном → `common` (slot=null).
- Дашборд-колонки `funnels` (непустые) → `links` (common, slot=null), label = человекочитаемое имя: `dash_sales_url`→`Дашборд продаж`, `dash_pereliv_url`→`Дашборд перелива`, `regi_total_url`→`Регистрации всего`, `regi_15_url`→`Регистрации 15:00`, `regi_19_url`→`Регистрации 19:00`, `regi_notime_url`→`Регистрации без времени`, `predspisok_url`→`Предсписок`.
- `enabled = 1`, если у блока есть хоть один item; иначе блок не создаём.
- **НЕ переносим**: `sales_note`, `dojim_note`, `replay_url`, `web_replay` (повтор остаётся в комнатах).
- **rooms_replay_enabled**: ставим `1`, если у воронки есть непустой `replay_url` ИЛИ `web_replay`.

- [ ] **Step 1: Write the failing test**

`app/tests/migrate-funnel-data.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { runMigratePhase3 } from '../scripts/migrate-phase3';
import { migrateFunnelData } from '../scripts/migrate-funnel-data';

let tmp: string;
let sqlite: Database.Database;

beforeEach(() => {
  tmp = path.join(os.tmpdir(), `mfd-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  sqlite = new Database(tmp);
  // Minimal fixture schema (subset of real DB needed by the migration)
  sqlite.exec(`
    CREATE TABLE funnels (
      id INTEGER PRIMARY KEY AUTOINCREMENT, num INTEGER, landing_url TEXT DEFAULT '',
      dash_sales_url TEXT DEFAULT '', dash_pereliv_url TEXT DEFAULT '',
      regi_total_url TEXT DEFAULT '', regi_15_url TEXT DEFAULT '', regi_19_url TEXT DEFAULT '',
      regi_notime_url TEXT DEFAULT '', predspisok_url TEXT DEFAULT ''
    );
    CREATE TABLE funnel_days (
      id INTEGER PRIMARY KEY AUTOINCREMENT, funnel_id INTEGER, time_slot TEXT, day_num INTEGER,
      gc_room TEXT DEFAULT '', web_room TEXT DEFAULT '', replay_url TEXT DEFAULT '', web_replay TEXT DEFAULT '',
      sales_page TEXT DEFAULT '', sales_note TEXT DEFAULT '', tariffs TEXT DEFAULT '', oto TEXT DEFAULT '',
      bonuses TEXT DEFAULT '', mission TEXT DEFAULT '', mission_type TEXT DEFAULT '',
      meditation TEXT DEFAULT '', dojim_note TEXT DEFAULT ''
    );
  `);
  runMigratePhase3(sqlite);
  sqlite.prepare(`INSERT INTO funnels (id, num, landing_url, dash_sales_url) VALUES (1, 1, 'https://land', 'https://dash')`).run();
  // tariffs only in slot 19 -> common; sales_page in both slots -> by_time
  sqlite.prepare(`INSERT INTO funnel_days (funnel_id,time_slot,day_num,tariffs,sales_page,replay_url,mission,mission_type)
                  VALUES (1,'19',1,'https://t19','https://s19','https://r19','https://m19','сейлбот')`).run();
  sqlite.prepare(`INSERT INTO funnel_days (funnel_id,time_slot,day_num,sales_page)
                  VALUES (1,'15',1,'https://s15')`).run();
});

afterEach(() => {
  sqlite.close();
  fs.rmSync(tmp, { force: true });
});

function blockItems(kind: string) {
  return sqlite.prepare(`
    SELECT i.slot, i.label, i.url FROM funnel_block_items i
    JOIN funnel_blocks b ON b.id = i.block_id
    WHERE b.funnel_id = 1 AND b.kind = ? ORDER BY i.position
  `).all(kind) as { slot: string | null; label: string; url: string }[];
}
function blockRow(kind: string) {
  return sqlite.prepare(`SELECT enabled, mode FROM funnel_blocks WHERE funnel_id=1 AND kind=?`).get(kind) as
    { enabled: number; mode: string } | undefined;
}

describe('migrateFunnelData', () => {
  it('migrates landing_url to landings (common)', () => {
    migrateFunnelData(sqlite);
    expect(blockItems('landings')).toEqual([{ slot: null, label: '', url: 'https://land' }]);
    expect(blockRow('landings')).toEqual({ enabled: 1, mode: 'common' });
  });

  it('single-slot tariffs -> common (slot null)', () => {
    migrateFunnelData(sqlite);
    expect(blockRow('tariffs')!.mode).toBe('common');
    expect(blockItems('tariffs')).toEqual([{ slot: null, label: '', url: 'https://t19' }]);
  });

  it('both-slot sales_page -> applications by_time (slots kept)', () => {
    migrateFunnelData(sqlite);
    expect(blockRow('applications')!.mode).toBe('by_time');
    const urls = blockItems('applications').map((i) => `${i.slot}:${i.url}`).sort();
    expect(urls).toEqual(['15:https://s15', '19:https://s19']);
  });

  it('mission -> processes with mission_type label', () => {
    migrateFunnelData(sqlite);
    expect(blockItems('processes')).toEqual([{ slot: null, label: 'сейлбот', url: 'https://m19' }]);
  });

  it('dashboard cols -> links', () => {
    migrateFunnelData(sqlite);
    expect(blockItems('links')).toEqual([{ slot: null, label: 'Дашборд продаж', url: 'https://dash' }]);
  });

  it('rooms_replay_enabled set when replay present; replay NOT in records', () => {
    migrateFunnelData(sqlite);
    const f = sqlite.prepare('SELECT rooms_replay_enabled FROM funnels WHERE id=1').get() as { rooms_replay_enabled: number };
    expect(f.rooms_replay_enabled).toBe(1);
    expect(blockRow('records')).toBeUndefined();
  });

  it('is idempotent (second run does not duplicate)', () => {
    migrateFunnelData(sqlite);
    migrateFunnelData(sqlite);
    expect(blockItems('tariffs')).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run tests/migrate-funnel-data.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

`app/scripts/migrate-funnel-data.ts`:
```ts
/**
 * Phase-3 DATA migration: distribute funnel_days columns + funnels dashboard
 * columns into funnel_blocks / funnel_block_items. Idempotent — a funnel that
 * already has any funnel_blocks row is skipped entirely.
 *
 * Run AFTER runMigratePhase3 (needs the new tables/columns).
 *   FUNNELS_DB_PATH=../ksamata_funnels.db npx tsx scripts/migrate-funnel-data.ts
 */

type DB = import('better-sqlite3').Database;

// funnel_days column -> block kind (single-field unless processes)
const DAY_COLUMN_TO_KIND: { col: string; kind: string; labelCol?: string }[] = [
  { col: 'sales_page', kind: 'applications' },
  { col: 'tariffs',    kind: 'tariffs' },
  { col: 'oto',        kind: 'oto' },
  { col: 'bonuses',    kind: 'bonuses' },
  { col: 'meditation', kind: 'meditation' },
  { col: 'mission',    kind: 'processes', labelCol: 'mission_type' },
];

const DASHBOARD_COLUMNS: { col: string; label: string }[] = [
  { col: 'dash_sales_url',   label: 'Дашборд продаж' },
  { col: 'dash_pereliv_url', label: 'Дашборд перелива' },
  { col: 'regi_total_url',   label: 'Регистрации всего' },
  { col: 'regi_15_url',      label: 'Регистрации 15:00' },
  { col: 'regi_19_url',      label: 'Регистрации 19:00' },
  { col: 'regi_notime_url',  label: 'Регистрации без времени' },
  { col: 'predspisok_url',   label: 'Предсписок' },
];

type Item = { slot: '15' | '19' | null; label: string; url: string };

function createBlock(sqlite: DB, funnelId: number, kind: string, mode: string, items: Item[]): void {
  if (items.length === 0) return;
  const res = sqlite
    .prepare(`INSERT INTO funnel_blocks (funnel_id, kind, enabled, mode) VALUES (?, ?, 1, ?)`)
    .run(funnelId, kind, mode);
  const blockId = res.lastInsertRowid as number;
  const ins = sqlite.prepare(
    `INSERT INTO funnel_block_items (block_id, slot, label, url, position) VALUES (?, ?, ?, ?, ?)`,
  );
  items.forEach((it, i) => ins.run(blockId, it.slot, it.label, it.url, i));
}

export function migrateFunnelData(sqlite: DB): void {
  sqlite.pragma('foreign_keys = ON');
  const funnels = sqlite.prepare(`SELECT * FROM funnels`).all() as Record<string, unknown>[];
  const hasBlocks = sqlite.prepare(`SELECT 1 FROM funnel_blocks WHERE funnel_id = ? LIMIT 1`);
  const daysFor = sqlite.prepare(`SELECT * FROM funnel_days WHERE funnel_id = ? ORDER BY day_num`);

  const run = sqlite.transaction(() => {
    for (const f of funnels) {
      const funnelId = f.id as number;
      if (hasBlocks.get(funnelId)) continue; // idempotent skip

      const days = daysFor.all(funnelId) as Record<string, string>[];

      // landings
      const landing = String(f.landing_url ?? '').trim();
      if (landing) createBlock(sqlite, funnelId, 'landings', 'common', [{ slot: null, label: '', url: landing }]);

      // day-column blocks
      for (const { col, kind, labelCol } of DAY_COLUMN_TO_KIND) {
        const rows = days
          .filter((d) => String(d[col] ?? '').trim() !== '')
          .map((d) => ({
            slot: d.time_slot as '15' | '19',
            label: labelCol ? String(d[labelCol] ?? '').trim() : '',
            url: String(d[col]).trim(),
          }));
        if (rows.length === 0) continue;
        const slots = new Set(rows.map((r) => r.slot));
        const byTime = slots.has('15') && slots.has('19');
        const items: Item[] = rows.map((r) => ({ slot: byTime ? r.slot : null, label: r.label, url: r.url }));
        createBlock(sqlite, funnelId, kind, byTime ? 'by_time' : 'common', items);
      }

      // links from dashboard columns
      const linkItems: Item[] = DASHBOARD_COLUMNS
        .filter((d) => String(f[d.col] ?? '').trim() !== '')
        .map((d) => ({ slot: null, label: d.label, url: String(f[d.col]).trim() }));
      createBlock(sqlite, funnelId, 'links', 'common', linkItems);

      // rooms_replay_enabled
      const hasReplay = days.some(
        (d) => String(d.replay_url ?? '').trim() !== '' || String(d.web_replay ?? '').trim() !== '',
      );
      if (hasReplay) {
        sqlite.prepare(`UPDATE funnels SET rooms_replay_enabled = 1 WHERE id = ?`).run(funnelId);
      }
    }
  });
  run();
}

if (require.main === module) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Database = require('better-sqlite3');
  const dbPath = process.env.FUNNELS_DB_PATH ?? '../ksamata_funnels.db';
  const sqlite = new Database(dbPath);
  console.log(`Phase-3 data migration on: ${dbPath}`);
  migrateFunnelData(sqlite);
  sqlite.close();
  console.log('Phase-3 data migration done.');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run tests/migrate-funnel-data.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add app/scripts/migrate-funnel-data.ts app/tests/migrate-funnel-data.test.ts
git commit -m "feat: Phase-3 data migration into block model"
```

---

### Task 5: Helper блоков (`funnel-blocks.ts`)

Чтение/запись блоков воронки через Drizzle (инъекция `db`), по образцу `funnel-links.ts`.

**Files:**
- Create: `app/src/lib/funnel-blocks.ts`
- Test: `app/tests/funnel-blocks.test.ts`

**Interfaces:**
- Consumes: `funnelBlocks`, `funnelBlockItems` (schema), `BLOCK_KINDS`/`getBlockDef` (blocks.ts).
- Produces:
  - `type BlockItem = { slot: '15'|'19'|null; label: string; url: string }`
  - `type BlockState = { kind: BlockKind; enabled: boolean; mode: BlockMode; items: BlockItem[] }`
  - `function getBlock(db: AnyDB, funnelId: number, kind: BlockKind): BlockState`
  - `function listBlocks(db: AnyDB, funnelId: number): BlockState[]` (все 9 видов; нет записи → дефолт enabled из каталога, mode 'common', items [])
  - `function replaceBlock(db: AnyDB, funnelId: number, kind: BlockKind, enabled: boolean, mode: BlockMode, items: BlockItem[]): BlockState` (upsert конфига + replace items в одной транзакции)

- [ ] **Step 1: Write the failing test**

`app/tests/funnel-blocks.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { runMigratePhase3 } from '../scripts/migrate-phase3';
import { getBlock, listBlocks, replaceBlock } from '../src/lib/funnel-blocks';
import * as schema from '../src/db/schema';

const REAL_DB = path.resolve(process.cwd(), '..', 'ksamata_funnels.db');
let tmp: string;
let sqlite: Database.Database;
let db: ReturnType<typeof drizzle>;
let funnelId: number;

beforeEach(() => {
  tmp = path.join(os.tmpdir(), `fb-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  fs.copyFileSync(REAL_DB, tmp);
  sqlite = new Database(tmp);
  runMigratePhase3(sqlite);
  db = drizzle(sqlite, { schema });
  funnelId = (sqlite.prepare('SELECT id FROM funnels LIMIT 1').get() as { id: number }).id;
});

afterEach(() => {
  sqlite.close();
  fs.rmSync(tmp, { force: true });
});

describe('funnel-blocks', () => {
  it('listBlocks returns all 9 kinds with catalog defaults when empty', () => {
    const blocks = listBlocks(db, funnelId);
    expect(blocks).toHaveLength(9);
    const landings = blocks.find((b) => b.kind === 'landings')!;
    expect(landings.enabled).toBe(true);   // default enabled
    expect(landings.items).toEqual([]);
    const oto = blocks.find((b) => b.kind === 'oto')!;
    expect(oto.enabled).toBe(false);
  });

  it('replaceBlock upserts config and items, getBlock reads them back', () => {
    replaceBlock(db, funnelId, 'tariffs', true, 'by_time', [
      { slot: '15', label: '', url: 'https://a' },
      { slot: '19', label: '', url: 'https://b' },
    ]);
    const b = getBlock(db, funnelId, 'tariffs');
    expect(b.enabled).toBe(true);
    expect(b.mode).toBe('by_time');
    expect(b.items).toEqual([
      { slot: '15', label: '', url: 'https://a' },
      { slot: '19', label: '', url: 'https://b' },
    ]);
  });

  it('replaceBlock replaces (does not append) on second call', () => {
    replaceBlock(db, funnelId, 'bonuses', true, 'common', [{ slot: null, label: '', url: 'https://x' }]);
    replaceBlock(db, funnelId, 'bonuses', true, 'common', [{ slot: null, label: '', url: 'https://y' }]);
    expect(getBlock(db, funnelId, 'bonuses').items).toEqual([{ slot: null, label: '', url: 'https://y' }]);
  });

  it('replaceBlock can disable a block and clear items', () => {
    replaceBlock(db, funnelId, 'oto', true, 'common', [{ slot: null, label: '', url: 'https://x' }]);
    replaceBlock(db, funnelId, 'oto', false, 'common', []);
    const b = getBlock(db, funnelId, 'oto');
    expect(b.enabled).toBe(false);
    expect(b.items).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run tests/funnel-blocks.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

`app/src/lib/funnel-blocks.ts`:
```ts
/**
 * funnel-blocks.ts — read/write helper for funnel_blocks + funnel_block_items.
 * Injected `db` handle (same pattern as funnel-links.ts).
 */

import { eq, and, asc } from 'drizzle-orm';
import { type AnyDB } from '../db/client';
import { funnelBlocks, funnelBlockItems } from '../db/schema';
import { BLOCK_KINDS, getBlockDef, type BlockKind, type BlockMode } from './blocks';

export type BlockItem = { slot: '15' | '19' | null; label: string; url: string };
export type BlockState = { kind: BlockKind; enabled: boolean; mode: BlockMode; items: BlockItem[] };

/** Read a single block's config + items. Falls back to catalog default if no row. */
export function getBlock(db: AnyDB, funnelId: number, kind: BlockKind): BlockState {
  const def = getBlockDef(kind);
  const cfg = db
    .select({ id: funnelBlocks.id, enabled: funnelBlocks.enabled, mode: funnelBlocks.mode })
    .from(funnelBlocks)
    .where(and(eq(funnelBlocks.funnelId, funnelId), eq(funnelBlocks.kind, kind)))
    .get() as { id: number; enabled: number; mode: BlockMode } | undefined;

  if (!cfg) {
    return { kind, enabled: def.defaultEnabled, mode: 'common', items: [] };
  }

  const items = db
    .select({ slot: funnelBlockItems.slot, label: funnelBlockItems.label, url: funnelBlockItems.url })
    .from(funnelBlockItems)
    .where(eq(funnelBlockItems.blockId, cfg.id))
    .orderBy(asc(funnelBlockItems.position))
    .all() as { slot: '15' | '19' | null; label: string; url: string }[];

  return {
    kind,
    enabled: cfg.enabled === 1,
    mode: cfg.mode,
    items: items.map((i) => ({ slot: i.slot ?? null, label: i.label, url: i.url })),
  };
}

/** All 9 blocks for a funnel, in catalog order. */
export function listBlocks(db: AnyDB, funnelId: number): BlockState[] {
  return BLOCK_KINDS.map((d) => getBlock(db, funnelId, d.kind));
}

/** Upsert block config and replace its items in one transaction. */
export function replaceBlock(
  db: AnyDB,
  funnelId: number,
  kind: BlockKind,
  enabled: boolean,
  mode: BlockMode,
  items: BlockItem[],
): BlockState {
  db.transaction((tx) => {
    const existing = tx
      .select({ id: funnelBlocks.id })
      .from(funnelBlocks)
      .where(and(eq(funnelBlocks.funnelId, funnelId), eq(funnelBlocks.kind, kind)))
      .get() as { id: number } | undefined;

    let blockId: number;
    if (existing) {
      blockId = existing.id;
      tx.update(funnelBlocks)
        .set({ enabled: enabled ? 1 : 0, mode })
        .where(eq(funnelBlocks.id, blockId))
        .run();
      tx.delete(funnelBlockItems).where(eq(funnelBlockItems.blockId, blockId)).run();
    } else {
      const inserted = tx
        .insert(funnelBlocks)
        .values({ funnelId, kind, enabled: enabled ? 1 : 0, mode })
        .returning({ id: funnelBlocks.id })
        .get() as { id: number };
      blockId = inserted.id;
    }

    items.forEach((it, i) => {
      tx.insert(funnelBlockItems)
        .values({ blockId, slot: it.slot ?? null, label: it.label, url: it.url, position: i })
        .run();
    });
  });

  return getBlock(db, funnelId, kind);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run tests/funnel-blocks.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/funnel-blocks.ts app/tests/funnel-blocks.test.ts
git commit -m "feat: funnel-blocks read/write helper"
```

---

### Task 6: Комнаты — `funnel-days.ts` на GC/Web/повтор + динамические дни

Перевести rooms-хелпер с `salesPage` на `replayUrl` и поддержать произвольный набор дней (редактор шлёт только показанные дни; пустые → удаляются). `MAX_DAY_NUM` остаётся 5.

**Files:**
- Modify: `app/src/lib/funnel-days.ts`
- Modify: `app/tests/funnel-days.test.ts` (обновить под новый `DayCell`)

**Interfaces:**
- Produces (изменено):
  - `type DayCell = { timeSlot: '19'|'15'; dayNum: number; gcRoom: string; webRoom: string; replayUrl: string }`
  - `listDays(db, funnelId): DayCell[]` (поля gc_room/web_room/replay_url)
  - `replaceDays(db, funnelId, cells): void` (UPSERT только gc_room/web_room/replay_url; пустая ячейка → DELETE)

- [ ] **Step 1: Write the failing test**

Replace `app/tests/funnel-days.test.ts` content with:
```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { listDays, replaceDays, type DayCell } from '../src/lib/funnel-days';
import * as schema from '../src/db/schema';

const REAL_DB = path.resolve(process.cwd(), '..', 'ksamata_funnels.db');
let tmp: string;
let sqlite: Database.Database;
let db: ReturnType<typeof drizzle>;
let funnelId: number;

beforeEach(() => {
  tmp = path.join(os.tmpdir(), `fd-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  fs.copyFileSync(REAL_DB, tmp);
  sqlite = new Database(tmp);
  db = drizzle(sqlite, { schema });
  funnelId = (sqlite.prepare('SELECT id FROM funnels LIMIT 1').get() as { id: number }).id;
  sqlite.prepare('DELETE FROM funnel_days WHERE funnel_id = ?').run(funnelId);
});

afterEach(() => {
  sqlite.close();
  fs.rmSync(tmp, { force: true });
});

describe('funnel-days (rooms)', () => {
  it('replaceDays writes gc/web/replay and listDays reads them', () => {
    const cells: DayCell[] = [
      { timeSlot: '15', dayNum: 1, gcRoom: 'g1', webRoom: 'w1', replayUrl: 'r1' },
      { timeSlot: '19', dayNum: 1, gcRoom: 'g2', webRoom: 'w2', replayUrl: '' },
    ];
    replaceDays(db, funnelId, cells);
    const got = listDays(db, funnelId);
    expect(got).toContainEqual({ timeSlot: '15', dayNum: 1, gcRoom: 'g1', webRoom: 'w1', replayUrl: 'r1' });
    expect(got).toContainEqual({ timeSlot: '19', dayNum: 1, gcRoom: 'g2', webRoom: 'w2', replayUrl: '' });
  });

  it('empty cell deletes the row', () => {
    replaceDays(db, funnelId, [{ timeSlot: '15', dayNum: 1, gcRoom: 'g', webRoom: '', replayUrl: '' }]);
    replaceDays(db, funnelId, [{ timeSlot: '15', dayNum: 1, gcRoom: '', webRoom: '', replayUrl: '' }]);
    expect(listDays(db, funnelId)).toHaveLength(0);
  });

  it('preserves other columns (tariffs) on update', () => {
    replaceDays(db, funnelId, [{ timeSlot: '15', dayNum: 1, gcRoom: 'g', webRoom: '', replayUrl: '' }]);
    sqlite.prepare(`UPDATE funnel_days SET tariffs='https://t' WHERE funnel_id=? AND time_slot='15' AND day_num=1`).run(funnelId);
    replaceDays(db, funnelId, [{ timeSlot: '15', dayNum: 1, gcRoom: 'g2', webRoom: '', replayUrl: '' }]);
    const t = sqlite.prepare(`SELECT tariffs FROM funnel_days WHERE funnel_id=? AND time_slot='15' AND day_num=1`).get(funnelId) as { tariffs: string };
    expect(t.tariffs).toBe('https://t');
  });

  it('rejects dayNum outside 1..5', () => {
    expect(() => replaceDays(db, funnelId, [{ timeSlot: '15', dayNum: 6, gcRoom: 'g', webRoom: '', replayUrl: '' }])).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run tests/funnel-days.test.ts`
Expected: FAIL — `replayUrl` missing from `DayCell` / old code references `salesPage`.

- [ ] **Step 3: Write minimal implementation**

In `app/src/lib/funnel-days.ts`: change `DayCell`, `listDays` select, the `isEmpty` check, the INSERT values, and the `onConflictDoUpdate` set to use `replayUrl`/`replay_url` instead of `salesPage`/`sales_page`. Final file:
```ts
/**
 * funnel-days.ts — read/write helper for funnel_days (вебинарные комнаты).
 * Manages ONLY gc_room, web_room, replay_url. All other columns are preserved
 * on UPDATE and default to '' on INSERT. Injected `db` handle.
 */

import { eq, and } from 'drizzle-orm';
import { type AnyDB } from '../db/client';
import { funnelDays, funnels } from '../db/schema';

export type DayCell = {
  timeSlot: '19' | '15';
  dayNum: number;
  gcRoom: string;
  webRoom: string;
  replayUrl: string;
};

const VALID_TIME_SLOTS = new Set<string>(['19', '15']);
const MIN_DAY_NUM = 1;
const MAX_DAY_NUM = 5;

function validateCell(cell: DayCell): void {
  if (!VALID_TIME_SLOTS.has(cell.timeSlot)) {
    throw new Error(`Invalid timeSlot "${cell.timeSlot}": must be '19' or '15'`);
  }
  if (cell.dayNum < MIN_DAY_NUM || cell.dayNum > MAX_DAY_NUM || !Number.isInteger(cell.dayNum)) {
    throw new Error(`Invalid dayNum ${cell.dayNum}: must be an integer between 1 and 5`);
  }
}

export function listDays(db: AnyDB, funnelId: number): DayCell[] {
  const rows = db
    .select({
      timeSlot: funnelDays.timeSlot,
      dayNum: funnelDays.dayNum,
      gcRoom: funnelDays.gcRoom,
      webRoom: funnelDays.webRoom,
      replayUrl: funnelDays.replayUrl,
    })
    .from(funnelDays)
    .where(eq(funnelDays.funnelId, funnelId))
    .orderBy(funnelDays.timeSlot, funnelDays.dayNum)
    .all();

  return rows.map((r: {
    timeSlot: string | null; dayNum: number;
    gcRoom: string | null; webRoom: string | null; replayUrl: string | null;
  }) => ({
    timeSlot: r.timeSlot as '19' | '15',
    dayNum: r.dayNum,
    gcRoom: r.gcRoom ?? '',
    webRoom: r.webRoom ?? '',
    replayUrl: r.replayUrl ?? '',
  }));
}

export function replaceDays(db: AnyDB, funnelId: number, cells: DayCell[]): void {
  for (const cell of cells) validateCell(cell);

  db.transaction((tx) => {
    for (const cell of cells) {
      const isEmpty =
        cell.gcRoom.trim() === '' &&
        cell.webRoom.trim() === '' &&
        cell.replayUrl.trim() === '';

      if (isEmpty) {
        tx.delete(funnelDays)
          .where(and(
            eq(funnelDays.funnelId, funnelId),
            eq(funnelDays.timeSlot, cell.timeSlot),
            eq(funnelDays.dayNum, cell.dayNum),
          ))
          .run();
      } else {
        tx.insert(funnelDays)
          .values({
            funnelId,
            timeSlot: cell.timeSlot,
            dayNum: cell.dayNum,
            gcRoom: cell.gcRoom,
            webRoom: cell.webRoom,
            replayUrl: cell.replayUrl,
          })
          .onConflictDoUpdate({
            target: [funnelDays.funnelId, funnelDays.timeSlot, funnelDays.dayNum],
            set: { gcRoom: cell.gcRoom, webRoom: cell.webRoom, replayUrl: cell.replayUrl },
          })
          .run();
      }
    }
  });
}

export function funnelExists(db: AnyDB, funnelId: number): boolean {
  const row = db.select({ id: funnels.id }).from(funnels).where(eq(funnels.id, funnelId)).get();
  return row !== undefined;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run tests/funnel-days.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/funnel-days.ts app/tests/funnel-days.test.ts
git commit -m "feat: rooms helper uses replay_url; dynamic days"
```

---

### Task 7: Идентичность — validation + `funnels.ts` (комментарий, время, повтор, имя)

Расширить идентичность: новые поля + производное имя. Сохранить существующее поведение axes/source.

**Files:**
- Modify: `app/src/lib/validation.ts`
- Modify: `app/src/lib/funnels.ts`
- Modify: `app/tests/api-funnels.test.ts` (добавить тесты новых полей; не ломать существующие)

**Interfaces:**
- Produces:
  - `validation.ts`: в `funnelCreateSchema` добавить `comment: z.string().optional()`, `timeLabelA: z.string().optional()`, `timeLabelB: z.string().optional()`, `roomsReplayEnabled: z.boolean().optional()`.
  - `ab-tags.ts` (или funnels.ts): `function funnelName(axes: AbAxes): string` → `«{product} / {contractor} / {channel} / {direction}»`.
  - `FunnelListItem` += `name: string`. `FunnelDetail` += `comment: string; timeLabelA: string; timeLabelB: string; roomsReplayEnabled: boolean`.
  - `getFunnel`/`listFunnels` заполняют новые поля; `createFunnel`/`updateFunnel` пишут `comment`/`timeLabelA`/`timeLabelB`/`roomsReplayEnabled`.

- [ ] **Step 1: Write the failing test**

Append to `app/tests/api-funnels.test.ts` (inside the existing top-level `describe`, reuse its `db`/`funnelId` setup; if the file builds its own temp DB per test, mirror that):
```ts
  it('funnelName derives «product / contractor / channel / direction»', async () => {
    const { funnelName } = await import('../src/lib/funnels');
    expect(funnelName({ product: 'БОО', contractor: 'NR', channel: 'ВК', direction: 'Перелив с БОО' }))
      .toBe('БОО / NR / ВК / Перелив с БОО');
  });

  it('updateFunnel persists comment and time labels', () => {
    const updated = updateFunnel(db, seededFunnelId, {
      comment: 'тест', timeLabelA: '12:00', timeLabelB: '20:00', roomsReplayEnabled: true,
    });
    expect(updated).not.toBeNull();
    const detail = getFunnel(db, seededFunnelId)!;
    expect(detail.comment).toBe('тест');
    expect(detail.timeLabelA).toBe('12:00');
    expect(detail.timeLabelB).toBe('20:00');
    expect(detail.roomsReplayEnabled).toBe(true);
    expect(detail.name).toContain(' / ');
  });
```
(Use whatever the file already names its funnel id; replace `seededFunnelId` with the existing variable. Ensure `getFunnel`, `updateFunnel` are imported — they already are in this test file.)

**Note for implementer:** the test temp DB must have Phase-3 columns. In this test file's `beforeEach`, after copying the real DB and before constructing `db`, call `runMigratePhase3(sqlite)` (import from `../scripts/migrate-phase3`). Add that line if absent.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run tests/api-funnels.test.ts`
Expected: FAIL — `funnelName` not exported / `comment` not on `FunnelDetail`.

- [ ] **Step 3: Write minimal implementation**

In `app/src/lib/validation.ts`, add to `funnelCreateSchema` object (before `sourceName`):
```ts
  comment: z.string().optional(),
  timeLabelA: z.string().optional(),
  timeLabelB: z.string().optional(),
  roomsReplayEnabled: z.boolean().optional(),
```

In `app/src/lib/funnels.ts`:
1. Add near the top (after imports):
```ts
export function funnelName(axes: AbAxes): string {
  return `${axes.product} / ${axes.contractor} / ${axes.channel} / ${axes.direction}`;
}
```
2. Extend `FunnelListItem`:
```ts
export type FunnelListItem = {
  id: number;
  num: number;
  frontCode: string;
  status: string;
  productName: string;
  name: string;
  axes: AbAxes;
};
```
3. Extend `FunnelDetail`:
```ts
export type FunnelDetail = FunnelListItem & {
  sourceId: number;
  productId: number;
  contractorId: number;
  variant: string;
  landingUrl: string;
  startDate: string;
  blockName: string;
  comment: string;
  timeLabelA: string;
  timeLabelB: string;
  roomsReplayEnabled: boolean;
};
```
4. In `listFunnels`, set `name: funnelName(getAxesForFunnel(db, f.id))` — compute axes once:
```ts
  return rows.map((f) => {
    const axes = getAxesForFunnel(db, f.id);
    return {
      id: f.id, num: f.num, frontCode: f.frontCode ?? '', status: f.status ?? 'active',
      productName: f.productName, name: funnelName(axes), axes,
    };
  });
```
5. In `getFunnel`, after computing axes, add `name`, `comment`, `timeLabelA`, `timeLabelB`, `roomsReplayEnabled`:
```ts
  const axes = getAxesForFunnel(db, row.id);
  return {
    id: row.id, num: row.num, frontCode: row.frontCode ?? '', status: row.status ?? 'active',
    productName: row.productName, name: funnelName(axes),
    sourceId: row.sourceId, productId: row.productId, contractorId: row.contractorId,
    variant: row.variant ?? '', landingUrl: row.landingUrl ?? '', startDate: row.startDate ?? '',
    blockName: row.blockName ?? '',
    comment: row.comment ?? '',
    timeLabelA: row.timeLabelA ?? '15:00',
    timeLabelB: row.timeLabelB ?? '19:00',
    roomsReplayEnabled: (row.roomsReplayEnabled ?? 0) === 1,
    axes,
  };
```
6. In `createFunnel`'s returned object and `updateFunnel`/`duplicateFunnel` `FunnelListItem` results, add `name: funnelName(axes)` (use the axes already in scope).
7. In `updateFunnel`, add scalar handling (in the scalarUpdate block):
```ts
    if (data.comment            !== undefined) scalarUpdate.comment            = data.comment;
    if (data.timeLabelA         !== undefined) scalarUpdate.timeLabelA         = data.timeLabelA;
    if (data.timeLabelB         !== undefined) scalarUpdate.timeLabelB         = data.timeLabelB;
    if (data.roomsReplayEnabled !== undefined) scalarUpdate.roomsReplayEnabled = data.roomsReplayEnabled ? 1 : 0;
```
8. In `createFunnel`'s `tx.insert(funnels).values({...})`, add `comment: data.comment ?? '', timeLabelA: data.timeLabelA ?? '15:00', timeLabelB: data.timeLabelB ?? '19:00', roomsReplayEnabled: data.roomsReplayEnabled ? 1 : 0,`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run tests/api-funnels.test.ts`
Expected: PASS (existing + 2 new).

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/validation.ts app/src/lib/funnels.ts app/tests/api-funnels.test.ts
git commit -m "feat: funnel identity adds comment/time labels/replay flag + derived name"
```

---

### Task 8: API — `/api/funnels/[id]/blocks/[kind]` (GET/PUT)

Тонкий route-хендлер по образцу `links/route.ts`. Валидирует kind через `isBlockKind`, mode через каталог, items.

**Files:**
- Create: `app/src/app/api/funnels/[id]/blocks/[kind]/route.ts`
- Test: `app/tests/api-blocks-route.test.ts`

**Interfaces:**
- Consumes: `getBlock`/`replaceBlock` (funnel-blocks.ts), `funnelExists` (funnel-days.ts), `isBlockKind`/`getBlockDef` (blocks.ts).
- Produces: `GET` → `BlockState`; `PUT` body `{ enabled: boolean; mode: 'common'|'by_time'; items: {slot,label,url}[] }` → обновлённый `BlockState`.

- [ ] **Step 1: Write the failing test**

`app/tests/api-blocks-route.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { runMigratePhase3 } from '../scripts/migrate-phase3';
import * as schema from '../src/db/schema';

const REAL_DB = path.resolve(process.cwd(), '..', 'ksamata_funnels.db');
let tmp: string;
let sqlite: Database.Database;
let funnelId: number;

beforeEach(() => {
  tmp = path.join(os.tmpdir(), `br-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  fs.copyFileSync(REAL_DB, tmp);
  sqlite = new Database(tmp);
  runMigratePhase3(sqlite);
  funnelId = (sqlite.prepare('SELECT id FROM funnels LIMIT 1').get() as { id: number }).id;
  const db = drizzle(sqlite, { schema });
  vi.doMock('@/db/client', () => ({ db }));
});

afterEach(() => {
  vi.resetModules();
  sqlite.close();
  fs.rmSync(tmp, { force: true });
});

function req(body: unknown) {
  return new Request('http://test', { method: 'PUT', body: JSON.stringify(body) }) as never;
}

describe('blocks route', () => {
  it('PUT then GET round-trips a block', async () => {
    const route = await import('../src/app/api/funnels/[id]/blocks/[kind]/route');
    const params = Promise.resolve({ id: String(funnelId), kind: 'tariffs' });
    const putRes = await route.PUT(req({ enabled: true, mode: 'common', items: [{ slot: null, label: '', url: 'https://a' }] }), { params });
    expect(putRes.status).toBe(200);
    const getRes = await route.GET({} as never, { params: Promise.resolve({ id: String(funnelId), kind: 'tariffs' }) });
    const body = await getRes.json();
    expect(body.enabled).toBe(true);
    expect(body.items).toEqual([{ slot: null, label: '', url: 'https://a' }]);
  });

  it('rejects unknown kind with 400', async () => {
    const route = await import('../src/app/api/funnels/[id]/blocks/[kind]/route');
    const res = await route.GET({} as never, { params: Promise.resolve({ id: String(funnelId), kind: 'rooms' }) });
    expect(res.status).toBe(400);
  });

  it('rejects invalid mode for landings (common-only) with 400', async () => {
    const route = await import('../src/app/api/funnels/[id]/blocks/[kind]/route');
    const res = await route.PUT(req({ enabled: true, mode: 'by_time', items: [] }), { params: Promise.resolve({ id: String(funnelId), kind: 'landings' }) });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run tests/api-blocks-route.test.ts`
Expected: FAIL — route module not found.

- [ ] **Step 3: Write minimal implementation**

`app/src/app/api/funnels/[id]/blocks/[kind]/route.ts`:
```ts
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db/client';
import { getBlock, replaceBlock, type BlockItem } from '@/lib/funnel-blocks';
import { funnelExists } from '@/lib/funnel-days';
import { isBlockKind, getBlockDef } from '@/lib/blocks';

type Params = { params: Promise<{ id: string; kind: string }> };

function parse(id: string, kind: string) {
  const numId = parseInt(id, 10);
  if (isNaN(numId)) return { error: NextResponse.json({ error: 'Invalid id' }, { status: 400 }) };
  if (!isBlockKind(kind)) return { error: NextResponse.json({ error: 'Invalid kind' }, { status: 400 }) };
  return { numId, kind };
}

export async function GET(_req: NextRequest, { params }: Params) {
  const { id, kind } = await params;
  const p = parse(id, kind);
  if ('error' in p) return p.error;
  if (!funnelExists(db, p.numId)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(getBlock(db, p.numId, p.kind as never));
}

export async function PUT(req: NextRequest, { params }: Params) {
  const { id, kind } = await params;
  const p = parse(id, kind);
  if ('error' in p) return p.error;
  if (!funnelExists(db, p.numId)) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }); }
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Body must be an object' }, { status: 400 });

  const b = body as { enabled?: unknown; mode?: unknown; items?: unknown };
  const def = getBlockDef(p.kind as never);

  if (typeof b.enabled !== 'boolean') return NextResponse.json({ error: 'enabled must be boolean' }, { status: 400 });
  if (b.mode !== 'common' && b.mode !== 'by_time') return NextResponse.json({ error: 'invalid mode' }, { status: 400 });
  if (!def.modes.includes(b.mode)) return NextResponse.json({ error: `mode ${b.mode} not allowed for ${p.kind}` }, { status: 400 });
  if (!Array.isArray(b.items)) return NextResponse.json({ error: 'items must be an array' }, { status: 400 });

  const items: BlockItem[] = [];
  for (let i = 0; i < b.items.length; i++) {
    const it = b.items[i] as { slot?: unknown; label?: unknown; url?: unknown };
    if (typeof it?.label !== 'string' || typeof it?.url !== 'string') {
      return NextResponse.json({ error: `items[${i}] needs string label and url` }, { status: 400 });
    }
    const slot = it.slot === '15' || it.slot === '19' ? it.slot : null;
    items.push({ slot, label: it.label, url: it.url });
  }

  const result = replaceBlock(db, p.numId, p.kind as never, b.enabled, b.mode, items);
  return NextResponse.json(result);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run tests/api-blocks-route.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add "app/src/app/api/funnels/[id]/blocks/[kind]/route.ts" app/tests/api-blocks-route.test.ts
git commit -m "feat: /api/funnels/[id]/blocks/[kind] GET+PUT"
```

---

### Task 9: API — rooms-роут на новый `DayCell`

Существующий `/api/funnels/[id]/days/route.ts` отдаёт/принимает `gcRoom/webRoom/salesPage`. Перевести на `gcRoom/webRoom/replayUrl` (без `salesPage`).

**Files:**
- Modify: `app/src/app/api/funnels/[id]/days/route.ts`
- Test: добавить/обновить `app/tests/` для days-роута, если есть; иначе покрытие через Task 6 (helper) достаточно — добавить минимальный route-тест `app/tests/api-days-route.test.ts`.

**Interfaces:**
- Consumes: `listDays`/`replaceDays`/`funnelExists` (funnel-days.ts) с новым `DayCell`.
- Produces: `GET` → `DayCell[]`; `PUT` body `{ cells: DayCell[] }` → обновлённый `DayCell[]`.

- [ ] **Step 1: Write the failing test**

`app/tests/api-days-route.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import * as schema from '../src/db/schema';

const REAL_DB = path.resolve(process.cwd(), '..', 'ksamata_funnels.db');
let tmp: string; let sqlite: Database.Database; let funnelId: number;

beforeEach(() => {
  tmp = path.join(os.tmpdir(), `dr-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  fs.copyFileSync(REAL_DB, tmp);
  sqlite = new Database(tmp);
  funnelId = (sqlite.prepare('SELECT id FROM funnels LIMIT 1').get() as { id: number }).id;
  sqlite.prepare('DELETE FROM funnel_days WHERE funnel_id = ?').run(funnelId);
  vi.doMock('@/db/client', () => ({ db: drizzle(sqlite, { schema }) }));
});
afterEach(() => { vi.resetModules(); sqlite.close(); fs.rmSync(tmp, { force: true }); });

describe('days route', () => {
  it('PUT cells with replayUrl, GET returns them', async () => {
    const route = await import('../src/app/api/funnels/[id]/days/route');
    const params = Promise.resolve({ id: String(funnelId) });
    const put = await route.PUT(
      new Request('http://t', { method: 'PUT', body: JSON.stringify({ cells: [{ timeSlot: '15', dayNum: 1, gcRoom: 'g', webRoom: 'w', replayUrl: 'r' }] }) }) as never,
      { params },
    );
    expect(put.status).toBe(200);
    const get = await route.GET({} as never, { params: Promise.resolve({ id: String(funnelId) }) });
    const body = await get.json();
    expect(body).toContainEqual({ timeSlot: '15', dayNum: 1, gcRoom: 'g', webRoom: 'w', replayUrl: 'r' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run tests/api-days-route.test.ts`
Expected: FAIL — route still validates/echoes `salesPage`.

- [ ] **Step 3: Write minimal implementation**

In `app/src/app/api/funnels/[id]/days/route.ts`, change the per-cell validation and the constructed `DayCell` to use `replayUrl` instead of `salesPage`. The cell-building loop becomes:
```ts
    const cell = rawCells[i] as Record<string, unknown>;
    if (
      (cell.timeSlot !== '19' && cell.timeSlot !== '15') ||
      typeof cell.dayNum !== 'number' ||
      typeof cell.gcRoom !== 'string' ||
      typeof cell.webRoom !== 'string' ||
      typeof cell.replayUrl !== 'string'
    ) {
      return NextResponse.json({ error: `cells[${i}] has invalid shape` }, { status: 400 });
    }
    cells.push({
      timeSlot: cell.timeSlot, dayNum: cell.dayNum,
      gcRoom: cell.gcRoom, webRoom: cell.webRoom, replayUrl: cell.replayUrl,
    });
```
(Keep the existing 400/404/JSON-guard structure from the current file; only the field names change from `salesPage` to `replayUrl`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run tests/api-days-route.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "app/src/app/api/funnels/[id]/days/route.ts" app/tests/api-days-route.test.ts
git commit -m "feat: days route uses replayUrl (rooms)"
```

---

### Task 10: Docker — runner Фазы 3 + entrypoint

Standalone-раннер (esbuild → `.cjs`) для применения Фазы 3 (схема + данные) при старте контейнера, по образцу `migrate-phase2-runner.ts`. Обновить Dockerfile (esbuild-бандл) и `docker-entrypoint.sh` (вызвать после Фазы 2).

**Files:**
- Create: `app/scripts/migrate-phase3-runner.ts`
- Modify: `app/Dockerfile` (добавить esbuild-бандл `migrate-phase3.cjs`)
- Modify: `app/docker-entrypoint.sh` (вызвать `node /app/migrate-phase3.cjs` после Фазы 2)

**Interfaces:**
- Consumes: `runMigratePhase3` (migrate-phase3.ts), `migrateFunnelData` (migrate-funnel-data.ts).

- [ ] **Step 1: Write the runner**

`app/scripts/migrate-phase3-runner.ts`:
```ts
/**
 * Standalone Phase-3 migration for the Docker runner image.
 * Compiled to migrate-phase3.cjs via esbuild in the builder stage:
 *   npx esbuild scripts/migrate-phase3-runner.ts \
 *     --bundle --platform=node --external:better-sqlite3 --outfile=migrate-phase3.cjs
 * Invoked by docker-entrypoint.sh as: node /app/migrate-phase3.cjs
 */

import Database from 'better-sqlite3';
import { runMigratePhase3 } from './migrate-phase3';
import { migrateFunnelData } from './migrate-funnel-data';

const dbPath = process.env.FUNNELS_DB_PATH;
if (!dbPath) {
  console.error('[migrate-phase3] FUNNELS_DB_PATH is not set — skipping.');
  process.exit(0);
}

console.log(`[migrate-phase3] Running Phase-3 migration on: ${dbPath}`);
const sqlite = new Database(dbPath);
sqlite.pragma('journal_mode = WAL');
runMigratePhase3(sqlite);
migrateFunnelData(sqlite);
sqlite.close();
console.log('[migrate-phase3] Done (schema + data).');
```

**Note:** `migrate-phase3.ts` and `migrate-funnel-data.ts` have `if (require.main === module)` CLI blocks that `require('better-sqlite3')`. esbuild with `--external:better-sqlite3` keeps that external; the runner imports the exported functions, so the CLI blocks do not execute. This matches Phase-2's structure.

- [ ] **Step 2: Wire Dockerfile**

In `app/Dockerfile`, find the builder-stage line that bundles Phase-2 (`esbuild scripts/migrate-phase2-runner.ts ... --outfile=migrate-phase2.cjs`) and add immediately after it an analogous line:
```dockerfile
RUN npx esbuild scripts/migrate-phase3-runner.ts \
    --bundle --platform=node --external:better-sqlite3 \
    --outfile=migrate-phase3.cjs
```
Find the line(s) that `COPY` `migrate-phase2.cjs` into the runner stage and add a parallel `COPY ... migrate-phase3.cjs ...` next to it (same source/dest convention).

- [ ] **Step 3: Wire entrypoint**

In `app/docker-entrypoint.sh`, after the Phase-2 migration block and **before** `exec node server.js`, add:
```sh
# Apply Phase-3 migration (idempotent: guarded ALTER + CREATE IF NOT EXISTS + skip-if-has-blocks data move).
if [ -n "$FUNNELS_DB_PATH" ]; then
  echo "[entrypoint] Running Phase-3 migration against $FUNNELS_DB_PATH"
  node /app/migrate-phase3.cjs
  echo "[entrypoint] Phase-3 migration done."
fi
```

- [ ] **Step 4: Verify the bundle builds locally**

Run: `cd app && npx esbuild scripts/migrate-phase3-runner.ts --bundle --platform=node --external:better-sqlite3 --outfile=/tmp/migrate-phase3.cjs && node -e "require('fs').accessSync('/tmp/migrate-phase3.cjs')" && echo OK`
Expected: prints `OK` (bundle compiles).

Then verify it runs end-to-end on a temp copy:
Run: `cd app && cp ../ksamata_funnels.db /tmp/ph3.db && FUNNELS_DB_PATH=/tmp/ph3.db node /tmp/migrate-phase3.cjs && echo DONE`
Expected: logs "Done (schema + data)." then `DONE`. (Clean up `/tmp/ph3.db` after.)

- [ ] **Step 5: Commit**

```bash
git add app/scripts/migrate-phase3-runner.ts app/Dockerfile app/docker-entrypoint.sh
git commit -m "feat: Phase-3 Docker runner + entrypoint wiring"
```

---

### Task 11: UI — глобальная светлая схема + `BlockListField` (атом строки блока)

Зафиксировать `color-scheme: light` и сделать переиспользуемый редактор строк блока-списка (1 или 2 поля, slot опционально).

**Files:**
- Modify: `app/src/app/globals.css` (добавить `color-scheme: light` и `::placeholder`)
- Create: `app/src/components/BlockListField.tsx`

**Interfaces:**
- Produces:
  - `BlockListField` props: `{ fields: 1|2; items: BlockItem[]; onChange: (items: BlockItem[]) => void; slot: '15'|'19'|null }` — редактирует подсписок строк для одного slot (или общий при slot=null). `BlockItem` импортируется из `@/lib/funnel-blocks`.

- [ ] **Step 1: globals.css**

In `app/src/app/globals.css`, after the existing `html, body { ... }` block append:
```css
:root {
  color-scheme: light;
}

input::placeholder,
textarea::placeholder {
  color: var(--faint);
  opacity: 1;
}
```

- [ ] **Step 2: BlockListField component**

`app/src/components/BlockListField.tsx`:
```tsx
'use client';

import { Trash2, Plus } from 'lucide-react';
import type { BlockItem } from '@/lib/funnel-blocks';

interface Props {
  fields: 1 | 2;
  slot: '15' | '19' | null;
  items: BlockItem[];
  onChange: (items: BlockItem[]) => void;
}

export default function BlockListField({ fields, slot, items, onChange }: Props) {
  const rows = items.filter((it) => it.slot === slot);

  function update(indexInRows: number, patch: Partial<BlockItem>) {
    let seen = -1;
    onChange(
      items.map((it) => {
        if (it.slot !== slot) return it;
        seen += 1;
        return seen === indexInRows ? { ...it, ...patch } : it;
      }),
    );
  }

  function remove(indexInRows: number) {
    let seen = -1;
    onChange(items.filter((it) => (it.slot === slot ? ++seen !== indexInRows : true)));
  }

  function add() {
    onChange([...items, { slot, label: '', url: '' }]);
  }

  return (
    <div className="flex flex-col gap-1.5">
      {fields === 2 && rows.length > 0 && (
        <div className="grid grid-cols-[150px_1fr_24px] gap-2 text-[10px] uppercase tracking-wide text-[var(--faint)]">
          <span>Описание</span><span>Ссылка</span><span />
        </div>
      )}
      {rows.map((row, i) => (
        <div
          key={i}
          className={
            fields === 2
              ? 'grid grid-cols-[150px_1fr_24px] items-center gap-2'
              : 'grid grid-cols-[1fr_24px] items-center gap-2'
          }
        >
          {fields === 2 && (
            <input
              value={row.label}
              onChange={(e) => update(i, { label: e.target.value })}
              placeholder="описание…"
              className="h-7 rounded-[6px] border border-[var(--line-soft)] bg-white px-2 text-[12px] text-[var(--ink)]"
            />
          )}
          <input
            value={row.url}
            onChange={(e) => update(i, { url: e.target.value })}
            placeholder="ссылка…"
            className="h-7 rounded-[6px] border border-[var(--line-soft)] bg-white px-2 font-mono text-[12px] text-[var(--ink)]"
          />
          <button type="button" onClick={() => remove(i)} aria-label="Удалить строку" className="text-[var(--faint)] hover:text-[var(--ink)]">
            <Trash2 size={15} />
          </button>
        </div>
      ))}
      <button type="button" onClick={add} className="mt-1 flex w-fit items-center gap-1 text-[12px] font-semibold text-[var(--orange)]">
        <Plus size={13} /> добавить
      </button>
    </div>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `cd app && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add app/src/app/globals.css app/src/components/BlockListField.tsx
git commit -m "feat: light color-scheme + BlockListField row editor"
```

---

### Task 12: UI — `BlockEditor` (универсальный блок-список)

Шапка (иконка, заголовок, сегмент режима если режимов >1, тумблер вкл/выкл) + контент (`common` → один `BlockListField`; `by_time` → два, подписанные `timeLabelA`/`timeLabelB`). Сохранение через `PUT /api/funnels/[id]/blocks/[kind]`.

**Files:**
- Create: `app/src/components/BlockEditor.tsx`
- Create: `app/src/components/Switch.tsx` (тумблер) и `app/src/components/Segmented.tsx` (сегмент) — мелкие атомы, переиспользуются идентичностью.

**Interfaces:**
- Consumes: `BlockState`/`BlockItem` (funnel-blocks), `getBlockDef` (blocks), `BlockListField`, `Switch`, `Segmented`.
- Produces:
  - `Switch` props `{ checked: boolean; onChange: (v: boolean) => void; label?: string }`.
  - `Segmented` props `{ options: {value: string; label: string}[]; value: string; onChange: (v: string) => void }`.
  - `BlockEditor` props `{ funnelId: number; initial: BlockState; timeLabelA: string; timeLabelB: string }`.

- [ ] **Step 1: Switch + Segmented atoms**

`app/src/components/Switch.tsx`:
```tsx
'use client';
interface Props { checked: boolean; onChange: (v: boolean) => void; label?: string }
export default function Switch({ checked, onChange, label }: Props) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {label && <span className="text-[11px] text-[var(--muted)]">{label}</span>}
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className="relative inline-block h-[17px] w-[30px] rounded-full transition"
        style={{ background: checked ? 'var(--orange)' : 'var(--line)' }}
      >
        <span className="absolute top-[2px] h-[13px] w-[13px] rounded-full bg-white transition-all" style={{ left: checked ? '15px' : '2px' }} />
      </button>
    </span>
  );
}
```

`app/src/components/Segmented.tsx`:
```tsx
'use client';
interface Props { options: { value: string; label: string }[]; value: string; onChange: (v: string) => void }
export default function Segmented({ options, value, onChange }: Props) {
  return (
    <span className="inline-flex gap-[2px] rounded-[7px] bg-[var(--chip)] p-[2px]">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className="rounded-[5px] px-2.5 py-[3px] text-[11px]"
            style={active ? { background: '#fff', color: 'var(--ink)' } : { color: 'var(--faint)' }}
          >
            {o.label}
          </button>
        );
      })}
    </span>
  );
}
```

- [ ] **Step 2: BlockEditor**

`app/src/components/BlockEditor.tsx`:
```tsx
'use client';

import { useState } from 'react';
import * as Icons from 'lucide-react';
import { getBlockDef, type BlockMode } from '@/lib/blocks';
import type { BlockState, BlockItem } from '@/lib/funnel-blocks';
import Switch from './Switch';
import Segmented from './Segmented';
import BlockListField from './BlockListField';

interface Props { funnelId: number; initial: BlockState; timeLabelA: string; timeLabelB: string }

export default function BlockEditor({ funnelId, initial, timeLabelA, timeLabelB }: Props) {
  const def = getBlockDef(initial.kind);
  const [enabled, setEnabled] = useState(initial.enabled);
  const [mode, setMode] = useState<BlockMode>(initial.mode);
  const [items, setItems] = useState<BlockItem[]>(initial.items);
  const [saving, setSaving] = useState(false);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Icon = (Icons as any)[def.icon] ?? Icons.Link;

  async function save(next?: { enabled?: boolean; mode?: BlockMode; items?: BlockItem[] }) {
    const payloadEnabled = next?.enabled ?? enabled;
    const payloadMode = next?.mode ?? mode;
    // When common, flatten slots to null; when by_time keep slot
    const payloadItems = (next?.items ?? items).map((it) =>
      payloadMode === 'common' ? { ...it, slot: null } : it,
    );
    setSaving(true);
    try {
      await fetch(`/api/funnels/${funnelId}/blocks/${initial.kind}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: payloadEnabled, mode: payloadMode, items: payloadItems }),
      });
    } finally {
      setSaving(false);
    }
  }

  if (!enabled) {
    return (
      <div className="mb-2.5 flex items-center gap-2 rounded-[10px] border border-[var(--line-soft)] bg-[var(--card)] px-3.5 py-2.5 opacity-60">
        <Icon size={16} className="text-[var(--faint)]" />
        <span className="text-[13px] font-medium text-[var(--muted)]">{def.title}</span>
        <span className="ml-auto">
          <Switch checked={false} onChange={(v) => { setEnabled(v); save({ enabled: v }); }} />
        </span>
      </div>
    );
  }

  return (
    <div className="mb-2.5 rounded-[10px] border border-[var(--line-soft)] bg-[var(--paper)] p-3.5">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Icon size={17} className="text-[var(--orange)]" />
        <span className="text-[13px] font-medium">{def.title}</span>
        {def.modes.length > 1 && (
          <Segmented
            options={[{ value: 'common', label: 'Общее' }, { value: 'by_time', label: 'По времени' }]}
            value={mode}
            onChange={(v) => { const m = v as BlockMode; setMode(m); save({ mode: m }); }}
          />
        )}
        <span className="ml-auto">
          <Switch checked={true} onChange={(v) => { setEnabled(v); save({ enabled: v }); }} />
        </span>
      </div>

      {mode === 'common' ? (
        <BlockListField fields={def.fields} slot={null} items={items}
          onChange={(next) => { setItems(next); }} />
      ) : (
        <div className="flex gap-3">
          <div className="flex-1">
            <div className="mb-1 text-[11px] font-medium text-[var(--muted)]">{timeLabelA}</div>
            <BlockListField fields={def.fields} slot="15" items={items} onChange={(next) => setItems(next)} />
          </div>
          <div className="flex-1">
            <div className="mb-1 text-[11px] font-medium text-[var(--muted)]">{timeLabelB}</div>
            <BlockListField fields={def.fields} slot="19" items={items} onChange={(next) => setItems(next)} />
          </div>
        </div>
      )}

      <div className="mt-3 flex justify-end">
        <button type="button" onClick={() => save()} disabled={saving}
          className="rounded-[8px] bg-[var(--orange)] px-4 py-1.5 text-[12px] font-semibold text-white disabled:opacity-60">
          {saving ? 'Сохранение…' : 'Сохранить'}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `cd app && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add app/src/components/Switch.tsx app/src/components/Segmented.tsx app/src/components/BlockEditor.tsx
git commit -m "feat: BlockEditor + Switch/Segmented atoms"
```

---

### Task 13: UI — `RoomsEditor` (GC/Web/повтор, динамические дни)

Особый блок комнат: оба времени колонками, поля GC/Web (+ повтор по флагу), дни 1..N (деф. 3), кнопка «добавить день» (до 5). Сохранение через `PUT /api/funnels/[id]/days`.

**Files:**
- Create: `app/src/components/RoomsEditor.tsx`
- Remove: `app/src/components/DaysEditor.tsx` (заменяется RoomsEditor)

**Interfaces:**
- Consumes: `DayCell` (funnel-days), `Switch`.
- Produces: `RoomsEditor` props `{ funnelId: number; initialDays: DayCell[]; replayEnabled: boolean; timeLabelA: string; timeLabelB: string }`.

- [ ] **Step 1: RoomsEditor**

`app/src/components/RoomsEditor.tsx`:
```tsx
'use client';

import { useState } from 'react';
import { Tv, Plus } from 'lucide-react';
import Switch from './Switch';
import type { DayCell } from '@/lib/funnel-days';

interface Props {
  funnelId: number;
  initialDays: DayCell[];
  replayEnabled: boolean;
  timeLabelA: string;
  timeLabelB: string;
}

const SLOTS: ('15' | '19')[] = ['15', '19'];
const MAX_DAYS = 5;

type Cell = { gcRoom: string; webRoom: string; replayUrl: string };
type Grid = Record<string, Cell>; // key `${slot}-${day}`

function key(slot: string, day: number) { return `${slot}-${day}`; }

function buildGrid(days: DayCell[], dayCount: number): Grid {
  const g: Grid = {};
  for (const slot of SLOTS) for (let d = 1; d <= dayCount; d++) g[key(slot, d)] = { gcRoom: '', webRoom: '', replayUrl: '' };
  for (const d of days) g[key(d.timeSlot, d.dayNum)] = { gcRoom: d.gcRoom, webRoom: d.webRoom, replayUrl: d.replayUrl };
  return g;
}

export default function RoomsEditor({ funnelId, initialDays, replayEnabled, timeLabelA, timeLabelB }: Props) {
  const initialDayCount = Math.max(3, ...initialDays.map((d) => d.dayNum), 0) || 3;
  const [dayCount, setDayCount] = useState(Math.min(MAX_DAYS, initialDayCount));
  const [replay, setReplay] = useState(replayEnabled);
  const [grid, setGrid] = useState<Grid>(() => buildGrid(initialDays, Math.min(MAX_DAYS, initialDayCount)));
  const [saving, setSaving] = useState(false);
  const labels = { '15': timeLabelA, '19': timeLabelB } as const;

  function set(slot: string, day: number, field: keyof Cell, value: string) {
    setGrid((p) => ({ ...p, [key(slot, day)]: { ...p[key(slot, day)], [field]: value } }));
  }

  function addDay() {
    if (dayCount >= MAX_DAYS) return;
    const next = dayCount + 1;
    setGrid((p) => {
      const g = { ...p };
      for (const slot of SLOTS) g[key(slot, next)] = { gcRoom: '', webRoom: '', replayUrl: '' };
      return g;
    });
    setDayCount(next);
  }

  async function save() {
    setSaving(true);
    const cells: DayCell[] = [];
    for (const slot of SLOTS) for (let d = 1; d <= dayCount; d++) {
      const c = grid[key(slot, d)];
      cells.push({ timeSlot: slot, dayNum: d, gcRoom: c.gcRoom, webRoom: c.webRoom, replayUrl: replay ? c.replayUrl : '' });
    }
    try {
      await fetch(`/api/funnels/${funnelId}/days`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cells }),
      });
      // Persist replay flag on the funnel
      await fetch(`/api/funnels/${funnelId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ roomsReplayEnabled: replay }),
      });
    } finally { setSaving(false); }
  }

  const cols = replay ? 'grid-cols-[22px_1fr_1fr_0.8fr]' : 'grid-cols-[22px_1fr_1fr]';

  return (
    <div className="mb-2.5 rounded-[10px] border border-[var(--line-soft)] bg-[var(--paper)] p-3.5">
      <div className="mb-2 flex items-center gap-2">
        <Tv size={17} className="text-[var(--orange)]" />
        <span className="text-[13px] font-medium">Вебинарные комнаты</span>
        <span className="ml-auto"><Switch checked={replay} onChange={setReplay} label="повтор" /></span>
      </div>

      <div className="flex gap-2.5">
        {SLOTS.map((slot) => (
          <div key={slot} className="flex-1">
            <div className="mb-1 text-[11px] font-medium text-[var(--muted)]">{labels[slot]}</div>
            <div className={`grid ${cols} items-center gap-1`}>
              <span /><span className="text-[10px] text-[var(--faint)]">GC</span>
              <span className="text-[10px] text-[var(--faint)]">Web</span>
              {replay && <span className="text-[10px] text-[var(--faint)]">повтор</span>}
              {Array.from({ length: dayCount }, (_, idx) => idx + 1).map((day) => {
                const c = grid[key(slot, day)];
                return (
                  <FragmentRow key={day} day={day} cell={c} replay={replay}
                    onChange={(f, v) => set(slot, day, f, v)} />
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-2 flex items-center justify-between">
        <button type="button" onClick={addDay} disabled={dayCount >= MAX_DAYS}
          className="flex items-center gap-1 text-[12px] font-semibold text-[var(--orange)] disabled:opacity-40">
          <Plus size={13} /> добавить день
        </button>
        <button type="button" onClick={save} disabled={saving}
          className="rounded-[8px] bg-[var(--orange)] px-4 py-1.5 text-[12px] font-semibold text-white disabled:opacity-60">
          {saving ? 'Сохранение…' : 'Сохранить'}
        </button>
      </div>
    </div>
  );
}

function FragmentRow({ day, cell, replay, onChange }: {
  day: number; cell: { gcRoom: string; webRoom: string; replayUrl: string };
  replay: boolean; onChange: (field: 'gcRoom' | 'webRoom' | 'replayUrl', value: string) => void;
}) {
  const inp = 'h-6 rounded-[5px] border border-[var(--line-soft)] bg-white px-1.5 font-mono text-[11px] text-[var(--ink)]';
  return (
    <>
      <span className="rounded-[4px] bg-[var(--chip)] py-[2px] text-center font-mono text-[10px] text-[var(--muted)]">{day}</span>
      <input className={inp} value={cell.gcRoom} placeholder="gc…" onChange={(e) => onChange('gcRoom', e.target.value)} />
      <input className={inp} value={cell.webRoom} placeholder="web…" onChange={(e) => onChange('webRoom', e.target.value)} />
      {replay && <input className={inp} value={cell.replayUrl} placeholder="повтор…" onChange={(e) => onChange('replayUrl', e.target.value)} />}
    </>
  );
}
```

- [ ] **Step 2: Remove DaysEditor**

Run: `cd app && git rm src/components/DaysEditor.tsx`

- [ ] **Step 3: Typecheck**

Run: `cd app && npx tsc --noEmit`
Expected: errors ONLY in `src/app/funnels/[id]/page.tsx` (still imports DaysEditor) — fixed in Task 14. If any error is inside RoomsEditor itself, fix it.

- [ ] **Step 4: Commit**

```bash
git add app/src/components/RoomsEditor.tsx
git commit -m "feat: RoomsEditor (GC/Web/replay, dynamic days); remove DaysEditor"
```

---

### Task 14: UI — `FunnelIdentity` + сборка карточки + имя в списке

Шапка идентификации (код-плашка, имя из осей, статус, оси-селекты, комментарий, авто-теги) и финальная композиция страницы воронки (идентичность → время → RoomsEditor → блоки по каталогу). Плюс имя воронки в списке.

**Files:**
- Create: `app/src/components/FunnelIdentity.tsx`
- Modify: `app/src/app/funnels/[id]/page.tsx`
- Modify: `app/src/app/page.tsx` (показывать `funnel.name`)
- Modify: `app/src/components/FunnelCard.tsx` (если рендерит имя — показать `name`)

**Interfaces:**
- Consumes: `FunnelDetail` (funnels), `listDays`, `listBlocks`, `BLOCK_KINDS`, `RoomsEditor`, `BlockEditor`, `FunnelForm` (для осей-селектов можно переиспользовать существующие RefSelect-паттерны), `Switch`/`Segmented`.
- Produces: `FunnelIdentity` props `{ funnel: FunnelDetail }` (рендерит редактируемую идентичность; сохранение через `PATCH /api/funnels/[id]`).

- [ ] **Step 1: FunnelIdentity**

`app/src/components/FunnelIdentity.tsx` — рендерит: код-инпут (`frontCode`), производное имя `funnel.name` (read-only заголовок), `Segmented` статус Активна/Черновик, 4 селекта осей (Продукт/Подрядчик/Канал/Направление — переиспользовать существующий RefSelect из `FunnelForm.tsx`: вынести RefSelect в отдельный файл `app/src/components/RefSelect.tsx`, импортировать в обоих местах), `textarea` комментария, read-only список АВ-тегов (из `axesToTagNames(funnel.axes).reg`). Поля времени `timeLabelA/B`. Кнопка «Сохранить» → `PATCH /api/funnels/[id]` с `{ frontCode, status, product, contractor, channel, direction, comment, timeLabelA, timeLabelB }`.

Реализация (полный компонент):
```tsx
'use client';

import { useState } from 'react';
import { Wand2 } from 'lucide-react';
import type { FunnelDetail } from '@/lib/funnels';
import { axesToTagNames } from '@/lib/ab-tags';
import Segmented from './Segmented';
import RefSelect from './RefSelect';

export default function FunnelIdentity({ funnel }: { funnel: FunnelDetail }) {
  const [frontCode, setFrontCode] = useState(funnel.frontCode);
  const [status, setStatus] = useState(funnel.status === 'active' ? 'active' : 'draft');
  const [axes, setAxes] = useState(funnel.axes);
  const [comment, setComment] = useState(funnel.comment);
  const [ta, setTa] = useState(funnel.timeLabelA);
  const [tb, setTb] = useState(funnel.timeLabelB);
  const [saving, setSaving] = useState(false);

  const name = `${axes.product} / ${axes.contractor} / ${axes.channel} / ${axes.direction}`;
  const tags = axesToTagNames(axes).reg.map((t) => t.replace(/^АВ /, ''));

  async function save() {
    setSaving(true);
    try {
      await fetch(`/api/funnels/${funnel.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          frontCode, status,
          product: axes.product, contractor: axes.contractor, channel: axes.channel, direction: axes.direction,
          comment, timeLabelA: ta, timeLabelB: tb,
        }),
      });
    } finally { setSaving(false); }
  }

  const inp = 'h-7 rounded-[6px] border border-[var(--line-soft)] bg-white px-2 text-[12px] text-[var(--ink)]';

  return (
    <div className="rounded-[14px] border border-[var(--line-soft)] bg-[var(--card)] p-4">
      <div className="mb-1 flex flex-wrap items-center gap-2.5">
        <input aria-label="Код" value={frontCode} onChange={(e) => setFrontCode(e.target.value)}
          className="h-[26px] w-[56px] rounded-[6px] border border-[var(--line)] bg-[var(--chip)] px-1.5 text-center font-mono text-[12px] text-[var(--muted)]" />
        <span className="text-[16px] font-medium">{name}</span>
        <span className="ml-auto">
          <Segmented options={[{ value: 'active', label: 'Активна' }, { value: 'draft', label: 'Черновик' }]} value={status} onChange={setStatus} />
        </span>
      </div>
      <div className="mb-3 flex items-center gap-1.5 text-[10px] text-[var(--faint)]">
        <Wand2 size={12} /> имя собирается из продукта · подрядчика · канала · направления
      </div>

      <div className="mb-3 grid grid-cols-2 gap-x-3 gap-y-2">
        <RefSelect kind="products" label="Продукт" value={axes.product} onChange={(v) => setAxes({ ...axes, product: v })} />
        <RefSelect kind="contractors" label="Подрядчик" value={axes.contractor} onChange={(v) => setAxes({ ...axes, contractor: v })} />
        <RefSelect kind="channels" label="Канал" value={axes.channel} onChange={(v) => setAxes({ ...axes, channel: v })} />
        <RefSelect kind="directions" label="Направление" value={axes.direction} onChange={(v) => setAxes({ ...axes, direction: v })} />
      </div>

      <label className="mb-3 flex flex-col gap-1">
        <span className="text-[10px] uppercase tracking-wide text-[var(--faint)]">Комментарий</span>
        <textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder="заметка по воронке…"
          className="min-h-[44px] rounded-[6px] border border-[var(--line-soft)] bg-white p-2 text-[12px] text-[var(--ink)]" />
      </label>

      <div className="mb-3 rounded-[9px] border border-dashed border-[var(--line)] bg-[var(--cream)] p-2.5">
        <div className="mb-1.5 text-[10px] uppercase tracking-wide text-[var(--faint)]">АВ-теги · генерируются автоматически</div>
        <div className="flex flex-wrap gap-1.5">
          {tags.map((t) => <span key={t} className="rounded-full bg-[var(--chip)] px-2 py-[3px] text-[10px] text-[var(--muted)]">{t}</span>)}
        </div>
      </div>

      <div className="mb-1 flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-wide text-[var(--faint)]">Время</span>
        <input value={ta} onChange={(e) => setTa(e.target.value)} className={`${inp} w-[62px] text-center font-mono`} />
        <input value={tb} onChange={(e) => setTb(e.target.value)} className={`${inp} w-[62px] text-center font-mono`} />
        <button type="button" onClick={save} disabled={saving}
          className="ml-auto rounded-[8px] bg-[var(--orange)] px-4 py-1.5 text-[12px] font-semibold text-white disabled:opacity-60">
          {saving ? 'Сохранение…' : 'Сохранить идентификацию'}
        </button>
      </div>
    </div>
  );
}
```

**Extract RefSelect:** move the inline `RefSelect` component currently inside `FunnelForm.tsx` into `app/src/components/RefSelect.tsx` with props `{ kind: 'products'|'contractors'|'channels'|'directions'; label: string; value: string; onChange: (v: string) => void }` (fetches `/api/refs/[kind]`, allows inline add — preserve existing behavior). Update `FunnelForm.tsx` to import it. Keep its existing fetch/add logic identical.

- [ ] **Step 2: Compose the page**

Replace `app/src/app/funnels/[id]/page.tsx` body with:
```tsx
import { notFound } from 'next/navigation';
import { db } from '@/db/client';
import { getFunnel } from '@/lib/funnels';
import { listDays } from '@/lib/funnel-days';
import { listBlocks } from '@/lib/funnel-blocks';
import FunnelIdentity from '@/components/FunnelIdentity';
import RoomsEditor from '@/components/RoomsEditor';
import BlockEditor from '@/components/BlockEditor';

interface PageProps { params: Promise<{ id: string }> }

export default async function FunnelEditPage({ params }: PageProps) {
  const { id } = await params;
  const numId = parseInt(id, 10);
  if (isNaN(numId)) notFound();

  const funnel = getFunnel(db, numId);
  if (!funnel) notFound();

  const initialDays = listDays(db, numId);
  const blocks = listBlocks(db, numId);
  const landings = blocks.find((b) => b.kind === 'landings')!;
  const rest = blocks.filter((b) => b.kind !== 'landings');

  return (
    <main className="mx-auto max-w-[680px] px-4 py-6">
      <FunnelIdentity funnel={funnel} />
      <div className="my-4 h-px bg-[var(--line-soft)]" />
      {/* Order: landings → rooms → remaining blocks (records, tariffs, ...) */}
      <BlockEditor funnelId={numId} initial={landings} timeLabelA={funnel.timeLabelA} timeLabelB={funnel.timeLabelB} />
      <RoomsEditor funnelId={numId} initialDays={initialDays} replayEnabled={funnel.roomsReplayEnabled}
        timeLabelA={funnel.timeLabelA} timeLabelB={funnel.timeLabelB} />
      {rest.map((b) => (
        <BlockEditor key={b.kind} funnelId={numId} initial={b} timeLabelA={funnel.timeLabelA} timeLabelB={funnel.timeLabelB} />
      ))}
    </main>
  );
}
```

- [ ] **Step 3: Show derived name in list**

In `app/src/app/page.tsx`, the list passes `title: buildTitle(funnel)` into `<FunnelCard>` (which renders `funnel.title`). Change the `buildTitle(funnel)` helper to return the new derived `funnel.name` (format `«product / contractor / channel / direction»`) instead of its current composition — i.e. `function buildTitle(funnel) { return funnel.name; }` (or inline `title: funnel.name`). Also add `name: string` to the local `Funnel` type in `page.tsx` (near line 24, alongside `productName`) so the field typechecks. `FunnelCard` itself needs no change (it already renders `funnel.title`).

- [ ] **Step 4: Typecheck + build**

Run: `cd app && npx tsc --noEmit && npm run build`
Expected: typecheck clean; `next build` succeeds.

- [ ] **Step 5: Run the full suite**

Run: `cd app && npx vitest run`
Expected: all tests pass (existing + new).

- [ ] **Step 6: Commit**

```bash
git add app/src/components/FunnelIdentity.tsx app/src/components/RefSelect.tsx app/src/components/FunnelForm.tsx "app/src/app/funnels/[id]/page.tsx" app/src/app/page.tsx app/src/components/FunnelCard.tsx
git commit -m "feat: FunnelIdentity + card composition + derived name in list"
```

---

### Task 15: Применить миграцию к боевой БД + перепечь Docker-seed

Применить Фазу 3 к реальной `ksamata_funnels.db` (схема + перенос данных) и обновить запечённую seed-копию для Docker. Это data-задача (мутирует git-трекаемую БД), коммитим сразу.

**Files:**
- Modify: `ksamata_funnels.db` (применить миграцию)
- Modify: `app/seed/ksamata_funnels.db` (перепечь из обновлённой БД)

- [ ] **Step 1: Бэкап + применить миграцию к боевой БД**

Run:
```bash
cd /Users/sergeielkin/dev/ksamata/Ksamata/ksamata-funnels-db
cp ksamata_funnels.db ksamata_funnels.db.bak-before-phase3
cd app
FUNNELS_DB_PATH=../ksamata_funnels.db npx tsx scripts/migrate-phase3.ts
FUNNELS_DB_PATH=../ksamata_funnels.db npx tsx scripts/migrate-funnel-data.ts
```
Expected: оба скрипта завершаются без ошибок с лог-сообщениями "done".

- [ ] **Step 2: Проверить результат**

Run:
```bash
cd /Users/sergeielkin/dev/ksamata/Ksamata/ksamata-funnels-db
sqlite3 ksamata_funnels.db "SELECT kind, count(*) FROM funnel_blocks GROUP BY kind ORDER BY kind;"
sqlite3 ksamata_funnels.db "SELECT count(*) AS items FROM funnel_block_items;"
sqlite3 ksamata_funnels.db "SELECT count(*) FROM funnels WHERE rooms_replay_enabled=1;"
```
Expected: непустые блоки (landings/applications/tariffs/oto/bonuses/processes/meditation/links), items > 0, часть воронок с повтором. Глазами сверить 1–2 воронки против `ksamata-leak-funnels/F*/F*.png`.

- [ ] **Step 3: Перепечь seed для Docker**

Run:
```bash
cd /Users/sergeielkin/dev/ksamata/Ksamata/ksamata-funnels-db
cp ksamata_funnels.db app/seed/ksamata_funnels.db
```

- [ ] **Step 4: Удалить бэкап-файлы из рабочего дерева (не коммитить)**

Run: `cd /Users/sergeielkin/dev/ksamata/Ksamata/ksamata-funnels-db && rm -f ksamata_funnels.db.bak-before-phase3`
(Бэкап локальный, в git не идёт.)

- [ ] **Step 5: Commit**

```bash
cd /Users/sergeielkin/dev/ksamata/Ksamata/ksamata-funnels-db
git add ksamata_funnels.db app/seed/ksamata_funnels.db
git commit -m "data: apply Phase-3 migration to live DB + rebake Docker seed"
```

---

## Self-Review

**Spec coverage:**
- §2.1 идентификация → Task 7 (поля/имя) + Task 14 (FunnelIdentity UI). ✓
- §2.2 время (деф. 15/19, редактируемое) → Task 7 (колонки) + Task 14 (поля). ✓
- §2.3 порядок блоков → Task 1 (каталог) + Task 14 (композиция: landings → rooms → rest). ✓
- §3 комнаты (GC/Web/повтор, дни 3+добавить) → Task 6 (helper) + Task 13 (RoomsEditor). ✓
- §4 блоки-списки (вкл/выкл, режим, 1/2 поля) → Task 1/5/8 + Task 11/12 UI. ✓
- §5 схема + миграция + перенос данных → Task 2/3/4 + Task 15 (apply). ✓
- §6 API → Task 8 (blocks), Task 9 (days/rooms), Task 7 (identity PATCH — существующий route уже принимает partial; новые поля проходят через `funnelUpdateSchema`). ✓
- §7 компоненты → Task 11–14. ✓
- §8 стиль/светлая схема → Task 11 (globals) + Task 12 (Segmented светлый). ✓
- §9 не меняем (теги/устаревшие колонки/Docker) → соблюдено (funnel_days колонки сохраняются, теги через axesToTagNames). ✓
- §10 решения → отражены в Task 4 mapping (sales_note/dojim_note не переносим; replay в комнатах; дашборды → links). ✓

**Примечание по identity PATCH (Task 7/14):** существующий `app/src/app/api/funnels/[id]/route.ts` (PATCH) использует `funnelUpdateSchema` + `updateFunnel`. После Task 7 новые опциональные поля (`comment`, `timeLabelA/B`, `roomsReplayEnabled`) проходят через partial-схему и `updateFunnel` без изменений в самом route. Если route жёстко перечисляет поля — добавить их там (проверить файл при реализации Task 7; если нужно — это часть Task 7 шага 3).

**Placeholder scan:** код приведён полностью в каждом шаге; «найти существующий элемент» указано только для двух точечных правок (RefSelect extract, list title) с явными именами файлов.

**Type consistency:** `BlockItem`/`BlockState`/`BlockKind`/`BlockMode` едины (Task 1/5); `DayCell` с `replayUrl` (Task 6) используется в Task 9/13; `funnelName` (Task 7) в Task 14; каталог иконок — lucide-имена (Globe/Video/Tag/FileText/Gift/Flame/Settings/Sparkles/Link).

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-26-funnel-card-blocks-redesign.md`. Two execution options:

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — execute tasks in this session with checkpoints.

Which approach?
