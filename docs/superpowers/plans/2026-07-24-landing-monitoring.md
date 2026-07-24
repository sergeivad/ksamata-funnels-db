# Мониторинг доступности лендов — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Сервис фоном проверяет доступность посадочных страниц из базы воронок и показывает статусы на странице `/monitoring`.

**Architecture:** Миграция Phase 6 добавляет четыре таблицы (цели, связка с воронками, текущее состояние, лог смен статуса). Цели синхронизируются из `funnel_block_items` и `funnels.landing_url`; по умолчанию включены только ленды. Планировщик внутри контейнера (`instrumentation.ts`) раз в 15 минут гоняет цикл проверок пулом по 8; чистая функция `checkUrl` отделена от БД и тестируется подменой `fetch`. Дашборд — клиентская страница поверх пяти API-роутов, как остальные страницы этого приложения.

**Tech Stack:** Next.js 15.5 (App Router), React 19, TypeScript strict, Drizzle ORM + better-sqlite3, Zod 3, Tailwind 3, Vitest 3, lucide-react.

Спека: [../specs/2026-07-24-landing-monitoring-design.md](../specs/2026-07-24-landing-monitoring-design.md)

## Global Constraints

- Все команды выполняются из каталога `app/`. Тесты — `npx vitest run`, типы — `npx tsc --noEmit`, сборка — `npm run build`.
- Ветка уже создана: `feat/landing-monitoring`. Коммитить после каждой задачи.
- Новых npm-зависимостей не добавлять. HTTP-проверки — нативный `fetch` Node 20.
- Путь к БД резолвит `app/src/db/client.ts`; тесты работают на временной КОПИИ `../ksamata_funnels.db`, никогда на живом файле.
- Миграция обязана быть идемпотентной: `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS`. Повторный прогон не должен ни падать, ни дублировать данные.
- Данные воронок (особенно теги) не трогаем вообще — фича только добавляет свои таблицы.
- Комментарии в коде — на русском, как в существующих `src/lib/status.ts` и `src/components/StatusPill.tsx`. Сообщения коммитов — на английском, как в истории репозитория.
- Статусы мониторинга: ровно `'up' | 'slow' | 'down' | 'unknown'`.
- Порог «медленно» — 5000 мс, таймаут запроса — 10000 мс, параллельность цикла — 8, пауза перед повторной попыткой — 3000 мс.
- Env-переменные: `MONITOR_ENABLED` (по умолчанию `true`, выключает ровно строка `'false'`), `MONITOR_INTERVAL_MINUTES` (по умолчанию `15`).

## Файловая структура

Создаются:

| Файл | Ответственность |
|---|---|
| `app/scripts/migrate-phase6-data.ts` | DDL Phase 6 — единый источник для tsx-миграции и Docker-раннера |
| `app/scripts/migrate-phase6.ts` | Функция `runMigratePhase6` + CLI-обёртка |
| `app/scripts/migrate-phase6-runner.ts` | Standalone-раннер для Docker-образа |
| `app/src/lib/monitor-status.ts` | Значения статусов, тип, guard, метаданные бейджа, `formatAgo` |
| `app/src/lib/monitor-urls.ts` | Нормализация и сплит URL-полей |
| `app/src/lib/monitor-targets.ts` | Синк целей из воронок + переключение `enabled` |
| `app/src/lib/monitor-check.ts` | Чистая HTTP-проверка одного URL |
| `app/src/lib/monitor-run.ts` | Прогон цикла, запись состояния и событий |
| `app/src/lib/monitor-view.ts` | Модели чтения для дашборда (сводка, строки, события) |
| `app/src/lib/monitor-scheduler.ts` | Разбор env + `setInterval` |
| `app/src/instrumentation.ts` | Хук старта сервера Next |
| `app/src/app/api/monitoring/route.ts` | `GET` — сводка + цели |
| `app/src/app/api/monitoring/run/route.ts` | `POST` — синк + прогон |
| `app/src/app/api/monitoring/targets/route.ts` | `PATCH` — групповое включение |
| `app/src/app/api/monitoring/targets/[id]/route.ts` | `PATCH` — одна цель |
| `app/src/app/api/monitoring/events/route.ts` | `GET` — история |
| `app/src/app/monitoring/page.tsx` | Страница-дашборд |
| `app/src/components/monitoring/MonitorStatusPill.tsx` | Бейдж статуса |
| `app/src/components/monitoring/MonitorSummary.tsx` | Полоса сводки + кнопка проверки |
| `app/src/components/monitoring/MonitorTable.tsx` | Таблица целей |
| `app/src/components/monitoring/MonitorEvents.tsx` | Лог смен статуса |

Модифицируются: `app/src/db/schema.ts`, `app/src/lib/validation.ts`, `app/src/components/AppHeader.tsx`, `app/Dockerfile`, `app/docker-entrypoint.sh`, `app/.env.example`, `CLAUDE.md`, `docs/README.md`, `docs/project-map.md`.

## Уточнение к спеке

В спеке описание «двух подряд неудач» допускало двоякое чтение. Здесь принято однозначно:

- падение подтверждается **внутри одного цикла**: провалилась проверка → пауза 3 с → повторная проверка; статус `down` ставится, только если провалились обе;
- `consecutive_failures` считает **подряд идущие циклы с подтверждённым падением** и нужен для отображения («падает N циклов подряд»); успешная проверка обнуляет счётчик;
- `slow` — рабочее состояние, счётчик не трогает.

Спека дописывается под эту формулировку в Задаче 10.

---

### Task 1: Миграция Phase 6 + таблицы Drizzle

**Files:**
- Create: `app/scripts/migrate-phase6-data.ts`
- Create: `app/scripts/migrate-phase6.ts`
- Create: `app/scripts/migrate-phase6-runner.ts`
- Modify: `app/src/db/schema.ts` (добавить таблицы в конец, перед блоком `Type exports`, и типы — в него)
- Modify: `app/Dockerfile:62` (добавить esbuild-шаг после Phase-5) и `app/Dockerfile:108` (COPY бандла)
- Modify: `app/docker-entrypoint.sh` (шаг Phase-6 после backfill-а тегов)
- Test: `app/tests/migrate-phase6.test.ts`

**Interfaces:**
- Consumes: ничего.
- Produces: `PHASE6_DDL: string`; `runMigratePhase6(sqlite: import('better-sqlite3').Database): void`; drizzle-таблицы `monitorTargets`, `monitorTargetFunnels`, `monitorState`, `monitorEvents` и типы `MonitorTarget`, `MonitorTargetFunnel`, `MonitorStateRow`, `MonitorEventRow` из `@/db/schema`.

- [ ] **Step 1: Написать падающий тест**

Создать `app/tests/migrate-phase6.test.ts`:

```ts
import { describe, it, expect, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { copyFileSync, unlinkSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { runMigratePhase6 } from '../scripts/migrate-phase6';

const REAL_DB = join(__dirname, '../../ksamata_funnels.db');
const TMP_DB = join(tmpdir(), `p6_${Date.now()}_${process.pid}.db`);
copyFileSync(REAL_DB, TMP_DB);
const sqlite = new Database(TMP_DB);
sqlite.pragma('foreign_keys = ON');

afterAll(() => { sqlite.close(); if (existsSync(TMP_DB)) unlinkSync(TMP_DB); });

describe('migrate-phase6', () => {
  it('создаёт четыре таблицы мониторинга идемпотентно', () => {
    runMigratePhase6(sqlite);
    runMigratePhase6(sqlite); // второй прогон не должен падать

    const tables = sqlite
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='table'
           AND name IN ('monitor_targets','monitor_target_funnels','monitor_state','monitor_events')`
      )
      .all() as { name: string }[];
    expect(tables.map((t) => t.name).sort()).toEqual([
      'monitor_events',
      'monitor_state',
      'monitor_target_funnels',
      'monitor_targets',
    ]);
  });

  it('держит url уникальным', () => {
    sqlite.prepare(`INSERT INTO monitor_targets (url, source_kind) VALUES (?, ?)`)
      .run('https://example.com/a', 'landings');
    expect(() =>
      sqlite.prepare(`INSERT INTO monitor_targets (url, source_kind) VALUES (?, ?)`)
        .run('https://example.com/a', 'links')
    ).toThrow();
  });

  it('ограничивает status допустимым набором', () => {
    const t = sqlite.prepare(`SELECT id FROM monitor_targets WHERE url = ?`)
      .get('https://example.com/a') as { id: number };
    expect(() =>
      sqlite.prepare(`INSERT INTO monitor_state (target_id, status) VALUES (?, ?)`)
        .run(t.id, 'broken')
    ).toThrow();
  });

  it('каскадно удаляет состояние и события вместе с целью', () => {
    const t = sqlite.prepare(`SELECT id FROM monitor_targets WHERE url = ?`)
      .get('https://example.com/a') as { id: number };
    sqlite.prepare(`INSERT INTO monitor_state (target_id, status) VALUES (?, 'up')`).run(t.id);
    sqlite.prepare(
      `INSERT INTO monitor_events (target_id, from_status, to_status) VALUES (?, 'up', 'down')`
    ).run(t.id);

    sqlite.prepare(`DELETE FROM monitor_targets WHERE id = ?`).run(t.id);

    const state = sqlite.prepare(`SELECT COUNT(*) AS c FROM monitor_state WHERE target_id = ?`)
      .get(t.id) as { c: number };
    const events = sqlite.prepare(`SELECT COUNT(*) AS c FROM monitor_events WHERE target_id = ?`)
      .get(t.id) as { c: number };
    expect(state.c).toBe(0);
    expect(events.c).toBe(0);
  });
});
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `npx vitest run tests/migrate-phase6.test.ts`
Expected: FAIL — `Failed to resolve import "../scripts/migrate-phase6"`.

- [ ] **Step 3: Написать DDL**

Создать `app/scripts/migrate-phase6-data.ts`:

```ts
/**
 * DDL Phase-6 (мониторинг доступности лендов).
 * Единый источник правды для migrate-phase6.ts (tsx/тесты) и Docker-раннера.
 */

export const PHASE6_DDL = `
CREATE TABLE IF NOT EXISTS monitor_targets (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  url         TEXT    NOT NULL UNIQUE,
  source_kind TEXT    NOT NULL,
  enabled     INTEGER NOT NULL DEFAULT 0,
  note        TEXT    NOT NULL DEFAULT '',
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_monitor_targets_enabled ON monitor_targets(enabled);

CREATE TABLE IF NOT EXISTS monitor_target_funnels (
  target_id INTEGER NOT NULL REFERENCES monitor_targets(id) ON DELETE CASCADE,
  funnel_id INTEGER NOT NULL REFERENCES funnels(id) ON DELETE CASCADE,
  PRIMARY KEY (target_id, funnel_id)
);
CREATE INDEX IF NOT EXISTS idx_mtf_funnel ON monitor_target_funnels(funnel_id);

CREATE TABLE IF NOT EXISTS monitor_state (
  target_id            INTEGER PRIMARY KEY REFERENCES monitor_targets(id) ON DELETE CASCADE,
  status               TEXT    NOT NULL DEFAULT 'unknown'
                         CHECK(status IN ('up','slow','down','unknown')),
  http_status          INTEGER,
  final_url            TEXT    NOT NULL DEFAULT '',
  error                TEXT    NOT NULL DEFAULT '',
  latency_ms           INTEGER,
  checked_at           TEXT,
  since                TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_monitor_state_status ON monitor_state(status);

CREATE TABLE IF NOT EXISTS monitor_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  target_id   INTEGER NOT NULL REFERENCES monitor_targets(id) ON DELETE CASCADE,
  from_status TEXT    NOT NULL,
  to_status   TEXT    NOT NULL,
  http_status INTEGER,
  error       TEXT    NOT NULL DEFAULT '',
  at          TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_monitor_events_target ON monitor_events(target_id);
CREATE INDEX IF NOT EXISTS idx_monitor_events_at     ON monitor_events(at);
`;
```

- [ ] **Step 4: Написать миграцию и раннер**

Создать `app/scripts/migrate-phase6.ts`:

```ts
/**
 * Phase-6: таблицы мониторинга доступности лендов. Идемпотентно.
 *
 *   cd app/
 *   FUNNELS_DB_PATH=../ksamata_funnels.db npx tsx scripts/migrate-phase6.ts
 */
import { PHASE6_DDL } from './migrate-phase6-data';

export function runMigratePhase6(sqlite: import('better-sqlite3').Database): void {
  sqlite.pragma('foreign_keys = ON');
  sqlite.exec(PHASE6_DDL);
}

if (require.main === module) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Database = require('better-sqlite3');
  const dbPath = process.env.FUNNELS_DB_PATH ?? '../ksamata_funnels.db';
  const sqlite = new Database(dbPath);
  console.log(`Phase-6 schema migration on: ${dbPath}`);
  runMigratePhase6(sqlite);
  sqlite.close();
  console.log('Phase-6 schema migration done.');
}
```

Создать `app/scripts/migrate-phase6-runner.ts`:

```ts
/**
 * Standalone-миграция Phase-6 для Docker-образа.
 * Собирается в migrate-phase6.cjs через esbuild в builder-стадии:
 *   npx esbuild scripts/migrate-phase6-runner.ts \
 *     --bundle --platform=node --external:better-sqlite3 --outfile=migrate-phase6.cjs
 * Вызывается из docker-entrypoint.sh как: node /app/migrate-phase6.cjs
 */

import Database from 'better-sqlite3';
import { runMigratePhase6 } from './migrate-phase6';

const dbPath = process.env.FUNNELS_DB_PATH;
if (!dbPath) {
  console.error('[migrate-phase6] FUNNELS_DB_PATH is not set — skipping.');
  process.exit(0);
}

console.log(`[migrate-phase6] Running Phase-6 migration on: ${dbPath}`);
const sqlite = new Database(dbPath);
sqlite.pragma('journal_mode = WAL');
runMigratePhase6(sqlite);
sqlite.close();
console.log('[migrate-phase6] Done (monitoring tables).');
```

- [ ] **Step 5: Запустить тест и убедиться, что он проходит**

Run: `npx vitest run tests/migrate-phase6.test.ts`
Expected: PASS, 4 теста.

- [ ] **Step 6: Добавить таблицы в схему Drizzle**

В `app/src/db/schema.ts` расширить импорт из `drizzle-orm/sqlite-core` на `primaryKey`:

```ts
import {
  integer,
  sqliteTable,
  text,
  uniqueIndex,
  index,
  primaryKey,
} from 'drizzle-orm/sqlite-core';
```

Перед секцией `// ─── Type exports ───` добавить:

```ts
// ─── Мониторинг доступности (Phase 6) ────────────────────────────────────────

export const monitorTargets = sqliteTable(
  'monitor_targets',
  {
    id:         integer('id').primaryKey({ autoIncrement: true }),
    url:        text('url').notNull().unique(),
    sourceKind: text('source_kind').notNull(),
    enabled:    integer('enabled').notNull().default(0),
    note:       text('note').notNull().default(''),
    createdAt:  text('created_at').notNull().default(sql`(datetime('now'))`),
    updatedAt:  text('updated_at').notNull().default(sql`(datetime('now'))`),
  },
  (t) => ({
    enabledIdx: index('idx_monitor_targets_enabled').on(t.enabled),
  }),
);

export const monitorTargetFunnels = sqliteTable(
  'monitor_target_funnels',
  {
    targetId: integer('target_id').notNull().references(() => monitorTargets.id, { onDelete: 'cascade' }),
    funnelId: integer('funnel_id').notNull().references(() => funnels.id, { onDelete: 'cascade' }),
  },
  (t) => ({
    pk:        primaryKey({ columns: [t.targetId, t.funnelId] }),
    funnelIdx: index('idx_mtf_funnel').on(t.funnelId),
  }),
);

export const monitorState = sqliteTable(
  'monitor_state',
  {
    targetId:            integer('target_id').primaryKey().references(() => monitorTargets.id, { onDelete: 'cascade' }),
    status:              text('status', { enum: ['up', 'slow', 'down', 'unknown'] }).notNull().default('unknown'),
    httpStatus:          integer('http_status'),
    finalUrl:            text('final_url').notNull().default(''),
    error:               text('error').notNull().default(''),
    latencyMs:           integer('latency_ms'),
    checkedAt:           text('checked_at'),
    since:               text('since'),
    consecutiveFailures: integer('consecutive_failures').notNull().default(0),
  },
  (t) => ({
    statusIdx: index('idx_monitor_state_status').on(t.status),
  }),
);

export const monitorEvents = sqliteTable(
  'monitor_events',
  {
    id:         integer('id').primaryKey({ autoIncrement: true }),
    targetId:   integer('target_id').notNull().references(() => monitorTargets.id, { onDelete: 'cascade' }),
    fromStatus: text('from_status').notNull(),
    toStatus:   text('to_status').notNull(),
    httpStatus: integer('http_status'),
    error:      text('error').notNull().default(''),
    at:         text('at').notNull().default(sql`(datetime('now'))`),
  },
  (t) => ({
    targetIdx: index('idx_monitor_events_target').on(t.targetId),
    atIdx:     index('idx_monitor_events_at').on(t.at),
  }),
);
```

В конец секции `Type exports` добавить:

```ts
export type MonitorTarget       = typeof monitorTargets.$inferSelect;
export type MonitorTargetFunnel = typeof monitorTargetFunnels.$inferSelect;
export type MonitorStateRow     = typeof monitorState.$inferSelect;
export type MonitorEventRow     = typeof monitorEvents.$inferSelect;
```

- [ ] **Step 7: Проверить типы**

Run: `npx tsc --noEmit`
Expected: без ошибок.

- [ ] **Step 8: Подключить миграцию к Docker**

В `app/Dockerfile` после блока сборки `migrate-phase5.cjs` (строка 62) вставить:

```dockerfile
# Compile the Phase-6 migration to a self-contained CJS bundle.
# better-sqlite3 is kept external so the runner's native .node binary is used.
RUN npx esbuild scripts/migrate-phase6-runner.ts \
      --bundle \
      --platform=node \
      --external:better-sqlite3 \
      --outfile=migrate-phase6.cjs
```

В стадии `runner`, после `COPY` бандла `backfill-legacy-tag-overrides.cjs`, добавить:

```dockerfile
# Copy the compiled Phase-6 migration bundle into the runner image.
COPY --from=builder /build/migrate-phase6.cjs /app/migrate-phase6.cjs
```

В `app/docker-entrypoint.sh` перед строкой `exec node server.js` вставить:

```sh
# Apply Phase-6 migration (idempotent: CREATE TABLE/INDEX IF NOT EXISTS).
# Adds the landing-availability monitoring tables.
if [ -n "$FUNNELS_DB_PATH" ]; then
  echo "[entrypoint] Running Phase-6 migration against $FUNNELS_DB_PATH"
  node /app/migrate-phase6.cjs
  echo "[entrypoint] Phase-6 migration done."
fi
```

- [ ] **Step 9: Прогнать миграцию на локальной БД**

Run: `FUNNELS_DB_PATH=../ksamata_funnels.db npx tsx scripts/migrate-phase6.ts`
Expected: `Phase-6 schema migration done.`

Run: `sqlite3 ../ksamata_funnels.db ".tables monitor_%"`
Expected: `monitor_events  monitor_state  monitor_target_funnels  monitor_targets`

- [ ] **Step 10: Коммит**

```bash
git add app/scripts/migrate-phase6-data.ts app/scripts/migrate-phase6.ts app/scripts/migrate-phase6-runner.ts app/tests/migrate-phase6.test.ts app/src/db/schema.ts app/Dockerfile app/docker-entrypoint.sh
git commit -m "feat(monitoring): phase-6 tables for landing availability"
```

---

### Task 2: Чистые хелперы — статусы и URL

**Files:**
- Create: `app/src/lib/monitor-status.ts`
- Create: `app/src/lib/monitor-urls.ts`
- Test: `app/tests/monitor-status.test.ts`
- Test: `app/tests/monitor-urls.test.ts`

**Interfaces:**
- Consumes: ничего.
- Produces:
  - `MONITOR_STATUS_VALUES: readonly ['up','slow','down','unknown']`
  - `type MonitorStatus = 'up' | 'slow' | 'down' | 'unknown'`
  - `isMonitorStatus(v: unknown): v is MonitorStatus`
  - `MONITOR_STATUS_META: Record<MonitorStatus, { label: string; className: string; order: number }>`
  - `formatAgo(iso: string | null, nowMs?: number): string`
  - `normalizeUrl(raw: string): string | null`
  - `splitUrlField(raw: string | null | undefined): string[]`

- [ ] **Step 1: Написать падающий тест для статусов**

Создать `app/tests/monitor-status.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  MONITOR_STATUS_VALUES,
  isMonitorStatus,
  MONITOR_STATUS_META,
  formatAgo,
} from '../src/lib/monitor-status';

describe('isMonitorStatus', () => {
  it('пропускает все допустимые значения', () => {
    for (const v of MONITOR_STATUS_VALUES) expect(isMonitorStatus(v)).toBe(true);
  });

  it('отбраковывает мусор', () => {
    expect(isMonitorStatus('broken')).toBe(false);
    expect(isMonitorStatus(null)).toBe(false);
    expect(isMonitorStatus(42)).toBe(false);
  });
});

describe('MONITOR_STATUS_META', () => {
  it('описывает каждый статус', () => {
    for (const v of MONITOR_STATUS_VALUES) {
      expect(MONITOR_STATUS_META[v].label.length).toBeGreaterThan(0);
      expect(MONITOR_STATUS_META[v].className.length).toBeGreaterThan(0);
    }
  });

  it('сортирует упавшие выше медленных, а рабочие — последними', () => {
    expect(MONITOR_STATUS_META.down.order).toBeLessThan(MONITOR_STATUS_META.slow.order);
    expect(MONITOR_STATUS_META.slow.order).toBeLessThan(MONITOR_STATUS_META.up.order);
  });
});

describe('formatAgo', () => {
  // Опорная точка: 2026-07-24 12:00:00 UTC. SQLite пишет время без зоны — трактуем как UTC.
  const now = Date.parse('2026-07-24T12:00:00Z');

  it('говорит «никогда» для пустого значения', () => {
    expect(formatAgo(null, now)).toBe('никогда');
  });

  it('показывает «только что» в пределах минуты', () => {
    expect(formatAgo('2026-07-24 11:59:30', now)).toBe('только что');
  });

  it('показывает минуты', () => {
    expect(formatAgo('2026-07-24 11:45:00', now)).toBe('15 мин назад');
  });

  it('показывает часы', () => {
    expect(formatAgo('2026-07-24 09:00:00', now)).toBe('3 ч назад');
  });

  it('показывает дни', () => {
    expect(formatAgo('2026-07-22 12:00:00', now)).toBe('2 дн назад');
  });
});
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `npx vitest run tests/monitor-status.test.ts`
Expected: FAIL — `Failed to resolve import "../src/lib/monitor-status"`.

- [ ] **Step 3: Реализовать monitor-status.ts**

Создать `app/src/lib/monitor-status.ts`:

```ts
// Единый источник правды по статусам мониторинга. Значения совпадают с
// CHECK-ограничением колонки monitor_state.status.
export const MONITOR_STATUS_VALUES = ['up', 'slow', 'down', 'unknown'] as const;
export type MonitorStatus = (typeof MONITOR_STATUS_VALUES)[number];

export function isMonitorStatus(v: unknown): v is MonitorStatus {
  return typeof v === 'string' && (MONITOR_STATUS_VALUES as readonly string[]).includes(v);
}

// Бейдж + порядок сортировки в таблице: сначала то, что требует внимания.
export const MONITOR_STATUS_META: Record<
  MonitorStatus,
  { label: string; className: string; order: number }
> = {
  down:    { label: 'Упало',          className: 'bg-[#FBE3E3] text-[#A32020]', order: 0 },
  slow:    { label: 'Медленно',       className: 'bg-[#FCF0D8] text-[#8A6100]', order: 1 },
  unknown: { label: 'Не проверялось', className: 'bg-[#E8E4DA] text-[#5E5A52]', order: 2 },
  up:      { label: 'Работает',       className: 'bg-[#DFF3E7] text-[#087443]', order: 3 },
};

/**
 * «Сколько прошло» для времени из SQLite (`datetime('now')` → 'YYYY-MM-DD HH:MM:SS' в UTC,
 * без указания зоны). Пробел меняем на 'T' и дописываем 'Z', иначе движок трактует
 * строку как локальное время и сдвигает результат на часовой пояс.
 */
export function formatAgo(iso: string | null, nowMs: number = Date.now()): string {
  if (!iso) return 'никогда';
  const normalized = iso.includes('T') ? iso : `${iso.replace(' ', 'T')}Z`;
  const then = Date.parse(normalized);
  if (Number.isNaN(then)) return 'никогда';

  const seconds = Math.max(0, Math.floor((nowMs - then) / 1000));
  if (seconds < 60) return 'только что';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} мин назад`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ч назад`;
  return `${Math.floor(hours / 24)} дн назад`;
}
```

- [ ] **Step 4: Запустить тест и убедиться, что он проходит**

Run: `npx vitest run tests/monitor-status.test.ts`
Expected: PASS.

- [ ] **Step 5: Написать падающий тест для URL**

Создать `app/tests/monitor-urls.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { normalizeUrl, splitUrlField } from '../src/lib/monitor-urls';

describe('normalizeUrl', () => {
  it('приводит голый хост к каноническому виду со слэшем', () => {
    expect(normalizeUrl('https://t.chistkaives.ru')).toBe('https://t.chistkaives.ru/');
    expect(normalizeUrl('https://t.chistkaives.ru/')).toBe('https://t.chistkaives.ru/');
  });

  it('сохраняет схему http как есть — её и надо проверять', () => {
    expect(normalizeUrl('http://lp.ksamata.ru/izh-yo')).toBe('http://lp.ksamata.ru/izh-yo');
  });

  it('срезает мусорный хвост', () => {
    expect(normalizeUrl('https://t.ksamatacenter.ru/rsya/dbo/a"')).toBe(
      'https://t.ksamatacenter.ru/rsya/dbo/a'
    );
    expect(normalizeUrl('  https://lp.ksamata.ru/rd-yo  ')).toBe('https://lp.ksamata.ru/rd-yo');
  });

  it('отбраковывает не-http, пустые и бесхостовые значения', () => {
    expect(normalizeUrl('')).toBeNull();
    expect(normalizeUrl('https://')).toBeNull();
    expect(normalizeUrl('нет ссылки')).toBeNull();
    expect(normalizeUrl('mailto:a@b.ru')).toBeNull();
    expect(normalizeUrl('https://localhost')).toBeNull();
  });
});

describe('splitUrlField', () => {
  it('возвращает пустой массив на пустом входе', () => {
    expect(splitUrlField('')).toEqual([]);
    expect(splitUrlField(null)).toEqual([]);
    expect(splitUrlField(undefined)).toEqual([]);
  });

  it('не ломает одиночную ссылку с путём', () => {
    expect(splitUrlField('https://lp.ksamata.ru/dtx-yo')).toEqual(['https://lp.ksamata.ru/dtx-yo']);
  });

  it('разбирает многоссылочное поле воронки №6 (в т.ч. двойной пробел)', () => {
    const raw =
      'https://t.chistkaives.ru / https://t.chistkaives.ru/boo  / https://t.detoxveslife.ru / https://t.detoxveslife.ru/boo / https://t.ksamatacenter.ru/rsya/boo/a';
    expect(splitUrlField(raw)).toEqual([
      'https://t.chistkaives.ru/',
      'https://t.chistkaives.ru/boo',
      'https://t.detoxveslife.ru/',
      'https://t.detoxveslife.ru/boo',
      'https://t.ksamatacenter.ru/rsya/boo/a',
    ]);
  });

  it('разбирает поле воронки №7 с хвостовой кавычкой', () => {
    const raw =
      'https://t.sustavy-spina.ru/spb / https://t.sustavy-spina.ru/ / https://t.spina-pozvon.ru/ / https://t.spina-pozvon.ru/spb / https://t.ksamatacenter.ru/rsya/dbo/a"';
    expect(splitUrlField(raw)).toEqual([
      'https://t.sustavy-spina.ru/spb',
      'https://t.sustavy-spina.ru/',
      'https://t.spina-pozvon.ru/',
      'https://t.spina-pozvon.ru/spb',
      'https://t.ksamatacenter.ru/rsya/dbo/a',
    ]);
  });

  it('схлопывает дубли внутри одного поля', () => {
    expect(splitUrlField('https://a.ru / https://a.ru/')).toEqual(['https://a.ru/']);
  });
});
```

- [ ] **Step 6: Запустить тест и убедиться, что он падает**

Run: `npx vitest run tests/monitor-urls.test.ts`
Expected: FAIL — `Failed to resolve import "../src/lib/monitor-urls"`.

- [ ] **Step 7: Реализовать monitor-urls.ts**

Создать `app/src/lib/monitor-urls.ts`:

```ts
// Разделитель нескольких ссылок в одном поле (`landing_url` воронок №6, №7):
// слэш, окружённый пробелами. Слэши внутри пути под это не подпадают.
const SEPARATOR = /\s+\/\s+/;

// Хвостовой мусор из ручного ввода: кавычки, запятые, точка с запятой, пробелы.
// Точку НЕ трогаем — она бывает частью пути.
const TRAILING_JUNK = /[\s"'«»,;]+$/;

/**
 * Канонический вид URL для дедупликации и проверки.
 * Возвращает null, если это не пригодная для проверки http(s)-ссылка.
 */
export function normalizeUrl(raw: string): string | null {
  const trimmed = raw.trim().replace(TRAILING_JUNK, '');
  if (!/^https?:\/\//i.test(trimmed)) return null;
  try {
    const parsed = new URL(trimmed);
    // Хост без точки — это localhost или мусор вроде голого "https://".
    if (!parsed.hostname.includes('.')) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

/** Разбирает поле, где через " / " может лежать несколько ссылок. Дубли схлопывает. */
export function splitUrlField(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const out: string[] = [];
  for (const part of raw.split(SEPARATOR)) {
    const url = normalizeUrl(part);
    if (url && !out.includes(url)) out.push(url);
  }
  return out;
}
```

- [ ] **Step 8: Запустить оба теста**

Run: `npx vitest run tests/monitor-urls.test.ts tests/monitor-status.test.ts`
Expected: PASS.

- [ ] **Step 9: Коммит**

```bash
git add app/src/lib/monitor-status.ts app/src/lib/monitor-urls.ts app/tests/monitor-status.test.ts app/tests/monitor-urls.test.ts
git commit -m "feat(monitoring): status metadata and URL normalization helpers"
```

---

### Task 3: Синхронизация целей из воронок

**Files:**
- Create: `app/src/lib/monitor-targets.ts`
- Test: `app/tests/monitor-targets.test.ts`

**Interfaces:**
- Consumes: `normalizeUrl`, `splitUrlField` (Task 2); таблицы `monitorTargets`, `monitorTargetFunnels`, `monitorState` (Task 1); `AnyDB` из `@/db/client`.
- Produces:
  - `LANDING_SOURCE_KINDS: readonly ['landings', 'funnel_landing_url']`
  - `syncMonitorTargets(db: AnyDB): { total: number; created: number; retired: number }`
  - `setTargetEnabled(db: AnyDB, targetId: number, enabled: boolean): boolean`
  - `setSourceKindEnabled(db: AnyDB, sourceKind: string, enabled: boolean): number`

- [ ] **Step 1: Написать падающий тест**

Создать `app/tests/monitor-targets.test.ts`:

```ts
/**
 * Синк целей мониторинга. Работает на временной КОПИИ реальной БД:
 * данные воронок читаются как есть, пишем только в свои таблицы.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { runMigratePhase6 } from '../scripts/migrate-phase6';
import * as schema from '../src/db/schema';
import {
  syncMonitorTargets,
  setTargetEnabled,
  setSourceKindEnabled,
} from '../src/lib/monitor-targets';

const REAL_DB = path.resolve(process.cwd(), '..', 'ksamata_funnels.db');
let tmp: string;
let sqlite: Database.Database;
let db: ReturnType<typeof drizzle<typeof schema>>;

beforeEach(() => {
  tmp = path.join(os.tmpdir(), `mt-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  fs.copyFileSync(REAL_DB, tmp);
  sqlite = new Database(tmp);
  sqlite.pragma('foreign_keys = ON');
  runMigratePhase6(sqlite);
  db = drizzle(sqlite, { schema });
});

afterEach(() => {
  sqlite.close();
  fs.rmSync(tmp, { force: true });
});

/** Все URL воронки — и из блоков, и из landing_url — очищаем, чтобы собрать чистый кейс. */
function wipeFunnelUrls() {
  sqlite.prepare(`UPDATE funnel_block_items SET url = ''`).run();
  sqlite.prepare(`UPDATE funnels SET landing_url = ''`).run();
}

function funnelIds(limit: number): number[] {
  return (sqlite.prepare(`SELECT id FROM funnels ORDER BY id LIMIT ?`).all(limit) as { id: number }[])
    .map((r) => r.id);
}

function targetRow(url: string) {
  return sqlite.prepare(`SELECT * FROM monitor_targets WHERE url = ?`).get(url) as
    | { id: number; source_kind: string; enabled: number }
    | undefined;
}

describe('syncMonitorTargets', () => {
  it('включает ленды и оставляет остальные виды выключенными', () => {
    wipeFunnelUrls();
    const [f1] = funnelIds(1);
    const landingBlock = sqlite
      .prepare(`INSERT INTO funnel_blocks (funnel_id, kind, enabled) VALUES (?, 'landings', 1)`)
      .run(f1).lastInsertRowid as number;
    sqlite.prepare(`INSERT INTO funnel_block_items (block_id, url) VALUES (?, ?)`)
      .run(landingBlock, 'https://lp.example.ru/a');
    const linksBlock = sqlite
      .prepare(`INSERT INTO funnel_blocks (funnel_id, kind, enabled) VALUES (?, 'links', 1)`)
      .run(f1).lastInsertRowid as number;
    sqlite.prepare(`INSERT INTO funnel_block_items (block_id, url) VALUES (?, ?)`)
      .run(linksBlock, 'https://gc.example.ru/dash');

    syncMonitorTargets(db);

    expect(targetRow('https://lp.example.ru/a')?.enabled).toBe(1);
    expect(targetRow('https://gc.example.ru/dash')?.enabled).toBe(0);
  });

  it('берёт landing_url воронки, у которой нет блока landings', () => {
    wipeFunnelUrls();
    const [f1] = funnelIds(1);
    sqlite.prepare(`UPDATE funnels SET landing_url = ? WHERE id = ?`)
      .run('https://t.zdorovy-zkt.ru/jivo/rsya/a', f1);

    syncMonitorTargets(db);

    const row = targetRow('https://t.zdorovy-zkt.ru/jivo/rsya/a');
    expect(row?.source_kind).toBe('funnel_landing_url');
    expect(row?.enabled).toBe(1);
  });

  it('разбирает многоссылочный landing_url в отдельные цели', () => {
    wipeFunnelUrls();
    const [f1] = funnelIds(1);
    sqlite.prepare(`UPDATE funnels SET landing_url = ? WHERE id = ?`)
      .run('https://a.example.ru / https://b.example.ru/boo"', f1);

    syncMonitorTargets(db);

    expect(targetRow('https://a.example.ru/')).toBeDefined();
    expect(targetRow('https://b.example.ru/boo')).toBeDefined();
  });

  it('делает одну цель из URL, использованного двумя воронками, и связывает с обеими', () => {
    wipeFunnelUrls();
    const [f1, f2] = funnelIds(2);
    for (const fid of [f1, f2]) {
      const blockId = sqlite
        .prepare(`INSERT INTO funnel_blocks (funnel_id, kind, enabled) VALUES (?, 'landings', 1)`)
        .run(fid).lastInsertRowid as number;
      sqlite.prepare(`INSERT INTO funnel_block_items (block_id, url) VALUES (?, ?)`)
        .run(blockId, 'https://lp.example.ru/shared');
    }

    syncMonitorTargets(db);

    const target = targetRow('https://lp.example.ru/shared');
    expect(target).toBeDefined();
    const links = sqlite
      .prepare(`SELECT funnel_id FROM monitor_target_funnels WHERE target_id = ? ORDER BY funnel_id`)
      .all(target!.id) as { funnel_id: number }[];
    expect(links.map((l) => l.funnel_id)).toEqual([f1, f2].sort((a, b) => a - b));
  });

  it('отдаёт приоритет источнику landings над остальными видами блоков', () => {
    wipeFunnelUrls();
    const [f1] = funnelIds(1);
    const linksBlock = sqlite
      .prepare(`INSERT INTO funnel_blocks (funnel_id, kind, enabled) VALUES (?, 'links', 1)`)
      .run(f1).lastInsertRowid as number;
    sqlite.prepare(`INSERT INTO funnel_block_items (block_id, url) VALUES (?, ?)`)
      .run(linksBlock, 'https://lp.example.ru/both');
    const landingBlock = sqlite
      .prepare(`INSERT INTO funnel_blocks (funnel_id, kind, enabled) VALUES (?, 'landings', 1)`)
      .run(f1).lastInsertRowid as number;
    sqlite.prepare(`INSERT INTO funnel_block_items (block_id, url) VALUES (?, ?)`)
      .run(landingBlock, 'https://lp.example.ru/both');

    syncMonitorTargets(db);

    expect(targetRow('https://lp.example.ru/both')?.source_kind).toBe('landings');
    expect(targetRow('https://lp.example.ru/both')?.enabled).toBe(1);
  });

  it('заводит строку состояния со статусом unknown', () => {
    wipeFunnelUrls();
    const [f1] = funnelIds(1);
    sqlite.prepare(`UPDATE funnels SET landing_url = ? WHERE id = ?`).run('https://s.example.ru/x', f1);

    syncMonitorTargets(db);

    const target = targetRow('https://s.example.ru/x')!;
    const state = sqlite.prepare(`SELECT status FROM monitor_state WHERE target_id = ?`)
      .get(target.id) as { status: string };
    expect(state.status).toBe('unknown');
  });

  it('не сбрасывает ручной тумблер при повторном синке', () => {
    wipeFunnelUrls();
    const [f1] = funnelIds(1);
    const linksBlock = sqlite
      .prepare(`INSERT INTO funnel_blocks (funnel_id, kind, enabled) VALUES (?, 'links', 1)`)
      .run(f1).lastInsertRowid as number;
    sqlite.prepare(`INSERT INTO funnel_block_items (block_id, url) VALUES (?, ?)`)
      .run(linksBlock, 'https://gc.example.ru/manual');

    syncMonitorTargets(db);
    const target = targetRow('https://gc.example.ru/manual')!;
    setTargetEnabled(db, target.id, true);

    syncMonitorTargets(db);

    expect(targetRow('https://gc.example.ru/manual')?.enabled).toBe(1);
  });

  it('гасит исчезнувший URL, но не удаляет его и его историю', () => {
    wipeFunnelUrls();
    const [f1] = funnelIds(1);
    sqlite.prepare(`UPDATE funnels SET landing_url = ? WHERE id = ?`).run('https://gone.example.ru/x', f1);
    syncMonitorTargets(db);
    const target = targetRow('https://gone.example.ru/x')!;
    sqlite.prepare(
      `INSERT INTO monitor_events (target_id, from_status, to_status) VALUES (?, 'up', 'down')`
    ).run(target.id);

    sqlite.prepare(`UPDATE funnels SET landing_url = '' WHERE id = ?`).run(f1);
    const stats = syncMonitorTargets(db);

    expect(stats.retired).toBe(1);
    expect(targetRow('https://gone.example.ru/x')?.enabled).toBe(0);
    const links = sqlite
      .prepare(`SELECT COUNT(*) AS c FROM monitor_target_funnels WHERE target_id = ?`)
      .get(target.id) as { c: number };
    expect(links.c).toBe(0);
    const events = sqlite
      .prepare(`SELECT COUNT(*) AS c FROM monitor_events WHERE target_id = ?`)
      .get(target.id) as { c: number };
    expect(events.c).toBe(1);
  });
});

describe('setSourceKindEnabled', () => {
  it('включает целую группу и возвращает количество затронутых целей', () => {
    wipeFunnelUrls();
    const [f1] = funnelIds(1);
    const linksBlock = sqlite
      .prepare(`INSERT INTO funnel_blocks (funnel_id, kind, enabled) VALUES (?, 'links', 1)`)
      .run(f1).lastInsertRowid as number;
    for (const u of ['https://gc.example.ru/1', 'https://gc.example.ru/2']) {
      sqlite.prepare(`INSERT INTO funnel_block_items (block_id, url) VALUES (?, ?)`).run(linksBlock, u);
    }
    syncMonitorTargets(db);

    expect(setSourceKindEnabled(db, 'links', true)).toBe(2);
    expect(targetRow('https://gc.example.ru/1')?.enabled).toBe(1);
    expect(targetRow('https://gc.example.ru/2')?.enabled).toBe(1);
  });
});

describe('setTargetEnabled', () => {
  it('возвращает false для несуществующей цели', () => {
    expect(setTargetEnabled(db, 999999, true)).toBe(false);
  });
});
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `npx vitest run tests/monitor-targets.test.ts`
Expected: FAIL — `Failed to resolve import "../src/lib/monitor-targets"`.

- [ ] **Step 3: Реализовать monitor-targets.ts**

Создать `app/src/lib/monitor-targets.ts`:

```ts
import { eq, sql, inArray, notInArray } from 'drizzle-orm';
import { type AnyDB } from '../db/client';
import {
  funnels,
  funnelBlocks,
  funnelBlockItems,
  monitorTargets,
  monitorTargetFunnels,
  monitorState,
} from '../db/schema';
import { normalizeUrl, splitUrlField } from './monitor-urls';

/** Виды источников, которые включаются в мониторинг сразу при заведении цели. */
export const LANDING_SOURCE_KINDS = ['landings', 'funnel_landing_url'] as const;

const LANDING_SET = new Set<string>(LANDING_SOURCE_KINDS);

/**
 * Чем меньше ранг, тем «главнее» источник. Один и тот же URL может прийти из
 * нескольких мест — цель заводится одна, вид источника берётся у главного.
 */
function sourceRank(kind: string): number {
  if (kind === 'landings') return 0;
  if (kind === 'funnel_landing_url') return 1;
  return 2;
}

interface Collected {
  url: string;
  sourceKind: string;
  funnelIds: Set<number>;
}

/** Собирает все пригодные для проверки URL из данных воронок. */
function collectTargets(db: AnyDB): Map<string, Collected> {
  const out = new Map<string, Collected>();

  const add = (url: string, sourceKind: string, funnelId: number) => {
    const existing = out.get(url);
    if (!existing) {
      out.set(url, { url, sourceKind, funnelIds: new Set([funnelId]) });
      return;
    }
    existing.funnelIds.add(funnelId);
    if (sourceRank(sourceKind) < sourceRank(existing.sourceKind)) {
      existing.sourceKind = sourceKind;
    }
  };

  const items = db
    .select({
      url: funnelBlockItems.url,
      kind: funnelBlocks.kind,
      funnelId: funnelBlocks.funnelId,
    })
    .from(funnelBlockItems)
    .innerJoin(funnelBlocks, eq(funnelBlocks.id, funnelBlockItems.blockId))
    .all() as { url: string; kind: string; funnelId: number }[];

  for (const row of items) {
    const url = normalizeUrl(row.url);
    if (url) add(url, row.kind, row.funnelId);
  }

  const funnelRows = db
    .select({ id: funnels.id, landingUrl: funnels.landingUrl })
    .from(funnels)
    .all() as { id: number; landingUrl: string | null }[];

  for (const row of funnelRows) {
    for (const url of splitUrlField(row.landingUrl)) {
      add(url, 'funnel_landing_url', row.id);
    }
  }

  return out;
}

/**
 * Приводит monitor_targets в соответствие с данными воронок.
 * Инварианты:
 *  - новая цель получает enabled=1 только для лендов;
 *  - у существующей цели enabled НЕ трогается — ручной тумблер переживает синк;
 *  - исчезнувший URL не удаляется: гасится и отвязывается от воронок,
 *    чтобы не потерять историю инцидентов.
 */
export function syncMonitorTargets(db: AnyDB): { total: number; created: number; retired: number } {
  const collected = collectTargets(db);
  let created = 0;
  let retired = 0;

  db.transaction((tx) => {
    for (const item of collected.values()) {
      const existing = tx
        .select({ id: monitorTargets.id })
        .from(monitorTargets)
        .where(eq(monitorTargets.url, item.url))
        .get() as { id: number } | undefined;

      let targetId: number;
      if (existing) {
        tx.update(monitorTargets)
          .set({ sourceKind: item.sourceKind, updatedAt: sql`(datetime('now'))` })
          .where(eq(monitorTargets.id, existing.id))
          .run();
        targetId = existing.id;
      } else {
        const inserted = tx
          .insert(monitorTargets)
          .values({
            url: item.url,
            sourceKind: item.sourceKind,
            enabled: LANDING_SET.has(item.sourceKind) ? 1 : 0,
          })
          .returning({ id: monitorTargets.id })
          .get() as { id: number };
        targetId = inserted.id;
        created += 1;
      }

      // Строка состояния должна существовать всегда — дашборд показывает
      // «не проверялось», а не пустоту.
      tx.insert(monitorState).values({ targetId, status: 'unknown' }).onConflictDoNothing().run();

      tx.delete(monitorTargetFunnels).where(eq(monitorTargetFunnels.targetId, targetId)).run();
      for (const funnelId of item.funnelIds) {
        tx.insert(monitorTargetFunnels).values({ targetId, funnelId }).onConflictDoNothing().run();
      }
    }

    const liveUrls = [...collected.keys()];
    const stale = (
      liveUrls.length === 0
        ? tx.select({ id: monitorTargets.id }).from(monitorTargets).all()
        : tx
            .select({ id: monitorTargets.id })
            .from(monitorTargets)
            .where(notInArray(monitorTargets.url, liveUrls))
            .all()
    ) as { id: number }[];

    if (stale.length > 0) {
      const ids = stale.map((s) => s.id);
      tx.update(monitorTargets)
        .set({ enabled: 0, updatedAt: sql`(datetime('now'))` })
        .where(inArray(monitorTargets.id, ids))
        .run();
      tx.delete(monitorTargetFunnels).where(inArray(monitorTargetFunnels.targetId, ids)).run();
      retired = ids.length;
    }
  });

  return { total: collected.size, created, retired };
}

/** Переключает одну цель. Возвращает false, если цели нет. */
export function setTargetEnabled(db: AnyDB, targetId: number, enabled: boolean): boolean {
  const existing = db
    .select({ id: monitorTargets.id })
    .from(monitorTargets)
    .where(eq(monitorTargets.id, targetId))
    .get() as { id: number } | undefined;
  if (!existing) return false;

  db.update(monitorTargets)
    .set({ enabled: enabled ? 1 : 0, updatedAt: sql`(datetime('now'))` })
    .where(eq(monitorTargets.id, targetId))
    .run();
  return true;
}

/** Переключает целую группу по виду источника. Возвращает число затронутых целей. */
export function setSourceKindEnabled(db: AnyDB, sourceKind: string, enabled: boolean): number {
  const rows = db
    .select({ id: monitorTargets.id })
    .from(monitorTargets)
    .where(eq(monitorTargets.sourceKind, sourceKind))
    .all() as { id: number }[];
  if (rows.length === 0) return 0;

  db.update(monitorTargets)
    .set({ enabled: enabled ? 1 : 0, updatedAt: sql`(datetime('now'))` })
    .where(eq(monitorTargets.sourceKind, sourceKind))
    .run();
  return rows.length;
}
```

- [ ] **Step 4: Запустить тест и убедиться, что он проходит**

Run: `npx vitest run tests/monitor-targets.test.ts`
Expected: PASS, 10 тестов.

- [ ] **Step 5: Проверить на реальных данных**

Создать временный скрипт `app/scripts/tmp-sync-check.ts`:

```ts
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../src/db/schema';
import { syncMonitorTargets } from '../src/lib/monitor-targets';

const sqlite = new Database(process.env.FUNNELS_DB_PATH ?? '../ksamata_funnels.db');
sqlite.pragma('foreign_keys = ON');
const db = drizzle(sqlite, { schema });
console.log(syncMonitorTargets(db));
console.log(
  sqlite.prepare(
    `SELECT source_kind, enabled, COUNT(*) AS c FROM monitor_targets GROUP BY source_kind, enabled ORDER BY c DESC`
  ).all()
);
sqlite.close();
```

Run: `FUNNELS_DB_PATH=../ksamata_funnels.db npx tsx scripts/tmp-sync-check.ts`
Expected: в выводе `landings` и `funnel_landing_url` с `enabled: 1` и суммой около 42; `links`, `applications`, `tariffs` и прочие — с `enabled: 0`.

Затем удалить скрипт: `rm scripts/tmp-sync-check.ts`

- [ ] **Step 6: Коммит**

```bash
git add app/src/lib/monitor-targets.ts app/tests/monitor-targets.test.ts
git commit -m "feat(monitoring): sync targets from funnel blocks and landing_url"
```

---

### Task 4: HTTP-проверка одного URL

**Files:**
- Create: `app/src/lib/monitor-check.ts`
- Test: `app/tests/monitor-check.test.ts`

**Interfaces:**
- Consumes: `MonitorStatus` (Task 2).
- Produces:
  - `CHECK_TIMEOUT_MS = 10_000`, `SLOW_THRESHOLD_MS = 5_000`, `MONITOR_USER_AGENT`
  - `interface CheckResult { status: 'up' | 'slow' | 'down'; httpStatus: number | null; finalUrl: string; latencyMs: number; error: string }`
  - `type FetchLike = (url: string, init: RequestInit) => Promise<Response>`
  - `type CheckFn = (url: string) => Promise<CheckResult>`
  - `checkUrl(url: string, opts?: { timeoutMs?: number; slowMs?: number; fetchImpl?: FetchLike; nowMs?: () => number }): Promise<CheckResult>`

- [ ] **Step 1: Написать падающий тест**

Создать `app/tests/monitor-check.test.ts`:

```ts
/**
 * Проверка одного URL. Сети здесь нет — fetch подменяется через opts.fetchImpl,
 * поэтому тесты детерминированы и не ходят на боевые ленды.
 */
import { describe, it, expect } from 'vitest';
import { checkUrl, type FetchLike } from '../src/lib/monitor-check';

/** Ответ-заглушка: у Response нет сеттера url, поэтому собираем совместимый объект. */
function fakeResponse(status: number, finalUrl: string): Response {
  return {
    status,
    url: finalUrl,
    body: null,
  } as unknown as Response;
}

/** Подменённый fetch с управляемой задержкой на подменённых же часах. */
function fakeFetch(
  response: Response | Error,
  elapsedMs = 0,
  clock?: { value: number }
): FetchLike {
  return async () => {
    if (clock) clock.value += elapsedMs;
    if (response instanceof Error) throw response;
    return response;
  };
}

function clockOpts(clock: { value: number }) {
  return { nowMs: () => clock.value };
}

describe('checkUrl', () => {
  it('считает 200 живым', async () => {
    const res = await checkUrl('https://a.ru/', {
      fetchImpl: fakeFetch(fakeResponse(200, 'https://a.ru/')),
    });
    expect(res.status).toBe('up');
    expect(res.httpStatus).toBe(200);
    expect(res.error).toBe('');
  });

  it('шлёт GET, а не HEAD — часть лендов отвечает на HEAD кодом 405', async () => {
    let seenMethod = '';
    const spy: FetchLike = async (_url, init) => {
      seenMethod = String(init.method);
      return fakeResponse(200, 'https://a.ru/');
    };
    await checkUrl('https://a.ru/', { fetchImpl: spy });
    expect(seenMethod).toBe('GET');
  });

  it('помечает медленный ответ как slow', async () => {
    const clock = { value: 0 };
    const res = await checkUrl('https://a.ru/', {
      fetchImpl: fakeFetch(fakeResponse(200, 'https://a.ru/'), 6000, clock),
      ...clockOpts(clock),
    });
    expect(res.status).toBe('slow');
    expect(res.latencyMs).toBe(6000);
  });

  it('оставляет up ответ на границе порога', async () => {
    const clock = { value: 0 };
    const res = await checkUrl('https://a.ru/', {
      fetchImpl: fakeFetch(fakeResponse(200, 'https://a.ru/'), 5000, clock),
      ...clockOpts(clock),
    });
    expect(res.status).toBe('up');
  });

  it('роняет 404 и 500 в down с кодом в тексте ошибки', async () => {
    for (const code of [404, 500]) {
      const res = await checkUrl('https://a.ru/', {
        fetchImpl: fakeFetch(fakeResponse(code, 'https://a.ru/')),
      });
      expect(res.status).toBe('down');
      expect(res.httpStatus).toBe(code);
      expect(res.error).toContain(String(code));
    }
  });

  it('роняет редирект на страницу с ошибкой', async () => {
    const res = await checkUrl('https://a.ru/', {
      fetchImpl: fakeFetch(fakeResponse(403, 'https://gc.ru/login')),
    });
    expect(res.status).toBe('down');
    expect(res.finalUrl).toBe('https://gc.ru/login');
  });

  it('запоминает финальный URL после редиректа', async () => {
    const res = await checkUrl('https://a.ru/', {
      fetchImpl: fakeFetch(fakeResponse(200, 'https://b.ru/new')),
    });
    expect(res.status).toBe('up');
    expect(res.finalUrl).toBe('https://b.ru/new');
  });

  it('превращает таймаут в down с понятным текстом', async () => {
    const timeout = new Error('timed out');
    timeout.name = 'TimeoutError';
    const res = await checkUrl('https://a.ru/', { fetchImpl: fakeFetch(timeout) });
    expect(res.status).toBe('down');
    expect(res.httpStatus).toBeNull();
    expect(res.error).toContain('Таймаут');
  });

  it('расшифровывает нерезолвящийся домен', async () => {
    const dns = new Error('fetch failed');
    (dns as Error & { cause?: { code: string } }).cause = { code: 'ENOTFOUND' };
    const res = await checkUrl('https://nope.ru/', { fetchImpl: fakeFetch(dns) });
    expect(res.status).toBe('down');
    expect(res.error).toContain('ENOTFOUND');
  });

  it('просит не кешировать и представляется в User-Agent', async () => {
    let seenInit: RequestInit | undefined;
    const spy: FetchLike = async (_url, init) => {
      seenInit = init;
      return fakeResponse(200, 'https://a.ru/');
    };
    await checkUrl('https://a.ru/', { fetchImpl: spy });
    expect(seenInit?.redirect).toBe('follow');
    expect(seenInit?.cache).toBe('no-store');
    expect(String((seenInit?.headers as Record<string, string>)['User-Agent'])).toContain('Ksamata');
  });
});
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `npx vitest run tests/monitor-check.test.ts`
Expected: FAIL — `Failed to resolve import "../src/lib/monitor-check"`.

- [ ] **Step 3: Реализовать monitor-check.ts**

Создать `app/src/lib/monitor-check.ts`:

```ts
/**
 * Проверка доступности одного URL. Про БД ничего не знает — это делает
 * функцию тестируемой подменой fetch и переиспользуемой из любого места.
 */

export const CHECK_TIMEOUT_MS = 10_000;
export const SLOW_THRESHOLD_MS = 5_000;
export const MONITOR_USER_AGENT = 'KsamataFunnelsMonitor/1.0';

export interface CheckResult {
  status: 'up' | 'slow' | 'down';
  httpStatus: number | null;
  finalUrl: string;
  latencyMs: number;
  error: string;
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/** Сигнатура проверяльщика — цикл принимает её, чтобы тесты обходились без сети. */
export type CheckFn = (url: string) => Promise<CheckResult>;

export interface CheckOptions {
  timeoutMs?: number;
  slowMs?: number;
  fetchImpl?: FetchLike;
  nowMs?: () => number;
}

/** Человекочитаемая расшифровка сетевой ошибки — она попадёт прямо в дашборд. */
function describeFetchError(err: unknown): string {
  if (!(err instanceof Error)) return 'Неизвестная ошибка';
  if (err.name === 'TimeoutError') return `Таймаут ${CHECK_TIMEOUT_MS / 1000} с`;
  if (err.name === 'AbortError') return 'Запрос прерван';
  const code = (err as Error & { cause?: { code?: string } }).cause?.code;
  if (code === 'ENOTFOUND') return 'Домен не резолвится (ENOTFOUND)';
  if (code === 'ECONNREFUSED') return 'Соединение отклонено (ECONNREFUSED)';
  if (code === 'CERT_HAS_EXPIRED') return 'Истёк SSL-сертификат';
  if (code) return `Сетевая ошибка (${code})`;
  return err.message.slice(0, 200);
}

export async function checkUrl(url: string, opts: CheckOptions = {}): Promise<CheckResult> {
  const timeoutMs = opts.timeoutMs ?? CHECK_TIMEOUT_MS;
  const slowMs = opts.slowMs ?? SLOW_THRESHOLD_MS;
  const doFetch = opts.fetchImpl ?? ((u, init) => fetch(u, init));
  const now = opts.nowMs ?? (() => Date.now());

  const started = now();
  try {
    const res = await doFetch(url, {
      method: 'GET',
      redirect: 'follow',
      cache: 'no-store',
      headers: { 'User-Agent': MONITOR_USER_AGENT },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const latencyMs = now() - started;

    // Тело не нужно: рвём поток, чтобы не тянуть мегабайты HTML на каждый цикл.
    try {
      await res.body?.cancel();
    } catch {
      // поток уже закрыт — не наша забота
    }

    if (res.status === 200) {
      return {
        status: latencyMs > slowMs ? 'slow' : 'up',
        httpStatus: 200,
        finalUrl: res.url,
        latencyMs,
        error: '',
      };
    }

    return {
      status: 'down',
      httpStatus: res.status,
      finalUrl: res.url,
      latencyMs,
      error: `HTTP ${res.status}`,
    };
  } catch (err: unknown) {
    return {
      status: 'down',
      httpStatus: null,
      finalUrl: '',
      latencyMs: now() - started,
      error: describeFetchError(err),
    };
  }
}
```

- [ ] **Step 4: Запустить тест и убедиться, что он проходит**

Run: `npx vitest run tests/monitor-check.test.ts`
Expected: PASS, 10 тестов.

- [ ] **Step 5: Коммит**

```bash
git add app/src/lib/monitor-check.ts app/tests/monitor-check.test.ts
git commit -m "feat(monitoring): HTTP availability checker"
```

---

### Task 5: Прогон цикла и запись событий

**Files:**
- Create: `app/src/lib/monitor-run.ts`
- Test: `app/tests/monitor-run.test.ts`

**Interfaces:**
- Consumes: `checkUrl`, `CheckFn`, `CheckResult` (Task 4); `syncMonitorTargets` (Task 3); таблицы Phase 6 (Task 1).
- Produces:
  - `RETRY_DELAY_MS = 3_000`, `CONCURRENCY = 8`
  - `interface CycleResult { checked: number; up: number; slow: number; down: number; startedAt: string; finishedAt: string }`
  - `isCycleRunning(): boolean`
  - `runMonitorCycle(db: AnyDB, opts?: { check?: CheckFn; concurrency?: number; retryDelayMs?: number; sleep?: (ms: number) => Promise<void>; sync?: boolean }): Promise<CycleResult | null>` — `null`, если цикл уже идёт.

- [ ] **Step 1: Написать падающий тест**

Создать `app/tests/monitor-run.test.ts`:

```ts
/**
 * Прогон цикла: запись состояния и лог смен статуса.
 * Проверяльщик подменяется через opts.check — сети нет.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { runMigratePhase6 } from '../scripts/migrate-phase6';
import * as schema from '../src/db/schema';
import { runMonitorCycle } from '../src/lib/monitor-run';
import type { CheckResult } from '../src/lib/monitor-check';

const REAL_DB = path.resolve(process.cwd(), '..', 'ksamata_funnels.db');
let tmp: string;
let sqlite: Database.Database;
let db: ReturnType<typeof drizzle<typeof schema>>;

const up: CheckResult = { status: 'up', httpStatus: 200, finalUrl: 'https://a.ru/', latencyMs: 120, error: '' };
const down: CheckResult = { status: 'down', httpStatus: 503, finalUrl: 'https://a.ru/', latencyMs: 90, error: 'HTTP 503' };
const slow: CheckResult = { status: 'slow', httpStatus: 200, finalUrl: 'https://a.ru/', latencyMs: 7000, error: '' };

/** Отдаёт заготовленные результаты по очереди; последний повторяется. */
function scriptedCheck(results: CheckResult[]) {
  let i = 0;
  const calls: string[] = [];
  const fn = async (url: string): Promise<CheckResult> => {
    calls.push(url);
    const r = results[Math.min(i, results.length - 1)];
    i += 1;
    return r;
  };
  return { fn, calls: () => calls };
}

const noSleep = async () => {};

function seedTarget(url = 'https://a.ru/'): number {
  const id = sqlite
    .prepare(`INSERT INTO monitor_targets (url, source_kind, enabled) VALUES (?, 'landings', 1)`)
    .run(url).lastInsertRowid as number;
  sqlite.prepare(`INSERT INTO monitor_state (target_id, status) VALUES (?, 'unknown')`).run(id);
  return id;
}

function state(id: number) {
  return sqlite.prepare(`SELECT * FROM monitor_state WHERE target_id = ?`).get(id) as {
    status: string;
    http_status: number | null;
    final_url: string;
    error: string;
    latency_ms: number | null;
    checked_at: string | null;
    since: string | null;
    consecutive_failures: number;
  };
}

function events(id: number) {
  return sqlite
    .prepare(`SELECT from_status, to_status FROM monitor_events WHERE target_id = ? ORDER BY id`)
    .all(id) as { from_status: string; to_status: string }[];
}

beforeEach(() => {
  tmp = path.join(os.tmpdir(), `mr-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  fs.copyFileSync(REAL_DB, tmp);
  sqlite = new Database(tmp);
  sqlite.pragma('foreign_keys = ON');
  runMigratePhase6(sqlite);
  db = drizzle(sqlite, { schema });
});

afterEach(() => {
  sqlite.close();
  fs.rmSync(tmp, { force: true });
});

describe('runMonitorCycle', () => {
  it('записывает состояние и заводит событие при первом переходе', async () => {
    const id = seedTarget();
    const check = scriptedCheck([up]);

    const result = await runMonitorCycle(db, { check: check.fn, sync: false, sleep: noSleep });

    expect(result).not.toBeNull();
    expect(result!.checked).toBe(1);
    expect(result!.up).toBe(1);
    const s = state(id);
    expect(s.status).toBe('up');
    expect(s.http_status).toBe(200);
    expect(s.latency_ms).toBe(120);
    expect(s.checked_at).not.toBeNull();
    expect(events(id)).toEqual([{ from_status: 'unknown', to_status: 'up' }]);
  });

  it('не плодит события, пока статус не менялся', async () => {
    const id = seedTarget();
    const check = scriptedCheck([up]);

    await runMonitorCycle(db, { check: check.fn, sync: false, sleep: noSleep });
    const sinceAfterFirst = state(id).since;
    await runMonitorCycle(db, { check: check.fn, sync: false, sleep: noSleep });
    await runMonitorCycle(db, { check: check.fn, sync: false, sleep: noSleep });

    expect(events(id)).toHaveLength(1);
    expect(state(id).since).toBe(sinceAfterFirst);
  });

  it('не роняет в down, если повторная попытка удалась', async () => {
    const id = seedTarget();
    const check = scriptedCheck([down, up]);

    await runMonitorCycle(db, { check: check.fn, sync: false, sleep: noSleep });

    expect(check.calls()).toHaveLength(2); // первая проверка + ретрай
    const s = state(id);
    expect(s.status).toBe('up');
    expect(s.consecutive_failures).toBe(0);
    expect(events(id)).toEqual([{ from_status: 'unknown', to_status: 'up' }]);
  });

  it('роняет в down, когда провалились обе попытки', async () => {
    const id = seedTarget();
    const check = scriptedCheck([down]);

    await runMonitorCycle(db, { check: check.fn, sync: false, sleep: noSleep });

    const s = state(id);
    expect(s.status).toBe('down');
    expect(s.error).toBe('HTTP 503');
    expect(s.consecutive_failures).toBe(1);
    expect(events(id)).toEqual([{ from_status: 'unknown', to_status: 'down' }]);
  });

  it('копит счётчик по циклам и закрывает инцидент при восстановлении', async () => {
    const id = seedTarget();
    const failing = scriptedCheck([down]);

    await runMonitorCycle(db, { check: failing.fn, sync: false, sleep: noSleep });
    await runMonitorCycle(db, { check: failing.fn, sync: false, sleep: noSleep });
    expect(state(id).consecutive_failures).toBe(2);

    const healthy = scriptedCheck([up]);
    await runMonitorCycle(db, { check: healthy.fn, sync: false, sleep: noSleep });

    const s = state(id);
    expect(s.status).toBe('up');
    expect(s.consecutive_failures).toBe(0);
    expect(events(id)).toEqual([
      { from_status: 'unknown', to_status: 'down' },
      { from_status: 'down', to_status: 'up' },
    ]);
  });

  it('не считает slow неудачей и не ретраит его', async () => {
    const id = seedTarget();
    const check = scriptedCheck([slow]);

    await runMonitorCycle(db, { check: check.fn, sync: false, sleep: noSleep });

    expect(check.calls()).toHaveLength(1);
    const s = state(id);
    expect(s.status).toBe('slow');
    expect(s.consecutive_failures).toBe(0);
  });

  it('пропускает выключенные цели', async () => {
    const id = seedTarget();
    sqlite.prepare(`UPDATE monitor_targets SET enabled = 0 WHERE id = ?`).run(id);
    const check = scriptedCheck([up]);

    const result = await runMonitorCycle(db, { check: check.fn, sync: false, sleep: noSleep });

    expect(result!.checked).toBe(0);
    expect(check.calls()).toHaveLength(0);
    expect(state(id).status).toBe('unknown');
  });

  it('заводит недостающую строку состояния сам', async () => {
    const id = sqlite
      .prepare(`INSERT INTO monitor_targets (url, source_kind, enabled) VALUES ('https://b.ru/', 'landings', 1)`)
      .run().lastInsertRowid as number;
    const check = scriptedCheck([up]);

    await runMonitorCycle(db, { check: check.fn, sync: false, sleep: noSleep });

    expect(state(id).status).toBe('up');
  });

  it('возвращает null, если цикл уже идёт', async () => {
    seedTarget();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const blocking = async (): Promise<CheckResult> => { await gate; return up; };

    const first = runMonitorCycle(db, { check: blocking, sync: false, sleep: noSleep });
    const second = await runMonitorCycle(db, { check: blocking, sync: false, sleep: noSleep });
    expect(second).toBeNull();

    release();
    await first;
  });

  it('считает сводку по всем целям', async () => {
    seedTarget('https://one.ru/');
    seedTarget('https://two.ru/');
    const check = scriptedCheck([up, slow]);

    const result = await runMonitorCycle(db, { check: check.fn, sync: false, sleep: noSleep });

    expect(result!.checked).toBe(2);
    expect(result!.up).toBe(1);
    expect(result!.slow).toBe(1);
    expect(result!.down).toBe(0);
  });
});
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `npx vitest run tests/monitor-run.test.ts`
Expected: FAIL — `Failed to resolve import "../src/lib/monitor-run"`.

- [ ] **Step 3: Реализовать monitor-run.ts**

Создать `app/src/lib/monitor-run.ts`:

```ts
import { eq, sql } from 'drizzle-orm';
import { type AnyDB } from '../db/client';
import { monitorTargets, monitorState, monitorEvents } from '../db/schema';
import { checkUrl, type CheckFn, type CheckResult } from './monitor-check';
import { syncMonitorTargets } from './monitor-targets';

export const RETRY_DELAY_MS = 3_000;
export const CONCURRENCY = 8;

export interface CycleResult {
  checked: number;
  up: number;
  slow: number;
  down: number;
  startedAt: string;
  finishedAt: string;
}

export interface CycleOptions {
  check?: CheckFn;
  concurrency?: number;
  retryDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  /** Синк целей перед прогоном. Выключается в тестах, где цели заводятся руками. */
  sync?: boolean;
}

// Одиночный флаг на процесс: планировщик и ручная кнопка не должны наложиться.
let cycleRunning = false;

export function isCycleRunning(): boolean {
  return cycleRunning;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

interface TargetRow {
  id: number;
  url: string;
}

/**
 * Одна цель: проверка, а при неудаче — одна повторная попытка через паузу.
 * Падение считается подтверждённым, только если провалились обе.
 */
async function checkWithRetry(
  url: string,
  check: CheckFn,
  retryDelayMs: number,
  sleep: (ms: number) => Promise<void>
): Promise<CheckResult> {
  const first = await check(url);
  if (first.status !== 'down') return first;
  await sleep(retryDelayMs);
  return check(url);
}

function persist(db: AnyDB, target: TargetRow, result: CheckResult): void {
  const prev = db
    .select({
      status: monitorState.status,
      consecutiveFailures: monitorState.consecutiveFailures,
    })
    .from(monitorState)
    .where(eq(monitorState.targetId, target.id))
    .get() as { status: string; consecutiveFailures: number } | undefined;

  const prevStatus = prev?.status ?? 'unknown';
  const failures = result.status === 'down' ? (prev?.consecutiveFailures ?? 0) + 1 : 0;
  const changed = prevStatus !== result.status;

  db.transaction((tx) => {
    tx.insert(monitorState)
      .values({
        targetId: target.id,
        status: result.status,
        httpStatus: result.httpStatus,
        finalUrl: result.finalUrl,
        error: result.error,
        latencyMs: result.latencyMs,
        checkedAt: sql`(datetime('now'))`,
        since: sql`(datetime('now'))`,
        consecutiveFailures: failures,
      })
      .onConflictDoUpdate({
        target: monitorState.targetId,
        set: {
          status: result.status,
          httpStatus: result.httpStatus,
          finalUrl: result.finalUrl,
          error: result.error,
          latencyMs: result.latencyMs,
          checkedAt: sql`(datetime('now'))`,
          // since двигаем только при смене статуса — иначе «лежит с» обнулялось бы
          // на каждом цикле и время инцидента было бы не прочитать.
          ...(changed ? { since: sql`(datetime('now'))` } : {}),
          consecutiveFailures: failures,
        },
      })
      .run();

    if (changed) {
      tx.insert(monitorEvents)
        .values({
          targetId: target.id,
          fromStatus: prevStatus,
          toStatus: result.status,
          httpStatus: result.httpStatus,
          error: result.error,
        })
        .run();
    }
  });
}

/** Прогон по всем включённым целям. Возвращает null, если цикл уже идёт. */
export async function runMonitorCycle(
  db: AnyDB,
  opts: CycleOptions = {}
): Promise<CycleResult | null> {
  if (cycleRunning) return null;
  cycleRunning = true;

  const check: CheckFn = opts.check ?? ((url) => checkUrl(url));
  const concurrency = opts.concurrency ?? CONCURRENCY;
  const retryDelayMs = opts.retryDelayMs ?? RETRY_DELAY_MS;
  const sleep = opts.sleep ?? defaultSleep;
  const startedAt = new Date().toISOString();

  const tally = { up: 0, slow: 0, down: 0 };

  try {
    if (opts.sync !== false) syncMonitorTargets(db);

    const targets = db
      .select({ id: monitorTargets.id, url: monitorTargets.url })
      .from(monitorTargets)
      .where(eq(monitorTargets.enabled, 1))
      .all() as TargetRow[];

    let cursor = 0;
    const worker = async () => {
      for (;;) {
        const index = cursor;
        cursor += 1;
        if (index >= targets.length) return;
        const target = targets[index];
        const result = await checkWithRetry(target.url, check, retryDelayMs, sleep);
        persist(db, target, result);
        tally[result.status] += 1;
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(concurrency, Math.max(targets.length, 1)) }, worker)
    );

    return {
      checked: targets.length,
      up: tally.up,
      slow: tally.slow,
      down: tally.down,
      startedAt,
      finishedAt: new Date().toISOString(),
    };
  } finally {
    cycleRunning = false;
  }
}
```

- [ ] **Step 4: Запустить тест и убедиться, что он проходит**

Run: `npx vitest run tests/monitor-run.test.ts`
Expected: PASS, 10 тестов.

- [ ] **Step 5: Коммит**

```bash
git add app/src/lib/monitor-run.ts app/tests/monitor-run.test.ts
git commit -m "feat(monitoring): check cycle with retry and status-change log"
```

---

### Task 6: Модели чтения для дашборда

**Files:**
- Create: `app/src/lib/monitor-view.ts`
- Test: `app/tests/monitor-view.test.ts`

**Interfaces:**
- Consumes: таблицы Phase 6 (Task 1); `MONITOR_STATUS_META`, `MonitorStatus` (Task 2); `isCycleRunning` (Task 5).
- Produces:
  - `interface MonitorFunnelRef { id: number; num: number }`
  - `interface MonitorTargetView { id: number; url: string; sourceKind: string; enabled: boolean; status: MonitorStatus; httpStatus: number | null; finalUrl: string; error: string; latencyMs: number | null; checkedAt: string | null; since: string | null; consecutiveFailures: number; funnels: MonitorFunnelRef[] }`
  - `interface MonitorSummaryView { total: number; enabled: number; up: number; slow: number; down: number; unknown: number; lastCheckedAt: string | null; running: boolean }`
  - `interface MonitorSourceKindView { sourceKind: string; total: number; enabled: number }`
  - `getMonitorDashboard(db: AnyDB): { summary: MonitorSummaryView; sourceKinds: MonitorSourceKindView[]; targets: MonitorTargetView[] }`
  - `interface MonitorEventView { id: number; url: string; fromStatus: string; toStatus: string; httpStatus: number | null; error: string; at: string; funnels: MonitorFunnelRef[] }`
  - `listMonitorEvents(db: AnyDB, limit?: number, offset?: number): MonitorEventView[]`

- [ ] **Step 1: Написать падающий тест**

Создать `app/tests/monitor-view.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { runMigratePhase6 } from '../scripts/migrate-phase6';
import * as schema from '../src/db/schema';
import { getMonitorDashboard, listMonitorEvents } from '../src/lib/monitor-view';

const REAL_DB = path.resolve(process.cwd(), '..', 'ksamata_funnels.db');
let tmp: string;
let sqlite: Database.Database;
let db: ReturnType<typeof drizzle<typeof schema>>;

beforeEach(() => {
  tmp = path.join(os.tmpdir(), `mv-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  fs.copyFileSync(REAL_DB, tmp);
  sqlite = new Database(tmp);
  sqlite.pragma('foreign_keys = ON');
  runMigratePhase6(sqlite);
  db = drizzle(sqlite, { schema });
});

afterEach(() => {
  sqlite.close();
  fs.rmSync(tmp, { force: true });
});

function makeTarget(url: string, enabled: number, status: string, checkedAt: string | null) {
  const id = sqlite
    .prepare(`INSERT INTO monitor_targets (url, source_kind, enabled) VALUES (?, 'landings', ?)`)
    .run(url, enabled).lastInsertRowid as number;
  sqlite
    .prepare(`INSERT INTO monitor_state (target_id, status, checked_at) VALUES (?, ?, ?)`)
    .run(id, status, checkedAt);
  return id;
}

describe('getMonitorDashboard', () => {
  it('считает сводку только по включённым целям', () => {
    makeTarget('https://a.ru/', 1, 'up', '2026-07-24 10:00:00');
    makeTarget('https://b.ru/', 1, 'down', '2026-07-24 10:00:00');
    makeTarget('https://c.ru/', 0, 'unknown', null);

    const { summary } = getMonitorDashboard(db);

    expect(summary.total).toBe(3);
    expect(summary.enabled).toBe(2);
    expect(summary.up).toBe(1);
    expect(summary.down).toBe(1);
    expect(summary.unknown).toBe(0);
  });

  it('берёт самую свежую проверку', () => {
    makeTarget('https://a.ru/', 1, 'up', '2026-07-24 10:00:00');
    makeTarget('https://b.ru/', 1, 'up', '2026-07-24 11:30:00');

    expect(getMonitorDashboard(db).summary.lastCheckedAt).toBe('2026-07-24 11:30:00');
  });

  it('сортирует упавшие наверх, дальше медленные, живые последними', () => {
    makeTarget('https://up.ru/', 1, 'up', '2026-07-24 10:00:00');
    makeTarget('https://slow.ru/', 1, 'slow', '2026-07-24 10:00:00');
    makeTarget('https://down.ru/', 1, 'down', '2026-07-24 10:00:00');

    const { targets } = getMonitorDashboard(db);
    expect(targets.map((t) => t.status)).toEqual(['down', 'slow', 'up']);
  });

  it('прикладывает номера воронок к цели', () => {
    const targetId = makeTarget('https://a.ru/', 1, 'up', '2026-07-24 10:00:00');
    const funnel = sqlite.prepare(`SELECT id, num FROM funnels ORDER BY num LIMIT 1`).get() as {
      id: number;
      num: number;
    };
    sqlite
      .prepare(`INSERT INTO monitor_target_funnels (target_id, funnel_id) VALUES (?, ?)`)
      .run(targetId, funnel.id);

    const { targets } = getMonitorDashboard(db);
    const row = targets.find((t) => t.url === 'https://a.ru/')!;
    expect(row.funnels).toEqual([{ id: funnel.id, num: funnel.num }]);
  });

  it('считает цели по видам источников', () => {
    makeTarget('https://a.ru/', 1, 'up', null);
    sqlite
      .prepare(`INSERT INTO monitor_targets (url, source_kind, enabled) VALUES ('https://g.ru/', 'links', 0)`)
      .run();

    const { sourceKinds } = getMonitorDashboard(db);
    const links = sourceKinds.find((s) => s.sourceKind === 'links')!;
    expect(links.total).toBe(1);
    expect(links.enabled).toBe(0);
  });
});

describe('listMonitorEvents', () => {
  it('отдаёт события свежими вперёд и с URL цели', () => {
    const id = makeTarget('https://a.ru/', 1, 'up', null);
    sqlite
      .prepare(
        `INSERT INTO monitor_events (target_id, from_status, to_status, at) VALUES (?, 'up', 'down', '2026-07-24 09:00:00')`
      )
      .run(id);
    sqlite
      .prepare(
        `INSERT INTO monitor_events (target_id, from_status, to_status, at) VALUES (?, 'down', 'up', '2026-07-24 10:00:00')`
      )
      .run(id);

    const rows = listMonitorEvents(db, 10, 0);
    expect(rows).toHaveLength(2);
    expect(rows[0].at).toBe('2026-07-24 10:00:00');
    expect(rows[0].url).toBe('https://a.ru/');
  });

  it('уважает limit и offset', () => {
    const id = makeTarget('https://a.ru/', 1, 'up', null);
    for (let i = 0; i < 5; i += 1) {
      sqlite
        .prepare(`INSERT INTO monitor_events (target_id, from_status, to_status) VALUES (?, 'up', 'down')`)
        .run(id);
    }
    expect(listMonitorEvents(db, 2, 0)).toHaveLength(2);
    expect(listMonitorEvents(db, 2, 4)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `npx vitest run tests/monitor-view.test.ts`
Expected: FAIL — `Failed to resolve import "../src/lib/monitor-view"`.

- [ ] **Step 3: Реализовать monitor-view.ts**

Создать `app/src/lib/monitor-view.ts`:

```ts
import { eq, desc, asc } from 'drizzle-orm';
import { type AnyDB } from '../db/client';
import {
  funnels,
  monitorTargets,
  monitorTargetFunnels,
  monitorState,
  monitorEvents,
} from '../db/schema';
import { MONITOR_STATUS_META, isMonitorStatus, type MonitorStatus } from './monitor-status';
import { isCycleRunning } from './monitor-run';

export interface MonitorFunnelRef {
  id: number;
  num: number;
}

export interface MonitorTargetView {
  id: number;
  url: string;
  sourceKind: string;
  enabled: boolean;
  status: MonitorStatus;
  httpStatus: number | null;
  finalUrl: string;
  error: string;
  latencyMs: number | null;
  checkedAt: string | null;
  since: string | null;
  consecutiveFailures: number;
  funnels: MonitorFunnelRef[];
}

export interface MonitorSummaryView {
  total: number;
  enabled: number;
  up: number;
  slow: number;
  down: number;
  unknown: number;
  lastCheckedAt: string | null;
  running: boolean;
}

export interface MonitorSourceKindView {
  sourceKind: string;
  total: number;
  enabled: number;
}

export interface MonitorEventView {
  id: number;
  url: string;
  fromStatus: string;
  toStatus: string;
  httpStatus: number | null;
  error: string;
  at: string;
  funnels: MonitorFunnelRef[];
}

/** Номера воронок по каждой цели — одним запросом, чтобы не плодить N+1. */
function funnelsByTarget(db: AnyDB): Map<number, MonitorFunnelRef[]> {
  const rows = db
    .select({
      targetId: monitorTargetFunnels.targetId,
      funnelId: funnels.id,
      num: funnels.num,
    })
    .from(monitorTargetFunnels)
    .innerJoin(funnels, eq(funnels.id, monitorTargetFunnels.funnelId))
    .orderBy(asc(funnels.num))
    .all() as { targetId: number; funnelId: number; num: number }[];

  const map = new Map<number, MonitorFunnelRef[]>();
  for (const row of rows) {
    const list = map.get(row.targetId) ?? [];
    list.push({ id: row.funnelId, num: row.num });
    map.set(row.targetId, list);
  }
  return map;
}

export function getMonitorDashboard(db: AnyDB): {
  summary: MonitorSummaryView;
  sourceKinds: MonitorSourceKindView[];
  targets: MonitorTargetView[];
} {
  const rows = db
    .select({
      id: monitorTargets.id,
      url: monitorTargets.url,
      sourceKind: monitorTargets.sourceKind,
      enabled: monitorTargets.enabled,
      status: monitorState.status,
      httpStatus: monitorState.httpStatus,
      finalUrl: monitorState.finalUrl,
      error: monitorState.error,
      latencyMs: monitorState.latencyMs,
      checkedAt: monitorState.checkedAt,
      since: monitorState.since,
      consecutiveFailures: monitorState.consecutiveFailures,
    })
    .from(monitorTargets)
    .leftJoin(monitorState, eq(monitorState.targetId, monitorTargets.id))
    .all() as {
      id: number;
      url: string;
      sourceKind: string;
      enabled: number;
      status: string | null;
      httpStatus: number | null;
      finalUrl: string | null;
      error: string | null;
      latencyMs: number | null;
      checkedAt: string | null;
      since: string | null;
      consecutiveFailures: number | null;
    }[];

  const links = funnelsByTarget(db);

  const targets: MonitorTargetView[] = rows.map((r) => ({
    id: r.id,
    url: r.url,
    sourceKind: r.sourceKind,
    enabled: r.enabled === 1,
    status: isMonitorStatus(r.status) ? r.status : 'unknown',
    httpStatus: r.httpStatus,
    finalUrl: r.finalUrl ?? '',
    error: r.error ?? '',
    latencyMs: r.latencyMs,
    checkedAt: r.checkedAt,
    since: r.since,
    consecutiveFailures: r.consecutiveFailures ?? 0,
    funnels: links.get(r.id) ?? [],
  }));

  // Сначала то, что требует внимания; внутри статуса — по URL, чтобы порядок был стабильным.
  targets.sort((a, b) => {
    const byStatus = MONITOR_STATUS_META[a.status].order - MONITOR_STATUS_META[b.status].order;
    return byStatus !== 0 ? byStatus : a.url.localeCompare(b.url);
  });

  const summary: MonitorSummaryView = {
    total: targets.length,
    enabled: 0,
    up: 0,
    slow: 0,
    down: 0,
    unknown: 0,
    lastCheckedAt: null,
    running: isCycleRunning(),
  };

  const kinds = new Map<string, MonitorSourceKindView>();

  for (const t of targets) {
    const kind = kinds.get(t.sourceKind) ?? { sourceKind: t.sourceKind, total: 0, enabled: 0 };
    kind.total += 1;
    if (t.enabled) kind.enabled += 1;
    kinds.set(t.sourceKind, kind);

    if (!t.enabled) continue;
    summary.enabled += 1;
    summary[t.status] += 1;
    if (t.checkedAt && (!summary.lastCheckedAt || t.checkedAt > summary.lastCheckedAt)) {
      summary.lastCheckedAt = t.checkedAt;
    }
  }

  const sourceKinds = [...kinds.values()].sort((a, b) => b.total - a.total);

  return { summary, sourceKinds, targets };
}

export function listMonitorEvents(db: AnyDB, limit = 50, offset = 0): MonitorEventView[] {
  const rows = db
    .select({
      id: monitorEvents.id,
      targetId: monitorEvents.targetId,
      url: monitorTargets.url,
      fromStatus: monitorEvents.fromStatus,
      toStatus: monitorEvents.toStatus,
      httpStatus: monitorEvents.httpStatus,
      error: monitorEvents.error,
      at: monitorEvents.at,
    })
    .from(monitorEvents)
    .innerJoin(monitorTargets, eq(monitorTargets.id, monitorEvents.targetId))
    .orderBy(desc(monitorEvents.at), desc(monitorEvents.id))
    .limit(limit)
    .offset(offset)
    .all() as {
      id: number;
      targetId: number;
      url: string;
      fromStatus: string;
      toStatus: string;
      httpStatus: number | null;
      error: string;
      at: string;
    }[];

  const links = funnelsByTarget(db);

  return rows.map((r) => ({
    id: r.id,
    url: r.url,
    fromStatus: r.fromStatus,
    toStatus: r.toStatus,
    httpStatus: r.httpStatus,
    error: r.error,
    at: r.at,
    funnels: links.get(r.targetId) ?? [],
  }));
}
```

- [ ] **Step 4: Запустить тест и убедиться, что он проходит**

Run: `npx vitest run tests/monitor-view.test.ts`
Expected: PASS, 7 тестов.

- [ ] **Step 5: Коммит**

```bash
git add app/src/lib/monitor-view.ts app/tests/monitor-view.test.ts
git commit -m "feat(monitoring): dashboard read models"
```

---

### Task 7: API-роуты

**Files:**
- Create: `app/src/app/api/monitoring/route.ts`
- Create: `app/src/app/api/monitoring/run/route.ts`
- Create: `app/src/app/api/monitoring/targets/route.ts`
- Create: `app/src/app/api/monitoring/targets/[id]/route.ts`
- Create: `app/src/app/api/monitoring/events/route.ts`
- Modify: `app/src/lib/validation.ts` (добавить две схемы в конец, перед блоком `Inferred TypeScript types`, и типы — в него)
- Test: `app/tests/api-monitoring-route.test.ts`

**Interfaces:**
- Consumes: `getMonitorDashboard`, `listMonitorEvents` (Task 6); `runMonitorCycle`, `isCycleRunning` (Task 5); `setTargetEnabled`, `setSourceKindEnabled`, `syncMonitorTargets` (Task 3); `parseRouteId`, `internalError`.
- Produces: `monitorTargetPatchSchema`, `monitorTargetsBulkPatchSchema` из `@/lib/validation`; пять route-хендлеров.

- [ ] **Step 1: Написать падающий тест**

Создать `app/tests/api-monitoring-route.test.ts`:

```ts
/**
 * HTTP-слой мониторинга. Каждая проверка идёт на свежей временной КОПИИ БД,
 * `@/db/client` подменяется drizzle-хендлом над копией (как в api-tag-templates-route.test.ts).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { runMigratePhase6 } from '../scripts/migrate-phase6';
import * as schema from '../src/db/schema';

const REAL_DB = path.resolve(process.cwd(), '..', 'ksamata_funnels.db');
let tmp: string;
let sqlite: Database.Database;
let db: ReturnType<typeof drizzle<typeof schema>>;

/* eslint-disable @typescript-eslint/consistent-type-imports */
let GET: typeof import('../src/app/api/monitoring/route').GET;
let PATCH_ONE: typeof import('../src/app/api/monitoring/targets/[id]/route').PATCH;
let PATCH_BULK: typeof import('../src/app/api/monitoring/targets/route').PATCH;
let GET_EVENTS: typeof import('../src/app/api/monitoring/events/route').GET;
/* eslint-enable @typescript-eslint/consistent-type-imports */

beforeEach(async () => {
  tmp = path.join(os.tmpdir(), `mapi-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  fs.copyFileSync(REAL_DB, tmp);
  sqlite = new Database(tmp);
  sqlite.pragma('foreign_keys = ON');
  runMigratePhase6(sqlite);
  db = drizzle(sqlite, { schema });
  vi.doMock('@/db/client', () => ({ db }));

  GET = (await import('../src/app/api/monitoring/route')).GET;
  PATCH_ONE = (await import('../src/app/api/monitoring/targets/[id]/route')).PATCH;
  PATCH_BULK = (await import('../src/app/api/monitoring/targets/route')).PATCH;
  GET_EVENTS = (await import('../src/app/api/monitoring/events/route')).GET;
});

afterEach(() => {
  vi.resetModules();
  sqlite.close();
  fs.rmSync(tmp, { force: true });
});

function jsonReq(method: string, body: unknown) {
  return new Request('http://test', { method, body: JSON.stringify(body) }) as never;
}
function rawReq(method: string, raw: string) {
  return new Request('http://test', { method, body: raw }) as never;
}
function urlReq(url: string) {
  return new Request(url) as never;
}
const params = (id: string) => ({ params: Promise.resolve({ id }) });

function seedTarget(url: string, sourceKind = 'landings', enabled = 1): number {
  const id = sqlite
    .prepare(`INSERT INTO monitor_targets (url, source_kind, enabled) VALUES (?, ?, ?)`)
    .run(url, sourceKind, enabled).lastInsertRowid as number;
  sqlite.prepare(`INSERT INTO monitor_state (target_id, status) VALUES (?, 'up')`).run(id);
  return id;
}

describe('GET /api/monitoring', () => {
  it('отдаёт сводку, виды источников и цели', async () => {
    seedTarget('https://a.ru/');
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.summary.enabled).toBe(1);
    expect(Array.isArray(body.targets)).toBe(true);
    expect(Array.isArray(body.sourceKinds)).toBe(true);
  });
});

describe('PATCH /api/monitoring/targets/[id]', () => {
  it('переключает одну цель', async () => {
    const id = seedTarget('https://a.ru/');
    const res = await PATCH_ONE(jsonReq('PATCH', { enabled: false }), params(String(id)));
    expect(res.status).toBe(200);
    const row = sqlite.prepare(`SELECT enabled FROM monitor_targets WHERE id = ?`).get(id) as {
      enabled: number;
    };
    expect(row.enabled).toBe(0);
  });

  it('отвечает 400 на нечисловой id', async () => {
    const res = await PATCH_ONE(jsonReq('PATCH', { enabled: true }), params('12abc'));
    expect(res.status).toBe(400);
  });

  it('отвечает 404 на несуществующую цель', async () => {
    const res = await PATCH_ONE(jsonReq('PATCH', { enabled: true }), params('999999'));
    expect(res.status).toBe(404);
  });

  it('отвечает 400 на битый JSON', async () => {
    const id = seedTarget('https://a.ru/');
    const res = await PATCH_ONE(rawReq('PATCH', '{bad'), params(String(id)));
    expect(res.status).toBe(400);
  });

  it('отвечает 400 на тело, не прошедшее валидацию', async () => {
    const id = seedTarget('https://a.ru/');
    const res = await PATCH_ONE(jsonReq('PATCH', { enabled: 'yes' }), params(String(id)));
    expect(res.status).toBe(400);
  });
});

describe('PATCH /api/monitoring/targets', () => {
  it('включает целую группу', async () => {
    seedTarget('https://g1.ru/', 'links', 0);
    seedTarget('https://g2.ru/', 'links', 0);

    const res = await PATCH_BULK(jsonReq('PATCH', { sourceKind: 'links', enabled: true }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.affected).toBe(2);
  });

  it('отвечает 400 на пустой sourceKind', async () => {
    const res = await PATCH_BULK(jsonReq('PATCH', { sourceKind: '', enabled: true }));
    expect(res.status).toBe(400);
  });
});

describe('GET /api/monitoring/events', () => {
  it('отдаёт историю с учётом limit', async () => {
    const id = seedTarget('https://a.ru/');
    for (let i = 0; i < 3; i += 1) {
      sqlite
        .prepare(`INSERT INTO monitor_events (target_id, from_status, to_status) VALUES (?, 'up', 'down')`)
        .run(id);
    }
    const res = await GET_EVENTS(urlReq('http://test/api/monitoring/events?limit=2'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.events).toHaveLength(2);
  });

  it('игнорирует мусорный limit и не падает', async () => {
    const res = await GET_EVENTS(urlReq('http://test/api/monitoring/events?limit=abc'));
    expect(res.status).toBe(200);
  });
});

describe('POST /api/monitoring/run', () => {
  it('отвечает 409, когда цикл уже идёт', async () => {
    // Флаг занятости живёт в модуле monitor-run — подменяем его целиком.
    vi.doMock('@/lib/monitor-run', () => ({
      isCycleRunning: () => true,
      runMonitorCycle: async () => null,
    }));
    const { POST } = await import('../src/app/api/monitoring/run/route');
    const res = await POST();
    expect(res.status).toBe(409);
  });
});
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `npx vitest run tests/api-monitoring-route.test.ts`
Expected: FAIL — `Failed to resolve import "../src/app/api/monitoring/route"`.

- [ ] **Step 3: Добавить Zod-схемы**

В `app/src/lib/validation.ts` перед комментарием `// Inferred TypeScript types` добавить:

```ts
// ── Мониторинг ───────────────────────────────────────────────────────────────

export const monitorTargetPatchSchema = z
  .object({
    enabled: z.boolean(),
  })
  .strict();

export const monitorTargetsBulkPatchSchema = z
  .object({
    sourceKind: z.string().trim().min(1).max(64),
    enabled: z.boolean(),
  })
  .strict();
```

В блок `Inferred TypeScript types` добавить:

```ts
export type MonitorTargetPatch = z.infer<typeof monitorTargetPatchSchema>;
export type MonitorTargetsBulkPatch = z.infer<typeof monitorTargetsBulkPatchSchema>;
```

- [ ] **Step 4: Написать роуты**

Создать `app/src/app/api/monitoring/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { db } from '@/db/client';
import { getMonitorDashboard } from '@/lib/monitor-view';
import { internalError } from '@/lib/http';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return NextResponse.json(getMonitorDashboard(db));
  } catch (err: unknown) {
    return internalError('GET /api/monitoring', err);
  }
}
```

Создать `app/src/app/api/monitoring/run/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { db } from '@/db/client';
import { runMonitorCycle, isCycleRunning } from '@/lib/monitor-run';
import { getMonitorDashboard } from '@/lib/monitor-view';
import { internalError } from '@/lib/http';

export const dynamic = 'force-dynamic';

export async function POST() {
  if (isCycleRunning()) {
    return NextResponse.json({ error: 'Проверка уже идёт' }, { status: 409 });
  }
  try {
    const cycle = await runMonitorCycle(db);
    if (cycle === null) {
      return NextResponse.json({ error: 'Проверка уже идёт' }, { status: 409 });
    }
    return NextResponse.json({ cycle, ...getMonitorDashboard(db) });
  } catch (err: unknown) {
    return internalError('POST /api/monitoring/run', err);
  }
}
```

Создать `app/src/app/api/monitoring/targets/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db/client';
import { setSourceKindEnabled } from '@/lib/monitor-targets';
import { monitorTargetsBulkPatchSchema } from '@/lib/validation';
import { internalError } from '@/lib/http';

export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = monitorTargetsBulkPatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', issues: parsed.error.issues }, { status: 400 });
  }

  try {
    const affected = setSourceKindEnabled(db, parsed.data.sourceKind, parsed.data.enabled);
    return NextResponse.json({ ok: true, affected });
  } catch (err: unknown) {
    return internalError('PATCH /api/monitoring/targets', err);
  }
}
```

Создать `app/src/app/api/monitoring/targets/[id]/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db/client';
import { setTargetEnabled } from '@/lib/monitor-targets';
import { monitorTargetPatchSchema, parseRouteId } from '@/lib/validation';
import { internalError } from '@/lib/http';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id: rawId } = await params;
  const id = parseRouteId(rawId);
  if (id === null) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = monitorTargetPatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', issues: parsed.error.issues }, { status: 400 });
  }

  try {
    const found = setTargetEnabled(db, id, parsed.data.enabled);
    if (!found) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ ok: true, id, enabled: parsed.data.enabled });
  } catch (err: unknown) {
    return internalError('PATCH /api/monitoring/targets/[id]', err);
  }
}
```

Создать `app/src/app/api/monitoring/events/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db/client';
import { listMonitorEvents } from '@/lib/monitor-view';
import { internalError } from '@/lib/http';

export const dynamic = 'force-dynamic';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/** Мусор в query не должен ронять страницу — молча падаем на значение по умолчанию. */
function readNumber(raw: string | null, fallback: number, max: number): number {
  if (raw === null || !/^\d+$/.test(raw)) return fallback;
  return Math.min(Number(raw), max);
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const limit = readNumber(url.searchParams.get('limit'), DEFAULT_LIMIT, MAX_LIMIT);
  const offset = readNumber(url.searchParams.get('offset'), 0, Number.MAX_SAFE_INTEGER);

  try {
    return NextResponse.json({ events: listMonitorEvents(db, limit, offset) });
  } catch (err: unknown) {
    return internalError('GET /api/monitoring/events', err);
  }
}
```

- [ ] **Step 5: Запустить тест и убедиться, что он проходит**

Run: `npx vitest run tests/api-monitoring-route.test.ts`
Expected: PASS, 11 тестов.

- [ ] **Step 6: Проверить типы**

Run: `npx tsc --noEmit`
Expected: без ошибок.

- [ ] **Step 7: Коммит**

```bash
git add app/src/app/api/monitoring app/src/lib/validation.ts app/tests/api-monitoring-route.test.ts
git commit -m "feat(monitoring): API routes for dashboard, run, targets and events"
```

---

### Task 8: Планировщик в контейнере

**Files:**
- Create: `app/src/lib/monitor-scheduler.ts`
- Create: `app/src/instrumentation.ts`
- Modify: `app/.env.example` (добавить блок в конец)
- Test: `app/tests/monitor-scheduler.test.ts`

**Interfaces:**
- Consumes: `runMonitorCycle` (Task 5); `db` из `@/db/client`.
- Produces:
  - `interface SchedulerConfig { enabled: boolean; intervalMs: number; firstRunDelayMs: number }`
  - `readSchedulerConfig(env: NodeJS.ProcessEnv | Record<string, string | undefined>): SchedulerConfig`
  - `startMonitorScheduler(): void`
  - `register(): Promise<void>` из `src/instrumentation.ts`

- [ ] **Step 1: Написать падающий тест**

Создать `app/tests/monitor-scheduler.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readSchedulerConfig, DEFAULT_INTERVAL_MINUTES } from '../src/lib/monitor-scheduler';

describe('readSchedulerConfig', () => {
  it('по умолчанию включён с интервалом 15 минут', () => {
    const cfg = readSchedulerConfig({});
    expect(cfg.enabled).toBe(true);
    expect(cfg.intervalMs).toBe(DEFAULT_INTERVAL_MINUTES * 60_000);
    expect(cfg.firstRunDelayMs).toBe(30_000);
  });

  it('выключается ровно строкой "false"', () => {
    expect(readSchedulerConfig({ MONITOR_ENABLED: 'false' }).enabled).toBe(false);
    expect(readSchedulerConfig({ MONITOR_ENABLED: 'FALSE' }).enabled).toBe(true);
    expect(readSchedulerConfig({ MONITOR_ENABLED: '0' }).enabled).toBe(true);
    expect(readSchedulerConfig({ MONITOR_ENABLED: 'true' }).enabled).toBe(true);
  });

  it('читает интервал из env', () => {
    expect(readSchedulerConfig({ MONITOR_INTERVAL_MINUTES: '5' }).intervalMs).toBe(5 * 60_000);
  });

  it('игнорирует мусорный и неположительный интервал', () => {
    for (const raw of ['abc', '0', '-3', '1.5', '']) {
      expect(readSchedulerConfig({ MONITOR_INTERVAL_MINUTES: raw }).intervalMs).toBe(
        DEFAULT_INTERVAL_MINUTES * 60_000
      );
    }
  });
});
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `npx vitest run tests/monitor-scheduler.test.ts`
Expected: FAIL — `Failed to resolve import "../src/lib/monitor-scheduler"`.

- [ ] **Step 3: Реализовать планировщик**

Создать `app/src/lib/monitor-scheduler.ts`:

```ts
/**
 * Фоновый планировщик проверок. Живёт внутри того же контейнера, что и приложение,
 * поэтому внешний cron не нужен. Инстанс один — гонок нет; на всякий случай
 * наложение циклов дополнительно ловит флаг занятости в monitor-run.
 */
import { runMonitorCycle } from './monitor-run';

export const DEFAULT_INTERVAL_MINUTES = 15;

// Даём entrypoint-миграциям и прогреву сервера закончиться до первого прогона.
const FIRST_RUN_DELAY_MS = 30_000;

export interface SchedulerConfig {
  enabled: boolean;
  intervalMs: number;
  firstRunDelayMs: number;
}

export function readSchedulerConfig(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>
): SchedulerConfig {
  // Выключает ровно строка 'false' — как ADMIN_AUTH_DISABLED в middleware:
  // случайная опечатка не должна молча отключить мониторинг.
  const enabled = env.MONITOR_ENABLED !== 'false';

  const raw = env.MONITOR_INTERVAL_MINUTES ?? '';
  const minutes = /^\d+$/.test(raw) && Number(raw) > 0 ? Number(raw) : DEFAULT_INTERVAL_MINUTES;

  return {
    enabled,
    intervalMs: minutes * 60_000,
    firstRunDelayMs: FIRST_RUN_DELAY_MS,
  };
}

let started = false;

export function startMonitorScheduler(): void {
  if (started) return;
  started = true;

  const config = readSchedulerConfig(process.env);
  if (!config.enabled) {
    console.log('[monitor] MONITOR_ENABLED=false — фоновые проверки выключены');
    return;
  }

  console.log(`[monitor] планировщик запущен, интервал ${config.intervalMs / 60_000} мин`);

  const tick = async () => {
    try {
      // Импорт клиента БД отложен: модуль читает файл БД на импорте, а
      // планировщик не должен ронять старт сервера, если путь ещё не готов.
      const { db } = await import('../db/client');
      const result = await runMonitorCycle(db);
      if (result === null) {
        console.log('[monitor] предыдущий цикл ещё идёт — пропускаем тик');
        return;
      }
      console.log(
        `[monitor] цикл завершён: проверено ${result.checked}, up ${result.up}, slow ${result.slow}, down ${result.down}`
      );
    } catch (err) {
      console.error('[monitor] цикл упал', err);
    }
  };

  setTimeout(tick, config.firstRunDelayMs);
  setInterval(tick, config.intervalMs);
}
```

Создать `app/src/instrumentation.ts`:

```ts
/**
 * Хук старта сервера Next. Вызывается один раз на процесс.
 * Планировщик поднимаем только на Node-рантайме: на Edge нет ни таймеров
 * нужного вида, ни доступа к better-sqlite3.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { startMonitorScheduler } = await import('./lib/monitor-scheduler');
  startMonitorScheduler();
}
```

- [ ] **Step 4: Запустить тест и убедиться, что он проходит**

Run: `npx vitest run tests/monitor-scheduler.test.ts`
Expected: PASS, 4 теста.

- [ ] **Step 5: Задокументировать переменные окружения**

В конец `app/.env.example` добавить:

```
# ── Мониторинг доступности лендов ────────────────────────────────────────────
# Фоновые проверки поднимаются вместе с сервером (src/instrumentation.ts).
# Выключает ровно строка "false" — любое другое значение оставляет мониторинг включённым.
# Локально имеет смысл выключить, чтобы dev-сервер не ходил на боевые ленды.
#   MONITOR_ENABLED=false
MONITOR_ENABLED=

# Период цикла проверок в минутах. По умолчанию 15. Мусор и неположительные
# значения игнорируются — берётся значение по умолчанию.
MONITOR_INTERVAL_MINUTES=
```

- [ ] **Step 6: Проверить, что планировщик реально стартует**

Run: `MONITOR_INTERVAL_MINUTES=1 npm run dev`

Expected: в логе появляется `[monitor] планировщик запущен, интервал 1 мин`, а примерно через 30 секунд — `[monitor] цикл завершён: проверено ...`. Остановить сервер.

Run: `MONITOR_ENABLED=false npm run dev`

Expected: в логе `[monitor] MONITOR_ENABLED=false — фоновые проверки выключены`, строки о завершении цикла не появляются. Остановить сервер.

- [ ] **Step 7: Коммит**

```bash
git add app/src/lib/monitor-scheduler.ts app/src/instrumentation.ts app/tests/monitor-scheduler.test.ts app/.env.example
git commit -m "feat(monitoring): in-container scheduler via instrumentation hook"
```

---

### Task 9: Страница-дашборд

**Files:**
- Create: `app/src/components/monitoring/MonitorStatusPill.tsx`
- Create: `app/src/components/monitoring/MonitorSummary.tsx`
- Create: `app/src/components/monitoring/MonitorTable.tsx`
- Create: `app/src/components/monitoring/MonitorEvents.tsx`
- Create: `app/src/app/monitoring/page.tsx`
- Modify: `app/src/components/AppHeader.tsx:77` (добавить пункт навигации)

**Interfaces:**
- Consumes: `MONITOR_STATUS_META`, `formatAgo`, `MonitorStatus` (Task 2); типы представлений из `@/lib/monitor-view` (Task 6); API из Task 7; `Switch`, `Toast`.
- Produces: страницу `/monitoring`.

Отдельный бейдж, а не существующий `StatusPill`: тот жёстко завязан на статусы воронки (`active`/`draft`/`archive`) и неизвестное значение молча превращает в «Черновик» — для мониторинга это дало бы враньё в интерфейсе.

- [ ] **Step 1: Написать бейдж статуса**

Создать `app/src/components/monitoring/MonitorStatusPill.tsx`:

```tsx
import { MONITOR_STATUS_META, isMonitorStatus } from '@/lib/monitor-status';

interface Props {
  status: string;
}

export default function MonitorStatusPill({ status }: Props) {
  const meta = isMonitorStatus(status) ? MONITOR_STATUS_META[status] : MONITOR_STATUS_META.unknown;
  return (
    <span className={`whitespace-nowrap rounded-full px-2 py-1 text-[11px] font-semibold ${meta.className}`}>
      {meta.label}
    </span>
  );
}
```

- [ ] **Step 2: Написать полосу сводки**

Создать `app/src/components/monitoring/MonitorSummary.tsx`:

```tsx
'use client';

import { RefreshCw } from 'lucide-react';
import { formatAgo } from '@/lib/monitor-status';
import type { MonitorSummaryView } from '@/lib/monitor-view';

interface Props {
  summary: MonitorSummaryView;
  running: boolean;
  onRun: () => void;
}

const CELLS: { key: 'enabled' | 'up' | 'slow' | 'down'; label: string; className: string }[] = [
  { key: 'enabled', label: 'Проверяем', className: 'text-[var(--ink)]' },
  { key: 'up', label: 'Работает', className: 'text-[#087443]' },
  { key: 'slow', label: 'Медленно', className: 'text-[#8A6100]' },
  { key: 'down', label: 'Упало', className: 'text-[#A32020]' },
];

export default function MonitorSummary({ summary, running, onRun }: Props) {
  return (
    <div className="flex flex-wrap items-center gap-4 rounded-[10px] border border-[var(--line-soft)] bg-[var(--card)] px-4 py-3">
      {CELLS.map((cell) => (
        <div key={cell.key} className="min-w-[72px]">
          <div className={`text-[20px] font-semibold leading-none ${cell.className}`}>
            {summary[cell.key]}
          </div>
          <div className="mt-1 text-[11px] text-[var(--muted)]">{cell.label}</div>
        </div>
      ))}

      <div className="ml-auto flex items-center gap-3">
        <span className="text-[11px] text-[var(--muted)]">
          Проверка: {formatAgo(summary.lastCheckedAt)}
        </span>
        <button
          type="button"
          onClick={onRun}
          disabled={running}
          className="inline-flex items-center gap-1.5 rounded-[8px] bg-[var(--orange)] px-3 py-2 text-[13px] font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
        >
          <RefreshCw size={14} className={running ? 'animate-spin' : undefined} />
          {running ? 'Проверяем…' : 'Проверить сейчас'}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Написать таблицу целей**

Создать `app/src/components/monitoring/MonitorTable.tsx`:

```tsx
'use client';

import Link from 'next/link';
import { ExternalLink, CornerDownRight } from 'lucide-react';
import Switch from '@/components/Switch';
import MonitorStatusPill from './MonitorStatusPill';
import { formatAgo } from '@/lib/monitor-status';
import type { MonitorTargetView } from '@/lib/monitor-view';

interface Props {
  targets: MonitorTargetView[];
  onToggle: (id: number, enabled: boolean) => void;
}

export default function MonitorTable({ targets, onToggle }: Props) {
  if (targets.length === 0) {
    return (
      <div className="rounded-[10px] border border-[var(--line-soft)] bg-[var(--card)] px-4 py-8 text-center text-[13px] text-[var(--muted)]">
        Под фильтр ничего не подходит.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-[10px] border border-[var(--line-soft)] bg-[var(--card)]">
      <table className="w-full min-w-[760px] border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-[var(--line-soft)] text-left text-[11px] text-[var(--muted)]">
            <th className="px-3 py-2 font-medium">Статус</th>
            <th className="px-3 py-2 font-medium">Страница</th>
            <th className="px-3 py-2 font-medium">Код</th>
            <th className="px-3 py-2 font-medium">Ответ</th>
            <th className="px-3 py-2 font-medium">С</th>
            <th className="px-3 py-2 font-medium">Воронки</th>
            <th className="px-3 py-2 font-medium">Вкл.</th>
          </tr>
        </thead>
        <tbody>
          {targets.map((t) => {
            const redirected = t.finalUrl !== '' && t.finalUrl !== t.url;
            return (
              <tr key={t.id} className="border-b border-[var(--line-soft)] last:border-0 align-top">
                <td className="px-3 py-2">
                  <MonitorStatusPill status={t.status} />
                  {t.consecutiveFailures > 1 && (
                    <div className="mt-1 text-[11px] text-[var(--muted)]">
                      подряд: {t.consecutiveFailures}
                    </div>
                  )}
                </td>
                <td className="px-3 py-2">
                  <a
                    href={t.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="inline-flex items-center gap-1 text-[var(--ink)] hover:underline"
                  >
                    {t.url}
                    <ExternalLink size={12} className="text-[var(--faint)]" />
                  </a>
                  {redirected && (
                    <div className="mt-0.5 flex items-center gap-1 text-[11px] text-[var(--muted)]">
                      <CornerDownRight size={11} />
                      {t.finalUrl}
                    </div>
                  )}
                  {t.error !== '' && (
                    <div className="mt-0.5 text-[11px] text-[#A32020]">{t.error}</div>
                  )}
                  <div className="mt-0.5 text-[11px] text-[var(--faint)]">{t.sourceKind}</div>
                </td>
                <td className="px-3 py-2 text-[var(--muted)]">{t.httpStatus ?? '—'}</td>
                <td className="px-3 py-2 text-[var(--muted)]">
                  {t.latencyMs === null ? '—' : `${t.latencyMs} мс`}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-[var(--muted)]">
                  {formatAgo(t.since)}
                </td>
                <td className="px-3 py-2">
                  <span className="flex flex-wrap gap-1">
                    {t.funnels.map((f) => (
                      <Link
                        key={f.id}
                        href={`/funnels/${f.id}`}
                        className="rounded-[5px] bg-[var(--chip)] px-1.5 py-0.5 text-[11px] text-[var(--muted)] hover:text-[var(--ink)]"
                      >
                        №{f.num}
                      </Link>
                    ))}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <Switch checked={t.enabled} onChange={(v) => onToggle(t.id, v)} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 4: Написать лог событий**

Создать `app/src/components/monitoring/MonitorEvents.tsx`:

```tsx
'use client';

import { MONITOR_STATUS_META, isMonitorStatus, formatAgo } from '@/lib/monitor-status';
import type { MonitorEventView } from '@/lib/monitor-view';

interface Props {
  events: MonitorEventView[];
}

function label(status: string): string {
  return isMonitorStatus(status) ? MONITOR_STATUS_META[status].label.toLowerCase() : status;
}

export default function MonitorEvents({ events }: Props) {
  return (
    <section className="rounded-[10px] border border-[var(--line-soft)] bg-[var(--card)] px-4 py-3">
      <h2 className="text-[13px] font-semibold text-[var(--ink)]">Последние события</h2>
      {events.length === 0 ? (
        <p className="mt-2 text-[12px] text-[var(--muted)]">
          Смен статуса пока не было — либо ещё не проверяли, либо всё стабильно.
        </p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {events.map((e) => (
            <li key={e.id} className="text-[12px] text-[var(--muted)]">
              <span className="text-[var(--faint)]">
                {e.funnels.map((f) => `№${f.num}`).join(', ') || '—'}
              </span>{' '}
              <span className="text-[var(--ink)]">{e.url}</span>: {label(e.fromStatus)} →{' '}
              {label(e.toStatus)}
              {e.error !== '' && ` (${e.error})`}, {formatAgo(e.at)}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
```

- [ ] **Step 5: Написать страницу**

Создать `app/src/app/monitoring/page.tsx`:

```tsx
'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Segmented from '@/components/Segmented';
import Toast from '@/components/Toast';
import MonitorSummary from '@/components/monitoring/MonitorSummary';
import MonitorTable from '@/components/monitoring/MonitorTable';
import MonitorEvents from '@/components/monitoring/MonitorEvents';
import { MONITOR_STATUS_META } from '@/lib/monitor-status';
import type {
  MonitorEventView,
  MonitorSourceKindView,
  MonitorSummaryView,
  MonitorTargetView,
} from '@/lib/monitor-view';

type StatusFilter = 'all' | 'down' | 'slow' | 'up';

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'Все' },
  { value: 'down', label: 'Упало' },
  { value: 'slow', label: 'Медленно' },
  { value: 'up', label: 'Работает' },
];

interface DashboardData {
  summary: MonitorSummaryView;
  sourceKinds: MonitorSourceKindView[];
  targets: MonitorTargetView[];
}

interface ToastState {
  message: string;
  variant: 'success' | 'error';
  key: number;
}

export default function MonitoringPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [events, setEvents] = useState<MonitorEventView[]>([]);
  const [loadFailed, setLoadFailed] = useState(false);
  const [running, setRunning] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [search, setSearch] = useState('');
  const [showDisabled, setShowDisabled] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);
  const toastKeyRef = useRef(0);

  const showToast = useCallback((message: string, variant: 'success' | 'error') => {
    toastKeyRef.current += 1;
    setToast({ message, variant, key: toastKeyRef.current });
  }, []);

  const load = useCallback(async () => {
    try {
      const [dashRes, eventsRes] = await Promise.all([
        fetch('/api/monitoring'),
        fetch('/api/monitoring/events?limit=25'),
      ]);
      if (!dashRes.ok || !eventsRes.ok) throw new Error('load failed');
      setData(await dashRes.json());
      setEvents((await eventsRes.json()).events);
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function runNow() {
    if (running) return;
    setRunning(true);
    try {
      const res = await fetch('/api/monitoring/run', { method: 'POST' });
      if (res.status === 409) {
        showToast('Проверка уже идёт', 'error');
        return;
      }
      if (!res.ok) throw new Error('run failed');
      await load();
      showToast('Проверка завершена', 'success');
    } catch {
      showToast('Не удалось запустить проверку', 'error');
    } finally {
      setRunning(false);
    }
  }

  async function toggleTarget(id: number, enabled: boolean) {
    try {
      const res = await fetch(`/api/monitoring/targets/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      if (!res.ok) throw new Error('toggle failed');
      await load();
    } catch {
      showToast('Не удалось переключить цель', 'error');
    }
  }

  async function toggleKind(sourceKind: string, enabled: boolean) {
    try {
      const res = await fetch('/api/monitoring/targets', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceKind, enabled }),
      });
      if (!res.ok) throw new Error('bulk failed');
      const body = await res.json();
      await load();
      showToast(
        enabled ? `Включено целей: ${body.affected}` : `Выключено целей: ${body.affected}`,
        'success'
      );
    } catch {
      showToast('Не удалось переключить группу', 'error');
    }
  }

  const visible = useMemo(() => {
    if (!data) return [];
    const query = search.trim().toLowerCase();
    return data.targets.filter((t) => {
      if (!showDisabled && !t.enabled) return false;
      if (statusFilter !== 'all' && t.status !== statusFilter) return false;
      if (query && !t.url.toLowerCase().includes(query)) return false;
      return true;
    });
  }, [data, search, showDisabled, statusFilter]);

  const disabledCount = data ? data.targets.filter((t) => !t.enabled).length : 0;

  return (
    <main className="mx-auto max-w-[1120px] px-4 py-6 sm:px-6">
      <h1 className="text-[18px] font-semibold text-[var(--ink)]">Мониторинг страниц</h1>
      <p className="mt-1 text-[12px] text-[var(--muted)]">
        Статус {MONITOR_STATUS_META.down.label.toLowerCase()} ставится, только если подряд
        провалились две попытки — моргание сети сюда не попадает.
      </p>

      {loadFailed && (
        <div className="mt-4 rounded-[10px] border border-[var(--line-soft)] bg-[var(--card)] px-4 py-6 text-center text-[13px] text-[#A32020]">
          Не удалось загрузить данные мониторинга.
        </div>
      )}

      {data && (
        <div className="mt-4 space-y-4">
          <MonitorSummary summary={data.summary} running={running} onRun={runNow} />

          <div className="flex flex-wrap items-center gap-2">
            {data.sourceKinds.map((k) => {
              const allOn = k.enabled === k.total;
              return (
                <button
                  key={k.sourceKind}
                  type="button"
                  onClick={() => void toggleKind(k.sourceKind, !allOn)}
                  className="rounded-[6px] bg-[var(--chip)] px-2 py-1 text-[11px] text-[var(--muted)] transition hover:text-[var(--ink)]"
                >
                  {k.sourceKind} · {k.total} · {allOn ? 'вкл' : `${k.enabled} вкл`}
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Segmented
              options={STATUS_OPTIONS}
              value={statusFilter}
              onChange={(v) => setStatusFilter(v as StatusFilter)}
            />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Поиск по URL"
              className="rounded-[7px] border border-[var(--line-soft)] bg-[var(--card)] px-2.5 py-1.5 text-[12px] text-[var(--ink)] outline-none"
            />
            <button
              type="button"
              onClick={() => setShowDisabled((v) => !v)}
              className="text-[12px] text-[var(--muted)] underline-offset-2 hover:underline"
            >
              {showDisabled ? 'Скрыть выключенные' : `Показать выключенные (${disabledCount})`}
            </button>
          </div>

          <MonitorTable targets={visible} onToggle={(id, enabled) => void toggleTarget(id, enabled)} />
          <MonitorEvents events={events} />
        </div>
      )}

      {toast && (
        <Toast
          key={toast.key}
          message={toast.message}
          variant={toast.variant}
          onClose={() => setToast(null)}
        />
      )}
    </main>
  );
}
```

- [ ] **Step 6: Добавить пункт навигации**

В `app/src/components/AppHeader.tsx` в блок `<nav>` после строки `{navLink('/tags', 'Теги')}` добавить:

```tsx
          {navLink('/monitoring', 'Мониторинг')}
```

- [ ] **Step 7: Проверить типы и сборку**

Run: `npx tsc --noEmit`
Expected: без ошибок.

Run: `npm run build`
Expected: сборка проходит, в списке маршрутов есть `/monitoring` и пять `/api/monitoring/*`.

- [ ] **Step 8: Проверить страницу вживую**

Запустить dev-сервер через preview-инструменты (`.claude/launch.json`, команда `npm run dev`, порт 3000), открыть `/monitoring` и проверить:

1. полоса сводки показывает ненулевое «Проверяем» (~42 после первого синка);
2. кнопка «Проверить сейчас» отрабатывает и таблица заполняется статусами;
3. упавшие строки идут первыми;
4. переключение чипа `links` включает группу, счётчик в чипе меняется;
5. «Показать выключенные» открывает остальные цели;
6. клик по чипу воронки ведёт на её карточку;
7. в консоли браузера нет ошибок.

Приложить скриншот страницы.

- [ ] **Step 9: Коммит**

```bash
git add app/src/app/monitoring app/src/components/monitoring app/src/components/AppHeader.tsx
git commit -m "feat(monitoring): dashboard page with targets table and incident log"
```

---

### Task 10: Документация и финальная проверка

**Files:**
- Modify: `CLAUDE.md` (разделы «Repository layout» не трогаем; правим «Data model», «Domain helpers», «API routes», «Pages & components», «Migrations», «Deployment», «Docs & planning»)
- Modify: `docs/README.md` (добавить спеку и план в индекс)
- Modify: `docs/project-map.md` (новые файлы)
- Modify: `docs/superpowers/specs/2026-07-24-landing-monitoring-design.md` (снять двусмысленность про «вторую неудачу»)

- [ ] **Step 1: Уточнить спеку**

В разделе «Прогон цикла» заменить абзац про защиту от ложных инцидентов на:

```markdown
Защита от ложных инцидентов: падение подтверждается **внутри одного цикла** —
провалилась проверка, пауза 3 секунды, повторная проверка; статус `down`
ставится, только если провалились обе попытки. Реальное падение попадает в
`down` за один цикл, а не за два. `consecutive_failures` считает подряд идущие
циклы с подтверждённым падением и нужен для отображения («падает N циклов
подряд»); `slow` — рабочее состояние, счётчик не трогает; любой не-`down`
исход счётчик обнуляет.
```

- [ ] **Step 2: Обновить CLAUDE.md**

В раздел «Data model» после списка таблиц добавить:

```markdown
- **Monitoring (Phase 6):** `monitor_targets` (URL to check, `source_kind`,
  `enabled`), `monitor_target_funnels` (which funnels use the URL),
  `monitor_state` (current status per target, 1:1), `monitor_events` (status
  **changes** only — never one row per check).
```

В раздел «Domain helpers» добавить:

```markdown
- `monitor-status.ts` — monitoring status values, badge metadata, `formatAgo`.
- `monitor-urls.ts` — URL normalization + multi-URL field splitting.
- `monitor-targets.ts` — sync targets from funnel data, enable/disable.
- `monitor-check.ts` — pure HTTP availability check (`checkUrl`).
- `monitor-run.ts` — check cycle, state persistence, event log.
- `monitor-view.ts` — dashboard read models.
- `monitor-scheduler.ts` — env config + `setInterval` (started by `src/instrumentation.ts`).
```

В раздел «API routes» добавить:

```markdown
- `GET /api/monitoring` — summary + targets with state.
- `POST /api/monitoring/run` — sync + run a check cycle (409 if one is running).
- `PATCH /api/monitoring/targets` — bulk enable/disable by `sourceKind`.
- `PATCH /api/monitoring/targets/[id]` — enable/disable one target.
- `GET /api/monitoring/events` — incident history.
```

В раздел «Pages & components» дописать `monitoring/page.tsx` в список страниц и
`monitoring/` (`MonitorStatusPill`, `MonitorSummary`, `MonitorTable`,
`MonitorEvents`) в список компонентов.

В раздел «Migrations» добавить:

```markdown
- **Phase 6** — monitoring tables (`monitor_targets`, `monitor_target_funnels`,
  `monitor_state`, `monitor_events`).
```

и поправить строку про порядок в Docker на: `Phase 2 → 3 (+data) → 4 → 5 →
legacy-tag-override backfill → 6`.

В раздел «Deployment» в перечень env-переменных добавить `MONITOR_ENABLED`,
`MONITOR_INTERVAL_MINUTES` и строку:

```markdown
- Background monitoring runs inside the container (`src/instrumentation.ts`),
  every `MONITOR_INTERVAL_MINUTES` (default 15). Set `MONITOR_ENABLED=false`
  to turn it off — only the exact string `false` disables it.
```

- [ ] **Step 3: Обновить docs/README.md и docs/project-map.md**

В `docs/README.md` в перечень спек и планов добавить строки со ссылками на
`superpowers/specs/2026-07-24-landing-monitoring-design.md` и
`superpowers/plans/2026-07-24-landing-monitoring.md`.

В `docs/project-map.md` добавить новые файлы из раздела «Файловая структура»
этого плана, в том же формате, что уже используется в файле.

- [ ] **Step 4: Полная проверка**

Run: `npx tsc --noEmit`
Expected: без ошибок.

Run: `npx vitest run`
Expected: все тесты проходят, включая шесть новых файлов (`migrate-phase6`,
`monitor-status`, `monitor-urls`, `monitor-targets`, `monitor-check`,
`monitor-run`, `monitor-view`, `monitor-scheduler`, `api-monitoring-route`).

Run: `npm run build`
Expected: сборка проходит.

- [ ] **Step 5: Проверить Docker-путь**

Run: `docker build -f app/Dockerfile -t ksamata-funnels-test app/`
Expected: сборка проходит, шаг esbuild для `migrate-phase6-runner.ts` отрабатывает.

Если Docker недоступен в окружении — зафиксировать это явно в отчёте и не
объявлять шаг выполненным.

- [ ] **Step 6: Коммит**

```bash
git add CLAUDE.md docs/README.md docs/project-map.md docs/superpowers/specs/2026-07-24-landing-monitoring-design.md docs/superpowers/plans/2026-07-24-landing-monitoring.md
git commit -m "docs: document landing monitoring (phase 6)"
```

---

## Проверка плана по спеке

| Требование спеки | Задача |
|---|---|
| Таблицы `monitor_targets` / `monitor_target_funnels` / `monitor_state` / `monitor_events` | 1 |
| Идемпотентная миграция + Docker entrypoint | 1 |
| Два источника лендов (блок `landings` + `landing_url`) | 3 |
| Нормализация, сплит по ` / `, срезание хвостовой кавычки | 2 |
| Дедупликация URL из нескольких воронок | 3 |
| `enabled = 1` только для лендов при первом заведении | 3 |
| Ручной тумблер переживает синк | 3 |
| Исчезнувший URL гаснет, но не удаляется | 3 |
| Строка состояния `unknown` для новой цели | 3 |
| `GET`, а не `HEAD`; таймаут 10 с; порог 5 с; `finalUrl` | 4 |
| Пул по 8; события только при смене статуса | 5 |
| Подтверждение падения повторной попыткой через 3 с | 5 |
| Флаг «цикл уже идёт» | 5, 7 |
| Пять API-роутов, `409` на параллельный прогон | 7 |
| Планировщик, `MONITOR_ENABLED`, `MONITOR_INTERVAL_MINUTES`, первый прогон через 30 с | 8 |
| Страница `/monitoring`: сводка, фильтры, таблица, чипы групп, лог событий | 9 |
| Пункт «Мониторинг» в шапке | 9 |
| Обновление документации | 10 |
