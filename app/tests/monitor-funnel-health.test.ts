/**
 * Состояние воронки. Цели и статусы заводим руками: проверяется правило
 * агрегации, а не сбор.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { runMigratePhase6 } from '../scripts/migrate-phase6';
import * as schema from '../src/db/schema';
import { clearMonitoringState } from './helpers/monitoring';
import { copyDbForTest } from './helpers/db';
import { getFunnelHealth, STALE_AFTER_DAYS } from '../src/lib/monitor-funnel-health';
import { funnelHealthTone, funnelHealthPillLabel } from '../src/lib/funnel-health';

const REAL_DB = path.resolve(process.cwd(), '..', 'ksamata_funnels.db');
const NOW = Date.parse('2026-09-18T12:00:00Z');
let tmp: string;
let sqlite: Database.Database;
let db: ReturnType<typeof drizzle<typeof schema>>;
let funnelId: number;

/** SQLite пишет UTC без зоны: 'YYYY-MM-DD HH:MM:SS'. */
function sqliteTime(ms: number): string {
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
}

function addTarget(
  url: string,
  enabled: 0 | 1,
  status: string | null,
  checkedAtMs: number | null,
  sourceKind = 'landings',
) {
  const id = sqlite.prepare(
    `INSERT INTO monitor_targets (url, source_kind, enabled) VALUES (?, ?, ?)`
  ).run(url, sourceKind, enabled).lastInsertRowid as number;
  sqlite.prepare(`INSERT INTO monitor_target_funnels (target_id, funnel_id) VALUES (?, ?)`)
    .run(id, funnelId);
  if (status !== null) {
    sqlite.prepare(`INSERT INTO monitor_state (target_id, status, checked_at) VALUES (?, ?, ?)`)
      .run(id, status, checkedAtMs === null ? null : sqliteTime(checkedAtMs));
  }
  return id;
}

beforeEach(() => {
  tmp = path.join(os.tmpdir(), `fh-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  copyDbForTest(REAL_DB, tmp);
  sqlite = new Database(tmp);
  sqlite.pragma('foreign_keys = ON');
  runMigratePhase6(sqlite);
  clearMonitoringState(sqlite);
  db = drizzle(sqlite, { schema });
  funnelId = (sqlite.prepare(`SELECT id FROM funnels WHERE status = 'active' LIMIT 1`)
    .get() as { id: number }).id;
});

afterEach(() => {
  sqlite.close();
  fs.rmSync(tmp, { force: true });
});

describe('состояние воронки', () => {
  it('считает свежие падения', () => {
    addTarget('https://lp.example.ru/a', 1, 'down', NOW - 60_000);
    addTarget('https://lp.example.ru/b', 1, 'up', NOW - 60_000);

    const h = getFunnelHealth(db, [funnelId], NOW).get(funnelId)!;
    expect(h.down).toBe(1);
    expect(h.enabled).toBe(2);
    expect(h.total).toBe(2);
    expect(funnelHealthTone(h)).toBe('down');
  });

  it('падение старше недели пилюлю не зажигает', () => {
    const old = NOW - (STALE_AFTER_DAYS + 1) * 86_400_000;
    addTarget('https://lp.example.ru/stale', 1, 'down', old);

    const h = getFunnelHealth(db, [funnelId], NOW).get(funnelId)!;
    expect(h.down).toBe(0);
    expect(funnelHealthTone(h)).toBe('ok');
  });

  it('выключенная цель включённой группы в падении всё равно считается', () => {
    // Так выглядит черновик: дефолт группы включён, а enabled = 0 потому,
    // что адрес не держит ни одна активная воронка. Ручная проверка такую
    // цель берёт, значит и пилюля обязана её считать.
    addTarget('https://lp.example.ru/off', 0, 'down', NOW - 60_000);

    const h = getFunnelHealth(db, [funnelId], NOW).get(funnelId)!;
    expect(h.down).toBe(1);
    expect(h.enabled).toBe(0);
  });

  it('падение в выключенной по умолчанию группе пилюлю не зажигает', () => {
    // `links` — админские страницы GetCourse, отвечающие 403 всегда; ручная
    // проверка их пропускает, и гореть пилюле было бы нечем перепроверить.
    addTarget('https://gc.example.ru/pl/user', 0, 'down', NOW - 60_000, 'links');

    const h = getFunnelHealth(db, [funnelId], NOW).get(funnelId)!;
    expect(h.down).toBe(0);
    expect(h.total).toBe(1);
    expect(funnelHealthTone(h)).toBe('ok');
  });

  it('включённая вручную цель выключенной группы считается', () => {
    addTarget('https://gc.example.ru/pl/on', 1, 'down', NOW - 60_000, 'links');

    const h = getFunnelHealth(db, [funnelId], NOW).get(funnelId)!;
    expect(h.down).toBe(1);
  });

  it('группа, выключенная человеком, падений не даёт', () => {
    // Решение по группе главнее дефолта — то же правило, что в синке.
    sqlite.prepare(
      `INSERT INTO monitor_source_kind_prefs (source_kind, enabled) VALUES ('landings', 0)`
    ).run();
    addTarget('https://lp.example.ru/muted', 0, 'down', NOW - 60_000);

    const h = getFunnelHealth(db, [funnelId], NOW).get(funnelId)!;
    expect(h.down).toBe(0);
  });

  it('выключенная непроверенная цель пробелом не считается', () => {
    addTarget('https://lp.example.ru/never-off', 0, 'unknown', null);

    const h = getFunnelHealth(db, [funnelId], NOW).get(funnelId)!;
    expect(h.unknown).toBe(0);
    expect(funnelHealthTone(h)).toBe('ok');
  });

  it('включённая непроверенная цель даёт «не проверялось»', () => {
    addTarget('https://lp.example.ru/never-on', 1, 'unknown', null);

    const h = getFunnelHealth(db, [funnelId], NOW).get(funnelId)!;
    expect(h.unknown).toBe(1);
    expect(funnelHealthTone(h)).toBe('unknown');
  });

  it('падение важнее непроверенного', () => {
    addTarget('https://lp.example.ru/x', 1, 'down', NOW - 60_000);
    addTarget('https://lp.example.ru/y', 1, 'unknown', null);

    expect(funnelHealthTone(getFunnelHealth(db, [funnelId], NOW).get(funnelId)!)).toBe('down');
  });

  it('пустой список воронок не строит запрос', () => {
    expect(getFunnelHealth(db, [], NOW).size).toBe(0);
  });
});

describe('подпись пилюли', () => {
  const h = (down: number, unknown: number) =>
    ({ down, unknown, enabled: 5, total: 7, lastCheckedAt: null });

  it('падения считает числом', () => {
    expect(funnelHealthPillLabel(h(3, 0))).toBe('Проверить · 3');
  });

  it('одно падение — тоже с числом, чтобы подпись не прыгала', () => {
    expect(funnelHealthPillLabel(h(1, 0))).toBe('Проверить · 1');
  });

  it('без падений, но без проверок — «Не проверялось»', () => {
    expect(funnelHealthPillLabel(h(0, 2))).toBe('Не проверялось');
  });

  it('всё живо — пустая подпись', () => {
    expect(funnelHealthPillLabel(h(0, 0))).toBe('');
  });
});
