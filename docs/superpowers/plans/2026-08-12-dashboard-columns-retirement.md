# Фаза 11: ссылки и дашборды живут только в блоке — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Вывести из обращения семь URL-колонок `funnels`, оставив единственным источником истины блок `links`, — по образцу фазы 10 для `landing_url`.

**Architecture:** Новая идемпотентная фаза миграции `migrate-phase11` при каждом старте контейнера переносит непустые адреса из семи колонок в блок «Ссылки» (сравнение по адресам, не по подписям) и гасит колонки. XLSX-экспорт переводится на чтение блока. Семь свойств удаляются из Drizzle-схемы; сами колонки остаются в SQLite пустыми, потому что в них продолжает писать Python-импорт.

**Tech Stack:** TypeScript, better-sqlite3, Drizzle ORM, vitest, esbuild (Docker), Python 3 + sqlite3 + openpyxl + pytest.

## Global Constraints

- Спека: [docs/superpowers/specs/2026-08-12-dashboard-columns-retirement-design.md](../specs/2026-08-12-dashboard-columns-retirement-design.md).
- Семь колонок и их подписи — ровно эта таблица, в этом порядке: `dash_sales_url` → «Дашборд продаж», `dash_pereliv_url` → «Дашборд перелива», `regi_total_url` → «Регистрации всего», `regi_15_url` → «Регистрации 15:00», `regi_19_url` → «Регистрации 19:00», `regi_notime_url` → «Регистрации без времени», `predspisok_url` → «Предсписок».
- **Сравнение адресов — `sameUrlKey`: `trim().toLowerCase()` без хвостовых `/`. Подписи в сравнении не участвуют.**
- **У файла тела миграции НЕТ CLI-блока `if (require.main === module)`.** esbuild бандлит раннер вместе с телом, и внутри бандла `require.main === module` истинно — блок сработал бы на импорте и фаза выполнилась бы дважды за старт. Единственная точка входа — раннер. Это проверяет `app/tests/migration-runners.test.ts`.
- Команды приложения запускаются из `app/`: `npx vitest run`, `npx tsc --noEmit`, `npm run build`. Python — из корня репозитория.
- Тесты работают с временной **копией** базы через `copyDbForTest` (`app/tests/helpers/db.ts`), никогда с живым файлом.
- Живую базу правим логикой приложения (`replaceBlock`, `updateFunnel`) или раннером фазы — не сырым SQL.
- После любого прогона по живой базе: `sqlite3 ksamata_funnels.db 'PRAGMA wal_checkpoint(TRUNCATE);'`, затем `rm -f ksamata_funnels.db-wal ksamata_funnels.db-shm`. `monitor_targets` обязан остаться пустым (`select count(*)` → `0`).
- Ветка: `claude/zen-hellman-5fcb1d`, перебазирована на `main` (`55d5a10`). Замеры в спеке сделаны на этой базе.

---

### Task 1: Фаза 11 — тело, раннер, Docker-обвязка

**Files:**
- Create: `app/scripts/migrate-phase11.ts`
- Create: `app/scripts/migrate-phase11-runner.ts`
- Test: `app/tests/migrate-phase11.test.ts`
- Modify: `app/Dockerfile` (после блока Phase-10 на строках 95-99 и после `COPY` на строке 162)
- Modify: `app/docker-entrypoint.sh` (после блока Phase-10, перед `exec node server.js`)

**Interfaces:**
- Consumes: `copyDbForTest(src, dest)` из `app/tests/helpers/db.ts`.
- Produces: `runMigratePhase11(sqlite: import('better-sqlite3').Database): Phase11Result`, где `Phase11Result = { moved: number; cleared: number }`; и `LINK_COLUMNS: { col: string; label: string }[]`.

- [ ] **Step 1: Написать падающий тест**

Создать `app/tests/migrate-phase11.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { copyDbForTest } from './helpers/db';
import { runMigratePhase11, LINK_COLUMNS } from '../scripts/migrate-phase11';

const dir = mkdtempSync(join(tmpdir(), 'phase11-'));
const dbPath = join(dir, 'test.db');
copyDbForTest(join(__dirname, '../../ksamata_funnels.db'), dbPath);
const sqlite = new Database(dbPath);
sqlite.pragma('foreign_keys = ON');

afterAll(() => {
  sqlite.close();
  rmSync(dir, { recursive: true, force: true });
});

/** Воронка без ссылок ни в колонках, ни в блоке — чистая точка отсчёта. */
function freshFunnel(): number {
  const num =
    ((sqlite.prepare(`SELECT MAX(num) AS m FROM funnels`).get() as { m: number | null }).m ?? 0) + 1;
  // source_id NOT NULL — берём любой существующий: сама воронка тесту не важна,
  // важно, что у неё пустые и колонки, и блок.
  const ref = (t: string) => (sqlite.prepare(`SELECT id FROM ${t} LIMIT 1`).get() as { id: number }).id;
  return sqlite
    .prepare(
      `INSERT INTO funnels (num, source_id, product_id, contractor_id, product_name, variant, status)
       VALUES (?, ?, ?, ?, 'тест', '', 'active')`
    )
    .run(num, ref('sources'), ref('products'), ref('contractors')).lastInsertRowid as number;
}

function setCol(id: number, col: string, value: string) {
  sqlite.prepare(`UPDATE funnels SET ${col} = ? WHERE id = ?`).run(value, id);
}

function addBlockItem(funnelId: number, label: string, url: string, enabled = 1) {
  let blockId = (
    sqlite
      .prepare(`SELECT id FROM funnel_blocks WHERE funnel_id = ? AND kind = 'links'`)
      .get(funnelId) as { id: number } | undefined
  )?.id;
  if (blockId === undefined) {
    blockId = sqlite
      .prepare(`INSERT INTO funnel_blocks (funnel_id, kind, enabled, mode) VALUES (?, 'links', ?, 'common')`)
      .run(funnelId, enabled).lastInsertRowid as number;
  }
  const pos =
    ((
      sqlite.prepare(`SELECT MAX(position) AS m FROM funnel_block_items WHERE block_id = ?`).get(blockId) as {
        m: number | null;
      }
    ).m ?? -1) + 1;
  sqlite
    .prepare(`INSERT INTO funnel_block_items (block_id, slot, label, url, position) VALUES (?, NULL, ?, ?, ?)`)
    .run(blockId, label, url, pos);
}

function blockItems(funnelId: number): { label: string; url: string }[] {
  return sqlite
    .prepare(
      `SELECT i.label, i.url FROM funnel_block_items i
         JOIN funnel_blocks b ON b.id = i.block_id
        WHERE b.funnel_id = ? AND b.kind = 'links'
        ORDER BY i.position`
    )
    .all(funnelId) as { label: string; url: string }[];
}

function cols(funnelId: number): Record<string, string> {
  return sqlite
    .prepare(`SELECT ${LINK_COLUMNS.map((c) => c.col).join(', ')} FROM funnels WHERE id = ?`)
    .get(funnelId) as Record<string, string>;
}

function blockEnabled(funnelId: number): number | undefined {
  return (
    sqlite
      .prepare(`SELECT enabled FROM funnel_blocks WHERE funnel_id = ? AND kind = 'links'`)
      .get(funnelId) as { enabled: number } | undefined
  )?.enabled;
}

beforeEach(() => {
  sqlite.exec('BEGIN');
});

afterEach(() => {
  sqlite.exec('ROLLBACK');
});

describe('Phase-11: ссылки и дашборды переезжают в блок', () => {
  it('переносит все семь колонок, каждую со своей подписью', () => {
    const id = freshFunnel();
    LINK_COLUMNS.forEach(({ col }, i) => setCol(id, col, `https://gc.example.ru/${i}`));

    const result = runMigratePhase11(sqlite);

    expect(result.moved).toBeGreaterThanOrEqual(7);
    expect(blockItems(id)).toEqual(
      LINK_COLUMNS.map(({ label }, i) => ({ label, url: `https://gc.example.ru/${i}` }))
    );
    expect(Object.values(cols(id)).every((v) => v === '')).toBe(true);
  });

  it('не плодит дубль, если адрес уже в блоке под той же подписью — регистр и хвостовой слэш не в счёт', () => {
    const id = freshFunnel();
    addBlockItem(id, 'Дашборд продаж', 'https://GC.example.ru/dash/');
    setCol(id, 'dash_sales_url', 'https://gc.example.ru/dash');

    runMigratePhase11(sqlite);

    expect(blockItems(id)).toEqual([{ label: 'Дашборд продаж', url: 'https://GC.example.ru/dash/' }]);
    expect(cols(id).dash_sales_url).toBe('');
  });

  it('не плодит дубль, если тот же адрес лежит в блоке под ДРУГОЙ подписью', () => {
    const id = freshFunnel();
    addBlockItem(id, 'Регистрации всего', 'https://gc.example.ru/same');
    setCol(id, 'dash_sales_url', 'https://gc.example.ru/same');

    runMigratePhase11(sqlite);

    expect(blockItems(id)).toEqual([{ label: 'Регистрации всего', url: 'https://gc.example.ru/same' }]);
  });

  it('дописывает вторым пунктом, когда подпись занята другим адресом (случай f9/f16)', () => {
    const id = freshFunnel();
    addBlockItem(id, 'Дашборд продаж', 'https://gc.example.ru/wrong');
    setCol(id, 'dash_sales_url', 'https://gc.example.ru/right');

    const result = runMigratePhase11(sqlite);

    expect(result.moved).toBeGreaterThanOrEqual(1);
    expect(blockItems(id)).toEqual([
      { label: 'Дашборд продаж', url: 'https://gc.example.ru/wrong' },
      { label: 'Дашборд продаж', url: 'https://gc.example.ru/right' },
    ]);
  });

  it('очищает колонку с текстом вместо адреса, ничего не добавляя в блок', () => {
    const id = freshFunnel();
    setCol(id, 'dash_sales_url', 'уточнить у подрядчика');

    runMigratePhase11(sqlite);

    expect(blockItems(id)).toEqual([]);
    expect(cols(id).dash_sales_url).toBe('');
  });

  it('создаёт блок и включает его, если перенесла адрес', () => {
    const id = freshFunnel();
    addBlockItem(id, 'Дашборд продаж', 'https://gc.example.ru/x', 0);
    setCol(id, 'regi_total_url', 'https://gc.example.ru/y');

    runMigratePhase11(sqlite);

    expect(blockEnabled(id)).toBe(1);
  });

  it('не включает блок, в который ничего не добавила', () => {
    const id = freshFunnel();
    addBlockItem(id, 'Дашборд продаж', 'https://gc.example.ru/dup', 0);
    setCol(id, 'dash_sales_url', 'https://gc.example.ru/dup');

    runMigratePhase11(sqlite);

    expect(blockEnabled(id)).toBe(0);
  });

  it('идемпотентна: второй прогон уже ничего не находит', () => {
    const id = freshFunnel();
    setCol(id, 'dash_sales_url', 'https://gc.example.ru/once');

    runMigratePhase11(sqlite);
    const second = runMigratePhase11(sqlite);

    expect(second).toEqual({ moved: 0, cleared: 0 });
    expect(blockItems(id)).toEqual([{ label: 'Дашборд продаж', url: 'https://gc.example.ru/once' }]);
  });

  it('после прогона ни в одной воронке базы не остаётся заполненной колонки', () => {
    runMigratePhase11(sqlite);

    const where = LINK_COLUMNS.map((c) => `trim(coalesce(${c.col}, '')) <> ''`).join(' OR ');
    const left = sqlite.prepare(`SELECT COUNT(*) AS n FROM funnels WHERE ${where}`).get() as { n: number };
    expect(left.n).toBe(0);
  });

  it('не теряет ни одного адреса живой базы: всё, что было в колонках, есть в блоке', () => {
    const key = (u: string) => u.trim().toLowerCase().replace(/\/+$/, '');
    const where = LINK_COLUMNS.map((c) => `trim(coalesce(${c.col}, '')) <> ''`).join(' OR ');
    const before = (
      sqlite
        .prepare(`SELECT id, ${LINK_COLUMNS.map((c) => c.col).join(', ')} FROM funnels WHERE ${where}`)
        .all() as Record<string, string | number>[]
    ).map((row) => [
      row.id as number,
      LINK_COLUMNS.map((c) => String(row[c.col] ?? '').trim()).filter((u) => /^https?:\/\//i.test(u)),
    ] as const);

    runMigratePhase11(sqlite);

    for (const [id, urls] of before) {
      const inBlock = new Set(blockItems(id).map((i) => key(i.url)));
      for (const url of urls) {
        expect(inBlock.has(key(url))).toBe(true);
      }
    }
  });
});
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Из `app/`:

```bash
npx vitest run tests/migrate-phase11.test.ts
```

Ожидаемо: FAIL — `Failed to resolve import "../scripts/migrate-phase11"`.

- [ ] **Step 3: Написать тело фазы**

Создать `app/scripts/migrate-phase11.ts`:

```ts
/**
 * Phase-11: адреса дашбордов и подсчётов регистраций живут только в блоке
 * «Ссылки». Идемпотентно.
 *
 *   cd app/
 *   npx tsx scripts/migrate-phase11-runner.ts
 *
 * Запускается только через свой раннер — он единственная точка входа и в
 * Docker, и вручную. Своего CLI-блока у файла нет сознательно: esbuild
 * бандлит раннер вместе с этим файлом, и внутри бандла
 * `require.main === module` истинно, так что блок сработал бы на импорте
 * и миграция выполнялась бы дважды за старт контейнера.
 *
 * Семь колонок `funnels` держали те же адреса, что и блок `links`, но правит
 * человек только блок: полей карточки у колонок нет вовсе, и приложение их
 * не читает и не пишет. Два места кончились тем, чем всегда: у f9 и f16 в
 * блоке лежала копия «Регистрации всего» под подписью «Дашборд продаж», а
 * верный адрес дашборда остался только в колонке.
 *
 * Правило переноса — то же, что у фазы 10: дописать в блок то, чего в нём ещё
 * нет, сравнивая адреса без учёта регистра и хвостового слэша. Подписи в
 * сравнении НЕ участвуют, поэтому понятия «конфликт» у фазы нет: расхождение
 * выглядит как «этого адреса в блоке нет» и дописывается вторым пунктом.
 * Ничего не теряется, а лишний пункт человек снимает в админке.
 *
 * Фаза остаётся в цепочке навсегда: колонки продолжают писать Python-скрипты
 * импорта (tools/data-import/), и каждый старт контейнера подметает то, что
 * попало туда в обход приложения.
 */

/** Колонка → подпись пункта блока. Та же таблица, что в migrate-funnel-data.ts. */
export const LINK_COLUMNS: { col: string; label: string }[] = [
  { col: 'dash_sales_url',   label: 'Дашборд продаж' },
  { col: 'dash_pereliv_url', label: 'Дашборд перелива' },
  { col: 'regi_total_url',   label: 'Регистрации всего' },
  { col: 'regi_15_url',      label: 'Регистрации 15:00' },
  { col: 'regi_19_url',      label: 'Регистрации 19:00' },
  { col: 'regi_notime_url',  label: 'Регистрации без времени' },
  { col: 'predspisok_url',   label: 'Предсписок' },
];

/** Сравниваем адреса как это делает человек: регистр и хвостовой «/» не в счёт. */
function sameUrlKey(url: string): string {
  return url.trim().toLowerCase().replace(/\/+$/, '');
}

export interface Phase11Result {
  /** Адреса, дописанные из колонок в блок. */
  moved: number;
  /** Воронки, у которых колонки очищены. */
  cleared: number;
}

export function runMigratePhase11(sqlite: import('better-sqlite3').Database): Phase11Result {
  sqlite.pragma('foreign_keys = ON');

  // Имена колонок — литералы этого файла, не пользовательский ввод.
  const colNames = LINK_COLUMNS.map((c) => c.col);
  const anyFilled = colNames.map((c) => `trim(coalesce(${c}, '')) <> ''`).join(' OR ');

  const rows = sqlite
    .prepare(`SELECT id, ${colNames.join(', ')} FROM funnels WHERE ${anyFilled}`)
    .all() as (Record<string, string | null> & { id: number })[];

  if (rows.length === 0) return { moved: 0, cleared: 0 };

  const selectBlock = sqlite.prepare(
    `SELECT id FROM funnel_blocks WHERE funnel_id = ? AND kind = 'links'`
  );
  const insertBlock = sqlite.prepare(
    `INSERT INTO funnel_blocks (funnel_id, kind, enabled, mode) VALUES (?, 'links', 1, 'common')`
  );
  const enableBlock = sqlite.prepare(`UPDATE funnel_blocks SET enabled = 1 WHERE id = ?`);
  const selectItems = sqlite.prepare(
    `SELECT url, position FROM funnel_block_items WHERE block_id = ? ORDER BY position`
  );
  const insertItem = sqlite.prepare(
    `INSERT INTO funnel_block_items (block_id, slot, label, url, position) VALUES (?, NULL, ?, ?, ?)`
  );
  const clearCols = sqlite.prepare(
    `UPDATE funnels SET ${colNames.map((c) => `${c} = ''`).join(', ')} WHERE id = ?`
  );

  let moved = 0;
  let cleared = 0;

  const migrate = sqlite.transaction(() => {
    for (const row of rows) {
      // Колонка с мусором вместо адреса (такое в базе встречается) не
      // переносится, но гасится тоже: переносить нечего, а держать второе
      // место ради нечитаемой строки — значит оставить его жить.
      const pending = LINK_COLUMNS.map(({ col, label }) => ({
        label,
        url: String(row[col] ?? '').trim(),
      })).filter((p) => /^https?:\/\//i.test(p.url));

      if (pending.length > 0) {
        let blockId = (selectBlock.get(row.id) as { id: number } | undefined)?.id;
        if (blockId === undefined) {
          blockId = Number(insertBlock.run(row.id).lastInsertRowid);
        }

        const existing = selectItems.all(blockId) as { url: string; position: number }[];
        const seen = new Set(existing.map((i) => sameUrlKey(i.url)));
        let position = existing.reduce((max, i) => Math.max(max, i.position), -1);

        let added = 0;
        for (const { label, url } of pending) {
          const key = sameUrlKey(url);
          if (seen.has(key)) continue;
          seen.add(key);
          position += 1;
          insertItem.run(blockId, label, url, position);
          added += 1;
        }

        if (added > 0) {
          moved += added;
          // Блок со ссылками обязан быть включённым: выключенный не виден в
          // карточке, и перенос «потерял» бы адрес из виду.
          enableBlock.run(blockId);
        }
      }

      clearCols.run(row.id);
      cleared += 1;
    }
  });
  migrate();

  return { moved, cleared };
}
```

- [ ] **Step 4: Запустить тест и убедиться, что он проходит**

```bash
npx vitest run tests/migrate-phase11.test.ts
```

Ожидаемо: PASS, 9 тестов.

- [ ] **Step 5: Написать раннер**

Создать `app/scripts/migrate-phase11-runner.ts`:

```ts
/**
 * Standalone-миграция Phase-11 для Docker-образа.
 * Собирается в migrate-phase11.cjs через esbuild в builder-стадии.
 * Вызывается из docker-entrypoint.sh как: node /app/migrate-phase11.cjs
 */
import Database from 'better-sqlite3';
import { resolveCliDbPath } from './cli-db-path';
import { runMigratePhase11 } from './migrate-phase11';

// Путь: FUNNELS_DB_PATH, иначе дефолт от расположения скрипта (см. cli-db-path.ts).
// Несуществующая база — отказ, а не тихий пропуск: стартовать на
// непромигрированной базе хуже, чем не стартовать вовсе.
const dbPath = resolveCliDbPath();

console.log(`[migrate-phase11] Running Phase-11 migration on: ${dbPath}`);
const sqlite = new Database(dbPath);
sqlite.pragma('journal_mode = WAL');
const result = runMigratePhase11(sqlite);
sqlite.close();
console.log(
  `[migrate-phase11] Done (адресов перенесено в блок: ${result.moved}; воронок очищено: ${result.cleared}).`
);
```

- [ ] **Step 6: Проверить, что раннер — единственная точка входа**

```bash
npx vitest run tests/migration-runners.test.ts
```

Ожидаемо: PASS. Тест находит раннеры сам через `readdirSync` — правки ему не нужны. Если он падает с указанием на `migrate-phase11.ts`, значит в теле фазы остался блок `if (require.main === module)`; убрать его.

- [ ] **Step 7: Вписать фазу в Dockerfile**

В `app/Dockerfile` после блока Phase-10 (строки 95-99) добавить:

```dockerfile
# Compile the Phase-11 migration to a self-contained CJS bundle.
RUN npx esbuild scripts/migrate-phase11-runner.ts \
      --bundle \
      --platform=node \
      --external:better-sqlite3 \
      --outfile=migrate-phase11.cjs
```

И после строки `COPY --from=builder /build/migrate-phase10.cjs /app/migrate-phase10.cjs`:

```dockerfile
COPY --from=builder /build/migrate-phase11.cjs /app/migrate-phase11.cjs
```

- [ ] **Step 8: Вписать фазу в entrypoint**

В `app/docker-entrypoint.sh` после блока Phase-10 и **перед** `exec node server.js`:

```sh
# Apply Phase-11 migration (idempotent: переносит адреса из семи колонок в блок
# «Ссылки» и чистит колонки). Дашборды и подсчёты регистраций живут только в
# блоке; колонки ещё пишут Python-скрипты импорта, поэтому фаза остаётся в
# цепочке навсегда — она подберёт то, что попало туда в обход приложения.
if [ -n "$FUNNELS_DB_PATH" ]; then
  echo "[entrypoint] Running Phase-11 migration against $FUNNELS_DB_PATH"
  node /app/migrate-phase11.cjs
  echo "[entrypoint] Phase-11 migration done."
fi
```

- [ ] **Step 9: Прогнать весь набор и типы**

```bash
npx tsc --noEmit && npx vitest run
```

Ожидаемо: типы чистые, все тесты зелёные.

- [ ] **Step 10: Проверить, что живая база не изменилась**

Из корня репозитория:

```bash
git status --porcelain
```

Ожидаемо: `ksamata_funnels.db` в списке НЕ значится (тесты работают с копией).

- [ ] **Step 11: Коммит**

```bash
git add app/scripts/migrate-phase11.ts app/scripts/migrate-phase11-runner.ts app/tests/migrate-phase11.test.ts app/Dockerfile app/docker-entrypoint.sh
git commit -m "feat(migrations): фаза 11 — ссылки и дашборды живут только в блоке"
```

---

### Task 2: Починка f9/f16 и прогон фазы по живой базе

**Files:**
- Create: `app/scripts/fix-links-dashboards-2026-08-12.ts` (после прогона переезжает в `app/scripts/archive/`)
- Modify: `ksamata_funnels.db` (данные)

**Interfaces:**
- Consumes: `runMigratePhase11` из Task 1; `getBlock`/`replaceBlock` из `app/src/lib/funnel-blocks.ts` (`replaceBlock(db, funnelId, kind, enabled, mode, items)`, `BlockItem = { slot: '15' | '19' | null; label: string; url: string }`); `db` из `app/src/db/client.ts`.
- Produces: ничего для следующих задач — операция над данными.

Порядок важен: сперва починка, потом фаза. Тогда фаза найдёт верные адреса уже в блоке, перенесёт `0` и лишнего пункта не создаст.

- [ ] **Step 1: Зафиксировать состояние до правки**

Из корня репозитория:

```bash
sqlite3 ksamata_funnels.db "SELECT f.front_code, trim(i.label), length(trim(i.url)) FROM funnel_block_items i JOIN funnel_blocks b ON b.id=i.block_id JOIN funnels f ON f.id=b.funnel_id WHERE b.kind='links' AND f.front_code IN ('f9','f16') ORDER BY f.front_code, i.position;"
```

Ожидаемо: у обеих воронок «Дашборд продаж» и «Регистрации всего» одной длины (1025 у f9, 1007 у f16) — та самая копия.

- [ ] **Step 2: Написать разовый скрипт починки**

Создать `app/scripts/fix-links-dashboards-2026-08-12.ts`:

```ts
/**
 * f9 и f16: в блоке «Ссылки» под подписью «Дашборд продаж» лежит побайтовая
 * копия «Регистрации всего» — ошибка вставки в админке. Верный адрес дашборда
 * сохранился только в колонке `funnels.dash_sales_url`, которую фаза 11
 * выводит из обращения. Ставим его в блок ДО прогона фазы: тогда фаза увидит
 * адрес уже на месте и не создаст второй пункт с той же подписью.
 *
 * Идемпотентен: уже починенный пункт пропускается, неожиданное содержимое —
 * повод остановиться, а не «поправить как-нибудь».
 *
 * Запуск из app/:
 *   npx tsx scripts/fix-links-dashboards-2026-08-12.ts
 */
import { eq } from 'drizzle-orm';
import { db } from '../src/db/client';
import { funnels } from '../src/db/schema';
import { getBlock, replaceBlock } from '../src/lib/funnel-blocks';

const LABEL = 'Дашборд продаж';

const TARGETS = [
  { frontCode: 'f9',  to: 'https://gc.ksamata.ru/pl/logic/funnel/dashboard?id=1630392#pk=alltime' },
  { frontCode: 'f16', to: 'https://gc.ksamata.ru/pl/logic/funnel/dashboard?id=1665622#pk=alltime' },
];

for (const t of TARGETS) {
  const row = db.select().from(funnels).where(eq(funnels.frontCode, t.frontCode)).get();
  if (!row) {
    console.error(`${t.frontCode} не найдена — ничего не делаю`);
    process.exit(1);
  }

  const block = getBlock(db, row.id, 'links');
  const idx = block.items.findIndex((i) => i.label.trim() === LABEL);
  if (idx === -1) {
    console.error(`${t.frontCode}: пункта «${LABEL}» в блоке нет — НЕ трогаю`);
    process.exit(1);
  }

  if (block.items[idx].url === t.to) {
    console.log(`${t.frontCode}: «${LABEL}» уже верный — пропускаю`);
    continue;
  }

  // Единственное ожидаемое неверное содержимое — копия «Регистрации всего».
  // Что-либо ещё означает, что данные с 12.08.2026 изменились, и подменять их
  // вслепую нельзя.
  const regTotal = block.items.find((i) => i.label.trim() === 'Регистрации всего');
  if (!regTotal || regTotal.url !== block.items[idx].url) {
    console.error(`${t.frontCode}: «${LABEL}» содержит не копию «Регистрации всего» — НЕ трогаю`);
    process.exit(1);
  }

  const items = block.items.map((i, n) => (n === idx ? { ...i, url: t.to } : i));
  replaceBlock(db, row.id, 'links', block.enabled, block.mode, items);
  console.log(`${t.frontCode}: «${LABEL}» → ${t.to}`);
}
```

- [ ] **Step 3: Прогнать скрипт**

Из `app/`:

```bash
npx tsx scripts/fix-links-dashboards-2026-08-12.ts
```

Ожидаемо: две строки вида `f9: «Дашборд продаж» → https://gc.ksamata.ru/pl/logic/funnel/dashboard?id=1630392#pk=alltime`.

- [ ] **Step 4: Проверить, что скрипт идемпотентен**

```bash
npx tsx scripts/fix-links-dashboards-2026-08-12.ts
```

Ожидаемо: `f9: «Дашборд продаж» уже верный — пропускаю` и то же для f16.

- [ ] **Step 5: Прогнать фазу 11 по живой базе**

Из `app/`:

```bash
npx tsx scripts/migrate-phase11-runner.ts
```

Ожидаемо: `[migrate-phase11] Done (адресов перенесено в блок: 0; воронок очищено: 45).`

`moved: 0` — именно то, чего мы добивались Step 3: все адреса колонок уже лежат в блоке. Если `moved` больше нуля, остановиться и разобраться, что за адрес переехал, прежде чем коммитить базу.

- [ ] **Step 6: Проверить результат и убрать WAL**

Из корня репозитория:

```bash
sqlite3 ksamata_funnels.db 'PRAGMA wal_checkpoint(TRUNCATE);'
rm -f ksamata_funnels.db-wal ksamata_funnels.db-shm
sqlite3 ksamata_funnels.db "SELECT count(*) FROM funnels WHERE trim(coalesce(dash_sales_url,''))<>'' OR trim(coalesce(dash_pereliv_url,''))<>'' OR trim(coalesce(regi_total_url,''))<>'' OR trim(coalesce(regi_15_url,''))<>'' OR trim(coalesce(regi_19_url,''))<>'' OR trim(coalesce(regi_notime_url,''))<>'' OR trim(coalesce(predspisok_url,''))<>'';"
sqlite3 ksamata_funnels.db "SELECT count(*) FROM monitor_targets;"
sqlite3 ksamata_funnels.db "SELECT count(*) FROM funnel_block_items i JOIN funnel_blocks b ON b.id=i.block_id WHERE b.kind='links' AND trim(coalesce(i.url,''))<>'';"
```

Ожидаемо: `0` заполненных колонок, `0` в `monitor_targets`, `221` пункт в блоке `links` (столько же, сколько было до правки: адреса не добавлялись, один был заменён).

- [ ] **Step 7: Прогнать тесты на изменённой базе**

Из `app/`:

```bash
npx vitest run
```

Ожидаемо: всё зелёное. Тест «после прогона ни в одной воронке базы не остаётся заполненной колонки» теперь тривиально верен, тест «не теряет ни одного адреса» проходит на пустом множестве — это нормально: фаза остаётся в цепочке ради будущих записей Python-импорта.

- [ ] **Step 8: Убрать скрипт в архив и закоммитить**

```bash
git mv app/scripts/fix-links-dashboards-2026-08-12.ts app/scripts/archive/fix-links-dashboards-2026-08-12.ts
git add app/scripts/archive/fix-links-dashboards-2026-08-12.ts ksamata_funnels.db
git commit -m "data(funnels): верный дашборд продаж f9/f16 в блоке, колонки очищены фазой 11"
```

---

### Task 3: Убрать семь свойств из Drizzle-схемы

**Files:**
- Modify: `app/src/db/schema.ts:64-70`

**Interfaces:**
- Consumes: ничего.
- Produces: ничего — удаление. Свойства `dashSalesUrl`, `dashPedelivUrl`, `regiTotalUrl`, `regi15Url`, `regi19Url`, `regiNotimeUrl`, `predspisokUrl` перестают существовать.

- [ ] **Step 1: Убедиться, что свойства нигде не читаются**

Из корня репозитория:

```bash
grep -rn "dashSalesUrl\|dashPedelivUrl\|dashPerelivUrl\|regiTotalUrl\|regi15Url\|regi19Url\|regiNotimeUrl\|predspisokUrl" app/src app/scripts app/tests
```

Ожидаемо: единственные попадания — объявления в `app/src/db/schema.ts`. Если найдётся что-то ещё, остановиться: значит с момента написания спеки код изменился.

- [ ] **Step 2: Удалить семь строк и оставить объяснение**

В `app/src/db/schema.ts` заменить строки 64-70:

```ts
    dashSalesUrl:     text('dash_sales_url').default(''),
    dashPedelivUrl:   text('dash_pereliv_url').default(''),
    regiTotalUrl:     text('regi_total_url').default(''),
    regi15Url:        text('regi_15_url').default(''),
    regi19Url:        text('regi_19_url').default(''),
    regiNotimeUrl:    text('regi_notime_url').default(''),
    predspisokUrl:    text('predspisok_url').default(''),
```

на комментарий:

```ts
    // Колонок dash_sales_url, dash_pereliv_url, regi_total_url, regi_15_url,
    // regi_19_url, regi_notime_url и predspisok_url здесь больше нет. Адреса
    // дашбордов и подсчётов регистраций живут в блоке «Ссылки» (kind = 'links'),
    // и правит человек только его. Сами колонки остались в SQLite пустыми:
    // в них ещё пишут Python-скрипты импорта, а Phase-11 при каждом старте
    // переносит попавшее туда в блок. Читать их из приложения нельзя — это
    // ровно то второе место, ради устранения которого всё и делалось.
    // Заодно исчезла опечатка `dashPedelivUrl`: Drizzle молча игнорировал
    // неизвестный ключ, так что запись в dash_pereliv_url проходила мимо.
```

- [ ] **Step 3: Проверить типы, тесты и сборку**

Из `app/`:

```bash
npx tsc --noEmit && npx vitest run && npm run build
```

Ожидаемо: всё зелёное. `npm run build` здесь обязателен: Edge-сборка ловит то, чего не видят ни `tsc`, ни тесты.

- [ ] **Step 4: Проверить, что база не тронута**

Из корня репозитория:

```bash
git status --porcelain
```

Ожидаемо: изменён только `app/src/db/schema.ts`. Если появился `ksamata_funnels.db` — `npm run build` поднял планировщик мониторинга; восстановить по инструкции из CLAUDE.md.

- [ ] **Step 5: Коммит**

```bash
git add app/src/db/schema.ts
git commit -m "refactor(schema): семь URL-колонок уходят из Drizzle вместе с опечаткой dashPedelivUrl"
```

---

### Task 4: XLSX-экспорт читает блок «Ссылки»

**Files:**
- Modify: `tools/data-export/ksamata_funnels_export.py` (константа рядом с `DB_PATH`; `load_all` — сбор и словарь результата; `build_excel` — строка «Прочие ссылки:»)
- Test: `tools/data-export/tests/test_export_links.py`

**Interfaces:**
- Consumes: `load_all(db_path)` — возвращает список словарей по воронке; ключи `dash_sales`, `dash_pereliv`, `predspisok`, `regi_total`, `regi_15`, `regi_19`, `regi_notime` уже существуют и остаются, добавляется `extra_links`.
- Produces: ничего для следующих задач.

- [ ] **Step 1: Написать падающий тест**

Создать `tools/data-export/tests/test_export_links.py`:

```python
"""Дашборды и подсчёты регистраций экспорт берёт из блока «Ссылки», а не из колонок.

Колонки funnels.dash_*_url / regi_*_url / predspisok_url выведены из обращения
фазой 11 и стоят пустыми: читай отчёт их — все семь полей были бы пустыми по
всем воронкам.
"""

import sqlite3

from ksamata_funnels_export import load_all


def make_db(path, items):
    """Минимальная база с одной воронкой и блоком «Ссылки» из `items`."""
    conn = sqlite3.connect(str(path))
    conn.executescript(
        """
        CREATE TABLE sources (id INTEGER PRIMARY KEY, name TEXT);
        CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT);
        CREATE TABLE contractors (id INTEGER PRIMARY KEY, name TEXT);
        CREATE TABLE funnels (id INTEGER PRIMARY KEY, num INTEGER,
            source_id INTEGER, product_id INTEGER, contractor_id INTEGER,
            product_name TEXT DEFAULT '', variant TEXT DEFAULT '',
            start_date TEXT DEFAULT '', block_name TEXT DEFAULT '',
            sheet_name TEXT DEFAULT '', tag_19_raw TEXT DEFAULT '',
            tag_15_raw TEXT DEFAULT '', reg_tags_raw TEXT DEFAULT '',
            bothelp_condition TEXT DEFAULT '', room_ids_json TEXT DEFAULT '{}');
        CREATE TABLE funnel_days (id INTEGER PRIMARY KEY, funnel_id INTEGER,
            time_slot TEXT, day_num INTEGER);
        CREATE TABLE funnel_tags (id INTEGER PRIMARY KEY, funnel_id INTEGER,
            tag_id INTEGER, tag_type TEXT, position INTEGER);
        CREATE TABLE tags (id INTEGER PRIMARY KEY, name TEXT);
        CREATE TABLE salebot_configs (id INTEGER PRIMARY KEY, funnel_id INTEGER,
            time_slot TEXT);
        CREATE TABLE product_durations (id INTEGER PRIMARY KEY, product_id INTEGER,
            day_num INTEGER, duration_minutes INTEGER);
        CREATE TABLE funnel_blocks (id INTEGER PRIMARY KEY, funnel_id INTEGER,
            kind TEXT, enabled INTEGER, mode TEXT);
        CREATE TABLE funnel_block_items (id INTEGER PRIMARY KEY, block_id INTEGER,
            slot TEXT, label TEXT, url TEXT, position INTEGER);
        INSERT INTO sources (id, name) VALUES (1, 'источник');
        INSERT INTO products (id, name) VALUES (1, 'ДБО');
        INSERT INTO contractors (id, name) VALUES (1, 'подрядчик');
        INSERT INTO funnels (id, num, source_id, product_id, contractor_id)
             VALUES (1, 1, 1, 1, 1);
        INSERT INTO funnel_blocks (id, funnel_id, kind, enabled, mode)
             VALUES (1, 1, 'links', 1, 'common');
        """
    )
    for pos, (label, url) in enumerate(items):
        conn.execute(
            "INSERT INTO funnel_block_items (block_id, slot, label, url, position)"
            " VALUES (1, NULL, ?, ?, ?)",
            (label, url, pos),
        )
    conn.commit()
    conn.close()


def test_standard_labels_land_in_their_fields(tmp_path):
    db = tmp_path / "ksamata_funnels.db"
    make_db(
        db,
        [
            ("Дашборд продаж", "https://gc.example.ru/sales"),
            ("Дашборд перелива", "https://gc.example.ru/pereliv"),
            ("Регистрации всего", "https://gc.example.ru/total"),
            ("Регистрации 15:00", "https://gc.example.ru/15"),
            ("Регистрации 19:00", "https://gc.example.ru/19"),
            ("Регистрации без времени", "https://gc.example.ru/notime"),
            ("Предсписок", "https://gc.example.ru/pre"),
        ],
    )

    f = load_all(str(db))[0]

    assert f["dash_sales"] == "https://gc.example.ru/sales"
    assert f["dash_pereliv"] == "https://gc.example.ru/pereliv"
    assert f["regi_total"] == "https://gc.example.ru/total"
    assert f["regi_15"] == "https://gc.example.ru/15"
    assert f["regi_19"] == "https://gc.example.ru/19"
    assert f["regi_notime"] == "https://gc.example.ru/notime"
    assert f["predspisok"] == "https://gc.example.ru/pre"
    assert f["extra_links"] == ""


def test_label_matching_ignores_case_and_spaces(tmp_path):
    db = tmp_path / "ksamata_funnels.db"
    make_db(db, [("  дашборд ПРОДАЖ  ", "https://gc.example.ru/sales")])

    f = load_all(str(db))[0]

    assert f["dash_sales"] == "https://gc.example.ru/sales"


def test_two_items_with_one_label_are_joined(tmp_path):
    """Случай f9/f16 после фазы 11: под одной подписью два адреса — оба в отчёт."""
    db = tmp_path / "ksamata_funnels.db"
    make_db(
        db,
        [
            ("Дашборд продаж", "https://gc.example.ru/a"),
            ("Дашборд продаж", "https://gc.example.ru/b"),
        ],
    )

    f = load_all(str(db))[0]

    assert f["dash_sales"] == "https://gc.example.ru/a / https://gc.example.ru/b"


def test_unknown_label_goes_to_extra_links(tmp_path):
    db = tmp_path / "ksamata_funnels.db"
    make_db(db, [("Сводка по рекламе", "https://gc.example.ru/ads")])

    f = load_all(str(db))[0]

    assert f["dash_sales"] == ""
    assert f["extra_links"] == "Сводка по рекламе — https://gc.example.ru/ads"


def test_empty_urls_are_skipped(tmp_path):
    db = tmp_path / "ksamata_funnels.db"
    make_db(db, [("Дашборд продаж", ""), ("Дашборд перелива", "   ")])

    f = load_all(str(db))[0]

    assert f["dash_sales"] == ""
    assert f["dash_pereliv"] == ""
    assert f["extra_links"] == ""


def test_funnel_without_links_block_does_not_crash(tmp_path):
    db = tmp_path / "ksamata_funnels.db"
    make_db(db, [])

    f = load_all(str(db))[0]

    assert f["dash_sales"] == ""
    assert f["predspisok"] == ""
    assert f["extra_links"] == ""
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Из корня репозитория:

```bash
python3 -m pytest tools/data-export/tests/test_export_links.py -q
```

Ожидаемо: FAIL — `KeyError: 'extra_links'` (и пустые значения там, где ждём адреса: сейчас поля читаются из колонок, которых в фикстуре нет).

- [ ] **Step 3: Добавить таблицу подписей**

В `tools/data-export/ksamata_funnels_export.py` после строки `OUT_PATH = ...` добавить:

```python
# Подпись пункта блока «Ссылки» → поле отчёта. Совпадает с таблицей фазы 11
# (app/scripts/migrate-phase11.ts) и со STANDARD_LINKS_LABELS приложения.
# Колонки funnels.dash_*_url / regi_*_url / predspisok_url больше не источник:
# после Phase-11 адреса живут только в блоке, а сами колонки стоят пустыми.
LINK_LABELS = {
    'дашборд продаж': 'dash_sales',
    'дашборд перелива': 'dash_pereliv',
    'регистрации всего': 'regi_total',
    'регистрации 15:00': 'regi_15',
    'регистрации 19:00': 'regi_19',
    'регистрации без времени': 'regi_notime',
    'предсписок': 'predspisok',
}
```

- [ ] **Step 4: Собирать ссылки из блока**

В `load_all`, сразу после блока, собирающего `landing` (заканчивается на `)` перед комментарием `# Tags grouped by type`), добавить:

```python
        # Дашборды и подсчёты регистраций — пункты блока «Ссылки». Пункт с
        # подписью вне таблицы попадает в «Прочие ссылки»: подпись в админке
        # свободная, и молча терять такую ссылку отчёт не должен.
        links = {key: '' for key in LINK_LABELS.values()}
        extra_links = []
        for r in conn.execute("""
            SELECT i.label, i.url
              FROM funnel_block_items i
              JOIN funnel_blocks b ON b.id = i.block_id
             WHERE b.funnel_id = ? AND b.kind = 'links'
             ORDER BY i.position
        """, (fid,)).fetchall():
            url = (r['url'] or '').strip()
            if not url:
                continue
            label = (r['label'] or '').strip()
            key = LINK_LABELS.get(label.lower())
            if key is None:
                extra_links.append(f'{label} — {url}' if label else url)
            else:
                links[key] = f'{links[key]} / {url}' if links[key] else url
```

- [ ] **Step 5: Переключить поля результата на блок**

В том же `load_all` заменить семь строк словаря результата:

```python
            'dash_sales': f['dash_sales_url'] or '',
            'dash_pereliv': f['dash_pereliv_url'] or '',
            'predspisok': f['predspisok_url'] or '',
            'regi_total': f['regi_total_url'] or '',
            'regi_15': f['regi_15_url'] or '',
            'regi_19': f['regi_19_url'] or '',
            'regi_notime': f['regi_notime_url'] or '',
```

на:

```python
            'dash_sales': links['dash_sales'],
            'dash_pereliv': links['dash_pereliv'],
            'predspisok': links['predspisok'],
            'regi_total': links['regi_total'],
            'regi_15': links['regi_15'],
            'regi_19': links['regi_19'],
            'regi_notime': links['regi_notime'],
            'extra_links': ' / '.join(extra_links),
```

- [ ] **Step 6: Запустить тест и убедиться, что он проходит**

```bash
python3 -m pytest tools/data-export/tests/test_export_links.py -q
```

Ожидаемо: PASS, 6 тестов.

- [ ] **Step 7: Добавить строку «Прочие ссылки:» в отчёт**

В `build_excel`, после строки `cur = wmeta(cur, 'Реги без выбора:', f['regi_notime'])`, добавить:

```python
        cur = wmeta(cur, 'Прочие ссылки:', f['extra_links'])
```

`wmeta` сама пропускает пустое значение (`if not val: return r`), поэтому у воронок без нестандартных подписей строка не появится.

- [ ] **Step 8: Прогнать все тесты Python и собрать настоящий отчёт**

Из корня репозитория:

```bash
python3 -m pytest tools/data-export/tests tools/data-import/tests -q
python3 tools/data-export/ksamata_funnels_export.py
```

Ожидаемо: тесты зелёные; отчёт собирается без ошибок. Открыть `data/generated/Сводная_таблица_автоворонок.xlsx` и убедиться, что у f9 в строке «Дашборд продаж:» стоит `…/pl/logic/funnel/dashboard?id=1630392#pk=alltime`, а не адрес `/pl/user/user/index…`.

- [ ] **Step 9: Проверить, что база не тронута**

```bash
git status --porcelain
```

Ожидаемо: `ksamata_funnels.db` не изменён (экспорт открывает базу `mode=ro`). `data/generated/` в `.gitignore`.

- [ ] **Step 10: Коммит**

```bash
git add tools/data-export/ksamata_funnels_export.py tools/data-export/tests/test_export_links.py
git commit -m "feat(export): дашборды и подсчёты регистраций читаются из блока «Ссылки»"
```

---

### Task 5: Документация

**Files:**
- Modify: `CLAUDE.md` (раздел Migrations; раздел Data tools; раздел Data model)
- Modify: `app/DEPLOY.md` (перечень фаз)
- Modify: `app/scripts/archive/fill-dashboards-2026-08-12.ts` (шапка)

**Interfaces:**
- Consumes: всё, сделанное в задачах 1-4.
- Produces: ничего.

- [ ] **Step 1: Описать фазу 11 в CLAUDE.md**

В разделе `## Migrations (app/scripts/)` после абзаца **Phase 10** добавить:

```markdown
- **Phase 11** — адреса дашбордов и подсчётов регистраций живут **только** в
  блоке «Ссылки». Семь колонок (`dash_sales_url`, `dash_pereliv_url`,
  `regi_total_url`, `regi_15_url`, `regi_19_url`, `regi_notime_url`,
  `predspisok_url`) держали то же, что и блок, но правит человек только блок:
  полей карточки у колонок нет, и приложение их не читает и не пишет. Фаза
  дописывает в блок адреса, которых там ещё нет (сравнение по адресу без учёта
  регистра и хвостового слэша, **подписи в сравнении не участвуют**), затем
  гасит все семь колонок — в одной транзакции, перенос первым. Понятия
  «конфликт» у неё поэтому нет: расхождение выглядит как «этого адреса в блоке
  нет» и дописывается вторым пунктом с той же подписью. Ничего не теряется, а
  лишний пункт человек снимает в админке; «блок главнее» стоило бы верных
  дашбордов f9 и f16, «колонка главнее» возвращало бы литералы Python-скриптов
  2022 года поверх правок маркетолога при каждом старте. **Фаза остаётся в
  цепочке навсегда**: колонки продолжает писать Python-импорт. Семь свойств
  удалены из `schema.ts`; сами колонки живут в SQLite пустыми.
```

В строке `**Docker runs, in order** (app/docker-entrypoint.sh)` заменить хвост `→ 9 → 10.` на `→ 9 → 10 → 11.`

- [ ] **Step 2: Дополнить раздел про Python-инструменты**

В `CLAUDE.md`, раздел `## Data tools (tools/)`, абзац, начинающийся с
**«Python tools still write `funnels.landing_url`»**, заменить целиком на:

```markdown
**Python tools still write columns the app no longer reads** —
`funnels.landing_url` (Phase 10) и семь URL-колонок дашбордов
(`dash_sales_url`, `dash_pereliv_url`, `regi_total_url`, `regi_15_url`,
`regi_19_url`, `regi_notime_url`, `predspisok_url`, Phase 11). Nothing breaks:
обе фазы выполняются при каждом старте контейнера и сметают попавшее туда в
блоки «Лендинги» и «Ссылки». But after running an import against a local DB,
run both phases by hand (`npx tsx scripts/migrate-phase10-runner.ts` and
`npx tsx scripts/migrate-phase11-runner.ts` from `app/`) or the addresses stay
invisible until the next container start.
```

- [ ] **Step 3: Отметить колонки в описании модели данных**

В `CLAUDE.md`, в описании таблицы **`funnels`** (пункт списка, который сейчас
заканчивается строкой `` roomsEnabled `` / `` roomsReplayEnabled `` — около
строки 62), дописать в конец этого же пункта, перед строкой про
`**num` и `frontCode` — two unrelated numberings**`:

```markdown
  Семи URL-колонок дашбордов (`dash_sales_url`, `dash_pereliv_url`,
  `regi_total_url`, `regi_15_url`, `regi_19_url`, `regi_notime_url`,
  `predspisok_url`) в `schema.ts` больше нет (Phase 11) — как и `landing_url`
  (Phase 10). Колонки остались в SQLite пустыми, потому что в них пишет
  Python-импорт; адреса живут в блоках `links` и `landings`.
```

- [ ] **Step 4: Дописать фазу в DEPLOY.md**

В `app/DEPLOY.md` в нумерованном перечне фаз (строки 73-82) после пункта 10
(`migrate-phase10.cjs`) добавить одиннадцатым:

```markdown
11. `migrate-phase11.cjs` — moves the seven dashboard/registration URL columns into the «Ссылки» block and blanks them
```

- [ ] **Step 5: Отметить архивный скрипт как перекрытый фазой**

В шапку `app/scripts/archive/fill-dashboards-2026-08-12.ts` добавить абзац:

```
 * ВНИМАНИЕ: скрипт писал адреса И в блок, И в колонки — временный компромисс
 * ради XLSX-экспорта, читавшего тогда колонки. После фазы 11 (12.08.2026)
 * колонки выведены из обращения, а экспорт читает блок: повторный прогон
 * записал бы в колонки то, что ближайший старт контейнера всё равно сметёт.
 * Не запускать.
```

- [ ] **Step 6: Проверить, что ссылки и номера строк в документации не разъехались**

```bash
grep -n "Phase 11\|фаза 11\|migrate-phase11" CLAUDE.md app/DEPLOY.md
grep -c "migrate-phase" app/docker-entrypoint.sh app/Dockerfile
```

Ожидаемо: фаза 11 упомянута в обоих документах; `app/docker-entrypoint.sh` даёт
`10` строк (было 9), `app/Dockerfile` — `30` (было 27: три строки на фазу —
`RUN npx esbuild`, `--outfile` и `COPY`).

- [ ] **Step 7: Коммит**

```bash
git add CLAUDE.md app/DEPLOY.md app/scripts/archive/fill-dashboards-2026-08-12.ts
git commit -m "docs: фаза 11 в цепочке миграций, колонки дашбордов выведены из обращения"
```

---

## После выката: что сделать на проде

**Это не задача плана, а памятка на момент деплоя.** На проде своя база в
`/data`, и починка f9/f16 из Task 2 туда не попадает: она сделана на локальном
файле репозитория, а образ несёт `app/seed/` только для первого старта.

Значит на проде фаза 11 при первом же старте сделает ровно то, для чего ветка
и написана: увидит, что верного адреса дашборда f9 и f16 в блоке нет, и
допишет его **вторым пунктом** с подписью «Дашборд продаж». В карточках этих
двух воронок окажется по два пункта с одной подписью — один верный, второй
копия «Регистрации всего».

Убрать лишний пункт в админке (`/funnels/<id>`, блок «Ссылки») после первого
старта нового образа. Ссылка при этом не теряется ни на секунду — в этом весь
смысл выбранного правила.
