import { describe, it, expect, afterAll, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { unlinkSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { runMigratePhase7 } from '../scripts/migrate-phase7';
import { copyDbForTest } from './helpers/db';

const REAL_DB = join(__dirname, '../../ksamata_funnels.db');
const TMP_DB = join(tmpdir(), `p7_${Date.now()}_${process.pid}.db`);
copyDbForTest(REAL_DB, TMP_DB);
const sqlite = new Database(TMP_DB);
sqlite.pragma('foreign_keys = ON');

afterAll(() => { sqlite.close(); if (existsSync(TMP_DB)) unlinkSync(TMP_DB); });

/** Свободный num, чтобы вставки тестов не спорили с живыми данными. */
let nextNum = 90000;
function insertFunnel(frontCode: string): number {
  const num = nextNum++;
  return sqlite
    .prepare(
      `INSERT INTO funnels (num, front_code, status, product_name, variant,
                            landing_url, start_date, block_name,
                            product_id, contractor_id, source_id)
       VALUES (?, ?, 'active', 'Phase-7 fixture', 'А', '', '', '', 1, 1, 1)`
    )
    .run(num, frontCode).lastInsertRowid as number;
}

function dropIndex(): void {
  sqlite.exec(`DROP INDEX IF EXISTS idx_funnels_front_code_unique`);
}

function indexExists(): boolean {
  const row = sqlite
    .prepare(`SELECT name FROM sqlite_master WHERE type='index' AND name=?`)
    .get('idx_funnels_front_code_unique');
  return row !== undefined;
}

beforeEach(() => {
  dropIndex();
  sqlite.prepare(`DELETE FROM funnels WHERE product_name = 'Phase-7 fixture'`).run();
});

describe('migrate-phase7', () => {
  it('создаёт уникальный индекс на front_code и повторный прогон не падает', () => {
    runMigratePhase7(sqlite);
    runMigratePhase7(sqlite);

    expect(indexExists()).toBe(true);
  });

  it('после миграции дубликат кода отбивается базой', () => {
    runMigratePhase7(sqlite);
    insertFunnel('f90001');

    expect(() => insertFunnel('f90001')).toThrow(/UNIQUE constraint failed: funnels\.front_code/i);
  });

  it('пустой код не считается дубликатом — индекс частичный', () => {
    runMigratePhase7(sqlite);

    // В живой базе бескодовых воронок десяток; обычный UNIQUE запретил бы вторую.
    expect(() => { insertFunnel(''); insertFunnel(''); }).not.toThrow();
  });

  it('нормализует регистр и пробелы до построения индекса', () => {
    const id = insertFunnel(' F90002 ');

    const result = runMigratePhase7(sqlite);

    const row = sqlite.prepare(`SELECT front_code AS code FROM funnels WHERE id = ?`).get(id) as {
      code: string;
    };
    expect(row.code).toBe('f90002');
    expect(result.normalized).toBeGreaterThanOrEqual(1);
  });

  it('разводит уже заведённые дубликаты вместо падения на CREATE INDEX', () => {
    // Без этого миграция роняла бы docker-entrypoint.sh под `set -e`, то есть
    // контейнер не поднялся бы вовсе.
    const older = insertFunnel('f90003');
    const newer = insertFunnel('f90003');

    const result = runMigratePhase7(sqlite);

    expect(indexExists()).toBe(true);
    // Код остаётся у той, что получила его раньше; промах автовыдачи обнуляется,
    // а не переписывается на следующий свободный — выдуманный код завтра
    // столкнётся с настоящим кодом ЛИК.
    const code = (id: number) =>
      (sqlite.prepare(`SELECT front_code AS code FROM funnels WHERE id = ?`).get(id) as {
        code: string;
      }).code;
    expect(code(older)).toBe('f90003');
    expect(code(newer)).toBe('');
    expect(result.clearedDuplicates).toEqual([{ id: newer, code: 'f90003' }]);
  });

  it('дубликат, различающийся только регистром, тоже разводится', () => {
    const older = insertFunnel('f90004');
    const newer = insertFunnel('F90004');

    const result = runMigratePhase7(sqlite);

    expect(indexExists()).toBe(true);
    expect(result.clearedDuplicates).toEqual([{ id: newer, code: 'f90004' }]);
    expect(older).toBeDefined();
  });

  it('на живых данных ничего не разводит — дубликатов там нет', () => {
    const result = runMigratePhase7(sqlite);
    expect(result.clearedDuplicates).toEqual([]);
  });
});
