import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { runMigratePhase6 } from '../scripts/migrate-phase6';
import * as schema from '../src/db/schema';
import { clearMonitoringState } from './helpers/monitoring';
import { getMonitorDashboard, listMonitorEvents, funnelsByTarget } from '../src/lib/monitor-view';

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
  // Копия реальной БД может нести цели, заведённые локальным планировщиком, —
  // тесты ниже считают абсолютные числа, поэтому стартуем с нуля.
  clearMonitoringState(sqlite);
  db = drizzle(sqlite, { schema });
});

afterEach(() => {
  sqlite.close();
  fs.rmSync(tmp, { force: true });
});

/** Первая активная воронка фикстуры — «хозяйка» рабочих целей. */
function activeFunnel(): { id: number; num: number } {
  return sqlite
    .prepare(`SELECT id, num FROM funnels WHERE status = 'active' ORDER BY id LIMIT 1`)
    .get() as { id: number; num: number };
}

function linkToFunnel(targetId: number, funnelId: number) {
  sqlite
    .prepare(`INSERT INTO monitor_target_funnels (target_id, funnel_id) VALUES (?, ?)`)
    .run(targetId, funnelId);
}

/**
 * Делает воронку неактивной и вешает на неё URL через landing_url — так проще,
 * чем через блок: у воронок фикстуры блок `landings` уже занят.
 */
function holdUrlByFunnel(status: 'draft' | 'archive', url: string): { id: number; num: number } {
  const f = sqlite
    .prepare(`SELECT id, num FROM funnels ORDER BY id DESC LIMIT 1 OFFSET ?`)
    .get(status === 'draft' ? 0 : 1) as { id: number; num: number };
  sqlite.prepare(`UPDATE funnels SET status = ?, landing_url = ? WHERE id = ?`).run(status, url, f.id);
  return f;
}

function makeTarget(url: string, enabled: number, status: string, checkedAt: string | null) {
  const id = sqlite
    .prepare(`INSERT INTO monitor_targets (url, source_kind, enabled) VALUES (?, 'landings', ?)`)
    .run(url, enabled).lastInsertRowid as number;
  sqlite
    .prepare(`INSERT INTO monitor_state (target_id, status, checked_at) VALUES (?, ?, ?)`)
    .run(id, status, checkedAt);
  return id;
}

/**
 * Погашенная цель бывает двух сортов, и группа считает их по-разному:
 * URL за неактивной воронкой остаётся в знаменателе (вернут воронку — оживёт),
 * осиротевший не считается вовсе, иначе «41 из 45» вечно намекало бы на четыре
 * недоступные страницы, которых давно нет в данных.
 */
describe('getMonitorDashboard · кто держит цель', () => {
  it('цель активной воронки — usage active и считается в группе', () => {
    const id = makeTarget('https://live.example.ru/', 1, 'up', '2026-07-24 10:00:00');
    const f = activeFunnel();
    linkToFunnel(id, f.id);

    const { targets, sourceKinds } = getMonitorDashboard(db);
    const row = targets.find((t) => t.url === 'https://live.example.ru/')!;
    expect(row.usage).toBe('active');
    expect(row.inactiveFunnels).toEqual([]);
    const kind = sourceKinds.find((s) => s.sourceKind === 'landings')!;
    expect(kind.total).toBe(1);
    expect(kind.enabled).toBe(1);
    expect(kind.inactiveArchive).toBe(0);
  });

  it('URL за архивной воронкой остаётся в знаменателе с пометкой', () => {
    const url = 'https://archived.example.ru/';
    const f = holdUrlByFunnel('archive', url);
    makeTarget(url, 0, 'up', '2026-07-24 10:00:00');

    const { targets, sourceKinds } = getMonitorDashboard(db);
    const row = targets.find((t) => t.url === url)!;
    expect(row.usage).toBe('inactive');
    expect(row.inactiveFunnels).toEqual([{ id: f.id, num: f.num, status: 'archive' }]);

    const kind = sourceKinds.find((s) => s.sourceKind === 'landings')!;
    expect(kind.total).toBe(1);
    expect(kind.enabled).toBe(0);
    expect(kind.inactiveArchive).toBe(1);
    expect(kind.inactiveDraft).toBe(0);
  });

  it('URL за черновиком считается отдельно от архива', () => {
    const url = 'https://drafted.example.ru/';
    holdUrlByFunnel('draft', url);
    makeTarget(url, 0, 'unknown', null);

    const kind = getMonitorDashboard(db).sourceKinds.find((s) => s.sourceKind === 'landings')!;
    expect(kind.inactiveDraft).toBe(1);
    expect(kind.inactiveArchive).toBe(0);
  });

  it('осиротевший URL не считается в группе, но из списка не исчезает', () => {
    makeTarget('https://gone.example.ru/', 0, 'down', '2026-07-24 10:00:00');

    const { targets, sourceKinds } = getMonitorDashboard(db);
    const row = targets.find((t) => t.url === 'https://gone.example.ru/')!;
    expect(row.usage).toBe('orphan');
    expect(sourceKinds.find((s) => s.sourceKind === 'landings')).toBeUndefined();
  });

  it('осиротевшие не раздувают знаменатель работающей группы', () => {
    const liveId = makeTarget('https://live.example.ru/', 1, 'up', null);
    linkToFunnel(liveId, activeFunnel().id);
    makeTarget('https://ghost1.example.ru/', 0, 'down', null);
    makeTarget('https://ghost2.example.ru/', 0, 'down', null);

    const kind = getMonitorDashboard(db).sourceKinds.find((s) => s.sourceKind === 'landings')!;
    expect(kind.enabled).toBe(1);
    expect(kind.total).toBe(1);
  });
});

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
    const linksId = sqlite
      .prepare(`INSERT INTO monitor_targets (url, source_kind, enabled) VALUES ('https://g.ru/', 'links', 0)`)
      .run().lastInsertRowid as number;
    // Цель должна кем-то использоваться, иначе она осиротевшая и в счёт не идёт.
    linkToFunnel(linksId, activeFunnel().id);

    const { sourceKinds } = getMonitorDashboard(db);
    const links = sourceKinds.find((s) => s.sourceKind === 'links')!;
    expect(links.total).toBe(1);
    expect(links.enabled).toBe(0);
  });

  it('прикладывает manualOverride к цели — для переключённой вручную и для обычной', () => {
    const overriddenId = sqlite
      .prepare(
        `INSERT INTO monitor_targets (url, source_kind, enabled, manual_override) VALUES (?, 'links', 1, 1)`
      )
      .run('https://gc.example.ru/manual').lastInsertRowid as number;
    const plainId = makeTarget('https://a.ru/', 1, 'up', '2026-07-24 10:00:00');

    const { targets } = getMonitorDashboard(db);
    expect(targets.find((t) => t.id === overriddenId)?.manualOverride).toBe(true);
    expect(targets.find((t) => t.id === plainId)?.manualOverride).toBe(false);
  });

  it('цель без строки в monitor_state (LEFT JOIN) считается unknown и попадает в сводку', () => {
    // Заводим цель напрямую, минуя makeTarget — у неё умышленно нет строки monitor_state,
    // это состояние до первого прогона монитора.
    const id = sqlite
      .prepare(`INSERT INTO monitor_targets (url, source_kind, enabled) VALUES (?, 'landings', 1)`)
      .run('https://no-state.ru/').lastInsertRowid as number;

    const { targets, summary } = getMonitorDashboard(db);
    const row = targets.find((t) => t.id === id)!;
    expect(row.status).toBe('unknown');
    expect(summary.unknown).toBe(1);
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

describe('funnelsByTarget', () => {
  function seedTwoTargetsWithFunnels() {
    const idA = makeTarget('https://a.ru/', 1, 'up', null);
    const idB = makeTarget('https://b.ru/', 1, 'up', null);

    const funnelRows = sqlite.prepare(`SELECT id, num FROM funnels ORDER BY num LIMIT 2`).all() as {
      id: number;
      num: number;
    }[];
    const [funnelA, funnelB] = funnelRows;

    sqlite
      .prepare(`INSERT INTO monitor_target_funnels (target_id, funnel_id) VALUES (?, ?)`)
      .run(idA, funnelA.id);
    sqlite
      .prepare(`INSERT INTO monitor_target_funnels (target_id, funnel_id) VALUES (?, ?)`)
      .run(idB, funnelB.id);

    return { idA, idB, funnelA, funnelB };
  }

  it('без targetIds возвращает связи по всем целям', () => {
    const { idA, idB, funnelA, funnelB } = seedTwoTargetsWithFunnels();

    const map = funnelsByTarget(db);

    expect(map.size).toBe(2);
    expect(map.get(idA)).toEqual([{ id: funnelA.id, num: funnelA.num }]);
    expect(map.get(idB)).toEqual([{ id: funnelB.id, num: funnelB.num }]);
  });

  it('с targetIds отдаёт связи только по переданным целям', () => {
    const { idA, idB, funnelA } = seedTwoTargetsWithFunnels();

    const map = funnelsByTarget(db, [idA]);

    expect(map.size).toBe(1);
    expect([...map.keys()]).toEqual([idA]);
    expect(map.get(idA)).toEqual([{ id: funnelA.id, num: funnelA.num }]);
    expect(map.has(idB)).toBe(false);
  });

  it('с пустым списком targetIds возвращает пустую карту и не падает', () => {
    seedTwoTargetsWithFunnels();

    const map = funnelsByTarget(db, []);

    expect(map.size).toBe(0);
  });
});
