/**
 * Фаза 18 — признак «воронка заведена в ЛИК».
 *
 * Состояние «до» строится явно (колонка сносится), по доводу
 * migrate-phase16.test.ts: копия живой базы фазу уже прошла.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { copyDbForTest } from './helpers/db';
import { runMigratePhase18 } from '../scripts/migrate-phase18';
import { PHASE18_COLUMN, PHASE18_FUNNELS_IN_LEAK } from '../scripts/migrate-phase18-data';

let dir: string;
let sqlite: Database.Database;

const hasColumn = () =>
  (sqlite.prepare(`PRAGMA table_info(funnels)`).all() as { name: string }[])
    .some((r) => r.name === PHASE18_COLUMN.name);

const flagOf = (code: string) =>
  (sqlite.prepare(`SELECT ${PHASE18_COLUMN.name} AS v FROM funnels WHERE front_code = ?`).get(code) as
    | { v: number }
    | undefined)?.v;

const marked = () =>
  (sqlite.prepare(`SELECT COUNT(*) AS c FROM funnels WHERE ${PHASE18_COLUMN.name} = 1`).get() as { c: number }).c;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'phase18-'));
  const dbPath = join(dir, 'test.db');
  copyDbForTest(join(__dirname, '../../ksamata_funnels.db'), dbPath);
  sqlite = new Database(dbPath);
  if (hasColumn()) sqlite.exec(`ALTER TABLE funnels DROP COLUMN ${PHASE18_COLUMN.name}`);
});

afterEach(() => {
  sqlite.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('Phase 18: funnels.in_leak', () => {
  it('заводит колонку и помечает воронки из снимка', () => {
    const result = runMigratePhase18(sqlite);
    expect(hasColumn()).toBe(true);
    // В снимке есть коды, которых в репозиторной базе нет (f99–f105 живут
    // только в проде), поэтому счёт — по тем, что в базе есть.
    const present = PHASE18_FUNNELS_IN_LEAK.filter((c) => flagOf(c) !== undefined);
    expect(present.length).toBeGreaterThan(0);
    for (const code of present) expect(flagOf(code)).toBe(1);
    expect(result.funnelsMarked).toBe(present.length);
    expect(marked()).toBe(present.length);
  });

  it('повторный прогон не возвращает снятую человеком галку', () => {
    runMigratePhase18(sqlite);
    const code = PHASE18_FUNNELS_IN_LEAK[0];
    sqlite.prepare(`UPDATE funnels SET ${PHASE18_COLUMN.name} = 0 WHERE front_code = ?`).run(code);

    const again = runMigratePhase18(sqlite);
    expect(again.funnelsMarked).toBe(0);
    expect(flagOf(code)).toBe(0);
  });

  it('код в верхнем регистре тоже находится', () => {
    const code = PHASE18_FUNNELS_IN_LEAK[0];
    sqlite.prepare(`UPDATE funnels SET front_code = upper(front_code) WHERE front_code = ?`).run(code);
    runMigratePhase18(sqlite);
    expect(flagOf(code.toUpperCase())).toBe(1);
  });
});
