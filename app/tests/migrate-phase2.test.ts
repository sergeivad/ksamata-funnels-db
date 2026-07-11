/**
 * Task 1 — Phase-2 migration test: channels, directions
 *
 * ISOLATION: All tests operate on a TEMP COPY of the DB.
 * The real ksamata_funnels.db is NEVER opened directly by these tests.
 */
import { describe, it, expect, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { copyFileSync, unlinkSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import * as schema from '../src/db/schema';
import { channels, directions } from '../src/db/schema';
import { runMigratePhase2 } from '../scripts/migrate-phase2';

// __dirname = app/tests/ → go up 2 levels to repo root for the DB
const REAL_DB = join(__dirname, '../../ksamata_funnels.db');
const TMP_DB  = join(tmpdir(), `ksamata_migrate_phase2_test_${Date.now()}_${process.pid}.db`);

// Copy real DB to temp location — never touch the real file
copyFileSync(REAL_DB, TMP_DB);

const sqlite = new Database(TMP_DB);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');
const testDb = drizzle(sqlite, { schema });

afterAll(() => {
  sqlite.close();
  if (existsSync(TMP_DB)) unlinkSync(TMP_DB);
});

describe('runMigratePhase2', () => {
  it('creates tables and seeds channels/directions idempotently', () => {
    // Run twice to prove idempotency
    runMigratePhase2(testDb);
    runMigratePhase2(testDb);

    const ch = testDb.select().from(channels).all().map(r => r.name);
    expect(ch).toEqual(expect.arrayContaining(['Ютуб', 'Яндекс', 'ВК', 'МАКС', 'Перелив']));
    expect(ch.length).toBe(5); // no duplicates

    const dir = testDb.select().from(directions).all().map(r => r.name);
    expect(dir).toEqual(expect.arrayContaining(['Органика', 'Реклама', 'РСЯ', 'In Stream', 'Квиз']));
    expect(dir.length).toBe(10); // no duplicates
  });

  it('directions contains all 10 expected values', () => {
    const dir = testDb.select().from(directions).all().map(r => r.name);
    expect(dir).toEqual(expect.arrayContaining([
      'Органика',
      'Реклама',
      'РСЯ',
      'In Stream',
      'Маркетплатформа',
      'Посевы',
      'Ретаргет',
      'Перелив с БОО',
      'Перелив с ДБО',
      'Квиз',
    ]));
  });

  it('adds funnels.status and funnels.front_code when missing (replaces migrate.sh)', () => {
    // Fresh DB whose funnels table lacks the Phase-2 columns.
    const bare = new Database(':memory:');
    bare.exec(`CREATE TABLE funnels (id INTEGER PRIMARY KEY AUTOINCREMENT, num INTEGER)`);
    const bareDb = drizzle(bare, { schema });

    runMigratePhase2(bareDb);
    runMigratePhase2(bareDb); // idempotent — must not throw on the second pass

    const cols = (bare.prepare(`PRAGMA table_info(funnels)`).all() as { name: string }[]).map((r) => r.name);
    expect(cols).toEqual(expect.arrayContaining(['status', 'front_code']));
    bare.exec(`INSERT INTO funnels (num) VALUES (1)`);
    const row = bare.prepare(`SELECT status, front_code FROM funnels WHERE num = 1`).get() as {
      status: string; front_code: string;
    };
    expect(row.status).toBe('active');
    expect(row.front_code).toBe('');
    bare.close();
  });
});
