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
