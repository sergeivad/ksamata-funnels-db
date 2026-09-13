import { eq, sql } from 'drizzle-orm';
import { type AnyDB } from '../db/client';
import { monitorTargets, monitorState, monitorEvents } from '../db/schema';
import { checkUrl, type CheckFn, type CheckResult } from './monitor-check';
import { syncMonitorTargets } from './monitor-targets';
import { notifyMonitorEvents } from './monitor-notify';

export const RETRY_DELAY_MS = 3_000;
export const CONCURRENCY = 8;

/**
 * Сколько держим историю смен статуса. `monitor_events` пишется только на
 * ПЕРЕХОД, но «мигающая» цель даёт под две сотни строк в сутки, а целей около
 * шестисот — без границы таблица не перестанет расти никогда. Квартала хватает,
 * чтобы разобрать «когда этот ленд начал падать»; всё, что старше, не читает
 * никто. Индекс по `at` уже есть, удаление дешёвое.
 */
export const EVENT_RETENTION_DAYS = 90;

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
  /** Уведомление по итогам прогона. Подменяется в тестах — сети там нет. */
  notify?: NotifyFn;
}

/** Получает отсечку `monitor_events.id`, снятую перед прогоном. */
export type NotifyFn = (db: AnyDB, sinceEventId: number) => Promise<unknown>;

// Одиночный флаг на процесс: планировщик и ручная кнопка не должны наложиться.
// Живёт на globalThis, а не в модуле: webpack кладёт этот модуль в два разных
// чанка (граф instrumentation.ts для планировщика и граф route-хендлеров для
// кнопки), и модульная переменная дала бы два независимых флага — защита от
// наложения работала бы только в тестах, где инстанс модуля один.
interface MonitorRunState {
  cycleRunning: boolean;
}

declare global {
  // eslint-disable-next-line no-var
  var __ksamataMonitorRun: MonitorRunState | undefined;
}

/** Читаем слот каждый раз, а не кэшируем ссылку — иначе подмена объекта не видна. */
function runState(): MonitorRunState {
  if (!globalThis.__ksamataMonitorRun) {
    globalThis.__ksamataMonitorRun = { cycleRunning: false };
  }
  return globalThis.__ksamataMonitorRun;
}

export function isCycleRunning(): boolean {
  return runState().cycleRunning;
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

/**
 * Чистим историю по завершении цикла, а не по таймеру: цикл — единственный
 * писатель этой таблицы, и в проде он и так идёт каждые 15 минут. Отдельный
 * планировщик уборки ради этого заводить незачем.
 */
export function pruneEvents(db: AnyDB, retentionDays = EVENT_RETENTION_DAYS): number {
  const res = db
    .delete(monitorEvents)
    .where(sql`${monitorEvents.at} < datetime('now', ${'-' + retentionDays + ' days'})`)
    .run();
  return Number((res as { changes?: number }).changes ?? 0);
}

/** Последний id журнала смен статуса; 0 на пустой таблице. */
function maxEventId(db: AnyDB): number {
  const row = db
    .select({ max: sql<number>`COALESCE(MAX(${monitorEvents.id}), 0)` })
    .from(monitorEvents)
    .get() as { max: number } | undefined;
  return row?.max ?? 0;
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
  const state = runState();
  if (state.cycleRunning) return null;
  state.cycleRunning = true;

  const check: CheckFn = opts.check ?? ((url) => checkUrl(url));
  const concurrency = opts.concurrency ?? CONCURRENCY;
  const retryDelayMs = opts.retryDelayMs ?? RETRY_DELAY_MS;
  const sleep = opts.sleep ?? defaultSleep;
  const notify = opts.notify ?? notifyMonitorEvents;
  const startedAt = new Date().toISOString();

  const tally = { up: 0, slow: 0, down: 0 };

  try {
    // Отсечку журнала снимаем ДО проверок: всё, что появится после неё, и есть
    // смены статуса этого прогона. Сравниваем по id, а не по времени — в
    // таблице UTC-строки SQLite с точностью до секунды, и два цикла подряд
    // (кнопка «проверить» сразу после планировщика) по времени не разделить.
    const sinceEventId = maxEventId(db);

    if (opts.sync !== false) syncMonitorTargets(db);

    const targets = db
      .select({ id: monitorTargets.id, url: monitorTargets.url })
      .from(monitorTargets)
      .where(eq(monitorTargets.enabled, 1))
      .all() as TargetRow[];

    let cursor = 0;
    let checked = 0;
    const worker = async () => {
      for (;;) {
        const index = cursor;
        cursor += 1;
        if (index >= targets.length) return;
        const target = targets[index];
        try {
          const result = await checkWithRetry(target.url, check, retryDelayMs, sleep);
          persist(db, target, result);
          tally[result.status] += 1;
          checked += 1;
        } catch (err) {
          // Изоляция сбоя одной цели: без try/catch необработанное исключение
          // валит Promise.all, «осиротевшие» воркеры продолжают писать в БД,
          // а cycleRunning в finally уже снят — следующий вызов запустит
          // реально наложившийся цикл. Одна плохая цель не должна ронять весь прогон.
          console.error(`monitor: цель ${target.url} упала с ошибкой`, err);
        }
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(concurrency, Math.max(targets.length, 1)) }, worker)
    );

    pruneEvents(db);

    // Уведомление не вправе ронять проверки: Telegram недоступен чаще, чем
    // наши ленды, и упавший цикл означал бы, что мы перестали замечать падения
    // вообще. Поэтому ошибка только в лог.
    try {
      await notify(db, sinceEventId);
    } catch (err) {
      console.error('[monitor] уведомление не ушло', err);
    }

    return {
      checked,
      up: tally.up,
      slow: tally.slow,
      down: tally.down,
      startedAt,
      finishedAt: new Date().toISOString(),
    };
  } finally {
    // Снимаем флаг в том же слоте, из которого его читали — на случай, если
    // globalThis.__ksamataMonitorRun подменили между стартом и финишем.
    state.cycleRunning = false;
  }
}
