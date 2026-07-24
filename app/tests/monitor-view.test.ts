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
