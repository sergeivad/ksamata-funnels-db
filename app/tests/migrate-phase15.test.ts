/**
 * Фаза 15 — правописание тега этапа предсписка: «Предписок» → «Предсписок».
 *
 * Состояние «до фазы 15» каждый тест строит сам, тем же приёмом, что и тесты
 * фаз 12 и 14: репозиторную базу фаза однажды пройдёт, и «в базе лежит старое
 * написание» перестанет быть правдой ровно в тот день, когда это случится.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { copyDbForTest } from './helpers/db';
import * as schema from '../src/db/schema';
import { runMigratePhase14 } from '../scripts/migrate-phase14';
import { PHASE14_SCENARIO } from '../scripts/migrate-phase14-data';
import { runMigratePhase15 } from '../scripts/migrate-phase15';
import { PHASE15_NEW_STAGE_TAG, PHASE15_OLD_STAGE_TAG } from '../scripts/migrate-phase15-data';
import { resyncFunnelAvTags } from '../src/lib/funnels';

let dir: string;
let sqlite: Database.Database;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'phase15-'));
  const dbPath = join(dir, 'test.db');
  copyDbForTest(join(__dirname, '../../ksamata_funnels.db'), dbPath);
  sqlite = new Database(dbPath);
  // Набор предсписка должен существовать: фаза 15 правит именно его.
  runMigratePhase14(sqlite);
});

afterEach(() => {
  sqlite.close();
  rmSync(dir, { recursive: true, force: true });
});

/**
 * Возвращает базу к старому написанию — состояние живого прода до выката.
 *
 * Через переименование строки `tags`, а не переписыванием funnel_tags: именно
 * так старое написание там и оказалось (материализация ссылается на tag_id).
 */
function useOldSpelling(): void {
  sqlite
    .prepare(`UPDATE tag_templates SET name = ? WHERE name = ?`)
    .run(PHASE15_OLD_STAGE_TAG, PHASE15_NEW_STAGE_TAG);
  sqlite
    .prepare(`UPDATE tags SET name = ? WHERE name = ?`)
    .run(PHASE15_OLD_STAGE_TAG, PHASE15_NEW_STAGE_TAG);
}

/** Обратная сторона useOldSpelling: база, где старого написания нет вовсе. */
function useNewSpelling(): void {
  sqlite
    .prepare(`UPDATE tag_templates SET name = ? WHERE name = ?`)
    .run(PHASE15_NEW_STAGE_TAG, PHASE15_OLD_STAGE_TAG);
  sqlite
    .prepare(`UPDATE tags SET name = ? WHERE name = ?`)
    .run(PHASE15_NEW_STAGE_TAG, PHASE15_OLD_STAGE_TAG);
}

function count(sql: string, ...args: unknown[]): number {
  return (sqlite.prepare(sql).get(...args) as { n: number }).n;
}

function templateNames(): string[] {
  return (
    sqlite
      .prepare(`SELECT name FROM tag_templates WHERE scenario = ? ORDER BY position, id`)
      .all(PHASE14_SCENARIO) as { name: string }[]
  ).map((r) => r.name);
}

function rowsWithName(name: string): number {
  return count(
    `SELECT COUNT(*) AS n FROM funnel_tags ft JOIN tags g ON g.id = ft.tag_id WHERE g.name = ?`,
    name
  );
}

/** Полный снимок материализованных наборов: имя тега × сценарий × воронка. */
function tagSnapshot(): Record<string, string[]> {
  const rows = sqlite
    .prepare(
      `SELECT ft.funnel_id AS funnelId, ft.tag_type AS tagType, g.name AS name
         FROM funnel_tags ft JOIN tags g ON g.id = ft.tag_id
        ORDER BY ft.funnel_id, ft.tag_type, ft.position`
    )
    .all() as { funnelId: number; tagType: string; name: string }[];
  const out: Record<string, string[]> = {};
  for (const r of rows) (out[`${r.funnelId}:${r.tagType}`] ??= []).push(r.name);
  return out;
}

describe('Phase-15: «Предписок» → «Предсписок»', () => {
  it('старое и новое написание — разные строки, и новое совпадает с фазой 14', () => {
    expect(PHASE15_OLD_STAGE_TAG).not.toBe(PHASE15_NEW_STAGE_TAG);
    expect(PHASE15_NEW_STAGE_TAG).toBe('АВ Этап: Предсписок');
    expect(PHASE15_OLD_STAGE_TAG).toBe('АВ Этап: Предписок');
  });

  it('переводит шаблон и все материализованные строки на новое написание', () => {
    useOldSpelling();
    const rowsBefore = rowsWithName(PHASE15_OLD_STAGE_TAG);
    expect(rowsBefore).toBeGreaterThan(0);
    expect(templateNames()).toEqual([PHASE15_OLD_STAGE_TAG]);

    const result = runMigratePhase15(sqlite);

    expect(result.templateRows).toBe(1);
    expect(result.tagRenamed).toBe(true);
    expect(result.tagMerged).toBe(false);
    expect(templateNames()).toEqual([PHASE15_NEW_STAGE_TAG]);
    expect(rowsWithName(PHASE15_OLD_STAGE_TAG)).toBe(0);
    // Ни одна строка не потеряна и не задвоена: тот же tag_id, другое имя.
    expect(rowsWithName(PHASE15_NEW_STAGE_TAG)).toBe(rowsBefore);
    expect(result.funnelTagRows).toBe(rowsBefore);
    expect(count(`SELECT COUNT(*) AS n FROM tags WHERE name = ?`, PHASE15_OLD_STAGE_TAG)).toBe(0);
    expect(sqlite.pragma('foreign_key_check')).toEqual([]);
  });

  it('прочие наборы не тронуты ни на строку', () => {
    useOldSpelling();
    const before = tagSnapshot();

    runMigratePhase15(sqlite);
    const after = tagSnapshot();

    expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort());
    for (const [key, names] of Object.entries(before)) {
      const expected = names.map((n) => (n === PHASE15_OLD_STAGE_TAG ? PHASE15_NEW_STAGE_TAG : n));
      expect(after[key], key).toEqual(expected);
    }
  });

  it('повторный прогон не находит работы', () => {
    useOldSpelling();
    runMigratePhase15(sqlite);
    const snapshot = tagSnapshot();

    const second = runMigratePhase15(sqlite);

    expect(second.templateRows).toBe(0);
    expect(second.overrideRows).toBe(0);
    expect(second.tagRenamed).toBe(false);
    expect(second.tagMerged).toBe(false);
    expect(tagSnapshot()).toEqual(snapshot);
  });

  it('на базе, где старого написания не было, ничего не меняет', () => {
    // Свежая база: фаза 5 засевает шаблон уже новым написанием, старого в ней
    // не было никогда. Состояние строим явно — репозиторная копия сегодня
    // такая, а завтра нет, и тест не должен зависеть от того, какая именно.
    useNewSpelling();
    const snapshot = tagSnapshot();
    const result = runMigratePhase15(sqlite);

    expect(result.tagRenamed).toBe(false);
    expect(result.tagMerged).toBe(false);
    expect(result.templateRows).toBe(0);
    expect(tagSnapshot()).toEqual(snapshot);
  });

  it('материализация после фазы даёт ровно тот же набор', () => {
    useOldSpelling();
    runMigratePhase15(sqlite);
    const snapshot = tagSnapshot();

    // Довод фазы 12 и 14: прямая правка законна ровно постольку, поскольку
    // движок построил бы то же самое.
    const db = drizzle(sqlite, { schema });
    const ids = (sqlite.prepare(`SELECT id FROM funnels ORDER BY id`).all() as { id: number }[])
      .map((r) => r.id);
    for (const id of ids) resyncFunnelAvTags(db, id);

    expect(tagSnapshot()).toEqual(snapshot);
  });

  it('следующий прогон фазы 14 не возвращает старое написание', () => {
    useOldSpelling();
    runMigratePhase15(sqlite);
    const snapshot = tagSnapshot();

    // Порядок в цепочке — 14, затем 15; проверяем оба на одном обороте.
    runMigratePhase14(sqlite);
    runMigratePhase15(sqlite);

    expect(rowsWithName(PHASE15_OLD_STAGE_TAG)).toBe(0);
    expect(tagSnapshot()).toEqual(snapshot);
  });

  it('переименовывает оверрайд со старым написанием', () => {
    useOldSpelling();
    const id = (sqlite.prepare(`SELECT id FROM funnels ORDER BY id LIMIT 1`).get() as { id: number }).id;
    sqlite
      .prepare(
        `INSERT INTO funnel_tag_overrides (funnel_id, tag_type, name, op, position)
         VALUES (?, ?, ?, 'remove', 0)`
      )
      .run(id, PHASE14_SCENARIO, PHASE15_OLD_STAGE_TAG);

    const result = runMigratePhase15(sqlite);

    expect(result.overrideRows).toBe(1);
    expect(result.overrideRowsDropped).toBe(0);
    const names = (
      sqlite
        .prepare(`SELECT name FROM funnel_tag_overrides WHERE funnel_id = ? AND tag_type = ?`)
        .all(id, PHASE14_SCENARIO) as { name: string }[]
    ).map((r) => r.name);
    expect(names).toEqual([PHASE15_NEW_STAGE_TAG]);
  });

  it('оверрайд со старым написанием снимается, если у воронки уже есть новый', () => {
    useOldSpelling();
    const id = (sqlite.prepare(`SELECT id FROM funnels ORDER BY id LIMIT 1`).get() as { id: number }).id;
    const insert = sqlite.prepare(
      `INSERT INTO funnel_tag_overrides (funnel_id, tag_type, name, op, position)
       VALUES (?, ?, ?, ?, ?)`
    );
    insert.run(id, PHASE14_SCENARIO, PHASE15_OLD_STAGE_TAG, 'remove', 0);
    insert.run(id, PHASE14_SCENARIO, PHASE15_NEW_STAGE_TAG, 'add', 1);

    const result = runMigratePhase15(sqlite);

    // Решение человека выражено строкой с новым написанием — она и остаётся.
    expect(result.overrideRowsDropped).toBe(1);
    expect(result.overrideRows).toBe(0);
    const rows = sqlite
      .prepare(`SELECT name, op FROM funnel_tag_overrides WHERE funnel_id = ? AND tag_type = ?`)
      .all(id, PHASE14_SCENARIO) as { name: string; op: string }[];
    expect(rows).toEqual([{ name: PHASE15_NEW_STAGE_TAG, op: 'add' }]);
  });

  it('сливает старую строку tags, если новая уже заведена', () => {
    useOldSpelling();
    const rowsBefore = rowsWithName(PHASE15_OLD_STAGE_TAG);
    // Так выглядит база, где шаблон уже правили через /api/tag-templates:
    // resyncAllFunnels завёл новую строку справочника, старая осталась сиротой.
    sqlite.prepare(`INSERT INTO tags (name) VALUES (?)`).run(PHASE15_NEW_STAGE_TAG);

    const result = runMigratePhase15(sqlite);

    expect(result.tagMerged).toBe(true);
    expect(result.tagRenamed).toBe(false);
    expect(count(`SELECT COUNT(*) AS n FROM tags WHERE name = ?`, PHASE15_OLD_STAGE_TAG)).toBe(0);
    expect(count(`SELECT COUNT(*) AS n FROM tags WHERE name = ?`, PHASE15_NEW_STAGE_TAG)).toBe(1);
    expect(rowsWithName(PHASE15_NEW_STAGE_TAG)).toBe(rowsBefore);
    expect(sqlite.pragma('foreign_key_check')).toEqual([]);
  });

  it('при слиянии не задваивает строку у воронки, где новый тег уже стоял', () => {
    useOldSpelling();
    const id = (sqlite.prepare(`SELECT id FROM funnels ORDER BY id LIMIT 1`).get() as { id: number }).id;
    sqlite.prepare(`INSERT INTO tags (name) VALUES (?)`).run(PHASE15_NEW_STAGE_TAG);
    const newId = (
      sqlite.prepare(`SELECT id FROM tags WHERE name = ?`).get(PHASE15_NEW_STAGE_TAG) as { id: number }
    ).id;
    // У одной воронки набор уже несёт новое написание — переезд старой строки
    // упёрся бы в UNIQUE(funnel_id, tag_id, tag_type).
    sqlite
      .prepare(
        `INSERT INTO funnel_tags (funnel_id, tag_id, tag_type, position) VALUES (?, ?, ?, 99)`
      )
      .run(id, newId, PHASE14_SCENARIO);

    runMigratePhase15(sqlite);

    expect(
      count(
        `SELECT COUNT(*) AS n FROM funnel_tags ft JOIN tags g ON g.id = ft.tag_id
          WHERE ft.funnel_id = ? AND ft.tag_type = ? AND g.name = ?`,
        id,
        PHASE14_SCENARIO,
        PHASE15_NEW_STAGE_TAG
      )
    ).toBe(1);
    expect(rowsWithName(PHASE15_OLD_STAGE_TAG)).toBe(0);
    expect(sqlite.pragma('foreign_key_check')).toEqual([]);
  });
});
