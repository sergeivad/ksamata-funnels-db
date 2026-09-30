/**
 * Фаза 20 — «чего не хватает в ЛИК» (funnels.leak_todo).
 *
 * Состояние «до» строится явно (колонка сносится): копия живой базы фазу
 * может уже пройти.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { copyDbForTest } from './helpers/db';
import { runMigratePhase20 } from '../scripts/migrate-phase20';
import { PHASE20_COLUMN } from '../scripts/migrate-phase20-data';

let dir: string;
let sqlite: Database.Database;

const hasColumn = () =>
  (sqlite.prepare(`PRAGMA table_info(funnels)`).all() as { name: string }[])
    .some((r) => r.name === PHASE20_COLUMN.name);

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'phase20-'));
  const dbPath = join(dir, 'test.db');
  copyDbForTest(join(__dirname, '../../ksamata_funnels.db'), dbPath);
  sqlite = new Database(dbPath);
  if (hasColumn()) sqlite.exec(`ALTER TABLE funnels DROP COLUMN ${PHASE20_COLUMN.name}`);
});

afterEach(() => {
  sqlite.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('Phase 20: funnels.leak_todo', () => {
  it('заводит колонку, у всех воронок она пуста', () => {
    const result = runMigratePhase20(sqlite);
    expect(hasColumn()).toBe(true);
    expect(result.columnsAdded).toBe(1);
    const filled = (sqlite.prepare(`SELECT COUNT(*) AS c FROM funnels WHERE ${PHASE20_COLUMN.name} <> ''`).get() as { c: number }).c;
    expect(filled).toBe(0);
  });

  it('повторный прогон ничего не делает и не стирает текст человека', () => {
    runMigratePhase20(sqlite);
    sqlite.prepare(`UPDATE funnels SET ${PHASE20_COLUMN.name} = 'комнаты' WHERE id = (SELECT MIN(id) FROM funnels)`).run();
    const again = runMigratePhase20(sqlite);
    expect(again.columnsAdded).toBe(0);
    const kept = (sqlite.prepare(`SELECT COUNT(*) AS c FROM funnels WHERE ${PHASE20_COLUMN.name} = 'комнаты'`).get() as { c: number }).c;
    expect(kept).toBe(1);
  });
});
