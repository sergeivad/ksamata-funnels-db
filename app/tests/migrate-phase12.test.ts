/**
 * Фаза 12 — признак «есть эфиры по времени» у типа воронки и снятие тегов
 * времени с воронок безвременных типов.
 *
 * Каждый тест работает на своей копии реальной базы: фаза заводит колонку, а
 * ключевое её поведение (бэкфилл только в прогон, заводящий колонку) на
 * повторном прогоне уже не воспроизводится.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { copyDbForTest } from './helpers/db';
import * as schema from '../src/db/schema';
import { runMigratePhase12 } from '../scripts/migrate-phase12';
import { TIMELESS_FUNNEL_TYPES } from '../src/lib/funnel-type';
import { resyncFunnelAvTags } from '../src/lib/funnels';

let dir: string;
let sqlite: Database.Database;

/**
 * Состояние «до фазы 12» строится тестом явно, а не берётся из копии живой
 * базы: та фазу уже прошла, и «колонки ещё нет» перестало бы быть правдой в
 * тот день, когда миграцию прогнали на репозиторной базе (ровно это и
 * случилось). Колонка сносится, а тег времени вешается на воронку
 * безвременного типа руками — тогда тест проверяет поведение фазы, а не
 * сегодняшние данные.
 */
function undoPhase12(): void {
  const hasColumn = (sqlite.prepare(`PRAGMA table_info(funnel_types)`).all() as { name: string }[])
    .some((r) => r.name === 'has_time');
  if (hasColumn) sqlite.exec('ALTER TABLE funnel_types DROP COLUMN has_time');

  // Воронка типа «АВ Прямые» с тегом «АВ Время: 15» — то, что фаза обязана снять.
  const funnel = sqlite
    .prepare(
      `SELECT f.id FROM funnels f JOIN funnel_types t ON t.id = f.funnel_type_id
        WHERE t.name = 'АВ Прямые' LIMIT 1`
    )
    .get() as { id: number } | undefined;
  const tag = sqlite.prepare(`SELECT id FROM tags WHERE name = 'АВ Время: 15'`).get() as
    | { id: number }
    | undefined;
  if (!funnel || !tag) throw new Error('фикстура сломана: нет воронки «АВ Прямые» или тега времени');
  sqlite
    .prepare(
      `INSERT OR IGNORE INTO funnel_tags (funnel_id, tag_id, tag_type, position)
       VALUES (?, ?, 'time_15', 99)`
    )
    .run(funnel.id, tag.id);
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'phase12-'));
  const dbPath = join(dir, 'test.db');
  copyDbForTest(join(__dirname, '../../ksamata_funnels.db'), dbPath);
  sqlite = new Database(dbPath);
  sqlite.pragma('foreign_keys = ON');
  undoPhase12();
});

afterEach(() => {
  sqlite.close();
  rmSync(dir, { recursive: true, force: true });
});

const columns = () =>
  (sqlite.prepare(`PRAGMA table_info(funnel_types)`).all() as { name: string }[]).map((r) => r.name);

const hasTimeOf = (name: string) =>
  (sqlite.prepare(`SELECT has_time FROM funnel_types WHERE name = ?`).get(name) as
    | { has_time: number }
    | undefined)?.has_time;

/** Строки funnel_tags с тегом времени у воронок безвременных типов. */
function timeRowsOnTimelessFunnels(): number {
  return (
    sqlite
      .prepare(
        `SELECT COUNT(*) AS c
           FROM funnel_tags ft
           JOIN tags t ON t.id = ft.tag_id
           JOIN funnels f ON f.id = ft.funnel_id
           JOIN funnel_types ty ON ty.id = f.funnel_type_id
          WHERE t.name LIKE 'АВ Время: %' AND ty.has_time = 0`
      )
      .get() as { c: number }
  ).c;
}

/** Все строки funnel_tags как сравнимый снимок. */
function tagSnapshot(): string[] {
  return (
    sqlite
      .prepare(
        `SELECT ft.funnel_id AS f, ft.tag_type AS ty, t.name AS n
           FROM funnel_tags ft JOIN tags t ON t.id = ft.tag_id
          ORDER BY ft.funnel_id, ft.tag_type, t.name`
      )
      .all() as { f: number; ty: string; n: string }[]
  ).map((r) => `${r.f}|${r.ty}|${r.n}`);
}

describe('фаза 12', () => {
  it('заводит колонку has_time', () => {
    expect(columns()).not.toContain('has_time');
    runMigratePhase12(sqlite);
    expect(columns()).toContain('has_time');
  });

  it('ставит ноль безвременным маркерам и оставляет единицу вебинарным', () => {
    const result = runMigratePhase12(sqlite);
    for (const name of TIMELESS_FUNNEL_TYPES) {
      // В живой базе может не быть какого-то из маркеров — проверяем только те,
      // что есть; отсутствующий и пометить нечем.
      const value = hasTimeOf(name);
      if (value !== undefined) expect(value, name).toBe(0);
    }
    expect(hasTimeOf('АВ Автоворонка')).toBe(1);
    expect(result.typesMarked).toBeGreaterThan(0);
  });

  it('снимает теги времени с воронок безвременных типов', () => {
    const result = runMigratePhase12(sqlite);
    expect(result.tagRowsRemoved).toBeGreaterThan(0);
    expect(timeRowsOnTimelessFunnels()).toBe(0);
  });

  it('не трогает теги времени у вебинарных воронок', () => {
    const before = (
      sqlite
        .prepare(
          `SELECT COUNT(*) AS c FROM funnel_tags ft JOIN tags t ON t.id = ft.tag_id
             WHERE t.name LIKE 'АВ Время: %'`
        )
        .get() as { c: number }
    ).c;
    const { tagRowsRemoved } = runMigratePhase12(sqlite);
    const after = (
      sqlite
        .prepare(
          `SELECT COUNT(*) AS c FROM funnel_tags ft JOIN tags t ON t.id = ft.tag_id
             WHERE t.name LIKE 'АВ Время: %'`
        )
        .get() as { c: number }
    ).c;
    expect(after).toBe(before - tagRowsRemoved);
    expect(after).toBeGreaterThan(0);
  });

  it('сам тег «АВ Время: …» из справочника тегов не удаляет', () => {
    runMigratePhase12(sqlite);
    const left = (
      sqlite.prepare(`SELECT COUNT(*) AS c FROM tags WHERE name LIKE 'АВ Время: %'`).get() as { c: number }
    ).c;
    expect(left).toBeGreaterThan(0);
  });

  it('идемпотентна: повторный прогон ничего не меняет', () => {
    runMigratePhase12(sqlite);
    const snapshot = tagSnapshot();
    const second = runMigratePhase12(sqlite);
    expect(second.tagRowsRemoved).toBe(0);
    expect(tagSnapshot()).toEqual(snapshot);
  });

  it('повторный прогон не затирает решение человека в справочнике', () => {
    runMigratePhase12(sqlite);
    // Человек в /refs решил, что у прямых воронок эфиры всё-таки есть.
    sqlite.prepare(`UPDATE funnel_types SET has_time = 1 WHERE name = 'АВ Прямые'`).run();
    runMigratePhase12(sqlite);
    expect(hasTimeOf('АВ Прямые')).toBe(1);
  });

  it('материализация после фазы даёт ровно тот же набор тегов', () => {
    runMigratePhase12(sqlite);
    const snapshot = tagSnapshot();

    // Ресинк воронок безвременных типов — именно тех, чьи строки фаза правила.
    const db = drizzle(sqlite, { schema });
    const ids = (
      sqlite
        .prepare(
          `SELECT f.id FROM funnels f JOIN funnel_types ty ON ty.id = f.funnel_type_id
            WHERE ty.has_time = 0`
        )
        .all() as { id: number }[]
    ).map((r) => r.id);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) resyncFunnelAvTags(db, id);

    expect(tagSnapshot()).toEqual(snapshot);
  });
});
