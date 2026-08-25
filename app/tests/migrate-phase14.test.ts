/**
 * Фаза 14 — пятый сценарий тегов «Предсписок».
 *
 * Каждый тест работает на своей копии реальной базы: фаза перестраивает
 * таблицы и ставит маркер в schema_migrations, то есть её ключевые ветки
 * («CHECK ещё узкий», «строка шаблона ещё не засеяна») на повторном прогоне
 * уже не воспроизводятся.
 *
 * Состояние «до фазы 14» строится тестом явно — тем же приёмом, что и в
 * migrate-phase12.test.ts: копия живой базы фазу однажды пройдёт, и «CHECK
 * перечисляет четыре значения» перестало бы быть правдой ровно в тот день,
 * когда миграцию прогнали на репозиторной базе.
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
import {
  PHASE14_SCENARIO,
  PHASE14_SEED_MARKER,
  PHASE14_STAGE_TAG,
  PHASE14_SCENARIO_TABLES,
} from '../scripts/migrate-phase14-data';
import { resyncFunnelAvTags } from '../src/lib/funnels';

let dir: string;
let sqlite: Database.Database;

/**
 * Возвращает базу в состояние «фазы 14 не было»: сужает три CHECK обратно,
 * выносит строки нового сценария и снимает маркер.
 *
 * Сужение делается тем же приёмом, что и расширение, — правкой DDL из
 * sqlite_master, — чтобы откат не расходился с фазой при любой будущей правке
 * схемы этих таблиц.
 */
function undoPhase14(): void {
  sqlite.exec(`DELETE FROM funnel_tags WHERE tag_type = '${PHASE14_SCENARIO}'`);
  sqlite.exec(`DELETE FROM funnel_tag_overrides WHERE tag_type = '${PHASE14_SCENARIO}'`);
  sqlite.exec(`DELETE FROM tag_templates WHERE scenario = '${PHASE14_SCENARIO}'`);
  sqlite.exec(`DELETE FROM schema_migrations WHERE name = '${PHASE14_SEED_MARKER}'`);

  for (const { table } of PHASE14_SCENARIO_TABLES) {
    const { sql } = sqlite
      .prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?`)
      .get(table) as { sql: string };
    if (!sql.includes(`'${PHASE14_SCENARIO}'`)) continue;

    const indexes = (
      sqlite
        .prepare(`SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name=? AND sql IS NOT NULL`)
        .all(table) as { sql: string }[]
    ).map((r) => r.sql);
    const columns = (sqlite.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[])
      .map((r) => `"${r.name}"`)
      .join(', ');
    const tmp = `${table}_undo`;
    const narrowed = sql
      .replace(/^CREATE TABLE\s+("?)[A-Za-z_][A-Za-z0-9_]*\1/, `CREATE TABLE "${tmp}"`)
      .replace(new RegExp(`,\\s*'${PHASE14_SCENARIO}'`), '');

    sqlite.pragma('foreign_keys = OFF');
    sqlite.exec(narrowed);
    sqlite.exec(`INSERT INTO "${tmp}" (${columns}) SELECT ${columns} FROM "${table}"`);
    sqlite.exec(`DROP TABLE "${table}"`);
    sqlite.exec(`ALTER TABLE "${tmp}" RENAME TO "${table}"`);
    for (const idx of indexes) sqlite.exec(idx);
    sqlite.pragma('foreign_keys = ON');
  }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'phase14-'));
  const dbPath = join(dir, 'test.db');
  copyDbForTest(join(__dirname, '../../ksamata_funnels.db'), dbPath);
  sqlite = new Database(dbPath);
  sqlite.pragma('foreign_keys = ON');
  undoPhase14();
});

afterEach(() => {
  sqlite.close();
  rmSync(dir, { recursive: true, force: true });
});

const count = (sql: string, ...args: unknown[]): number =>
  (sqlite.prepare(sql).get(...(args as [])) as { n: number }).n;

const rowsOf = (tagType: string) =>
  count(`SELECT COUNT(*) AS n FROM funnel_tags WHERE tag_type = ?`, tagType);

/** Снимок всех тегов базы: воронка → сценарий → упорядоченный список имён. */
function tagSnapshot(): Record<string, string[]> {
  const rows = sqlite
    .prepare(
      `SELECT ft.funnel_id AS funnelId, ft.tag_type AS tagType, t.name AS name, ft.position AS position
         FROM funnel_tags ft JOIN tags t ON t.id = ft.tag_id
        ORDER BY ft.funnel_id, ft.tag_type, ft.position, t.name`
    )
    .all() as { funnelId: number; tagType: string; name: string }[];
  const out: Record<string, string[]> = {};
  for (const r of rows) (out[`${r.funnelId}/${r.tagType}`] ??= []).push(r.name);
  return out;
}

function acceptsScenario(table: string): boolean {
  // Пробная вставка в транзакции с откатом: единственный честный способ
  // спросить у SQLite, пропускает ли CHECK значение, — попробовать.
  try {
    sqlite.exec('BEGIN');
    if (table === 'tag_templates') {
      sqlite
        .prepare(`INSERT INTO tag_templates (scenario, name, position) VALUES (?, 'проба', 99)`)
        .run(PHASE14_SCENARIO);
    } else if (table === 'funnel_tag_overrides') {
      const f = sqlite.prepare(`SELECT id FROM funnels LIMIT 1`).get() as { id: number };
      sqlite
        .prepare(
          `INSERT INTO funnel_tag_overrides (funnel_id, tag_type, name, op, position)
           VALUES (?, ?, 'проба', 'add', 99)`
        )
        .run(f.id, PHASE14_SCENARIO);
    } else {
      const f = sqlite.prepare(`SELECT id FROM funnels LIMIT 1`).get() as { id: number };
      const t = sqlite.prepare(`SELECT id FROM tags LIMIT 1`).get() as { id: number };
      sqlite
        .prepare(`INSERT INTO funnel_tags (funnel_id, tag_id, tag_type, position) VALUES (?, ?, ?, 99)`)
        .run(f.id, t.id, PHASE14_SCENARIO);
    }
    return true;
  } catch {
    return false;
  } finally {
    sqlite.exec('ROLLBACK');
  }
}

describe('фаза 14', () => {
  it('до неё CHECK не пропускает новый сценарий, после — пропускает', () => {
    for (const { table } of PHASE14_SCENARIO_TABLES) {
      expect(acceptsScenario(table), `${table} до фазы`).toBe(false);
    }

    const result = runMigratePhase14(sqlite);
    expect(result.tablesRebuilt).toEqual(PHASE14_SCENARIO_TABLES.map((t) => t.table));

    for (const { table } of PHASE14_SCENARIO_TABLES) {
      expect(acceptsScenario(table), `${table} после фазы`).toBe(true);
    }
  });

  it('перестройка таблиц ничего не теряет: строки, индексы, внешние ключи', () => {
    const before = {
      tags: rowsOf('reg') + rowsOf('time_15') + rowsOf('time_19') + rowsOf('messenger'),
      overrides: count(`SELECT COUNT(*) AS n FROM funnel_tag_overrides`),
      templates: count(`SELECT COUNT(*) AS n FROM tag_templates`),
      indexes: (
        sqlite
          .prepare(
            `SELECT name FROM sqlite_master WHERE type='index'
               AND tbl_name IN ('funnel_tags','tag_templates','funnel_tag_overrides')
             ORDER BY name`
          )
          .all() as { name: string }[]
      ).map((r) => r.name),
      snapshot: tagSnapshot(),
    };

    runMigratePhase14(sqlite);

    expect(rowsOf('reg') + rowsOf('time_15') + rowsOf('time_19') + rowsOf('messenger')).toBe(before.tags);
    expect(count(`SELECT COUNT(*) AS n FROM funnel_tag_overrides`)).toBe(before.overrides);
    expect(count(`SELECT COUNT(*) AS n FROM tag_templates`)).toBe(before.templates + 1);
    expect(
      (
        sqlite
          .prepare(
            `SELECT name FROM sqlite_master WHERE type='index'
               AND tbl_name IN ('funnel_tags','tag_templates','funnel_tag_overrides')
             ORDER BY name`
          )
          .all() as { name: string }[]
      ).map((r) => r.name)
    ).toEqual(before.indexes);
    expect(sqlite.pragma('foreign_key_check')).toEqual([]);

    // Прежние сценарии не тронуты ни на строку.
    const after = tagSnapshot();
    for (const [key, names] of Object.entries(before.snapshot)) {
      expect(after[key], key).toEqual(names);
    }
  });

  it('строка шаблона одна и после второго прогона', () => {
    const first = runMigratePhase14(sqlite);
    expect(first.templateSeeded).toBe(true);

    const rows = sqlite
      .prepare(`SELECT name, position FROM tag_templates WHERE scenario = ?`)
      .all(PHASE14_SCENARIO) as { name: string; position: number }[];
    expect(rows).toEqual([{ name: PHASE14_STAGE_TAG, position: 0 }]);

    const second = runMigratePhase14(sqlite);
    expect(second.templateSeeded).toBe(false);
    expect(second.tablesRebuilt).toEqual([]);
    expect(count(`SELECT COUNT(*) AS n FROM tag_templates WHERE scenario = '${PHASE14_SCENARIO}'`)).toBe(1);
  });

  it('снятую человеком строку шаблона повторный прогон не возвращает', () => {
    runMigratePhase14(sqlite);
    // Человек очистил набор предсписка в /tags.
    sqlite.prepare(`DELETE FROM tag_templates WHERE scenario = ?`).run(PHASE14_SCENARIO);

    runMigratePhase14(sqlite);
    expect(count(`SELECT COUNT(*) AS n FROM tag_templates WHERE scenario = '${PHASE14_SCENARIO}'`)).toBe(0);
  });

  it('набор предсписка равен набору мессенджера с точностью до этапа', () => {
    runMigratePhase14(sqlite);

    const setOf = (funnelId: number, tagType: string) =>
      (
        sqlite
          .prepare(
            `SELECT t.name AS name FROM funnel_tags ft JOIN tags t ON t.id = ft.tag_id
              WHERE ft.funnel_id = ? AND ft.tag_type = ? ORDER BY ft.position`
          )
          .all(funnelId, tagType) as { name: string }[]
      ).map((r) => r.name);

    const ids = (sqlite.prepare(`SELECT id FROM funnels ORDER BY id`).all() as { id: number }[])
      .map((r) => r.id);
    expect(ids.length).toBeGreaterThan(0);

    for (const id of ids) {
      const messenger = setOf(id, 'messenger');
      if (messenger.length === 0) continue; // воронка без осей — её пропускают обе стороны
      const predspisok = setOf(id, PHASE14_SCENARIO);
      expect(predspisok[0], `воронка ${id}`).toBe(PHASE14_STAGE_TAG);
      expect(predspisok.slice(1), `воронка ${id}`).toEqual(messenger.slice(1));
    }
    expect(rowsOf(PHASE14_SCENARIO)).toBe(rowsOf('messenger'));
  });

  it('повторный прогон не добавляет ни строки', () => {
    runMigratePhase14(sqlite);
    const snapshot = tagSnapshot();
    const rows = rowsOf(PHASE14_SCENARIO);

    const second = runMigratePhase14(sqlite);
    expect(rowsOf(PHASE14_SCENARIO)).toBe(rows);
    expect(second.tagRows).toBe(rows);
    expect(tagSnapshot()).toEqual(snapshot);
  });

  it('материализация после фазы даёт ровно тот же набор тегов', () => {
    runMigratePhase14(sqlite);
    const snapshot = tagSnapshot();

    const db = drizzle(sqlite, { schema });
    const ids = (sqlite.prepare(`SELECT id FROM funnels ORDER BY id`).all() as { id: number }[])
      .map((r) => r.id);
    for (const id of ids) resyncFunnelAvTags(db, id);

    expect(tagSnapshot()).toEqual(snapshot);
  });

  it('add-оверрайд предсписка попадает в материализацию', () => {
    runMigratePhase14(sqlite);
    const id = (sqlite.prepare(`SELECT id FROM funnels ORDER BY id LIMIT 1`).get() as { id: number }).id;
    sqlite
      .prepare(
        `INSERT INTO funnel_tag_overrides (funnel_id, tag_type, name, op, position)
         VALUES (?, ?, 'промо-предсписок', 'add', 0)`
      )
      .run(id, PHASE14_SCENARIO);

    runMigratePhase14(sqlite);

    const names = (
      sqlite
        .prepare(
          `SELECT t.name AS name FROM funnel_tags ft JOIN tags t ON t.id = ft.tag_id
            WHERE ft.funnel_id = ? AND ft.tag_type = ?`
        )
        .all(id, PHASE14_SCENARIO) as { name: string }[]
    ).map((r) => r.name);
    expect(names).toContain('промо-предсписок');
  });
});
