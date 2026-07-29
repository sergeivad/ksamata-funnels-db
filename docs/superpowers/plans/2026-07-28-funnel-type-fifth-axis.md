# Тип воронки — пятая ось. План реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Дать базе пятую ось — тип воронки (`АВ Автоворонка` / `АВ Прямые` /
`АВ Квиз` / `АВ Квиз-Лайт`), чтобы её теги совпадали с разметкой GetCourse,
а ключ склейки в аудите стал пятёркой.

**Architecture:** Тип — редактируемый справочник `funnel_types` (как `channels` /
`directions`) плюс nullable FK `funnels.funnel_type_id`. Имя строки справочника —
текст маркера дословно. Маркер выпускается в слой идентичности `computeTagSet`
рядом с четырьмя осевыми тегами и потому неудаляем через оверрайды. Из шаблона
`tag_templates` маркер уходит.

**Tech Stack:** Next.js 15 (App Router), Drizzle + better-sqlite3, Zod, vitest;
Python 3 + pytest для `tools/audit`.

Дизайн: [docs/superpowers/specs/2026-07-28-funnel-type-fifth-axis-design.md](../specs/2026-07-28-funnel-type-fifth-axis-design.md)

## Global Constraints

- Все команды приложения — из каталога `app/`.
- Проверка перед каждым коммитом: `npx tsc --noEmit` и `npx vitest run`.
  Для задач 8 — `python3 -m pytest tools/audit/tests` из корня репозитория.
- Тесты работают только с временной копией БД через `copyDbForTest`
  (`app/tests/helpers/db.ts`), никогда с `ksamata_funnels.db` напрямую.
- Данные воронок и теги меняются только через `createFunnel` / `updateFunnel`
  или API. Raw SQL по живой базе запрещён. **Исключение — миграции**: как все
  фазы 2-6, фаза 8 делает DDL и бэкфилл колонки напрямую. Границу держать
  строго: миграция пишет `funnels.funnel_type_id`, но **никогда** не трогает
  `funnel_tags` — материализация тегов идёт только через `computeTagSet`.
- Имя типа хранится дословно: `АВ Автоворонка`, `АВ Прямые`, `АВ Квиз`,
  `АВ Квиз-Лайт`. Никакого приклеивания префикса `АВ ` при выводе.
- Ключ справочника (`RefKind`) — строка `funnel_types`.
- Значение типа по умолчанию при бэкфилле — `АВ Автоворонка`.
- После любого прогона против живой БД: `sqlite3 ksamata_funnels.db 'PRAGMA
  wal_checkpoint(TRUNCATE);'`, удалить `-wal`/`-shm`, убедиться что
  `SELECT COUNT(*) FROM monitor_targets` = 0 и `git status --porcelain` пуст.
- Порядок применения к данным (задача 7) обязателен: фаза 8 → сверка →
  чистка шаблона → двенадцать правок типа.

---

### Task 1: Справочник `funnel_types` и миграция фазы 8

**Files:**
- Create: `app/src/lib/funnel-type.ts`
- Create: `app/scripts/migrate-phase8-data.ts`
- Create: `app/scripts/migrate-phase8.ts`
- Create: `app/scripts/migrate-phase8-runner.ts`
- Modify: `app/src/db/schema.ts` (добавить таблицу `funnelTypes` и колонку `funnelTypeId`)
- Modify: `app/Dockerfile` (сборка `.cjs` и копирование в образ, по образцу фазы 6)
- Modify: `app/docker-entrypoint.sh` (запуск после фазы 6)
- Test: `app/tests/migrate-phase8.test.ts`

**Interfaces:**
- Produces: `FUNNEL_TYPE_KIND = 'funnel_types'`, `DEFAULT_FUNNEL_TYPE = 'АВ Автоворонка'`,
  `SEED_FUNNEL_TYPES: readonly string[]`, `FUNNEL_TYPE_LABEL = 'Тип воронки'`
  (все из `app/src/lib/funnel-type.ts`);
  `runMigratePhase8(sqlite: import('better-sqlite3').Database): void`;
  Drizzle-таблица `funnelTypes` и колонка `funnels.funnelTypeId`.

- [ ] **Step 1: Написать падающий тест**

Создать `app/tests/migrate-phase8.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { copyDbForTest } from './helpers/db';
import { runMigratePhase8 } from '../scripts/migrate-phase8';
import { SEED_FUNNEL_TYPES, DEFAULT_FUNNEL_TYPE } from '../src/lib/funnel-type';

let dir: string;
let dbPath: string;
let sqlite: Database.Database;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'phase8-'));
  dbPath = join(dir, 'test.db');
  copyDbForTest(join(__dirname, '../../ksamata_funnels.db'), dbPath);
  sqlite = new Database(dbPath);
  runMigratePhase8(sqlite);
});

afterAll(() => {
  sqlite.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('Phase-8: справочник типов воронки', () => {
  it('заводит справочник с четырьмя маркерами', () => {
    const names = (sqlite.prepare('SELECT name FROM funnel_types ORDER BY name').all() as { name: string }[])
      .map((r) => r.name);
    expect(names.sort()).toEqual([...SEED_FUNNEL_TYPES].sort());
  });

  it('добавляет колонку funnels.funnel_type_id', () => {
    const cols = (sqlite.prepare('PRAGMA table_info(funnels)').all() as { name: string }[]).map((c) => c.name);
    expect(cols).toContain('funnel_type_id');
  });

  it('бэкфиллит всем воронкам «АВ Автоворонка»', () => {
    const row = sqlite.prepare(`
      SELECT COUNT(*) AS total,
             SUM(CASE WHEN t.name = ? THEN 1 ELSE 0 END) AS auto
        FROM funnels f LEFT JOIN funnel_types t ON t.id = f.funnel_type_id
    `).get(DEFAULT_FUNNEL_TYPE) as { total: number; auto: number };
    expect(row.total).toBeGreaterThan(0);
    expect(row.auto).toBe(row.total);
  });

  it('идемпотентна: повторный прогон ничего не ломает и не двоит', () => {
    runMigratePhase8(sqlite);
    const n = (sqlite.prepare('SELECT COUNT(*) AS n FROM funnel_types').get() as { n: number }).n;
    expect(n).toBe(SEED_FUNNEL_TYPES.length);
  });

  it('не трогает funnel_tags — маркер там уже стоит из шаблона', () => {
    const n = (sqlite.prepare(`
      SELECT COUNT(DISTINCT ft.funnel_id) AS n FROM funnel_tags ft
      JOIN tags t ON t.id = ft.tag_id WHERE t.name = ?
    `).get(DEFAULT_FUNNEL_TYPE) as { n: number }).n;
    const total = (sqlite.prepare('SELECT COUNT(*) AS n FROM funnels').get() as { n: number }).n;
    expect(n).toBe(total);
  });
});
```

- [ ] **Step 2: Прогнать тест и убедиться, что он падает**

Из `app/`: `npx vitest run tests/migrate-phase8.test.ts`
Ожидание: FAIL — модуль `../scripts/migrate-phase8` не найден.

- [ ] **Step 3: Написать модуль типа**

Создать `app/src/lib/funnel-type.ts`:

```ts
/**
 * Пятая ось воронки — её тип. В GetCourse это один из взаимоисключающих
 * маркеров без двоеточия, поэтому в AXIS_PREFIXES ему места нет (см. ab-tags.ts).
 *
 * Значения живут в справочнике funnel_types и правятся через /refs: набор
 * маркеров задаёт GetCourse, и пятый может появиться без нашего участия.
 * Здесь — только то, что кодом действительно зашито: ключ справочника,
 * значение для бэкфилла и стартовый набор.
 */
export const FUNNEL_TYPE_KIND = 'funnel_types' as const;

/** Имя строки справочника = текст маркера дословно. */
export const DEFAULT_FUNNEL_TYPE = 'АВ Автоворонка';

export const SEED_FUNNEL_TYPES: readonly string[] = [
  DEFAULT_FUNNEL_TYPE,
  'АВ Прямые',
  'АВ Квиз',
  'АВ Квиз-Лайт',
];

export const FUNNEL_TYPE_LABEL = 'Тип воронки';
```

- [ ] **Step 4: Написать DDL и миграцию**

Создать `app/scripts/migrate-phase8-data.ts`:

```ts
/**
 * DDL Phase-8 (пятая ось: тип воронки).
 * Единый источник правды для migrate-phase8.ts (tsx/тесты) и Docker-раннера.
 */
export const PHASE8_DDL = `
CREATE TABLE IF NOT EXISTS funnel_types (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT    NOT NULL UNIQUE
);
`;

export const PHASE8_FUNNEL_COLUMN = {
  name: 'funnel_type_id',
  ddl: `ALTER TABLE funnels ADD COLUMN funnel_type_id INTEGER REFERENCES funnel_types(id)`,
};
```

Создать `app/scripts/migrate-phase8.ts`:

```ts
/**
 * Phase-8: справочник типов воронки + FK у funnels. Идемпотентно.
 *
 *   cd app/
 *   FUNNELS_DB_PATH=../ksamata_funnels.db npx tsx scripts/migrate-phase8.ts
 *
 * Бэкфилл ставит всем воронкам «АВ Автоворонка» — это не решение о типе,
 * а сохранение того, что база утверждает и без пятой оси: маркер стоит
 * у каждой воронки из шаблона tag_templates. funnel_tags при этом
 * не меняется ни на строку, меняется только источник маркера.
 */
import { PHASE8_DDL, PHASE8_FUNNEL_COLUMN } from './migrate-phase8-data';
import { addColumnIfMissing } from './migrate-phase3-data';
import { SEED_FUNNEL_TYPES, DEFAULT_FUNNEL_TYPE } from '../src/lib/funnel-type';

export function runMigratePhase8(sqlite: import('better-sqlite3').Database): void {
  sqlite.pragma('foreign_keys = ON');
  sqlite.exec(PHASE8_DDL);
  addColumnIfMissing(sqlite, 'funnels', PHASE8_FUNNEL_COLUMN.name, PHASE8_FUNNEL_COLUMN.ddl);

  const insert = sqlite.prepare('INSERT OR IGNORE INTO funnel_types (name) VALUES (?)');
  for (const name of SEED_FUNNEL_TYPES) insert.run(name);

  // Бэкфилл только там, где тип ещё не проставлен: повторный прогон
  // не должен затирать уже принятые решения о типе.
  sqlite.prepare(`
    UPDATE funnels
       SET funnel_type_id = (SELECT id FROM funnel_types WHERE name = ?)
     WHERE funnel_type_id IS NULL
  `).run(DEFAULT_FUNNEL_TYPE);
}

if (require.main === module) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Database = require('better-sqlite3');
  const { resolveCliDbPath } = require('./cli-db-path') as typeof import('./cli-db-path');
  const dbPath = resolveCliDbPath();
  const sqlite = new Database(dbPath);
  console.log(`Phase-8 schema migration on: ${dbPath}`);
  runMigratePhase8(sqlite);
  sqlite.close();
  console.log('Phase-8 schema migration done.');
}
```

- [ ] **Step 5: Прогнать тест и убедиться, что он проходит**

Из `app/`: `npx vitest run tests/migrate-phase8.test.ts`
Ожидание: PASS, 5 тестов.

- [ ] **Step 6: Описать таблицу и колонку в схеме Drizzle**

В `app/src/db/schema.ts`, в блоке lookup-таблиц рядом с `contractors`:

```ts
// Пятая ось: тип воронки. Имя = текст маркера GetCourse дословно
// («АВ Автоворонка», «АВ Прямые», …), см. src/lib/funnel-type.ts.
export const funnelTypes = sqliteTable('funnel_types', {
  id:   integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
});
```

В таблице `funnels`, рядом с `frontCode`:

```ts
    // Phase 8: пятая ось. NULL = тип не выбран, маркер не выпускается.
    funnelTypeId:     integer('funnel_type_id').references(() => funnelTypes.id),
```

- [ ] **Step 7: Раннер для Docker**

Создать `app/scripts/migrate-phase8-runner.ts`:

```ts
/**
 * Standalone-миграция Phase-8 для Docker-образа.
 * Собирается в migrate-phase8.cjs через esbuild в builder-стадии.
 * Вызывается из docker-entrypoint.sh как: node /app/migrate-phase8.cjs
 */
import Database from 'better-sqlite3';
import { runMigratePhase8 } from './migrate-phase8';

const dbPath = process.env.FUNNELS_DB_PATH;
if (!dbPath) {
  console.error('[migrate-phase8] FUNNELS_DB_PATH is not set — skipping.');
  process.exit(0);
}

console.log(`[migrate-phase8] Running Phase-8 migration on: ${dbPath}`);
const sqlite = new Database(dbPath);
sqlite.pragma('journal_mode = WAL');
runMigratePhase8(sqlite);
sqlite.close();
console.log('[migrate-phase8] Done (funnel types).');
```

- [ ] **Step 8: Встроить в образ и в запуск**

В `app/Dockerfile`, сразу после блока сборки фазы 6 (строки 66-70):

```dockerfile
RUN npx esbuild scripts/migrate-phase8-runner.ts \
      --bundle \
      --platform=node \
      --external:better-sqlite3 \
      --outfile=migrate-phase8.cjs
```

И рядом с копированием `migrate-phase6.cjs` (строка 122):

```dockerfile
COPY --from=builder /build/migrate-phase8.cjs /app/migrate-phase8.cjs
```

В `app/docker-entrypoint.sh`, между блоком фазы 6 и `exec node server.js`:

```sh
# Apply Phase-8 migration (idempotent: CREATE TABLE IF NOT EXISTS + INSERT OR IGNORE).
# Adds the funnel-type lookup (fifth AV axis) and backfills it with «АВ Автоворонка».
if [ -n "$FUNNELS_DB_PATH" ]; then
  echo "[entrypoint] Running Phase-8 migration against $FUNNELS_DB_PATH"
  node /app/migrate-phase8.cjs
  echo "[entrypoint] Phase-8 migration done."
fi
```

- [ ] **Step 9: Полная проверка и коммит**

Из `app/`: `npx tsc --noEmit` — ожидание: без ошибок.
Из `app/`: `npx vitest run` — ожидание: все тесты проходят.

```bash
git add app/src/lib/funnel-type.ts app/scripts/migrate-phase8*.ts \
        app/src/db/schema.ts app/Dockerfile app/docker-entrypoint.sh \
        app/tests/migrate-phase8.test.ts
git commit -m "feat(schema): фаза 8 — справочник типов воронки и FK у funnels"
```

---

### Task 2: `funnel_types` как вид справочника в `refs.ts`

**Files:**
- Modify: `app/src/lib/refs.ts:17-24` (TABLE_MAP), `:65-70` (AXIS_KIND_TO_AXIS), `:137-151` (directFkFunnelIds), `:171-175` (findAxisTagRow), `:279-282` (переименование)
- Test: `app/tests/api-refs.test.ts` (дописать describe-блок)

**Interfaces:**
- Consumes: `FUNNEL_TYPE_KIND`, `funnelTypes` (Task 1).
- Produces: `refTagNameFor(kind: RefKind, value: string): string | null` —
  имя тега, зеркалящего значение справочника: `префикс + значение` для четырёх
  осей, само значение для `funnel_types`, `null` для `sources` и `tags`.
  `RefKind` теперь включает `'funnel_types'`.

- [ ] **Step 1: Написать падающий тест**

Дописать в конец `app/tests/api-refs.test.ts`:

```ts
describe('справочник типов воронки', () => {
  it('funnel_types — валидный вид и он редактируемый', () => {
    expect(isValidKind('funnel_types')).toBe(true);
    expect(isImmutableKind('funnel_types')).toBe(false);
  });

  it('зеркальный тег типа — само значение, без префикса', () => {
    expect(refTagNameFor('funnel_types', 'АВ Квиз')).toBe('АВ Квиз');
    expect(refTagNameFor('directions', 'РСЯ')).toBe('АВ Направление: РСЯ');
    expect(refTagNameFor('sources', 'Яндекс НИМБ')).toBeNull();
  });

  it('используемый тип удалить нельзя', () => {
    const row = getRefByName(db, 'funnel_types', 'АВ Автоворонка')!;
    const res = deleteRef(db, 'funnel_types', row.id);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('in_use');
  });

  it('неиспользуемый тип удалить можно', () => {
    const created = createRef(db, 'funnel_types', 'АВ Тест-Маркер');
    const res = deleteRef(db, 'funnel_types', created.id);
    expect(res.ok).toBe(true);
  });
});
```

Импорты дописать в шапку файла: `isValidKind`, `isImmutableKind`, `refTagNameFor`,
`getRefByName`, `createRef`, `deleteRef` из `@/lib/refs`. Фикстура файла должна
применять `runMigratePhase8` — добавить его вызов рядом с уже имеющимися
`runMigratePhase*`.

- [ ] **Step 2: Прогнать тест и убедиться, что он падает**

Из `app/`: `npx vitest run tests/api-refs.test.ts`
Ожидание: FAIL — `refTagNameFor` не экспортируется.

- [ ] **Step 3: Реализовать**

В `app/src/lib/refs.ts` добавить `funnelTypes` в импорт из `../db/schema`
и в `TABLE_MAP`:

```ts
const TABLE_MAP = {
  products,
  contractors,
  sources,
  tags,
  channels,
  directions,
  funnel_types: funnelTypes,
} as const;
```

Заменить `AXIS_KIND_TO_AXIS` и его три места использования на общую функцию:

```ts
// Виды справочников, значение которых дублируется тегом воронки.
// У четырёх осей тег — «АВ <Ось>: <значение>»; у типа воронки маркер
// двоеточия не имеет, и тег равен самому значению (см. funnel-type.ts).
// `sources` и `tags` зеркала не имеют: первый — обычный FK, второй сам
// и есть таблица тегов.
const AXIS_KIND_TO_AXIS: Partial<Record<RefKind, keyof AbAxes>> = {
  products: 'product',
  contractors: 'contractor',
  channels: 'channel',
  directions: 'direction',
};

export function refTagNameFor(kind: RefKind, value: string): string | null {
  if (kind === FUNNEL_TYPE_KIND) return value;
  const axis = AXIS_KIND_TO_AXIS[kind];
  return axis ? `${AXIS_PREFIXES[axis]}${value}` : null;
}
```

`findAxisTagRow` (строки 171-175) переписать через неё:

```ts
  const tagName = refTagNameFor(kind, value);
  if (!tagName) return undefined;
  return getRefByName(db, 'tags', tagName);
```

Переименование (строки 279-282):

```ts
    const oldTag = refTagNameFor(kind, existing.name);
    const newTag = refTagNameFor(kind, newName);
    if (oldTag && newTag) renameOrMergeTag(tx, oldTag, newTag);
```

`directFkFunnelIds` (строки 138-142) — добавить ветку:

```ts
  const column =
    kind === 'products' ? funnels.productId
    : kind === 'contractors' ? funnels.contractorId
    : kind === 'sources' ? funnels.sourceId
    : kind === FUNNEL_TYPE_KIND ? funnels.funnelTypeId
    : undefined;
```

Импортировать `FUNNEL_TYPE_KIND` из `./funnel-type`.

- [ ] **Step 4: Прогнать тест и убедиться, что он проходит**

Из `app/`: `npx vitest run tests/api-refs.test.ts` — ожидание: PASS.

- [ ] **Step 5: Полная проверка и коммит**

Из `app/`: `npx tsc --noEmit` и `npx vitest run` — ожидание: без ошибок.

```bash
git add app/src/lib/refs.ts app/tests/api-refs.test.ts
git commit -m "feat(refs): funnel_types как редактируемый справочник"
```

---

### Task 3: Маркер в слое идентичности `computeTagSet`

**Files:**
- Modify: `app/src/lib/ab-tags.ts:56-91`
- Test: `app/tests/ab-tags.test.ts` (дописать describe-блок)

**Interfaces:**
- Produces: тип `FunnelTypeContext = { name: string | null; known: readonly string[] }`
  и новая четвёртая позиция `computeTagSet(template, axes, overrides, type?)`
  со значением по умолчанию `{ name: null, known: [] }` — старые вызовы
  продолжают компилироваться.

- [ ] **Step 1: Написать падающий тест**

Дописать в `app/tests/ab-tags.test.ts`:

```ts
describe('пятая ось: маркер типа воронки', () => {
  const axes = { product: 'ЖИВО', contractor: 'НИМБ', channel: 'Яндекс', direction: 'РСЯ' };
  const empty = { reg: { add: [], remove: [] }, time_15: { add: [], remove: [] },
                  time_19: { add: [], remove: [] }, messenger: { add: [], remove: [] } };
  const known = ['АВ Автоворонка', 'АВ Прямые', 'АВ Квиз', 'АВ Квиз-Лайт'];
  const tpl = { reg: [], time_15: [], time_19: [], messenger: [] };

  it('кладёт маркер во все четыре сценария как axis', () => {
    const out = computeTagSet(tpl, axes, empty, { name: 'АВ Квиз', known });
    for (const s of SCENARIOS) {
      const chip = out[s].tags.find((t) => t.name === 'АВ Квиз');
      expect(chip, `сценарий ${s}`).toBeDefined();
      expect(chip!.source).toBe('axis');
    }
  });

  it('без типа маркера нет вовсе', () => {
    const out = computeTagSet(tpl, axes, empty, { name: null, known });
    expect(out.reg.tags.some((t) => known.includes(t.name))).toBe(false);
  });

  it('гасит чужой маркер, пришедший из шаблона', () => {
    const withAuto = { ...tpl, reg: ['АВ Автоворонка', 'допродажи'] };
    const out = computeTagSet(withAuto, axes, empty, { name: 'АВ Квиз', known });
    const names = out.reg.tags.map((t) => t.name);
    expect(names).toContain('АВ Квиз');
    expect(names).not.toContain('АВ Автоворонка');
    expect(names).toContain('допродажи');
  });

  it('гасит маркер, пришедший через add-оверрайд', () => {
    const ov = { ...empty, reg: { add: ['АВ Прямые'], remove: [] } };
    const out = computeTagSet(tpl, axes, ov, { name: 'АВ Квиз', known });
    expect(out.reg.tags.map((t) => t.name)).not.toContain('АВ Прямые');
  });

  it('свой маркер неудаляем через remove-оверрайд', () => {
    const ov = { ...empty, reg: { add: [], remove: ['АВ Квиз'] } };
    const out = computeTagSet(tpl, axes, ov, { name: 'АВ Квиз', known });
    expect(out.reg.tags.map((t) => t.name)).toContain('АВ Квиз');
    expect(out.reg.suppressed).not.toContain('АВ Квиз');
  });
});
```

- [ ] **Step 2: Прогнать тест и убедиться, что он падает**

Из `app/`: `npx vitest run tests/ab-tags.test.ts`
Ожидание: FAIL — `computeTagSet` принимает три аргумента, маркер не появляется.

- [ ] **Step 3: Реализовать**

В `app/src/lib/ab-tags.ts` добавить тип и переписать `computeTagSet`:

```ts
/**
 * Пятая ось. `name` — маркер этой воронки (null = тип не выбран),
 * `known` — все имена из справочника типов. Второе нужно, чтобы погасить
 * ЧУЖОЙ маркер: пока он зашит в tag_templates, квизовая воронка иначе
 * получила бы «АВ Автоворонка» вторым маркером.
 *
 * Множество приходит извне, а не зашито здесь, потому что значения типа
 * правятся через справочник — см. funnel-type.ts.
 */
export type FunnelTypeContext = { name: string | null; known: readonly string[] };

export function computeTagSet(
  template: TemplateMap,
  axes: AbAxes,
  overrides: OverrideMap,
  type: FunnelTypeContext = { name: null, known: [] },
): TagSets {
  const axisTags = axisTagNames(axes);
  const markerNames = new Set(type.known);
  const isIdentity = (name: string) => isAxisTag(name) || markerNames.has(name);
  const out = {} as TagSets;

  for (const scenario of SCENARIOS) {
    const staticTags = template[scenario] ?? [];
    const ov = overrides[scenario] ?? { add: [], remove: [] };
    // Только неидентичные remove считаются — оси и маркер типа неудаляемы.
    const removeSet = new Set(ov.remove.filter((n) => !isIdentity(n)));

    const tags: TagChip[] = [];
    const seen = new Set<string>();

    const pushIfNew = (name: string, source: TagChip['source']) => {
      if (seen.has(name)) return;
      seen.add(name);
      tags.push({ name, source });
    };

    for (const name of staticTags) {
      if (isIdentity(name)) continue; // теги идентичности приходят только своим слоем
      if (removeSet.has(name)) continue;
      pushIfNew(name, 'default');
    }
    for (const name of axisTags) pushIfNew(name, 'axis');
    if (type.name) pushIfNew(type.name, 'axis');
    for (const name of ov.add) {
      if (isIdentity(name)) continue;
      pushIfNew(name, 'custom');
    }

    const suppressed = staticTags.filter((n) => !isIdentity(n) && removeSet.has(n));
    out[scenario] = { tags, suppressed };
  }

  return out;
}
```

- [ ] **Step 4: Прогнать тест и убедиться, что он проходит**

Из `app/`: `npx vitest run tests/ab-tags.test.ts` — ожидание: PASS.

- [ ] **Step 5: Полная проверка и коммит**

Из `app/`: `npx tsc --noEmit` и `npx vitest run` — ожидание: без ошибок.
Старые тесты `computeTagSet` обязаны пройти без правок: четвёртый аргумент
имеет значение по умолчанию.

```bash
git add app/src/lib/ab-tags.ts app/tests/ab-tags.test.ts
git commit -m "feat(tags): маркер типа воронки в слое идентичности"
```

---

### Task 4: Чтение и запись типа в `funnels.ts`, валидация, маршруты

**Files:**
- Modify: `app/src/lib/funnels.ts:44-52` (`FunnelListItem`), `:94-110`
  (`materializeFunnelTags`), `:212-260` (`createFunnel`), `:369-430` (`updateFunnel`)
- Modify: `app/src/lib/validation.ts:63-87`
- Modify: `app/src/app/api/funnels/route.ts`, `app/src/app/api/funnels/[id]/route.ts`
- Test: `app/tests/materialize-tags.test.ts`, `app/tests/api-funnels-route.test.ts`

**Interfaces:**
- Consumes: `FunnelTypeContext` (Task 3), `FUNNEL_TYPE_KIND`, `refTagNameFor` (Task 2).
- Produces: поле `funnelType: string | null` в `FunnelListItem` (и, через него,
  в `FunnelDetail`); поле `funnelType?: string` в `funnelCreateSchema` /
  `funnelUpdateSchema`; `getFunnelTypeContext(db: AnyDB, funnelId: number): FunnelTypeContext`.

- [ ] **Step 1: Написать падающий тест**

Дописать в `app/tests/materialize-tags.test.ts`:

```ts
describe('тип воронки участвует в материализации', () => {
  it('смена типа без осей перематериализует теги', () => {
    const created = createFunnel(db, {
      num: 9001, frontCode: 'ftest', status: 'draft', productName: '', variant: '',
      landingUrl: '', startDate: '', product: 'ЖИВО', contractor: 'НИМБ',
      channel: 'Яндекс', direction: 'РСЯ',
    });

    updateFunnel(db, created.id, { funnelType: 'АВ Квиз' });

    const names = listFunnelTagNames(db, created.id, 'reg');
    expect(names).toContain('АВ Квиз');
    expect(names).not.toContain('АВ Автоворонка');
  });

  it('неизвестный тип отвергается, а не заводится молча', () => {
    const created = createFunnel(db, {
      num: 9002, frontCode: 'ftest2', status: 'draft', productName: '', variant: '',
      landingUrl: '', startDate: '', product: 'ЖИВО', contractor: 'НИМБ',
      channel: 'Яндекс', direction: 'РСЯ',
    });

    expect(() => updateFunnel(db, created.id, { funnelType: 'АВ Опечатка' }))
      .toThrow(ValidationError);
    const rows = db.select().from(funnelTypes).all() as { name: string }[];
    expect(rows.map((r) => r.name)).not.toContain('АВ Опечатка');
  });
});
```

Вспомогательная функция `listFunnelTagNames` в этом файле уже может
отсутствовать — тогда добавить её рядом с тестом:

```ts
function listFunnelTagNames(dbh: typeof db, funnelId: number, tagType: string): string[] {
  return (dbh.select({ name: tags.name }).from(funnelTags)
    .innerJoin(tags, eq(tags.id, funnelTags.tagId))
    .where(and(eq(funnelTags.funnelId, funnelId), eq(funnelTags.tagType, tagType as Scenario)))
    .all() as { name: string }[]).map((r) => r.name);
}
```

Фикстура файла должна применять `runMigratePhase8`.

- [ ] **Step 2: Прогнать тест и убедиться, что он падает**

Из `app/`: `npx vitest run tests/materialize-tags.test.ts`
Ожидание: FAIL — поле `funnelType` не принимается.

- [ ] **Step 3: Реализовать чтение типа и материализацию**

В `app/src/lib/funnels.ts` рядом с `getAxesForFunnel`:

```ts
/**
 * Контекст пятой оси для воронки: её маркер и полный список известных.
 * Читается из справочника, а не из зашитого списка — значения расширяемы.
 */
export function getFunnelTypeContext(db: AnyDB, funnelId: number): FunnelTypeContext {
  const known = (db.select({ name: funnelTypes.name }).from(funnelTypes).all() as { name: string }[])
    .map((r) => r.name);

  const row = db
    .select({ name: funnelTypes.name })
    .from(funnels)
    .leftJoin(funnelTypes, eq(funnelTypes.id, funnels.funnelTypeId))
    .where(eq(funnels.id, funnelId))
    .get() as { name: string | null } | undefined;

  return { name: row?.name ?? null, known };
}
```

В `materializeFunnelTags` (строка 97) передать контекст четвёртым аргументом:

```ts
  const sets: TagSets = computeTagSet(template, axes, overrides, getFunnelTypeContext(db, funnelId));
```

Разрешение имени в id — строгое:

```ts
/**
 * Тип разрешается ТОЛЬКО среди существующих значений. createRef здесь был бы
 * get-or-create, и опечатка в API завела бы пятый маркер, который тут же уехал
 * бы в теги и в аудит. Новые значения заводятся через /refs осознанно.
 */
function resolveFunnelTypeId(tx: AnyDB, name: string): number {
  const row = getRefByName(tx, FUNNEL_TYPE_KIND, name);
  if (!row) {
    throw new ValidationError(
      `Неизвестный тип воронки «${name}». Заведите его в справочнике типов, если он появился в GetCourse.`,
    );
  }
  return row.id;
}
```

- [ ] **Step 4: Пробросить тип через create и update**

В `createFunnel`, в блоке `.values({…})` (после `roomsEnabled`):

```ts
        funnelTypeId:       data.funnelType ? resolveFunnelTypeId(tx, data.funnelType) : null,
```

В `updateFunnel`, в сборке `scalarUpdate` (после строки про `roomsEnabled`):

```ts
    if (data.funnelType !== undefined) {
      scalarUpdate.funnelTypeId = data.funnelType ? resolveFunnelTypeId(tx, data.funnelType) : null;
    }
```

И — ключевое — расширить условие перематериализации (строка 425):

```ts
    // Тип воронки входит сюда наравне с осями: он тоже слой идентичности,
    // и PATCH с одним лишь типом обязан пересчитать теги. Без этого правка
    // типа молча меняла бы только колонку.
    const hasAxes = data.product !== undefined || data.contractor !== undefined
      || data.channel !== undefined || data.direction !== undefined
      || data.funnelType !== undefined;
```

Импортировать `funnelTypes` из `../db/schema`, `FunnelTypeContext` из `./ab-tags`,
`FUNNEL_TYPE_KIND` из `./funnel-type`, `getRefByName` из `./refs`,
`ValidationError` из `./errors`.

- [ ] **Step 5: Отдавать тип наружу**

В `FunnelListItem` (строка 44) добавить поле:

```ts
  funnelType: string | null;
```

Поле обязательное, поэтому `npx tsc --noEmit` перечислит каждое место сборки
`FunnelListItem`: `listFunnels`, `getFunnel`, `createFunnel`, `createDraftFunnel`,
`duplicateFunnel`, `updateFunnel`. В SELECT-запросах добавляется join, образец:

```ts
  const rows = db
    .select({
      id: funnels.id,
      num: funnels.num,
      frontCode: funnels.frontCode,
      status: funnels.status,
      productName: funnels.productName,
      funnelType: funnelTypes.name,   // NULL, если тип не выбран
    })
    .from(funnels)
    .leftJoin(funnelTypes, eq(funnelTypes.id, funnels.funnelTypeId))
    .all();
```

Там, где строка воронки уже прочитана без join (например сразу после INSERT
в `createFunnel`), проще дочитать имя точечно:

```ts
    const typeName = inserted.funnelTypeId
      ? (tx.select({ name: funnelTypes.name }).from(funnelTypes)
           .where(eq(funnelTypes.id, inserted.funnelTypeId)).get() as { name: string }).name
      : null;
```

- [ ] **Step 6: Валидация и маршруты**

В `app/src/lib/validation.ts`, в `funnelCreateSchema` после `direction`:

```ts
  // Пятая ось. Пустая строка = «тип не выбран» (маркер не выпускается).
  // Значение проверяется по справочнику в funnels.ts, а не здесь: набор
  // расширяемый и Zod о нём знать не может.
  funnelType: z.string().trim().max(REF_MAX).optional(),
```

В `app/src/app/api/funnels/route.ts` и `app/src/app/api/funnels/[id]/route.ts`
добавить в catch ветку перед общим `internalError`:

```ts
    if (err instanceof ValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
```

Импортировать `ValidationError` из `@/lib/errors`.

- [ ] **Step 7: Прогнать весь набор тестов и досыпать фазу 8 в фикстуры**

`getFunnelTypeContext` читает `funnel_types`, поэтому любой тест, который
создаёт или правит воронку, но фазу 8 не применил, упадёт на отсутствующей
таблице. Это не баг, а недостающая строка фикстуры — тесты собирают БД
явными вызовами миграций (`runMigratePhase3`, `runMigratePhase5` и т.д.).

Из `app/`: `npx vitest run`

В каждый упавший файл добавить импорт и вызов рядом с уже имеющимися:

```ts
import { runMigratePhase8 } from '../scripts/migrate-phase8';
// …в блоке подготовки фикстуры, последним из миграций:
runMigratePhase8(sqlite);
```

Прогнать снова и убедиться, что падений не осталось. Чинить `getFunnelTypeContext`
«терпимостью к отсутствующей таблице» **нельзя**: тогда тест на воронке без
фазы 8 молча проверял бы модель без пятой оси.

- [ ] **Step 8: Полная проверка и коммит**

Из `app/`: `npx tsc --noEmit` и `npx vitest run` — ожидание: без ошибок.

```bash
git add app/src/lib/funnels.ts app/src/lib/validation.ts app/src/app/api/funnels \
        app/tests/materialize-tags.test.ts app/tests/api-funnels-route.test.ts
git commit -m "feat(funnels): тип воронки в CRUD, материализации и API"
```

---

### Task 5: Селектор типа и чип в списке

**Files:**
- Modify: `app/src/components/FunnelIdentity.tsx:18-21,32-60,205-216,268-271`
- Modify: `app/src/components/FunnelCard.tsx`
- Modify: `app/src/app/refs/page.tsx:13-29`

Тестов компонентов в проекте нет (`app/tests` — только `.test.ts`), поэтому
задача проверяется `tsc`, `npm run build` и ручным прогоном (Step 4).
Заводить инфраструктуру для одного селектора не нужно.

**Interfaces:**
- Consumes: `funnelType` из `FunnelDetail` (Task 4), `FUNNEL_TYPE_KIND` и
  `FUNNEL_TYPE_LABEL` (Task 1), `DEFAULT_FUNNEL_TYPE` (Task 1).

- [ ] **Step 1: Добавить селектор в карточку**

В `FunnelIdentity.tsx` завести состояние рядом с `axes`:

```tsx
  const [funnelType, setFunnelType] = useState<string>(funnel.funnelType ?? '');
```

В блок «грязности» формы (строки 56-59) добавить сравнение:

```tsx
    funnelType !== (saved.funnelType ?? '') ||
```

В `saved` (строки 44-47) добавить `funnelType: funnel.funnelType ?? ''`.

В тело PATCH-запроса (строки 205 и 216) добавить `funnelType`.

После четвёртого `RefSelect` (строка 271):

```tsx
        <RefSelect
          kind={FUNNEL_TYPE_KIND}
          label={FUNNEL_TYPE_LABEL}
          value={funnelType}
          onChange={setFunnelType}
        />
```

- [ ] **Step 2: Чип типа в списке воронок**

В `FunnelCard.tsx`, рядом с `StatusPill`, показывать тип только когда он
не «Автоворонка» и не пуст:

```tsx
{funnel.funnelType && funnel.funnelType !== DEFAULT_FUNNEL_TYPE && (
  <span
    className="rounded bg-[#F1E7D6] px-1.5 py-0.5 text-[11px] text-[#7A5B22]"
    title="Тип воронки"
  >
    {funnel.funnelType.replace(/^АВ /, '')}
  </span>
)}
```

Показ без префикса — только в чипе; хранится и выпускается тег дословно.
Правило «только не-Автоворонка» оставляет 60 карточек из 72 без изменений
и делает видимым различие ровно там, где оно есть.

- [ ] **Step 3: Показать справочник на `/refs`**

Страница держит явный список видов, а не выводит его из API, поэтому сам
справочник там не появится. В `app/src/app/refs/page.tsx` дописать поле в
`RefsState` (строки 13-20) и строку в `KINDS` (строки 22-29):

```tsx
type RefsState = {
  products: RefRow[];
  contractors: RefRow[];
  sources: RefRow[];
  tags: RefRow[];
  channels: RefRow[];
  directions: RefRow[];
  funnel_types: RefRow[];
};

const KINDS: Array<{ key: keyof RefsState; label: string }> = [
  { key: 'products', label: 'Продукты' },
  { key: 'contractors', label: 'Подрядчики' },
  { key: 'sources', label: 'Источники' },
  { key: 'tags', label: 'Теги' },
  { key: 'channels', label: 'Каналы' },
  { key: 'directions', label: 'Направления' },
  { key: 'funnel_types', label: 'Типы воронок' },
];
```

Начальное состояние `useState` для `RefsState` тоже нужно дополнить пустым
массивом `funnel_types: []` — на это укажет `tsc`.

- [ ] **Step 4: Проверка сборкой**

Из `app/`: `npx tsc --noEmit` — ожидание: без ошибок.
Из `app/`: `npm run build` — ожидание: сборка проходит, включая edge-бандл.

- [ ] **Step 5: Ручная проверка в браузере — на КОПИИ базы**

Живую `ksamata_funnels.db` дев-сервером не открывать: он поднимет планировщик
мониторинга и запишет в неё сотни строк. Работать с копией:

```bash
cd app
cp ../ksamata_funnels.db /tmp/uicheck.db
FUNNELS_DB_PATH=/tmp/uicheck.db npx tsx scripts/migrate-phase8.ts
MONITOR_ENABLED=false FUNNELS_DB_PATH=/tmp/uicheck.db npm run dev
```

Открыть http://localhost:3000 и проверить: (1) на карточке воронки появился
селектор «Тип воронки» с четырьмя значениями и пустым вариантом; (2) выбор
значения и сохранение меняют список тегов внизу карточки — маркер меняется
во всех четырёх сценариях; (3) в списке воронок чипа нет, пока тип
«АВ Автоворонка»; (4) на `/refs` появилась таблица «Типы воронок».

Остановить сервер, удалить копию: `rm -f /tmp/uicheck.db*`.
Затем убедиться, что живая база не тронута:

```bash
git status --porcelain ksamata_funnels.db
```

Ожидание: пусто.

- [ ] **Step 6: Коммит**

```bash
git add app/src/components/FunnelIdentity.tsx app/src/components/FunnelCard.tsx
git commit -m "feat(ui): селектор типа воронки и чип в списке"
```

---

### Task 6: Убрать маркер из шаблона и закрыть его от ручного ввода

**Files:**
- Modify: `app/scripts/migrate-phase5-data.ts:40,44,49,53`
- Modify: `app/src/components/TagTemplateEditor.tsx:25`
- Modify: `app/src/lib/validation.ts:109-117`
- Test: `app/tests/api-tag-templates-route.test.ts`

**Interfaces:**
- Consumes: справочник `funnel_types` (Task 1), `refTagNameFor` (Task 2).

- [ ] **Step 1: Написать падающий тест**

Дописать в `app/tests/api-tag-templates-route.test.ts`:

```ts
it('маркер типа нельзя положить в шаблон через API', async () => {
  const res = await PUT(
    new Request('http://x/api/tag-templates/reg', {
      method: 'PUT',
      body: JSON.stringify({ names: ['АВ Квиз', 'допродажи'] }),
    }) as never,
    { params: Promise.resolve({ scenario: 'reg' }) },
  );
  expect(res.status).toBe(400);
});
```

- [ ] **Step 2: Прогнать тест и убедиться, что он падает**

Из `app/`: `npx vitest run tests/api-tag-templates-route.test.ts`
Ожидание: FAIL — сейчас возвращается 200.

- [ ] **Step 3: Убрать маркер из сида шаблона**

В `app/scripts/migrate-phase5-data.ts` удалить четыре строки с
`name: 'АВ Автоворонка'` (позиции 40, 44, 49, 53) и поправить `position`
у оставшихся тегов сценария, чтобы нумерация шла подряд. В шапке файла
заменить пояснение про маркер на:

```ts
 * Маркер типа воронки («АВ Автоворонка» и три альтернативы) в шаблоне НЕ живёт
 * с фазы 8: он выводится из funnels.funnel_type_id как пятая ось, см.
 * src/lib/funnel-type.ts. Вернуть его сюда — значит снова поставить один и тот
 * же маркер каждой воронке и получить второй источник правды.
```

- [ ] **Step 4: Закрыть ручной ввод маркера**

В `app/src/lib/validation.ts` `customTagNameSchema` проверяет только четыре оси
чистой функцией. Набор типов расширяем и лежит в БД, поэтому проверку добавляем
там, где есть доступ к БД, — в `replaceTemplateScenario`
(`app/src/lib/tag-templates.ts`), рядом с существующими проверками:

```ts
  const known = new Set(
    (db.select({ name: funnelTypes.name }).from(funnelTypes).all() as { name: string }[])
      .map((r) => r.name),
  );
  for (const name of names) {
    if (known.has(name)) {
      throw new ValidationError(
        `«${name}» — маркер типа воронки, он выводится из типа и в шаблоне не хранится`,
      );
    }
  }
```

В `app/src/app/api/tag-templates/[scenario]/route.ts` добавить ветку
`ValidationError → 400` перед `internalError`, по образцу Task 4 Step 6.

В `TagTemplateEditor.tsx` запрет сейчас чисто клиентский и знает только про оси
(строка 25). Набор типов лежит в БД, поэтому его надо дочитать:

```tsx
  const [markerNames, setMarkerNames] = useState<string[]>([]);

  useEffect(() => {
    fetch('/api/refs/funnel_types')
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: { name: string }[]) => setMarkerNames(rows.map((r) => r.name)))
      .catch(() => setMarkerNames([]));  // сервер всё равно откажет — см. replaceTemplateScenario
  }, []);
```

и в `add()` заменить одну проверку на две:

```tsx
    if (isAxisTag(n)) return;            // оси управляются автоматически
    if (markerNames.includes(n)) {       // маркер типа — пятая ось, живёт в типе воронки
      setError(`«${n}» — маркер типа воронки, он выводится из типа и в шаблоне не хранится`);
      return;
    }
```

Клиентская проверка здесь — удобство, а не защита: отказ по существу выдаёт
сервер, поэтому падение запроса за списком не должно ломать редактор.

- [ ] **Step 5: Прогнать тест и убедиться, что он проходит**

Из `app/`: `npx vitest run tests/api-tag-templates-route.test.ts` — ожидание: PASS.

- [ ] **Step 6: Проверить, что двоевластие над тегом исчезло**

Это не формальность, а закрытие находки рецензии задачи 2. Пока `АВ Автоворонка`
жил и в шаблоне, и в справочнике типов, переименование типа через
`/api/refs/funnel_types/[id]` переименовывало **шаблонный** тег: `tags.id=47`,
4 сценария, 288 строк `funnel_tags`. Владелец решил механизм переноса тега
оставить (он верен: так же работают продукты и подрядчики), а двоевластие снять
здесь. Значит здесь же и проверяем.

Тест дописать в `app/tests/api-tag-templates-route.test.ts`:

```ts
it('после чистки шаблона маркером владеет только справочник типов', () => {
  // Шаблон не должен содержать ни одного имени из справочника типов —
  // иначе переименование типа через /refs заденет чужой тег.
  const known = new Set(
    (sqlite.prepare('SELECT name FROM funnel_types').all() as { name: string }[])
      .map((r) => r.name),
  );
  const inTemplate = (sqlite.prepare('SELECT name FROM tag_templates').all() as { name: string }[])
    .map((r) => r.name)
    .filter((n) => known.has(n));
  expect(inTemplate).toEqual([]);
});
```

Тест проверяет СИД (фаза 5 на свежей базе), а не живую базу — её чистит
задача 7. Если фикстура файла построена на копии живой базы, где маркер ещё
в шаблоне, сначала прогони чистку из задачи 7 в подготовке теста либо
собери шаблон сидом фазы 5 на пустой базе; что из двух — решай по тому, как
устроена фикстура, и объясни выбор в отчёте.

- [ ] **Step 7: Полная проверка и коммит**

Из `app/`: `npx tsc --noEmit` и `npx vitest run` — ожидание: без ошибок.

```bash
git add app/scripts/migrate-phase5-data.ts app/src/lib/tag-templates.ts \
        app/src/components/TagTemplateEditor.tsx \
        app/src/app/api/tag-templates app/tests/api-tag-templates-route.test.ts
git commit -m "feat(tags): маркер уходит из шаблона и закрыт от ручного ввода"
```

---

### Task 7: Данные — чистка живого шаблона и двенадцать правок типа

**Files:**
- Create: `app/scripts/set-funnel-types-2026-07-28.ts`

**Interfaces:**
- Consumes: `updateFunnel`, `getFunnel` (Task 4), API прода.

- [ ] **Step 1: Написать скрипт**

Создать `app/scripts/set-funnel-types-2026-07-28.ts` по образцу
`archive-stalled-funnels-2026-07-28.ts` — с той же защитой по осям и теми же
двумя режимами:

```ts
/**
 * Пятая ось: проставить тип двенадцати воронкам и убрать маркер из живого
 * шаблона. Порядок внутри скрипта обязателен — сначала шаблон, потом типы:
 * фаза 8 уже проставила всем «АВ Автоворонка», поэтому чистка шаблона ничего
 * не теряет; в обратном порядке воронки на время остались бы без маркера.
 *
 * Одиннадцать воронок линейки ЖИВО-* → «АВ Прямые»: у их связок в реестре
 * GetCourse единственный маркер именно такой, и в базе у всех одиннадцать
 * нет ни дней, ни лендингов. f43 → «АВ Квиз»: её связка ЖИВО/НИМБ/Яндекс/РСЯ
 * несёт три маркера, и f43 — та из двух воронок, что квизовая.
 *
 * f8, f12, f27 сознательно остаются «АВ Автоворонка»: у всех троих 6 дней
 * и лендинг, в базе лежит вебинарная воронка, а недостающие квиз/прямые —
 * это отдельные воронки, которых в базе нет.
 *
 * ПРЕДВАРИТЕЛЬНОЕ УСЛОВИЕ: справочник funnel_types и колонка funnel_type_id
 * должны уже существовать (Фаза 7). На проде это делает docker-entrypoint.sh
 * при старте контейнера, но для ручного прогона — по умолчанию и для копии
 * из Step 2/3 — это отдельный шаг, ничего его не делает за вас:
 *   FUNNELS_DB_PATH=/abs/path/ksamata_funnels.db npx tsx scripts/migrate-phase8.ts
 * Без него скрипт падает в ОБОИХ режимах: assertNotFunnelTypeMarker (внутри
 * replaceTemplateScenario, --apply) и getFunnelTypeContext (внутри
 * axesMismatch → getFunnel, --dry-run тоже, на первой же цели) читают
 * funnel_types и без миграции получат «no such table».
 *
 * Каждая мутация — своя отдельная транзакция (по одной на сценарий шаблона,
 * одна на общий ресинк тегов, по одной на каждую из двенадцати воронок).
 * Падение на любом шаге останавливает скрипт, но не откатывает уже
 * применённые шаги и не портит недошедшие — скрипт идемпотентен (уже
 * очищенный сценарий и уже проставленный тип просто пропускаются с «=»),
 * поэтому повторный `--apply` после сбоя безопасно продолжит с того места,
 * где остановился, а не задвоит работу.
 *
 * Запуск из app/ (сначала обязательно с --dry-run):
 *   FUNNELS_DB_PATH=/abs/path/ksamata_funnels.db npx tsx scripts/set-funnel-types-2026-07-28.ts --dry-run
 *   FUNNELS_DB_PATH=/abs/path/ksamata_funnels.db npx tsx scripts/set-funnel-types-2026-07-28.ts --apply
 */
import { eq } from 'drizzle-orm';
import { db } from '../src/db/client';
import { funnels, funnelTags, tags } from '../src/db/schema';
import { getFunnel, updateFunnel, resyncAllFunnels } from '../src/lib/funnels';
import { SCENARIOS } from '../src/lib/ab-tags';
import { listTemplate, replaceTemplateScenario } from '../src/lib/tag-templates';
import { SEED_FUNNEL_TYPES } from '../src/lib/funnel-type';

const PROD = process.env.PROD_BASE_URL ?? 'https://funnels.ksamata.ru';

/** Ожидаемые оси — защита от того, что num или код указывает не туда. */
const TARGETS = [
  { code: 'f43', num: 45, type: 'АВ Квиз',   product: 'ЖИВО',               contractor: 'НИМБ',   channel: 'Яндекс', direction: 'РСЯ' },
  { code: 'f45', num: 46, type: 'АВ Прямые', product: 'ЖИВО-суставы',       contractor: 'НИМБ',   channel: 'Яндекс', direction: 'РСЯ' },
  { code: 'f46', num: 47, type: 'АВ Прямые', product: 'ЖИВО-суставы',       contractor: 'ИНХАУЗ', channel: 'ВК',     direction: 'Реклама' },
  { code: 'f47', num: 48, type: 'АВ Прямые', product: 'ЖИВО-суставы-триал', contractor: 'НИМБ',   channel: 'Яндекс', direction: 'РСЯ' },
  { code: 'f48', num: 49, type: 'АВ Прямые', product: 'ЖИВО-ЖКТ',           contractor: 'ИНХАУЗ', channel: 'ВК',     direction: 'Реклама' },
  { code: 'f51', num: 50, type: 'АВ Прямые', product: 'ЖИВО-суставы-триал', contractor: 'ИНХАУЗ', channel: 'ВК',     direction: 'Реклама' },
  { code: 'f54', num: 64, type: 'АВ Прямые', product: 'ЖИВО-ЖКТ',           contractor: 'НИМБ',   channel: 'Яндекс', direction: 'РСЯ' },
  { code: 'f55', num: 66, type: 'АВ Прямые', product: 'ЖИВО-суставы-триал', contractor: 'ИНХАУЗ', channel: 'Яндекс', direction: 'РСЯ' },
  { code: 'f56', num: 67, type: 'АВ Прямые', product: 'ЖИВО-суставы',       contractor: 'ИНХАУЗ', channel: 'Яндекс', direction: 'РСЯ' },
  { code: 'f57', num: 68, type: 'АВ Прямые', product: 'ЖИВО-ЖКТ',           contractor: 'ИНХАУЗ', channel: 'Яндекс', direction: 'РСЯ' },
  { code: 'f73', num: 69, type: 'АВ Прямые', product: 'ЖИВО-суставы-триал', contractor: 'NR',     channel: 'ВК',     direction: 'Реклама' },
  { code: 'f74', num: 70, type: 'АВ Прямые', product: 'ЖИВО-ЖКТ',           contractor: 'NR',     channel: 'ВК',     direction: 'Реклама' },
];

const apply = process.argv.includes('--apply');
const dryRun = process.argv.includes('--dry-run');
if (apply === dryRun) {
  console.error('Укажи ровно один режим: --dry-run или --apply');
  process.exit(2);
}

function axesMismatch(id: number, want: (typeof TARGETS)[number]): string[] {
  const full = getFunnel(db, id);
  if (!full) return ['воронка не читается'];
  return (['product', 'contractor', 'channel', 'direction'] as const)
    .filter((axis) => full.axes[axis] !== want[axis])
    .map((axis) => `${axis}: «${full.axes[axis] || '—'}» вместо «${want[axis]}»`);
}

/**
 * Число воронок на проде — только для справки в шапке вывода, ни на что не
 * влияет. Задача прямо запрещает скрипту трогать прод, поэтому недоступный
 * прод (сеть, авторизация, временная недоступность) не должен валить прогон
 * по локальной копии — предупреждаем и продолжаем без этой строки.
 */
async function prodFunnelCount(): Promise<number | null> {
  try {
    const res = await fetch(`${PROD}/api/funnels`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const list = await res.json() as { num: number }[];
    return list.length;
  } catch (err) {
    console.error(`  ! прод недоступен, счётчик пропущен: ${(err as Error).message}`);
    return null;
  }
}

/** Итоговая сводка по маркерам — та самая проверка, что раньше делалась отдельным sqlite3-запросом руками. */
function printMarkerSummary(): void {
  const rows = db
    .select({ funnelId: funnelTags.funnelId, name: tags.name })
    .from(funnelTags)
    .innerJoin(tags, eq(tags.id, funnelTags.tagId))
    .all() as { funnelId: number; name: string }[];

  const byMarker = new Map<string, Set<number>>();
  for (const name of SEED_FUNNEL_TYPES) byMarker.set(name, new Set());
  for (const row of rows) {
    if (byMarker.has(row.name)) byMarker.get(row.name)!.add(row.funnelId);
  }

  console.log('\nИтог по маркерам типа:');
  for (const name of SEED_FUNNEL_TYPES) {
    console.log(`  ${name}: ${byMarker.get(name)!.size}`);
  }
}

async function main() {
  const prodCount = await prodFunnelCount();
  const prodLine = prodCount === null ? 'прод: н/д' : `прод: ${prodCount} воронок`;
  console.log(`${prodLine}. Локально: `
    + `${db.select({ id: funnels.id }).from(funnels).all().length}.\n`);

  // Шаг 1 — живой шаблон. Сперва чистим все сценарии по отдельности (каждый
  // replaceTemplateScenario — своя транзакция), и только потом один общий
  // resyncAllFunnels — а не по разу на сценарий, как раньше: ресинк
  // пересчитывает теги ВСЕХ воронок по ВСЕМ сценариям разом, так что четыре
  // прогона подряд повторяли одну и ту же работу трижды впустую.
  const markers = new Set(SEED_FUNNEL_TYPES);
  let templateChanged = false;
  for (const scenario of SCENARIOS) {
    const current = listTemplate(db)[scenario] ?? [];
    const cleaned = current.filter((n) => !markers.has(n));
    if (cleaned.length === current.length) {
      console.log(`  = шаблон ${scenario}: маркера нет`);
    } else if (dryRun) {
      console.log(`  - шаблон ${scenario}: убрать ${current.filter((n) => markers.has(n)).join(', ')}`);
    } else {
      replaceTemplateScenario(db, scenario, cleaned);
      templateChanged = true;
      console.log(`  ✓ шаблон ${scenario} очищен`);
    }
  }
  if (templateChanged) {
    resyncAllFunnels(db);
    console.log('  ✓ теги всех воронок пересчитаны по очищенному шаблону');
  }

  // Шаг 2 — типы.
  for (const want of TARGETS) {
    const row = db.select({ id: funnels.id, code: funnels.frontCode })
      .from(funnels).where(eq(funnels.num, want.num)).get();
    if (!row) { console.error(`  ! num=${want.num} локально не найдена — пропускаю`); continue; }
    if (row.code !== want.code) {
      console.error(`  ! num=${want.num}: код «${row.code}» вместо «${want.code}» — пропускаю`);
      continue;
    }
    const mismatch = axesMismatch(row.id, want);
    if (mismatch.length) {
      console.error(`  ! ${want.code} оси не совпали (${mismatch.join('; ')}) — пропускаю`);
      continue;
    }
    const current = getFunnel(db, row.id)?.funnelType ?? null;
    if (current === want.type) {
      console.log(`  = ${want.code} уже «${want.type}»`);
    } else if (dryRun) {
      console.log(`  - ${want.code}: «${current ?? '—'}» → «${want.type}»`);
    } else {
      updateFunnel(db, row.id, { funnelType: want.type });
      console.log(`  ✓ ${want.code}: «${current ?? '—'}» → «${want.type}»`);
    }
  }

  if (!dryRun) printMarkerSummary();
}

main().catch((err) => { console.error(err); process.exit(1); });
```

- [ ] **Step 2: Прогнать вхолостую на копии базы**

```bash
cd app
cp ../ksamata_funnels.db /tmp/typecheck.db
FUNNELS_DB_PATH=/tmp/typecheck.db npx tsx scripts/set-funnel-types-2026-07-28.ts --dry-run
```

Ожидание: четыре строки про шаблон, двенадцать строк вида
`- f45: «АВ Автоворонка» → «АВ Прямые»`, ни одной строки `!`.

- [ ] **Step 3: Применить к копии и проверить итог**

```bash
cd app
FUNNELS_DB_PATH=/tmp/typecheck.db npx tsx scripts/set-funnel-types-2026-07-28.ts --apply
sqlite3 -column /tmp/typecheck.db "
SELECT t.name, COUNT(DISTINCT ft.funnel_id) FROM funnel_tags ft
 JOIN tags t ON t.id=ft.tag_id
 WHERE t.name IN ('АВ Автоворонка','АВ Прямые','АВ Квиз','АВ Квиз-Лайт')
 GROUP BY t.name;"
```

Ожидание ровно: `АВ Автоворонка` 60, `АВ Прямые` 11, `АВ Квиз` 1.
Если числа другие — остановиться и разобраться, к живой базе не переходить.

- [ ] **Step 4: Применить к живой базе**

Живой `ksamata_funnels.db` Фаза 7 ещё не накатана (это отдельная миграция —
на проде её делает `docker-entrypoint.sh` при старте контейнера, а локально
никто её за вас не запускает). Без неё скрипт падает в ОБОИХ режимах: и
`--apply` (на первой же чистке шаблона — `assertNotFunnelTypeMarker` читает
`funnel_types`), и `--dry-run` (на первой цели `f43` — `axesMismatch →
getFunnel → getFunnelTypeContext`, тот же справочник). Поэтому первый шаг —
миграция, и только потом оба режима скрипта:

```bash
cd app
FUNNELS_DB_PATH=$(cd .. && pwd)/ksamata_funnels.db npx tsx scripts/migrate-phase8.ts
sqlite3 $(cd .. && pwd)/ksamata_funnels.db "SELECT COUNT(*) FROM funnel_types;"
sqlite3 $(cd .. && pwd)/ksamata_funnels.db "SELECT COUNT(*) FROM funnels WHERE funnel_type_id IS NULL;"
```

Ожидание: первый запрос — `4` (`SEED_FUNNEL_TYPES`), второй — `0` (бэкфилл
Фазы 7 проставил всем воронкам «АВ Автоворонка», раз это ещё не решение о
типе, а сохранение текущего маркера из шаблона). Если числа другие —
останавливаться, дальше не идти.

```bash
FUNNELS_DB_PATH=$(cd .. && pwd)/ksamata_funnels.db npx tsx scripts/set-funnel-types-2026-07-28.ts --dry-run
FUNNELS_DB_PATH=$(cd .. && pwd)/ksamata_funnels.db npx tsx scripts/set-funnel-types-2026-07-28.ts --apply
```

Затем гигиена:

```bash
sqlite3 ksamata_funnels.db 'PRAGMA wal_checkpoint(TRUNCATE);'
rm -f ksamata_funnels.db-wal ksamata_funnels.db-shm
sqlite3 ksamata_funnels.db 'SELECT COUNT(*) FROM monitor_targets;'
```

Ожидание последней команды: `0`.

- [ ] **Step 5: Коммит**

Диф `ksamata_funnels.db` в этом коммите — результат ДВУХ разных мутаций,
выполненных подряд на Step 4: схемы Фазы 7 (справочник `funnel_types`,
колонка `funnels.funnel_type_id`, бэкфилл всем «АВ Автоворонка») и
собственно двенадцати правок этого скрипта. Это одна пара `git add` +
`git commit`, а не две — но если разбирать диф базы построчно, схемные
изменения в нём тоже будут, и это ожидаемо, не путать с посторонней порчей.

```bash
git add app/scripts/set-funnel-types-2026-07-28.ts ksamata_funnels.db
git commit -m "fix(data): тип воронки у двенадцати воронок, маркер убран из шаблона"
```

---

### Task 8: Аудит — ключ склейки становится пятёркой

**Files:**
- Modify: `tools/audit/normalize.py:10,163-175`
- Modify: `tools/audit/findings.py:83,118-119,148-149,261,358,500,509,563-576,603-604`
- Modify: `tools/audit/retired.py` (комментарий про четвёрку)
- Modify: `tools/audit/db_source.py:116-123`
- Test: `tools/audit/tests/test_normalize.py`, `tools/audit/tests/test_run_audit.py`

**Interfaces:**
- Produces: `av_key(tags) -> tuple` длины 5 (четыре оси + маркер);
  `quad(key) -> tuple` длины 4; `is_complete_quad(key) -> bool`;
  `is_complete_key(key) -> bool` (все пять).

- [ ] **Step 1: Написать падающий тест**

Дописать в `tools/audit/tests/test_normalize.py`:

```python
from normalize import av_key, quad, is_complete_key, is_complete_quad, key_label

AXES_TAGS = {
    'АВ Продукт: ЖИВО', 'АВ Подрядчик: НИМБ',
    'АВ Канал: Яндекс', 'АВ Направление: РСЯ',
}


def test_av_key_is_five_parts_with_marker():
    key = av_key(AXES_TAGS | {'АВ Квиз'})
    assert key == ('ЖИВО', 'НИМБ', 'Яндекс', 'РСЯ', 'АВ Квиз')
    assert is_complete_key(key)


def test_marker_missing_leaves_key_incomplete_but_quad_whole():
    key = av_key(AXES_TAGS)
    assert key[4] is None
    assert not is_complete_key(key)
    assert is_complete_quad(key)
    assert quad(key) == ('ЖИВО', 'НИМБ', 'Яндекс', 'РСЯ')


def test_same_quad_different_marker_are_different_keys():
    a = av_key(AXES_TAGS | {'АВ Автоворонка'})
    b = av_key(AXES_TAGS | {'АВ Квиз'})
    assert a != b
    assert quad(a) == quad(b)


def test_key_label_prints_five_parts():
    assert key_label(av_key(AXES_TAGS | {'АВ Квиз'})) == 'ЖИВО / НИМБ / Яндекс / РСЯ / АВ Квиз'
```

- [ ] **Step 2: Прогнать тест и убедиться, что он падает**

Из корня репозитория: `python3 -m pytest tools/audit/tests/test_normalize.py -v`
Ожидание: FAIL — `quad` и `is_complete_quad` не существуют, ключ из четырёх частей.

- [ ] **Step 3: Реализовать пятёрку в `normalize.py`**

Заменить `av_key`, `is_complete_key`, `key_label`:

```python
def marker_of(tags):
    """Маркер типа воронки. Их четыре и они взаимоисключающие: ни одно
    предложение реестра не несёт двух (сверено 2026-07-28)."""
    found = MARKER_TAGS & {normalize_tag(t) for t in tags}
    return next(iter(found)) if len(found) == 1 else None


def av_key(tags):
    """АВ-пятёрка: четыре оси в порядке AXES плюс маркер типа воронки.

    Пятый элемент добавлен 2026-07-28: маркер различает РАЗНЫЕ воронки
    с одинаковой четвёркой (f33 и f43 — автоворонка и квиз на одних осях).
    Отсутствующая часть даёт None.
    """
    return tuple(av_value(tags, axis) for axis in AXES) + (marker_of(tags),)


def quad(key):
    """Первые четыре элемента — связка без типа.

    Нужен там, где вопрос задаётся о СВЯЗКЕ, а не о воронке: отставка
    (retired.RETIRED_KEYS хранит четвёрки), даты последних заказов и класс 10.
    Срез key[:4] по коду разошёлся бы с этим смыслом молча.
    """
    return key[:4]


def is_complete_quad(key):
    return all(part is not None for part in quad(key))


def is_complete_key(key):
    return all(part is not None for part in key)


def key_label(key):
    """Читаемая форма ключа для отчёта; пропуски помечаются тире."""
    return ' / '.join(part if part is not None else '—' for part in key)
```

- [ ] **Step 4: Прогнать тест и убедиться, что он проходит**

Из корня: `python3 -m pytest tools/audit/tests/test_normalize.py -v` — ожидание: PASS.

- [ ] **Step 5: Перевести потребителей ключа**

В `tools/audit/findings.py`:

- строка 358 и 500: `is_retired(group.key, …)` → `is_retired(quad(group.key), order_dates.get(quad(group.key)))`;
- строка 576: то же для `find_unknown_av_keys`;
- строки 148-149 (`last_order_dates`): ключом словаря сделать `quad(av_key(obs.tags))`,
  условие — `is_complete_quad`;
- строки 603-604 (класс 10, неполная четвёрка): `is_complete_key` → `is_complete_quad`;
- строки 118-119, 509, 574: оставить `is_complete_key` — там речь именно
  о воронке, а не о связке;
- строка 42: заголовок класса 12 привести к делу:
  `12: 'Предложение с АВ Этап, но без маркера типа воронки'`.

Импортировать `quad` и `is_complete_quad` из `normalize` (строки 21-26).

В `tools/audit/db_source.py:116-123` менять ничего не нужно: та же `av_key`
теперь читает маркер из тегов воронки, которые с фазы 8 его содержат.
Добавить пояснение к докстрингу `build_av_index`:

```python
    """АВ-ключ (пятёрка) -> множество funnel_id. Неполные ключи отбрасываются.

    Обе стороны считаются одной функцией av_key: с фазы 8 база держит маркер
    типа в funnel_tags наравне с осями, поэтому особого случая тут нет.
    """
```

В `tools/audit/retired.py` поправить комментарий над `RETIRED_KEYS`:

```python
# ключ (Продукт, Подрядчик, Канал, Направление) → (дата решения, причина).
# ЧЕТВЁРКА, а не пятёрка: отставляют связку целиком, а не отдельный её тип.
# Вызывающий обязан передавать normalize.quad(av_key(...)) — иначе ни один
# ключ не совпадёт и 112 отставленных предложений вернутся в отчёт молча.
```

- [ ] **Step 6: Прогнать все тесты аудита**

Из корня: `python3 -m pytest tools/audit/tests -v`
Ожидание: PASS. Тесты, где ожидался четырёхэлементный ключ, поправить на
пятиэлементный — при правке сверяться с тем, что проверяет тест: связку
(тогда `quad`) или воронку (тогда полный ключ).

- [ ] **Step 7: Решающий прогон и сверка с ожиданием**

Из корня репозитория:

```bash
SSL_CERT_FILE=/etc/ssl/cert.pem python3 tools/audit/run_audit.py
```

(ключи `GC_DEV_KEY`, `GC_API_KEY`, `GC_DOMAIN` — из
`/Users/sergeielkin/dev/ksamata/getcourse-api/.env`, в вывод не печатать)

Занимает ~12 минут. Сверить с отчётом до правок:

- класс 8 (коллизия ключа) — ожидание: находок нет, `f33`/`f43` разошлись;
- класс 12 — ожидание: одна находка, offer `8506324` (`ТКМ / НИМБ / Яндекс / РСЯ`);
- класс 9 и 14 — ожидание: число находок НЕ выросло. Рост означает, что
  отставка перестала совпадать, то есть где-то забыт `quad`;
- класс 1 — ожидание: находки «ожидается `АВ Автоворонка`» по одиннадцати
  воронкам ЖИВО-* исчезли.

Числа записать в журнал (Task 9).

- [ ] **Step 8: Коммит**

```bash
git add tools/audit/
git commit -m "feat(audit): ключ склейки становится пятёркой, отставка остаётся по связке"
```

---

### Task 9: Документы и итоговая проверка

**Files:**
- Modify: `CLAUDE.md` (раздел «Data model» и «Tags: three layers»)
- Modify: `tools/audit/README.md`
- Modify: `docs/plans/2026-07-25-tag-drift-triage.md`
- Modify: `docs/project-map.md`

- [ ] **Step 1: `CLAUDE.md`**

В описание `funnels` добавить `funnelTypeId`; в список lookup-таблиц —
`funnel_types`. В раздел «Tags: three layers» дописать четвёртым абзацем:

```markdown
Поверх трёх слоёв лежит **слой идентичности**: четыре осевых тега
(`АВ Продукт:` и три остальных) и **маркер типа воронки** — пятая ось,
выводимая из `funnels.funnel_type_id` (справочник `funnel_types`,
`app/src/lib/funnel-type.ts`). Теги идентичности нельзя ни удалить
оверрайдом, ни положить в шаблон: `computeTagSet` гасит их в обоих слоях.
Значения типа расширяемы через `/refs` — набор маркеров задаёт GetCourse.
```

В список миграций добавить: **Phase 8** — `funnel_types` + `funnels.funnel_type_id`
+ бэкфилл `АВ Автоворонка`. В строку «Docker runs, in order» дописать `→ 7`.

- [ ] **Step 2: `tools/audit/README.md`**

Заменить утверждение «Ключ склейки — АВ-четвёрка» на пятёрку с пояснением
про `quad`. Переписать абзац «база умеет выражать только `АВ Автоворонка`»:
теперь умеет все четыре, а `f43` размечена квизом. В разделе про
`RETIRED_KEYS` добавить предупреждение, что список — четвёрки и вызов идёт
через `quad`.

- [ ] **Step 3: Журнал разбора**

В `docs/plans/2026-07-25-tag-drift-triage.md` пометить задачу «маркер типа
воронки — это ПЯТАЯ ОСЬ» как ✅ со ссылкой на спеку и этот план. **Исправить
запись про LEAK:** продукта `ЖИВО-квизы` там нет, продукт F43 — `ЖИВО`,
а различает LEAK легаси-меткой заявок `квиз`; и запись про «Подключили
‹мессенджер›» — маркер `АВ Прямые` там не у всех (82 из 139 несут
`АВ Автоворонка`). Записать числа прогона из Task 8 Step 7.

- [ ] **Step 4: Итоговая проверка**

```bash
cd app && npx tsc --noEmit && npx vitest run && npm run build
cd .. && python3 -m pytest tools/audit/tests
git status --porcelain
sqlite3 ksamata_funnels.db 'SELECT COUNT(*) FROM monitor_targets;'
```

Ожидание: сборка и все тесты проходят; `git status` показывает только
изменённые документы; счётчик мониторинга — `0`.

- [ ] **Step 5: Коммит**

```bash
git add CLAUDE.md tools/audit/README.md docs/plans/2026-07-25-tag-drift-triage.md docs/project-map.md
git commit -m "docs: пятая ось — модель, аудит и журнал приведены в соответствие"
```

---

## Что остаётся за границей плана

Решение владельца 2026-07-28: **не входит** заведение недостающих воронок
(три связки без воронок вовсе, плюс квиз/прямые к `f8`, `f12`, `f27`) и
правки в LEAK. Опись — в спеке, разделы «Опись недостающего» и «LEAK».
Причина отсрочки по LEAK: трафика на квизы нет, а правка метки в F43 без
заведения линейки квиз-лайт сузила бы охват с трёх предложений до одного.

**Прод** обновляется отдельно от этого плана: образ с фазой 7 в
`docker-entrypoint.sh` выкатывается Dokploy, после чего к нему применяется
тот же скрипт из Task 7 через публичный API. База и прод обязаны сойтись
дословно — сверять составом воронок, типами и тегами.
