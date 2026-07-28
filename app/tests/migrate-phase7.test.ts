import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { copyDbForTest } from './helpers/db';
import { runMigratePhase7 } from '../scripts/migrate-phase7';
import { SEED_FUNNEL_TYPES, DEFAULT_FUNNEL_TYPE } from '../src/lib/funnel-type';

let dir: string;
let dbPath: string;
let sqlite: Database.Database;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'phase7-'));
  dbPath = join(dir, 'test.db');
  copyDbForTest(join(__dirname, '../../ksamata_funnels.db'), dbPath);
  sqlite = new Database(dbPath);
  runMigratePhase7(sqlite);
});

afterAll(() => {
  sqlite.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('Phase-7: справочник типов воронки', () => {
  it('заводит справочник с четырьмя маркерами', () => {
    const names = (sqlite.prepare('SELECT name FROM funnel_types ORDER BY name').all() as { name: string }[])
      .map((r) => r.name);
    expect(names.sort()).toEqual([...SEED_FUNNEL_TYPES].sort());
  });

  it('добавляет колонку funnels.funnel_type_id', () => {
    const cols = (sqlite.prepare('PRAGMA table_info(funnels)').all() as { name: string }[]).map((c) => c.name);
    expect(cols).toContain('funnel_type_id');
  });

  it('бэкфиллит всем воронкам «АВ Автоворонка»', () => {
    const row = sqlite.prepare(`
      SELECT COUNT(*) AS total,
             SUM(CASE WHEN t.name = ? THEN 1 ELSE 0 END) AS auto
        FROM funnels f LEFT JOIN funnel_types t ON t.id = f.funnel_type_id
    `).get(DEFAULT_FUNNEL_TYPE) as { total: number; auto: number };
    expect(row.total).toBeGreaterThan(0);
    expect(row.auto).toBe(row.total);
  });

  it('идемпотентна: повторный прогон ничего не ломает и не двоит', () => {
    runMigratePhase7(sqlite);
    const n = (sqlite.prepare('SELECT COUNT(*) AS n FROM funnel_types').get() as { n: number }).n;
    expect(n).toBe(SEED_FUNNEL_TYPES.length);
  });

  it('не трогает funnel_tags — маркер там уже стоит из шаблона', () => {
    const n = (sqlite.prepare(`
      SELECT COUNT(DISTINCT ft.funnel_id) AS n FROM funnel_tags ft
      JOIN tags t ON t.id = ft.tag_id WHERE t.name = ?
    `).get(DEFAULT_FUNNEL_TYPE) as { n: number }).n;
    const total = (sqlite.prepare('SELECT COUNT(*) AS n FROM funnels').get() as { n: number }).n;
    expect(n).toBe(total);
  });
});
