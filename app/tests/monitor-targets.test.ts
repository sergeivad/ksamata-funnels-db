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

/**
 * Все URL воронки — и из блоков, и из landing_url — очищаем, чтобы собрать чистый кейс.
 * Блоки удаляем целиком (не только url), а не оставляем пустыми: в реальной БД у
 * воронок уже есть блоки вида landings/links/... с уникальностью (funnel_id, kind),
 * и тестам ниже нужно свободно заводить свои блоки тех же видов под тот же funnel_id.
 */
function wipeFunnelUrls() {
  sqlite.prepare(`DELETE FROM funnel_block_items`).run();
  sqlite.prepare(`DELETE FROM funnel_blocks`).run();
  sqlite.prepare(`UPDATE funnels SET landing_url = ''`).run();
}

/**
 * Очищаем состояние мониторинга для тестов, которые проверяют абсолютные числа в stats.
 * Это нужно, чтобы исходная БД с данными в monitor_targets не влияла на ожидаемые значения.
 */
function clearMonitoringState() {
  sqlite.prepare(`DELETE FROM monitor_target_funnels`).run();
  sqlite.prepare(`DELETE FROM monitor_events`).run();
  sqlite.prepare(`DELETE FROM monitor_state`).run();
  sqlite.prepare(`DELETE FROM monitor_targets`).run();
}

function funnelIds(limit: number): number[] {
  return (sqlite.prepare(`SELECT id FROM funnels ORDER BY id LIMIT ?`).all(limit) as { id: number }[])
    .map((r) => r.id);
}

function targetRow(url: string) {
  return sqlite.prepare(`SELECT * FROM monitor_targets WHERE url = ?`).get(url) as
    | { id: number; source_kind: string; enabled: number; manual_override: number }
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
    clearMonitoringState();
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

  it('гасит все цели, когда нет ни одного URL в воронках', () => {
    clearMonitoringState();
    wipeFunnelUrls();
    const [f1, f2] = funnelIds(2);

    // Первый синк: заводим 2 цели из разных источников
    const landingBlock = sqlite
      .prepare(`INSERT INTO funnel_blocks (funnel_id, kind, enabled) VALUES (?, 'landings', 1)`)
      .run(f1).lastInsertRowid as number;
    sqlite.prepare(`INSERT INTO funnel_block_items (block_id, url) VALUES (?, ?)`)
      .run(landingBlock, 'https://lp1.example.ru/retire-all');
    sqlite.prepare(`UPDATE funnels SET landing_url = ? WHERE id = ?`)
      .run('https://lp2.example.ru/retire-all', f2);

    const firstStats = syncMonitorTargets(db);
    expect(firstStats.total).toBe(2);

    // Второй синк: стираем все URL и проверяем, что все цели гасятся
    wipeFunnelUrls();
    const secondStats = syncMonitorTargets(db);

    expect(secondStats.retired).toBe(2);
    expect(secondStats.total).toBe(0);

    // Все цели отключены
    const allTargets = sqlite
      .prepare(`SELECT id, enabled FROM monitor_targets`)
      .all() as { id: number; enabled: number }[];
    expect(allTargets.length).toBe(2);
    expect(allTargets.every((t) => t.enabled === 0)).toBe(true);

    // Все связи расторгнуты
    const linkCount = sqlite
      .prepare(`SELECT COUNT(*) AS c FROM monitor_target_funnels`)
      .get() as { c: number };
    expect(linkCount.c).toBe(0);
  });
});

/**
 * enabled раньше означал сразу две вещи — «человек выключил» и «URL пропал из
 * данных», — из-за чего пропавший и вернувшийся ленд оставался погашенным
 * навсегда. Разводит эти смыслы колонка manual_override.
 */
describe('manual_override: ручной тумблер против авто-ретайрмента', () => {
  /** Записывает URL в landing_url первой воронки (пусто — стирает). */
  function setLandingUrl(funnelId: number, url: string) {
    sqlite.prepare(`UPDATE funnels SET landing_url = ? WHERE id = ?`).run(url, funnelId);
  }

  it('снова включает ленд, который пропадал из данных и вернулся', () => {
    clearMonitoringState();
    wipeFunnelUrls();
    const [f1] = funnelIds(1);
    const url = 'https://lp.example.ru/resurrect';

    setLandingUrl(f1, url);
    syncMonitorTargets(db);
    expect(targetRow(url)?.enabled).toBe(1);

    // URL исчез на один синк — цель гаснет, но остаётся в базе.
    setLandingUrl(f1, '');
    syncMonitorTargets(db);
    expect(targetRow(url)?.enabled).toBe(0);

    // URL вернулся — цель обязана ожить сама, без ручного вмешательства.
    setLandingUrl(f1, url);
    syncMonitorTargets(db);
    expect(targetRow(url)?.enabled).toBe(1);
    expect(targetRow(url)?.manual_override).toBe(0);
  });

  it('оставляет выключенным ленд, который выключил человек', () => {
    clearMonitoringState();
    wipeFunnelUrls();
    const [f1] = funnelIds(1);
    const url = 'https://lp.example.ru/muted';

    setLandingUrl(f1, url);
    syncMonitorTargets(db);
    const target = targetRow(url)!;

    setTargetEnabled(db, target.id, false);
    expect(targetRow(url)?.manual_override).toBe(1);

    syncMonitorTargets(db);
    syncMonitorTargets(db);

    expect(targetRow(url)?.enabled).toBe(0);
  });

  it('оставляет включённой группу не-лендов, включённую человеком', () => {
    clearMonitoringState();
    wipeFunnelUrls();
    const [f1] = funnelIds(1);
    const linksBlock = sqlite
      .prepare(`INSERT INTO funnel_blocks (funnel_id, kind, enabled) VALUES (?, 'links', 1)`)
      .run(f1).lastInsertRowid as number;
    for (const u of ['https://gc.example.ru/keep1', 'https://gc.example.ru/keep2']) {
      sqlite.prepare(`INSERT INTO funnel_block_items (block_id, url) VALUES (?, ?)`).run(linksBlock, u);
    }
    syncMonitorTargets(db);

    expect(setSourceKindEnabled(db, 'links', true)).toBe(2);

    syncMonitorTargets(db);

    expect(targetRow('https://gc.example.ru/keep1')?.enabled).toBe(1);
    expect(targetRow('https://gc.example.ru/keep2')?.enabled).toBe(1);
  });

  it('держит не-ленды выключенными, пока их никто не трогал', () => {
    clearMonitoringState();
    wipeFunnelUrls();
    const [f1] = funnelIds(1);
    const linksBlock = sqlite
      .prepare(`INSERT INTO funnel_blocks (funnel_id, kind, enabled) VALUES (?, 'links', 1)`)
      .run(f1).lastInsertRowid as number;
    sqlite.prepare(`INSERT INTO funnel_block_items (block_id, url) VALUES (?, ?)`)
      .run(linksBlock, 'https://gc.example.ru/auto-off');

    syncMonitorTargets(db);
    syncMonitorTargets(db);

    expect(targetRow('https://gc.example.ru/auto-off')?.enabled).toBe(0);
  });
});

/**
 * manual_override раньше ставился безусловно при любом клике по тумблеру —
 * из-за этого «включить ленды обратно» (после авто-ретайрмента) навсегда
 * пришпиливало всю группу и глушило авто-оживление. Правильный смысл:
 * override фиксируется, только если запрошенное состояние отличается от
 * дефолта вида источника (лендам положено enabled=1, остальным — 0).
 */
describe('manual_override: фиксируется только на отклонение от дефолта', () => {
  function setLandingUrl(funnelId: number, url: string) {
    sqlite.prepare(`UPDATE funnels SET landing_url = ? WHERE id = ?`).run(url, funnelId);
  }

  it('включение группы лендов (совпадает с дефолтом) не ставит override — авто-оживление продолжает работать', () => {
    clearMonitoringState();
    wipeFunnelUrls();
    const [f1] = funnelIds(1);
    const url = 'https://lp.example.ru/group-noop';
    setLandingUrl(f1, url);
    syncMonitorTargets(db);
    expect(targetRow(url)?.enabled).toBe(1);
    expect(targetRow(url)?.manual_override).toBe(0);

    // Клик по групповому чипу «ленды» с тем же состоянием — no-op по смыслу.
    expect(setSourceKindEnabled(db, 'funnel_landing_url', true)).toBe(1);
    expect(targetRow(url)?.manual_override).toBe(0);

    // URL пропал и вернулся — авто-оживление должно сработать, override не мешает.
    setLandingUrl(f1, '');
    syncMonitorTargets(db);
    expect(targetRow(url)?.enabled).toBe(0);

    setLandingUrl(f1, url);
    syncMonitorTargets(db);
    expect(targetRow(url)?.enabled).toBe(1);
    expect(targetRow(url)?.manual_override).toBe(0);
  });

  it('выключение ленда ставит override=1 и переживает синк', () => {
    clearMonitoringState();
    wipeFunnelUrls();
    const [f1] = funnelIds(1);
    const url = 'https://lp.example.ru/disable-then-survive';
    setLandingUrl(f1, url);
    syncMonitorTargets(db);
    const target = targetRow(url)!;

    setTargetEnabled(db, target.id, false);
    expect(targetRow(url)?.enabled).toBe(0);
    expect(targetRow(url)?.manual_override).toBe(1);

    syncMonitorTargets(db);
    expect(targetRow(url)?.enabled).toBe(0);
    expect(targetRow(url)?.manual_override).toBe(1);
  });

  it('повторное включение того же ленда снимает override обратно в 0', () => {
    clearMonitoringState();
    wipeFunnelUrls();
    const [f1] = funnelIds(1);
    const url = 'https://lp.example.ru/re-enable-clears-override';
    setLandingUrl(f1, url);
    syncMonitorTargets(db);
    const target = targetRow(url)!;

    setTargetEnabled(db, target.id, false);
    expect(targetRow(url)?.manual_override).toBe(1);

    setTargetEnabled(db, target.id, true);
    expect(targetRow(url)?.enabled).toBe(1);
    expect(targetRow(url)?.manual_override).toBe(0);
  });

  it('включение группы не-лендов (отклонение от дефолта) ставит override=1 и переживает синк', () => {
    clearMonitoringState();
    wipeFunnelUrls();
    const [f1] = funnelIds(1);
    const linksBlock = sqlite
      .prepare(`INSERT INTO funnel_blocks (funnel_id, kind, enabled) VALUES (?, 'links', 1)`)
      .run(f1).lastInsertRowid as number;
    sqlite.prepare(`INSERT INTO funnel_block_items (block_id, url) VALUES (?, ?)`)
      .run(linksBlock, 'https://gc.example.ru/group-override');

    syncMonitorTargets(db);
    expect(setSourceKindEnabled(db, 'links', true)).toBe(1);
    expect(targetRow('https://gc.example.ru/group-override')?.manual_override).toBe(1);

    syncMonitorTargets(db);
    expect(targetRow('https://gc.example.ru/group-override')?.enabled).toBe(1);
    expect(targetRow('https://gc.example.ru/group-override')?.manual_override).toBe(1);
  });
});

describe('setSourceKindEnabled', () => {
  it('включает целую группу и возвращает количество затронутых целей', () => {
    clearMonitoringState();
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
