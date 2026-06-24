/**
 * Task 1 — Phase-2 migration test: channels, directions, funnel_links
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
import { channels, directions, funnelLinks, funnels } from '../src/db/schema';
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

  it('funnel_links table exists and accepts an insert', () => {
    // Get the first funnel to use as a valid reference
    const firstFunnel = testDb.select({ id: funnels.id }).from(funnels).get();
    expect(firstFunnel).toBeDefined();

    // Insert into funnel_links
    testDb.insert(funnelLinks).values({
      funnelId: firstFunnel!.id,
      label:    'Test Link',
      url:      'https://example.com',
      position: 0,
    }).run();

    const links = testDb.select().from(funnelLinks).all();
    expect(links.length).toBeGreaterThanOrEqual(1);
    expect(links[0].label).toBe('Test Link');
    expect(links[0].url).toBe('https://example.com');
  });
});
