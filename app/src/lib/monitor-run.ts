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

    return {
      checked,
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
