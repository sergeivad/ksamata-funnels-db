/**
 * Прогон цикла: запись состояния и лог смен статуса.
 * Проверяльщик подменяется через opts.check — сети нет.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { runMigratePhase6 } from '../scripts/migrate-phase6';
import * as schema from '../src/db/schema';
import { clearMonitoringState } from './helpers/monitoring';
import { runMonitorCycle, runFunnelCheck, EVENT_RETENTION_DAYS, isCycleRunning } from '../src/lib/monitor-run';
import { notifyMonitorEvents } from '../src/lib/monitor-notify';
import type { CheckResult } from '../src/lib/monitor-check';
import type { AnyDB } from '../src/db/client';
import { copyDbForTest } from './helpers/db';

const REAL_DB = path.resolve(process.cwd(), '..', 'ksamata_funnels.db');
let tmp: string;
let sqlite: Database.Database;
let db: ReturnType<typeof drizzle<typeof schema>>;
let funnelId: number;

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

/** Цель без привязки к воронке — по образцу seedTarget, но с явным enabled. */
function addTarget(url: string, enabled: 0 | 1): number {
  const id = sqlite
    .prepare(`INSERT INTO monitor_targets (url, source_kind, enabled) VALUES (?, 'landings', ?)`)
    .run(url, enabled).lastInsertRowid as number;
  sqlite.prepare(`INSERT INTO monitor_state (target_id, status) VALUES (?, 'unknown')`).run(id);
  return id;
}

/** Как addTarget, но с настраиваемым source_kind — нужен для правила дефолта группы. */
function addKindTarget(url: string, sourceKind: string, enabled: 0 | 1): number {
  const id = sqlite
    .prepare(`INSERT INTO monitor_targets (url, source_kind, enabled) VALUES (?, ?, ?)`)
    .run(url, sourceKind, enabled).lastInsertRowid as number;
  sqlite.prepare(`INSERT INTO monitor_state (target_id, status) VALUES (?, 'unknown')`).run(id);
  return id;
}

/** Связывает цель с воронкой — как это делает синк, только вручную. */
function linkTarget(targetId: number, fId: number): void {
  sqlite
    .prepare(`INSERT INTO monitor_target_funnels (target_id, funnel_id) VALUES (?, ?)`)
    .run(targetId, fId);
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
  copyDbForTest(REAL_DB, tmp);
  sqlite = new Database(tmp);
  sqlite.pragma('foreign_keys = ON');
  runMigratePhase6(sqlite);
  // Копия реальной БД может нести цели, заведённые локальным планировщиком, —
  // тесты ниже считают абсолютные числа, поэтому стартуем с нуля.
  clearMonitoringState(sqlite);
  db = drizzle(sqlite, { schema });
  funnelId = (sqlite.prepare(`SELECT id FROM funnels WHERE status = 'active' LIMIT 1`)
    .get() as { id: number }).id;
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
    await runMonitorCycle(db, { check: check.fn, sync: false, sleep: noSleep });
    await runMonitorCycle(db, { check: check.fn, sync: false, sleep: noSleep });

    expect(events(id)).toHaveLength(1);
  });

  it('не двигает since, пока статус не менялся', async () => {
    const id = seedTarget();
    const check = scriptedCheck([up]);

    await runMonitorCycle(db, { check: check.fn, sync: false, sleep: noSleep });

    // datetime('now') имеет разрешение в секунду, а весь тест укладывается
    // в миллисекунды — сравнение с «since после первого цикла» совпало бы
    // даже без guard'а в persist. Подставляем заведомо старое значение,
    // чтобы assert был чувствителен к реальному поведению кода.
    const backdated = '2020-01-01 00:00:00';
    sqlite.prepare(`UPDATE monitor_state SET since = ? WHERE target_id = ?`).run(backdated, id);

    await runMonitorCycle(db, { check: check.fn, sync: false, sleep: noSleep });
    await runMonitorCycle(db, { check: check.fn, sync: false, sleep: noSleep });

    expect(state(id).since).toBe(backdated);
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

  it('отдаёт уведомителю отсечку, снятую до прогона', async () => {
    const id = seedTarget();
    await runMonitorCycle(db, { check: scriptedCheck([up]).fn, sync: false, sleep: noSleep });
    const before = (sqlite.prepare(`SELECT MAX(id) AS m FROM monitor_events`).get() as { m: number }).m;

    const seen: number[] = [];
    await runMonitorCycle(db, {
      check: scriptedCheck([down]).fn,
      sync: false,
      sleep: noSleep,
      notify: async (_db, since) => {
        seen.push(since);
      },
    });

    // Отсечка снята ДО прогона, поэтому событие этого цикла в неё не попало —
    // иначе уведомитель не увидел бы ровно то падение, ради которого зовётся.
    expect(seen).toEqual([before]);
    expect(events(id)).toHaveLength(2);
  });

  it('не роняет цикл, если уведомление не ушло', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    seedTarget();

    const result = await runMonitorCycle(db, {
      check: scriptedCheck([down]).fn,
      sync: false,
      sleep: noSleep,
      notify: async () => {
        throw new Error('Telegram недоступен');
      },
    });

    expect(result).not.toBeNull();
    expect(result!.down).toBe(1);
    log.mockRestore();
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

  it('изолирует упавшую цель: цикл не падает и считает только успешные', async () => {
    const idBad = seedTarget('https://one.ru/');
    const idGood = seedTarget('https://two.ru/');
    // Проверяльщик, который реально бросает исключение (не «down»-результат) —
    // именно такой случай не покрыт CheckFn-контрактом, но не должен топить цикл.
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const check = async (url: string): Promise<CheckResult> => {
      if (url === 'https://one.ru/') throw new Error('boom');
      return up;
    };

    const result = await runMonitorCycle(db, { check, sync: false, sleep: noSleep });

    expect(result).not.toBeNull();
    expect(result!.checked).toBe(1);
    expect(result!.up).toBe(1);
    expect(state(idGood).status).toBe('up');
    expect(state(idBad).status).toBe('unknown'); // до упавшей цели persist не дошёл
    expect(errorSpy).toHaveBeenCalled();

    errorSpy.mockRestore();
  });
});

/**
 * Флаг «цикл идёт» обязан жить на globalThis, а не в модуле: в бандле Next
 * этот модуль существует в двух копиях (планировщик из instrumentation.ts и
 * route-хендлер кнопки), и модульная переменная развела бы их по разным флагам.
 * Воспроизвести само бандление в vitest нельзя — vitest отдаёт всем импортёрам
 * один инстанс модуля, — поэтому проверяем механизм: экспортируемый аксессор
 * читает именно общий слот, а не собственную копию значения.
 */
describe('общий слот флага на globalThis', () => {
  const saved = globalThis.__ksamataMonitorRun;
  afterEach(() => {
    globalThis.__ksamataMonitorRun = saved;
  });

  it('isCycleRunning() видит значение, выставленное в слоте напрямую', () => {
    globalThis.__ksamataMonitorRun = { cycleRunning: true };
    expect(isCycleRunning()).toBe(true);

    globalThis.__ksamataMonitorRun = { cycleRunning: false };
    expect(isCycleRunning()).toBe(false);
  });

  it('заводит слот сам, если его ещё нет', () => {
    globalThis.__ksamataMonitorRun = undefined;
    expect(isCycleRunning()).toBe(false);
    expect(globalThis.__ksamataMonitorRun).toEqual({ cycleRunning: false });
  });

  it('прогон цикла поднимает и опускает флаг в общем слоте', async () => {
    const id = seedTarget();
    expect(id).toBeGreaterThan(0);

    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const blocking = async (): Promise<CheckResult> => { await gate; return up; };

    const running = runMonitorCycle(db, { check: blocking, sync: false, sleep: noSleep });
    expect(globalThis.__ksamataMonitorRun?.cycleRunning).toBe(true);

    release();
    await running;
    expect(globalThis.__ksamataMonitorRun?.cycleRunning).toBe(false);
  });
});

describe('ретеншен истории инцидентов', () => {
  /** Событие «задним числом» — как будто оно записано N дней назад. */
  function seedOldEvent(targetId: number, daysAgo: number) {
    sqlite
      .prepare(
        `INSERT INTO monitor_events (target_id, from_status, to_status, at)
         VALUES (?, 'up', 'down', datetime('now', ?))`
      )
      .run(targetId, `-${daysAgo} days`);
  }

  it('срок хранения — 90 дней (решение принято явно, не деталь реализации)', () => {
    expect(EVENT_RETENTION_DAYS).toBe(90);
  });

  it(`удаляет события старше ${EVENT_RETENTION_DAYS} дней по завершении цикла`, async () => {
    const id = seedTarget();
    seedOldEvent(id, EVENT_RETENTION_DAYS + 1);
    seedOldEvent(id, EVENT_RETENTION_DAYS - 1);
    expect(events(id)).toHaveLength(2);

    await runMonitorCycle(db, { check: scriptedCheck([up]).fn, sync: false, sleep: noSleep });

    // Осталось свежее событие плюс переход unknown → up этого цикла.
    expect(events(id)).toHaveLength(2);
    const rows = sqlite
      .prepare(`SELECT at FROM monitor_events WHERE target_id = ? ORDER BY at`)
      .all(id) as { at: string }[];
    const oldest = new Date(rows[0].at + 'Z').getTime();
    const cutoff = Date.now() - EVENT_RETENTION_DAYS * 24 * 3600 * 1000;
    expect(oldest).toBeGreaterThan(cutoff);
  });

  it('историю в пределах срока не трогает', async () => {
    const id = seedTarget();
    seedOldEvent(id, 1);
    await runMonitorCycle(db, { check: scriptedCheck([up]).fn, sync: false, sleep: noSleep });
    expect(events(id)).toHaveLength(2);
  });
});

describe('запись результата', () => {
  it('чтение прошлого статуса идёт внутри транзакции', () => {
    // Транзакция better-sqlite3 синхронна: если SELECT внутри неё, весь
    // persist виден снаружи как одна операция. Проверяем структурно —
    // на исходнике, потому что гонку двух писателей тестом не поймать.
    const src = fs.readFileSync(
      path.resolve(process.cwd(), 'src/lib/monitor-run.ts'), 'utf8',
    );
    const body = src.slice(src.indexOf('function persist('), src.indexOf('export async function runMonitorCycle'));
    const txAt = body.indexOf('db.transaction(');
    const selectAt = body.indexOf('.from(monitorState)');
    expect(txAt).toBeGreaterThanOrEqual(0);
    expect(selectAt).toBeGreaterThan(txAt);
  });

  it('транзакция открывается как immediate', async () => {
    // Граница транзакции сама по себе ничего не обещает: `db.transaction()`
    // у better-sqlite3 — DEFERRED, и с SELECT-ом первой строкой транзакция
    // начинается читающей. Второй писатель того же файла (разовый tsx,
    // Python-инструмент) в этот момент даёт `SQLITE_BUSY_SNAPSHOT`, которую
    // busy_timeout не переигрывает, — цель молча выпала бы из прогона.
    // Гонку двух процессов тестом не поставить, а вот флаг, который её и
    // закрывает, проверить можно ровно там, где он передаётся.
    seedTarget();
    const check = scriptedCheck([up]);
    const configs: unknown[] = [];
    const real = db.transaction.bind(db) as (fn: unknown, config?: unknown) => unknown;
    const spy = new Proxy(db as object, {
      get(target, prop) {
        if (prop === 'transaction') {
          return (fn: unknown, config?: unknown) => {
            configs.push(config);
            return real(fn, config);
          };
        }
        const value = Reflect.get(target, prop, target) as unknown;
        return typeof value === 'function' ? value.bind(target) : value;
      },
    }) as unknown as AnyDB;

    await runMonitorCycle(spy, { check: check.fn, sync: false, sleep: noSleep });

    expect(configs).toEqual([{ behavior: 'immediate' }]);
  });
});

describe('ручная проверка воронки', () => {
  it('проверяет только адреса этой воронки, включая выключенные с рабочим дефолтом группы', async () => {
    // `mine` в группе 'landings' (см. addTarget) — её дефолт включён
    // (DEFAULT_ENABLED_SOURCE_KINDS), поэтому цель проверяется, хотя своя
    // enabled=0 (типичный черновик: hasActive=false в синке). Это не «все
    // выключенные подряд» — правило и его границу (группа `links`) отдельно
    // проверяет describe('правка 1: ...') ниже.
    const mine = addTarget('https://lp.example.ru/mine', 0);   // выключенная цель воронки
    const alien = addTarget('https://lp.example.ru/alien', 1); // чужая, включённая
    linkTarget(mine, funnelId);

    const asked: string[] = [];
    const check = async (url: string) => {
      asked.push(url);
      return { status: 'up' as const, httpStatus: 200, finalUrl: url, latencyMs: 1, error: '' };
    };

    await runFunnelCheck(db, funnelId, { check, sync: false, notify: async () => undefined });

    expect(asked).toEqual(['https://lp.example.ru/mine']);
    expect(asked).not.toContain('https://lp.example.ru/alien');
    // Не просто «id вставки валиден» — доказываем, что чужую цель реально не
    // тронули: persist не писал в её состояние, оно осталось тем, с чем цель
    // была заведена в addTarget.
    expect(state(alien).status).toBe('unknown');
  });

  it('вторая проверка воронки подряд отказывается, пока идёт первая', async () => {
    const t = addTarget('https://lp.example.ru/slow', 1);
    linkTarget(t, funnelId);

    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const check = async (url: string) => {
      await gate;
      return { status: 'up' as const, httpStatus: 200, finalUrl: url, latencyMs: 1, error: '' };
    };

    const first = runFunnelCheck(db, funnelId, { check, sync: false, notify: async () => undefined });
    const second = await runFunnelCheck(db, funnelId, { check, sync: false, notify: async () => undefined });
    expect(second).toBeNull();
    release();
    expect(await first).not.toBeNull();
  });

  it('общий цикл ручной проверке не мешает', async () => {
    const t = addTarget('https://lp.example.ru/both', 1);
    linkTarget(t, funnelId);
    const check = async (url: string) => ({
      status: 'up' as const, httpStatus: 200, finalUrl: url, latencyMs: 1, error: '',
    });

    // Флаг общего цикла поднят — ручная проверка всё равно проходит.
    const cycle = runMonitorCycle(db, { check, sync: false, notify: async () => undefined });
    const manual = await runFunnelCheck(db, funnelId, { check, sync: false, notify: async () => undefined });
    expect(manual).not.toBeNull();
    await cycle;
  });

  it('идущая ручная проверка не мешает общему циклу', async () => {
    const t = addTarget('https://lp.example.ru/both2', 1);
    linkTarget(t, funnelId);
    const check = async (url: string) => ({
      status: 'up' as const, httpStatus: 200, finalUrl: url, latencyMs: 1, error: '',
    });

    // Зеркало предыдущего теста: на этот раз первой стартует (и не ждётся)
    // ручная проверка, а дожидаемся общего цикла — обратное направление той
    // же независимости флагов.
    const manual = runFunnelCheck(db, funnelId, { check, sync: false, notify: async () => undefined });
    const cycle = await runMonitorCycle(db, { check, sync: false, notify: async () => undefined });
    expect(cycle).not.toBeNull();
    await manual;
  });
});

/**
 * Ревью шага 9 (замер на f37, 18.09.2026): ручная проверка била по ВСЕМ целям
 * воронки без разбора, включая четыре адреса служебной группы `links`
 * (админка GetCourse вида `/pl/user/user/index?uc[segment_id]=…`) — они
 * требуют сессии и без неё отвечают 403 всегда, а группа именно поэтому
 * выключена по умолчанию. Один клик красил воронку в «упало» на семь дней
 * (STALE_AFTER_DAYS), а настоящая находка (мёртвая комната) тонула под
 * четырьмя простынями двухтысячезначных адресов. Правило теперь живёт в
 * `selectFunnelCheckTargets` (`monitor-targets.ts`), и `runFunnelCheck` — тонкая
 * обёртка над ним; три теста ниже проверяют ровно три границы правила.
 */
describe('правка 1: ручная проверка уважает дефолт группы', () => {
  it('черновик: enabled=0 у цели, но дефолт её группы включён — цель проверяется', async () => {
    // 'landings' в DEFAULT_ENABLED_SOURCE_KINDS — своя enabled=0 здесь не
    // решение по группе, а следствие hasActive=false (воронка не активна).
    const t = addKindTarget('https://lp.example.ru/draft-landing', 'landings', 0);
    linkTarget(t, funnelId);

    const asked: string[] = [];
    const check = async (url: string) => {
      asked.push(url);
      return { status: 'up' as const, httpStatus: 200, finalUrl: url, latencyMs: 1, error: '' };
    };

    await runFunnelCheck(db, funnelId, { check, sync: false, notify: async () => undefined });

    expect(asked).toEqual(['https://lp.example.ru/draft-landing']);
  });

  it('links: enabled=0 — решение по группе, ручная проверка его уважает и цель не трогает', async () => {
    const t = addKindTarget(
      'https://gc.ksamata.ru/pl/user/user/index?uc[segment_id]=1',
      'links',
      0
    );
    linkTarget(t, funnelId);

    const asked: string[] = [];
    const check = async (url: string) => {
      asked.push(url);
      return { status: 'up' as const, httpStatus: 200, finalUrl: url, latencyMs: 1, error: '' };
    };

    await runFunnelCheck(db, funnelId, { check, sync: false, notify: async () => undefined });

    expect(asked).toEqual([]);
    // Не только «не спрошено» — состояние цели тоже не тронуто.
    expect(state(t).status).toBe('unknown');
  });

  it('enabled=1 проверяется всегда, даже у links — человек включил её руками, его решение сильнее', async () => {
    const t = addKindTarget(
      'https://gc.ksamata.ru/pl/user/user/index?uc[segment_id]=2',
      'links',
      1
    );
    linkTarget(t, funnelId);

    const asked: string[] = [];
    const check = async (url: string) => {
      asked.push(url);
      return { status: 'up' as const, httpStatus: 200, finalUrl: url, latencyMs: 1, error: '' };
    };

    await runFunnelCheck(db, funnelId, { check, sync: false, notify: async () => undefined });

    expect(asked).toEqual(['https://gc.ksamata.ru/pl/user/user/index?uc[segment_id]=2']);
  });
});

/**
 * Уведомление из ручной проверки — тем же способом, что и общий цикл: своя
 * отсечка `maxEventId`, тот же `notify(db, sinceEventId)`. Без этого падение,
 * найденное кнопкой, ворует переход у ближайшего фонового цикла: тот увидит
 * статус уже изменившимся и не напишет второе событие — уведомления не будет
 * никогда, не только «с опозданием». `notify` здесь — обёртка над настоящим
 * `notifyMonitorEvents` (не голый мок, как в тестах выше), чтобы заодно
 * проверить фильтр по `enabled` конкретно в связке с ручной проверкой.
 */
describe('уведомление из ручной проверки', () => {
  const env = {
    MONITOR_TELEGRAM_BOT_TOKEN: '123:AA',
    MONITOR_TELEGRAM_CHAT_IDS: '42',
  };

  function realNotify() {
    const texts: string[] = [];
    const fetchImpl = async (_url: string, init?: { body?: string }) => {
      texts.push(JSON.parse(init?.body ?? '{}').text as string);
      return { ok: true, status: 200, text: async () => '' };
    };
    const notify = (notifyDb: AnyDB, sinceEventId: number) =>
      notifyMonitorEvents(notifyDb, sinceEventId, { env, fetchImpl });
    return { notify, texts };
  }

  it('находит падение на включённой цели и шлёт уведомление о нём — как это сделал бы общий цикл', async () => {
    const t = addTarget('https://lp.example.ru/falls', 1);
    linkTarget(t, funnelId);
    const { notify, texts } = realNotify();

    const result = await runFunnelCheck(db, funnelId, {
      check: async () => down,
      sync: false,
      sleep: noSleep,
      notify,
    });

    expect(result).not.toBeNull();
    expect(texts).toHaveLength(1);
    expect(texts[0]).toContain('https://lp.example.ru/falls');
  });

  it('находит падение на выключенной цели (черновик) и не шлёт ничего', async () => {
    // Без фильтра по enabled в notifyMonitorEvents первая проверка черновика —
    // десятки unknown → down — зашумила бы чат тем, что не падение, а
    // ненастроенная страница.
    const t = addTarget('https://lp.example.ru/draft-falls', 0);
    linkTarget(t, funnelId);
    const { notify, texts } = realNotify();

    const result = await runFunnelCheck(db, funnelId, {
      check: async () => down,
      sync: false,
      sleep: noSleep,
      notify,
    });

    expect(result).not.toBeNull();
    expect(texts).toEqual([]);
  });
});
