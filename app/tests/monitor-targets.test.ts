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
import { clearMonitoringState as clearState } from './helpers/monitoring';
import { copyDbForTest } from './helpers/db';
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
  copyDbForTest(REAL_DB, tmp);
  sqlite = new Database(tmp);
  sqlite.pragma('foreign_keys = ON');
  runMigratePhase6(sqlite);
  // Копия реальной БД может нести цели и решения по группам, заведённые локальным
  // планировщиком. Стартуем от задокументированного дефолта: ленды вкл, остальное выкл.
  clearMonitoringState();
  db = drizzle(sqlite, { schema });
});

afterEach(() => {
  sqlite.close();
  fs.rmSync(tmp, { force: true });
});

/**
 * Все URL воронки очищаем, чтобы собрать чистый кейс. Блоки удаляем целиком (не
 * только url), а не оставляем пустыми: в реальной БД у воронок уже есть блоки
 * вида landings/links/... с уникальностью (funnel_id, kind), и тестам ниже нужно
 * свободно заводить свои блоки тех же видов под тот же funnel_id.
 */
function wipeFunnelUrls() {
  sqlite.prepare(`DELETE FROM funnel_block_items`).run();
  sqlite.prepare(`DELETE FROM funnel_blocks`).run();
}

/**
 * Второй источник целей — сетка комнат (funnel_days). Тест, который хочет
 * «вообще ни одного URL в воронках», обязан стереть и её: копия реальной БД
 * несёт сотни строк комнат у активных воронок, и без этого «пусто» не пусто.
 */
function wipeRooms() {
  sqlite.prepare(`DELETE FROM funnel_days`).run();
}

/**
 * Кладёт лендинг(и) воронки — то есть строки блока «Лендинги», единственного
 * места, где адрес посадочной живёт после Phase-10. Пустой список очищает блок.
 */
function setLanding(funnelId: number, ...urls: string[]) {
  const existing = sqlite
    .prepare(`SELECT id FROM funnel_blocks WHERE funnel_id = ? AND kind = 'landings'`)
    .get(funnelId) as { id: number } | undefined;
  const blockId =
    existing?.id ??
    (sqlite
      .prepare(`INSERT INTO funnel_blocks (funnel_id, kind, enabled, mode) VALUES (?, 'landings', 1, 'common')`)
      .run(funnelId).lastInsertRowid as number);
  sqlite.prepare(`DELETE FROM funnel_block_items WHERE block_id = ?`).run(blockId);
  urls.forEach((url, i) => {
    sqlite
      .prepare(`INSERT INTO funnel_block_items (block_id, slot, label, url, position) VALUES (?, NULL, '', ?, ?)`)
      .run(blockId, url, i);
  });
}

/** Очищаем состояние мониторинга (см. tests/helpers/monitoring.ts) для текущей копии БД. */
function clearMonitoringState() {
  clearState(sqlite);
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

  it('заводит цель из блока «Лендинги» с видом landings', () => {
    wipeFunnelUrls();
    const [f1] = funnelIds(1);
    setLanding(f1, 'https://t.zdorovy-zkt.ru/jivo/rsya/a');

    syncMonitorTargets(db);

    const row = targetRow('https://t.zdorovy-zkt.ru/jivo/rsya/a');
    expect(row?.source_kind).toBe('landings');
    expect(row?.enabled).toBe(1);
  });

  it('делает отдельную цель на каждую строку блока', () => {
    wipeFunnelUrls();
    const [f1] = funnelIds(1);
    setLanding(f1, 'https://a.example.ru', 'https://b.example.ru/boo');

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
    setLanding(f1, 'https://s.example.ru/x');

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
    setLanding(f1, 'https://gone.example.ru/x');
    syncMonitorTargets(db);
    const target = targetRow('https://gone.example.ru/x')!;
    sqlite.prepare(
      `INSERT INTO monitor_events (target_id, from_status, to_status) VALUES (?, 'up', 'down')`
    ).run(target.id);

    setLanding(f1);
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
    // Комнаты — второй источник целей (задача 2): копия реальной БД несёт
    // сотни строк funnel_days у активных воронок, и без зачистки «ни одного
    // URL в воронках» было бы неправдой.
    wipeRooms();
    const [f1, f2] = funnelIds(2);

    // Первый синк: заводим 2 цели из разных источников
    const landingBlock = sqlite
      .prepare(`INSERT INTO funnel_blocks (funnel_id, kind, enabled) VALUES (?, 'landings', 1)`)
      .run(f1).lastInsertRowid as number;
    sqlite.prepare(`INSERT INTO funnel_block_items (block_id, url) VALUES (?, ?)`)
      .run(landingBlock, 'https://lp1.example.ru/retire-all');
    setLanding(f2, 'https://lp2.example.ru/retire-all');

    const firstStats = syncMonitorTargets(db);
    expect(firstStats.total).toBe(2);

    // Второй синк: стираем все URL и проверяем, что все цели гасятся
    wipeFunnelUrls();
    wipeRooms();
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
  it('снова включает ленд, который пропадал из данных и вернулся', () => {
    clearMonitoringState();
    wipeFunnelUrls();
    const [f1] = funnelIds(1);
    const url = 'https://lp.example.ru/resurrect';

    setLanding(f1, url);
    syncMonitorTargets(db);
    expect(targetRow(url)?.enabled).toBe(1);

    // URL исчез на один синк — цель гаснет, но остаётся в базе.
    setLanding(f1, '');
    syncMonitorTargets(db);
    expect(targetRow(url)?.enabled).toBe(0);

    // URL вернулся — цель обязана ожить сама, без ручного вмешательства.
    setLanding(f1, url);
    syncMonitorTargets(db);
    expect(targetRow(url)?.enabled).toBe(1);
    expect(targetRow(url)?.manual_override).toBe(0);
  });

  it('оставляет выключенным ленд, который выключил человек', () => {
    clearMonitoringState();
    wipeFunnelUrls();
    const [f1] = funnelIds(1);
    const url = 'https://lp.example.ru/muted';

    setLanding(f1, url);
    syncMonitorTargets(db);
    const target = targetRow(url)!;

    setTargetEnabled(db, target.id, false);
    expect(targetRow(url)?.manual_override).toBe(1);

    syncMonitorTargets(db);
    syncMonitorTargets(db);

    expect(targetRow(url)?.enabled).toBe(0);
  });

  /** Ссылка в блоке links: группа по умолчанию выключена, так что тумблер на ней = override. */
  function setLinksUrl(funnelId: number, url: string) {
    sqlite.prepare(`DELETE FROM funnel_block_items WHERE block_id IN (SELECT id FROM funnel_blocks WHERE funnel_id = ? AND kind = 'links')`).run(funnelId);
    sqlite.prepare(`DELETE FROM funnel_blocks WHERE funnel_id = ? AND kind = 'links'`).run(funnelId);
    if (!url) return;
    const blockId = sqlite
      .prepare(`INSERT INTO funnel_blocks (funnel_id, kind, enabled) VALUES (?, 'links', 1)`)
      .run(funnelId).lastInsertRowid as number;
    sqlite.prepare(`INSERT INTO funnel_block_items (block_id, url) VALUES (?, ?)`).run(blockId, url);
  }

  it('не гасит цель, которую человек включил вопреки дефолту группы', () => {
    clearMonitoringState();
    wipeFunnelUrls();
    const [f1] = funnelIds(1);
    const url = 'https://gc.example.ru/pinned';

    setLinksUrl(f1, url);
    syncMonitorTargets(db);
    const target = targetRow(url)!;
    expect(target.enabled).toBe(0); // группа links выключена по умолчанию

    setTargetEnabled(db, target.id, true);
    expect(targetRow(url)?.manual_override).toBe(1);

    // URL пропал из данных воронки — цель осиротела.
    setLinksUrl(f1, '');
    syncMonitorTargets(db);

    expect(targetRow(url)?.enabled).toBe(1);
  });

  it('возвращает под проверку ручную цель, чей URL пропадал и вернулся', () => {
    clearMonitoringState();
    wipeFunnelUrls();
    const [f1] = funnelIds(1);
    const url = 'https://gc.example.ru/pinned-roundtrip';

    setLinksUrl(f1, url);
    syncMonitorTargets(db);
    setTargetEnabled(db, targetRow(url)!.id, true);

    setLinksUrl(f1, '');
    syncMonitorTargets(db);
    setLinksUrl(f1, url);
    syncMonitorTargets(db);

    expect(targetRow(url)?.enabled).toBe(1);
    expect(targetRow(url)?.manual_override).toBe(1);
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
  it('включение группы лендов (совпадает с дефолтом) не ставит override — авто-оживление продолжает работать', () => {
    clearMonitoringState();
    wipeFunnelUrls();
    const [f1] = funnelIds(1);
    const url = 'https://lp.example.ru/group-noop';
    setLanding(f1, url);
    syncMonitorTargets(db);
    expect(targetRow(url)?.enabled).toBe(1);
    expect(targetRow(url)?.manual_override).toBe(0);

    // Клик по групповому чипу «ленды» с тем же состоянием — no-op по смыслу.
    expect(setSourceKindEnabled(db, 'landings', true)).toBe(1);
    expect(targetRow(url)?.manual_override).toBe(0);

    // URL пропал и вернулся — авто-оживление должно сработать, override не мешает.
    setLanding(f1, '');
    syncMonitorTargets(db);
    expect(targetRow(url)?.enabled).toBe(0);

    setLanding(f1, url);
    syncMonitorTargets(db);
    expect(targetRow(url)?.enabled).toBe(1);
    expect(targetRow(url)?.manual_override).toBe(0);
  });

  it('выключение ленда ставит override=1 и переживает синк', () => {
    clearMonitoringState();
    wipeFunnelUrls();
    const [f1] = funnelIds(1);
    const url = 'https://lp.example.ru/disable-then-survive';
    setLanding(f1, url);
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
    setLanding(f1, url);
    syncMonitorTargets(db);
    const target = targetRow(url)!;

    setTargetEnabled(db, target.id, false);
    expect(targetRow(url)?.manual_override).toBe(1);

    setTargetEnabled(db, target.id, true);
    expect(targetRow(url)?.enabled).toBe(1);
    expect(targetRow(url)?.manual_override).toBe(0);
  });

  it('включение группы не-лендов меняет дефолт группы, а не помечает цели override', () => {
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
    // Дефолт группы теперь 1, значит цель ему соответствует — отклонения нет.
    expect(targetRow('https://gc.example.ru/group-override')?.manual_override).toBe(0);

    syncMonitorTargets(db);
    expect(targetRow('https://gc.example.ru/group-override')?.enabled).toBe(1);
    expect(targetRow('https://gc.example.ru/group-override')?.manual_override).toBe(0);
  });

  it('выключение группы лендов переживает синк', () => {
    clearMonitoringState();
    wipeFunnelUrls();
    const [f1] = funnelIds(1);
    const url = 'https://lp.example.ru/group-off';
    setLanding(f1, url);
    syncMonitorTargets(db);
    expect(targetRow(url)?.enabled).toBe(1);

    setSourceKindEnabled(db, 'landings', false);

    syncMonitorTargets(db);
    syncMonitorTargets(db);

    expect(targetRow(url)?.enabled).toBe(0);
  });
});

/**
 * Главное требование задачи: ссылка, добавленная в блок уже включённой группы,
 * должна попасть под проверку сама. Раньше групповой клик правил только те цели,
 * что существовали на момент клика, и новая приходила выключенной навсегда.
 */
/**
 * Проверяются (enabled) только страницы активных воронок — их падения не шум,
 * а сигнал. Страницы черновиков и архива могут лежать на законных основаниях,
 * поэтому с 18.09.2026 они тоже заводят цель и связь (см. collectTargets),
 * просто без enabled: связь — «кто держит адрес», а не «кого проверяем».
 */
describe('enabled только у активных воронок, цель и связь — у всех статусов', () => {
  function setStatus(funnelId: number, status: string) {
    sqlite.prepare(`UPDATE funnels SET status = ? WHERE id = ?`).run(status, funnelId);
  }

  function addLanding(funnelId: number, url: string) {
    const block = sqlite
      .prepare(`INSERT INTO funnel_blocks (funnel_id, kind, enabled) VALUES (?, 'landings', 1)`)
      .run(funnelId).lastInsertRowid as number;
    sqlite.prepare(`INSERT INTO funnel_block_items (block_id, url) VALUES (?, ?)`).run(block, url);
  }

  it('заводит цели по блокам черновика и архива, но не включает их', () => {
    clearMonitoringState();
    wipeFunnelUrls();
    // Комнаты (задача 2) — второй источник целей; без зачистки активные
    // воронки в копии реальной БД принесли бы свои комнаты в подсчёт.
    wipeRooms();
    const [f1, f2, f3] = funnelIds(3);
    setStatus(f1, 'active');
    setStatus(f2, 'draft');
    setStatus(f3, 'archive');
    addLanding(f1, 'https://lp.example.ru/live');
    addLanding(f2, 'https://lp.example.ru/draft');
    addLanding(f3, 'https://lp.example.ru/archived');

    const stats = syncMonitorTargets(db);

    // Все три адреса заводят цель и связь — их держит воронка, статус не важен.
    expect(stats.total).toBe(3);
    expect(targetRow('https://lp.example.ru/live')?.enabled).toBe(1);
    expect(targetRow('https://lp.example.ru/draft')?.enabled).toBe(0);
    expect(targetRow('https://lp.example.ru/archived')?.enabled).toBe(0);
  });

  it('заводит цель за лендингом неактивной воронки, но выключенной', () => {
    clearMonitoringState();
    wipeFunnelUrls();
    const [f1] = funnelIds(1);
    setStatus(f1, 'archive');
    setLanding(f1, 'https://lp.example.ru/archived-field');

    syncMonitorTargets(db);

    const row = targetRow('https://lp.example.ru/archived-field');
    expect(row).toBeDefined();
    expect(row?.enabled).toBe(0);
  });

  it('гасит цель, когда воронку убрали из активных, и оживляет при возврате', () => {
    clearMonitoringState();
    wipeFunnelUrls();
    const [f1] = funnelIds(1);
    setStatus(f1, 'active');
    const url = 'https://lp.example.ru/status-flip';
    addLanding(f1, url);

    syncMonitorTargets(db);
    expect(targetRow(url)?.enabled).toBe(1);

    setStatus(f1, 'archive');
    syncMonitorTargets(db);
    expect(targetRow(url)?.enabled).toBe(0);
    // История цели остаётся — цель гасится, а не удаляется.
    expect(targetRow(url)).toBeDefined();

    setStatus(f1, 'active');
    syncMonitorTargets(db);
    expect(targetRow(url)?.enabled).toBe(1);
  });

  it('оставляет под проверкой URL, который делят активная и архивная воронки, и связывает с обеими', () => {
    clearMonitoringState();
    wipeFunnelUrls();
    const [f1, f2] = funnelIds(2);
    setStatus(f1, 'active');
    setStatus(f2, 'archive');
    const url = 'https://lp.example.ru/shared-mixed';
    addLanding(f1, url);
    addLanding(f2, url);

    syncMonitorTargets(db);

    const target = targetRow(url)!;
    expect(target.enabled).toBe(1);
    // Связь — «кто держит адрес», а не «кого проверяем»: числятся обе. Раньше
    // в связях оставалась только активная, и это было прежним смыслом
    // monitor_target_funnels — с 18.09.2026 он другой (см. collectTargets).
    const links = sqlite
      .prepare(`SELECT funnel_id FROM monitor_target_funnels WHERE target_id = ? ORDER BY funnel_id`)
      .all(target.id) as { funnel_id: number }[];
    expect(links.map((l) => l.funnel_id)).toEqual([f1, f2].sort((a, b) => a - b));
  });
});

describe('предпочтение группы наследуется новыми целями', () => {
  /** Заводит блок нужного вида под первой воронкой и возвращает его id. */
  function makeBlock(funnelId: number, kind: string): number {
    return sqlite
      .prepare(`INSERT INTO funnel_blocks (funnel_id, kind, enabled) VALUES (?, ?, 1)`)
      .run(funnelId, kind).lastInsertRowid as number;
  }

  function addUrl(blockId: number, url: string) {
    sqlite.prepare(`INSERT INTO funnel_block_items (block_id, url) VALUES (?, ?)`).run(blockId, url);
  }

  it('заводит включённой ссылку, добавленную в группу после её включения', () => {
    clearMonitoringState();
    wipeFunnelUrls();
    const [f1] = funnelIds(1);
    const block = makeBlock(f1, 'tariffs');
    addUrl(block, 'https://pay.example.ru/first');

    syncMonitorTargets(db);
    setSourceKindEnabled(db, 'tariffs', true);

    // Ссылка появилась уже после того, как группу включили.
    addUrl(block, 'https://pay.example.ru/second');
    syncMonitorTargets(db);

    expect(targetRow('https://pay.example.ru/second')?.enabled).toBe(1);
    expect(targetRow('https://pay.example.ru/second')?.manual_override).toBe(0);
  });

  it('заводит включённой ссылку в новой воронке, если её группа включена', () => {
    clearMonitoringState();
    wipeFunnelUrls();
    const [f1, f2] = funnelIds(2);
    addUrl(makeBlock(f1, 'oto'), 'https://oto.example.ru/old');

    syncMonitorTargets(db);
    setSourceKindEnabled(db, 'oto', true);

    addUrl(makeBlock(f2, 'oto'), 'https://oto.example.ru/new-funnel');
    syncMonitorTargets(db);

    expect(targetRow('https://oto.example.ru/new-funnel')?.enabled).toBe(1);
  });

  it('оставляет выключенной новую ссылку в группе, которую не включали', () => {
    clearMonitoringState();
    wipeFunnelUrls();
    const [f1] = funnelIds(1);
    const block = makeBlock(f1, 'bonuses');

    syncMonitorTargets(db);
    addUrl(block, 'https://bonus.example.ru/untouched');
    syncMonitorTargets(db);

    expect(targetRow('https://bonus.example.ru/untouched')?.enabled).toBe(0);
  });

  it('клик по группе снимает точечный тумблер внутри неё', () => {
    clearMonitoringState();
    wipeFunnelUrls();
    const [f1] = funnelIds(1);
    const block = makeBlock(f1, 'processes');
    addUrl(block, 'https://proc.example.ru/muted');
    addUrl(block, 'https://proc.example.ru/plain');

    syncMonitorTargets(db);
    const muted = targetRow('https://proc.example.ru/muted')!;
    setTargetEnabled(db, muted.id, true);
    expect(targetRow('https://proc.example.ru/muted')?.manual_override).toBe(1);

    // Групповое решение перебивает точечное — иначе «выключить группу»
    // оставляло бы в ней включённые цели без всякого объяснения.
    setSourceKindEnabled(db, 'processes', false);

    expect(targetRow('https://proc.example.ru/muted')?.enabled).toBe(0);
    expect(targetRow('https://proc.example.ru/muted')?.manual_override).toBe(0);
    expect(targetRow('https://proc.example.ru/plain')?.enabled).toBe(0);
  });

  it('точечный тумблер переживает синк, пока по группе не кликали', () => {
    clearMonitoringState();
    wipeFunnelUrls();
    const [f1] = funnelIds(1);
    // 'upsell' сюда не годится с 18.09.2026 — он теперь в DEFAULT_ENABLED_SOURCE_KINDS,
    // и «включить» стало бы совпадением с дефолтом группы, а не отклонением от
    // него (override тогда не ставился бы, и тест проверял бы не то). 'links' —
    // служебная группа, остаётся выключенной по умолчанию, что и нужно тесту.
    addUrl(makeBlock(f1, 'links'), 'https://med.example.ru/single');

    syncMonitorTargets(db);
    const target = targetRow('https://med.example.ru/single')!;
    setTargetEnabled(db, target.id, true);

    syncMonitorTargets(db);

    expect(targetRow('https://med.example.ru/single')?.enabled).toBe(1);
    expect(targetRow('https://med.example.ru/single')?.manual_override).toBe(1);
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

describe('комнаты как цели', () => {
  /** Кладёт одну строку сетки комнат. Все прочие колонки funnel_days — по умолчанию. */
  function setRoom(funnelId: number, slot: '15' | '19', day: number,
                   gc: string, web: string, replay = '') {
    sqlite.prepare(`DELETE FROM funnel_days WHERE funnel_id = ? AND time_slot = ? AND day_num = ?`)
      .run(funnelId, slot, day);
    sqlite.prepare(
      `INSERT INTO funnel_days (funnel_id, time_slot, day_num, gc_room, web_room, replay_url)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(funnelId, slot, day, gc, web, replay);
  }

  function wipeRooms() {
    sqlite.prepare(`DELETE FROM funnel_days`).run();
  }

  function activeFunnelId(): number {
    return (sqlite.prepare(`SELECT id FROM funnels WHERE status = 'active' LIMIT 1`)
      .get() as { id: number }).id;
  }

  function kindOf(url: string): string | undefined {
    return (sqlite.prepare(`SELECT source_kind FROM monitor_targets WHERE url = ?`)
      .get(url) as { source_kind: string } | undefined)?.source_kind;
  }

  function enabledOf(url: string): number | undefined {
    return (sqlite.prepare(`SELECT enabled FROM monitor_targets WHERE url = ?`)
      .get(url) as { enabled: number } | undefined)?.enabled;
  }

  it('заводит цели трёх видов из сетки комнат', () => {
    wipeFunnelUrls();
    wipeRooms();
    const id = activeFunnelId();
    sqlite.prepare(`UPDATE funnels SET rooms_enabled = 1, rooms_replay_enabled = 1 WHERE id = ?`).run(id);
    setRoom(id, '15', 1,
      'https://gc.ksamata.ru/tst1-15', 'https://web.ksamatacenter.com/room/tst1-15',
      'https://gc.ksamata.ru/tst1-15r');

    syncMonitorTargets(db);

    expect(kindOf('https://gc.ksamata.ru/tst1-15')).toBe('room_gc');
    expect(kindOf('https://web.ksamatacenter.com/room/tst1-15')).toBe('room_web');
    expect(kindOf('https://gc.ksamata.ru/tst1-15r')).toBe('room_replay');
  });

  it('комнаты проверяются по умолчанию', () => {
    wipeFunnelUrls();
    wipeRooms();
    const id = activeFunnelId();
    sqlite.prepare(`UPDATE funnels SET rooms_enabled = 1 WHERE id = ?`).run(id);
    setRoom(id, '15', 1, 'https://gc.ksamata.ru/tst2-15', 'https://web.ksamatacenter.com/room/tst2-15');

    syncMonitorTargets(db);

    expect(enabledOf('https://web.ksamatacenter.com/room/tst2-15')).toBe(1);
  });

  it('воронка без эфиров комнат не отдаёт', () => {
    wipeFunnelUrls();
    wipeRooms();
    const id = activeFunnelId();
    sqlite.prepare(`UPDATE funnels SET rooms_enabled = 0 WHERE id = ?`).run(id);
    setRoom(id, '15', 1, 'https://gc.ksamata.ru/tst3-15', 'https://web.ksamatacenter.com/room/tst3-15');

    syncMonitorTargets(db);

    expect(kindOf('https://gc.ksamata.ru/tst3-15')).toBeUndefined();
  });

  it('снятый повтор не отдаёт только повтор, комнаты остаются', () => {
    wipeFunnelUrls();
    wipeRooms();
    const id = activeFunnelId();
    sqlite.prepare(`UPDATE funnels SET rooms_enabled = 1, rooms_replay_enabled = 0 WHERE id = ?`).run(id);
    setRoom(id, '15', 1,
      'https://gc.ksamata.ru/tst4-15', 'https://web.ksamatacenter.com/room/tst4-15',
      'https://gc.ksamata.ru/tst4-15r');

    syncMonitorTargets(db);

    expect(kindOf('https://gc.ksamata.ru/tst4-15')).toBe('room_gc');
    expect(kindOf('https://gc.ksamata.ru/tst4-15r')).toBeUndefined();
  });

  it('продажные группы блоков тоже включены по умолчанию', () => {
    wipeFunnelUrls();
    wipeRooms();
    const id = activeFunnelId();
    const blockId = sqlite.prepare(
      `INSERT INTO funnel_blocks (funnel_id, kind, enabled, mode) VALUES (?, 'tariffs', 1, 'common')`
    ).run(id).lastInsertRowid as number;
    sqlite.prepare(
      `INSERT INTO funnel_block_items (block_id, slot, label, url, position) VALUES (?, NULL, '', ?, 0)`
    ).run(blockId, 'https://t.ksamata.ru/tst-tariff');

    syncMonitorTargets(db);

    expect(enabledOf('https://t.ksamata.ru/tst-tariff')).toBe(1);
  });

  it('служебные «Ссылки» по умолчанию не проверяются', () => {
    wipeFunnelUrls();
    wipeRooms();
    const id = activeFunnelId();
    const blockId = sqlite.prepare(
      `INSERT INTO funnel_blocks (funnel_id, kind, enabled, mode) VALUES (?, 'links', 1, 'common')`
    ).run(id).lastInsertRowid as number;
    sqlite.prepare(
      `INSERT INTO funnel_block_items (block_id, slot, label, url, position) VALUES (?, NULL, 'Дашборд', ?, 0)`
    ).run(blockId, 'https://gc.ksamata.ru/dash/tst');

    syncMonitorTargets(db);

    expect(enabledOf('https://gc.ksamata.ru/dash/tst')).toBe(0);
  });
});

describe('счётчик retired', () => {
  it('считает списанные в этот прогон, а не все погашенные разом', () => {
    clearMonitoringState();
    wipeFunnelUrls();
    const [f1] = funnelIds(1);
    setLanding(f1, 'https://retired-once.example.ru/x');
    syncMonitorTargets(db);

    setLanding(f1);
    expect(syncMonitorTargets(db).retired, 'первый синк действительно списывает').toBe(1);

    // Цель уже погашена — второй синк не списывает её заново.
    expect(syncMonitorTargets(db).retired, 'повторный синк ничего не списывает').toBe(0);
  });

  it('не переписывает updatedAt у давно погашенной цели', () => {
    clearMonitoringState();
    wipeFunnelUrls();
    const [f1] = funnelIds(1);
    setLanding(f1, 'https://stale-stamp.example.ru/x');
    syncMonitorTargets(db);
    setLanding(f1);
    syncMonitorTargets(db);

    const id = targetRow('https://stale-stamp.example.ru/x')!.id;
    sqlite.prepare(`UPDATE monitor_targets SET updated_at = '2020-01-01 00:00:00' WHERE id = ?`).run(id);

    syncMonitorTargets(db);

    const after = sqlite
      .prepare(`SELECT updated_at AS u FROM monitor_targets WHERE id = ?`)
      .get(id) as { u: string };
    expect(after.u, 'штамп погашенной цели не должен обновляться каждым синком')
      .toBe('2020-01-01 00:00:00');
  });
});

describe('связи и включённость разведены', () => {
  function funnelsOf(url: string): number[] {
    return (sqlite.prepare(
      `SELECT f.funnel_id AS id FROM monitor_target_funnels f
         JOIN monitor_targets t ON t.id = f.target_id WHERE t.url = ?`
    ).all(url) as { id: number }[]).map((r) => r.id);
  }

  it('адрес черновика получает цель и связь, но не проверяется', () => {
    wipeFunnelUrls();
    // Черновик заводим сами: в репозиторной базе их ноль (59 active, 20 archive),
    // и ждать его от живых данных значило бы опереть тест на изменяемое деловое
    // значение — CLAUDE.md это прямо запрещает. Копия базы одноразовая.
    const draftId = (sqlite.prepare(`SELECT id FROM funnels WHERE status = 'archive' LIMIT 1`)
      .get() as { id: number }).id;
    sqlite.prepare(`UPDATE funnels SET status = 'draft' WHERE id = ?`).run(draftId);
    setLanding(draftId, 'https://lp.example.ru/draft-only');

    syncMonitorTargets(db);

    const row = sqlite.prepare(`SELECT enabled FROM monitor_targets WHERE url = ?`)
      .get('https://lp.example.ru/draft-only') as { enabled: number } | undefined;
    expect(row?.enabled).toBe(0);
    expect(funnelsOf('https://lp.example.ru/draft-only')).toEqual([draftId]);
    // Контроль: правило именно про статус, а не про то, что цель не завелась.
    expect(row).toBeDefined();
  });

  it('адрес, который держат активная и архивная, проверяется и связан с обеими', () => {
    wipeFunnelUrls();
    const active = (sqlite.prepare(`SELECT id FROM funnels WHERE status = 'active' LIMIT 1`)
      .get() as { id: number }).id;
    const archived = (sqlite.prepare(`SELECT id FROM funnels WHERE status = 'archive' LIMIT 1`)
      .get() as { id: number }).id;
    setLanding(active, 'https://lp.example.ru/shared');
    setLanding(archived, 'https://lp.example.ru/shared');

    syncMonitorTargets(db);

    const row = sqlite.prepare(`SELECT enabled FROM monitor_targets WHERE url = ?`)
      .get('https://lp.example.ru/shared') as { enabled: number };
    expect(row.enabled).toBe(1);
    expect(funnelsOf('https://lp.example.ru/shared').sort()).toEqual([active, archived].sort());
  });

  it('адрес, которого нет уже ни у кого, отвязывается и гаснет', () => {
    wipeFunnelUrls();
    const active = (sqlite.prepare(`SELECT id FROM funnels WHERE status = 'active' LIMIT 1`)
      .get() as { id: number }).id;
    setLanding(active, 'https://lp.example.ru/will-vanish');
    syncMonitorTargets(db);

    setLanding(active);
    syncMonitorTargets(db);

    const row = sqlite.prepare(`SELECT enabled FROM monitor_targets WHERE url = ?`)
      .get('https://lp.example.ru/will-vanish') as { enabled: number };
    expect(row.enabled).toBe(0);
    expect(funnelsOf('https://lp.example.ru/will-vanish')).toEqual([]);
  });
});
