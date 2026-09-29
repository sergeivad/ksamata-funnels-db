/**
 * Фаза 19 — колонки второго повтора и времени повторов.
 *
 * Состояние «до» строится явно (колонки сносятся), по доводу
 * migrate-phase16.test.ts: копия живой базы фазу уже прошла.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { copyDbForTest } from './helpers/db';
import { runMigratePhase19 } from '../scripts/migrate-phase19';
import { PHASE19_COLUMNS } from '../scripts/migrate-phase19-data';

let dir: string;
let sqlite: Database.Database;

const columns = () =>
  new Set((sqlite.prepare(`PRAGMA table_info(funnel_days)`).all() as { name: string }[]).map((r) => r.name));

// web_replay заведён ещё Python-импортом и заполнен в живой базе — его фаза
// не сносит и не трогает; сносим только то, что фаза заводит впервые.
const NEW_COLUMNS = PHASE19_COLUMNS.filter((c) => c.name !== 'web_replay');

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'phase19-'));
  const dbPath = join(dir, 'test.db');
  copyDbForTest(join(__dirname, '../../ksamata_funnels.db'), dbPath);
  sqlite = new Database(dbPath);
  for (const c of NEW_COLUMNS) if (columns().has(c.name)) sqlite.exec(`ALTER TABLE funnel_days DROP COLUMN ${c.name}`);
});

afterEach(() => {
  sqlite.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('Phase 19: второй повтор', () => {
  it('заводит колонки и не трогает данные первого повтора', () => {
    const before = sqlite.prepare(`SELECT COUNT(*) AS c FROM funnel_days WHERE web_replay <> ''`).get() as { c: number };
    const result = runMigratePhase19(sqlite);
    expect(result.columnsAdded).toBe(NEW_COLUMNS.length);
    for (const c of PHASE19_COLUMNS) expect(columns().has(c.name)).toBe(true);
    const after = sqlite.prepare(`SELECT COUNT(*) AS c FROM funnel_days WHERE web_replay <> ''`).get() as { c: number };
    expect(after.c).toBe(before.c);
    const filled = sqlite.prepare(`SELECT COUNT(*) AS c FROM funnel_days WHERE replay2_url <> '' OR replay_time <> ''`).get() as { c: number };
    expect(filled.c).toBe(0);
  });

  it('повторный прогон ничего не делает', () => {
    runMigratePhase19(sqlite);
    expect(runMigratePhase19(sqlite).columnsAdded).toBe(0);
  });
});
