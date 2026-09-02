/**
 * Фаза 16 — предсписок становится свойством воронки.
 *
 * Устройство теста повторяет migrate-phase12.test.ts, и по той же причине:
 * ключевое поведение фазы (бэкфилл только в прогон, заводящий колонку) на
 * повторном прогоне не воспроизводится, поэтому состояние «до» строится явно,
 * а не берётся из копии живой базы — та фазу однажды пройдёт, и «колонки ещё
 * нет» перестанет быть правдой.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { copyDbForTest } from './helpers/db';
import * as schema from '../src/db/schema';
import { runMigratePhase16 } from '../scripts/migrate-phase16';
import { runMigratePhase14 } from '../scripts/migrate-phase14';
import {
  PHASE16_COLUMN,
  PHASE16_FUNNELS_WITHOUT_PREDSPISOK,
} from '../scripts/migrate-phase16-data';
import { resyncFunnelAvTags } from '../src/lib/funnels';

let dir: string;
let sqlite: Database.Database;

/**
 * Состояние «до фазы 16»: колонки нет, наборы предсписка есть у ВСЕХ воронок.
 *
 * Второе не менее важно первого. Копия живой базы фазу 16 уже прошла, и наборы
 * 44 воронок в ней снесены — на такой фикстуре третий шаг фазы нечего было бы
 * сносить, и тест «сносит строки» проходил бы, ничего не проверив.
 *
 * Наборы восстанавливает не рука, а сама фаза 14: без колонки она
 * материализует предсписок всем, что и есть настоящее состояние «до 16».
 * Так фикстура не разъедется с тем, что в этом состоянии было на самом деле.
 */
function undoPhase16(): void {
  const hasColumn = (sqlite.prepare(`PRAGMA table_info(funnels)`).all() as { name: string }[])
    .some((r) => r.name === PHASE16_COLUMN.name);
  if (hasColumn) sqlite.exec(`ALTER TABLE funnels DROP COLUMN ${PHASE16_COLUMN.name}`);
  runMigratePhase14(sqlite);
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'phase16-'));
  const dbPath = join(dir, 'test.db');
  copyDbForTest(join(__dirname, '../../ksamata_funnels.db'), dbPath);
  sqlite = new Database(dbPath);
  sqlite.pragma('foreign_keys = ON');
  undoPhase16();
});

afterEach(() => {
  sqlite.close();
  rmSync(dir, { recursive: true, force: true });
});

const columns = () =>
  (sqlite.prepare(`PRAGMA table_info(funnels)`).all() as { name: string }[]).map((r) => r.name);

const flagOf = (code: string) =>
  (sqlite.prepare(`SELECT ${PHASE16_COLUMN.name} AS v FROM funnels WHERE front_code = ?`).get(code) as
    | { v: number }
    | undefined)?.v;

/** Строк funnel_tags сценария predspisok у воронок со снятым признаком. */
function predspisokRowsOnFunnelsWithout(): number {
  return (
    sqlite
      .prepare(
        `SELECT COUNT(*) AS c FROM funnel_tags ft
           JOIN funnels f ON f.id = ft.funnel_id
          WHERE ft.tag_type = 'predspisok' AND f.${PHASE16_COLUMN.name} = 0`
      )
      .get() as { c: number }
  ).c;
}

const predspisokRowsTotal = () =>
  (sqlite.prepare(`SELECT COUNT(*) AS c FROM funnel_tags WHERE tag_type = 'predspisok'`).get() as
    { c: number }).c;

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

describe('фаза 16', () => {
  it('заводит колонку has_predspisok', () => {
    expect(columns()).not.toContain(PHASE16_COLUMN.name);
    runMigratePhase16(sqlite);
    expect(columns()).toContain(PHASE16_COLUMN.name);
  });

  it('снимает признак у воронок из списка и оставляет у остальных', () => {
    const result = runMigratePhase16(sqlite);
    for (const code of PHASE16_FUNNELS_WITHOUT_PREDSPISOK) {
      // В чужой базе какого-то кода может не быть — проверяем те, что есть.
      const value = flagOf(code);
      if (value !== undefined) expect(value, code).toBe(0);
    }
    expect(result.funnelsCleared).toBeGreaterThan(0);
    // f36 «Предсписок ДБО Ютуб органика» — предложение 8670757, признак остаётся.
    expect(flagOf('f36')).toBe(1);
  });

  it('умолчание для воронки вне списка — «предсписок есть»', () => {
    runMigratePhase16(sqlite);
    const codes = new Set(PHASE16_FUNNELS_WITHOUT_PREDSPISOK as readonly string[]);
    const others = (
      sqlite.prepare(`SELECT front_code AS c FROM funnels`).all() as { c: string }[]
    ).map((r) => r.c).filter((c) => !codes.has(c));
    expect(others.length).toBeGreaterThan(0);
    for (const code of others) expect(flagOf(code), code).toBe(1);
  });

  it('сносит строки predspisok у воронок со снятым признаком', () => {
    const before = predspisokRowsTotal();
    const result = runMigratePhase16(sqlite);
    expect(result.tagRowsRemoved).toBeGreaterThan(0);
    expect(predspisokRowsOnFunnelsWithout()).toBe(0);
    expect(predspisokRowsTotal()).toBe(before - result.tagRowsRemoved);
  });

  it('не трогает наборы predspisok у воронок с признаком', () => {
    runMigratePhase16(sqlite);
    const left = (
      sqlite
        .prepare(
          `SELECT COUNT(DISTINCT ft.funnel_id) AS c FROM funnel_tags ft
             JOIN funnels f ON f.id = ft.funnel_id
            WHERE ft.tag_type = 'predspisok' AND f.${PHASE16_COLUMN.name} = 1`
        )
        .get() as { c: number }
    ).c;
    expect(left).toBeGreaterThan(0);
  });

  it('не трогает остальные четыре сценария', () => {
    const before = (
      sqlite.prepare(`SELECT COUNT(*) AS c FROM funnel_tags WHERE tag_type <> 'predspisok'`)
        .get() as { c: number }
    ).c;
    runMigratePhase16(sqlite);
    const after = (
      sqlite.prepare(`SELECT COUNT(*) AS c FROM funnel_tags WHERE tag_type <> 'predspisok'`)
        .get() as { c: number }
    ).c;
    expect(after).toBe(before);
  });

  it('сам тег «АВ Этап: Предсписок» из справочника тегов не удаляет', () => {
    runMigratePhase16(sqlite);
    const left = (
      sqlite.prepare(`SELECT COUNT(*) AS c FROM tags WHERE name = 'АВ Этап: Предсписок'`)
        .get() as { c: number }
    ).c;
    expect(left).toBe(1);
  });

  it('идемпотентна: повторный прогон ничего не меняет', () => {
    runMigratePhase16(sqlite);
    const snapshot = tagSnapshot();
    const second = runMigratePhase16(sqlite);
    expect(second.tagRowsRemoved).toBe(0);
    expect(second.funnelsCleared).toBe(0);
    expect(tagSnapshot()).toEqual(snapshot);
  });

  it('повторный прогон не затирает решение человека на карточке', () => {
    runMigratePhase16(sqlite);
    // Человек завёл предложение в GetCourse и поставил галку обратно.
    const code = PHASE16_FUNNELS_WITHOUT_PREDSPISOK[0];
    sqlite.prepare(`UPDATE funnels SET ${PHASE16_COLUMN.name} = 1 WHERE front_code = ?`).run(code);
    runMigratePhase16(sqlite);
    expect(flagOf(code)).toBe(1);
  });

  it('снятая человеком галка подметается при следующем прогоне', () => {
    runMigratePhase16(sqlite);
    // Признак сняли на карточке, но строки приехали мимо приложения.
    const row = sqlite
      .prepare(`SELECT id FROM funnels WHERE ${PHASE16_COLUMN.name} = 1 LIMIT 1`)
      .get() as { id: number };
    const tag = sqlite.prepare(`SELECT id FROM tags WHERE name = 'АВ Этап: Предсписок'`)
      .get() as { id: number };
    sqlite.prepare(`UPDATE funnels SET ${PHASE16_COLUMN.name} = 0 WHERE id = ?`).run(row.id);
    sqlite
      .prepare(
        `INSERT OR IGNORE INTO funnel_tags (funnel_id, tag_id, tag_type, position)
         VALUES (?, ?, 'predspisok', 99)`
      )
      .run(row.id, tag.id);

    const result = runMigratePhase16(sqlite);
    expect(result.tagRowsRemoved).toBeGreaterThan(0);
    expect(predspisokRowsOnFunnelsWithout()).toBe(0);
  });

  it('материализация после фазы даёт ровно тот же набор тегов', () => {
    runMigratePhase16(sqlite);
    const snapshot = tagSnapshot();

    const db = drizzle(sqlite, { schema });
    const ids = (
      sqlite.prepare(`SELECT id FROM funnels WHERE ${PHASE16_COLUMN.name} = 0`).all() as
        { id: number }[]
    ).map((r) => r.id);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) resyncFunnelAvTags(db, id);

    expect(tagSnapshot()).toEqual(snapshot);
  });
});
