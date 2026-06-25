/**
 * Task 5 — funnel-links helper tests
 *
 * ISOLATION: All tests operate on a TEMP COPY of the DB.
 * The real ksamata_funnels.db is NEVER opened directly by these tests.
 */
import { describe, it, expect, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';
import { copyFileSync, unlinkSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import * as schema from '../src/db/schema';
import { listLinks, replaceLinks } from '../src/lib/funnel-links';

// __dirname = app/tests/ → go up 2 levels to repo root for the DB
const REAL_DB = join(__dirname, '../../ksamata_funnels.db');
const TMP_DB  = join(tmpdir(), `ksamata_funnels_links_test_${Date.now()}_${process.pid}.db`);

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

// Use funnel num=33 (no existing links) and num=32 for isolation test
function getFunnel(num: number) {
  return testDb.select().from(schema.funnels).where(eq(schema.funnels.num, num)).get()!;
}

describe('listLinks', () => {
  it('returns empty array for funnel with no links', () => {
    const funnel = getFunnel(33);
    const links = listLinks(testDb, funnel.id);
    expect(links).toEqual([]);
  });
});

describe('replaceLinks — create and replace', () => {
  it('inserts 2 items in position order 0,1 with correct label/url', () => {
    const funnel = getFunnel(33);
    replaceLinks(testDb, funnel.id, [
      { label: 'Дашборд', url: 'https://x' },
      { label: 'Отчёт',   url: 'https://y' },
    ]);

    const links = listLinks(testDb, funnel.id);
    expect(links).toHaveLength(2);
    expect(links[0]).toMatchObject({ label: 'Дашборд', url: 'https://x', position: 0 });
    expect(links[1]).toMatchObject({ label: 'Отчёт',   url: 'https://y', position: 1 });
    expect(typeof links[0].id).toBe('number');
    expect(typeof links[1].id).toBe('number');
  });

  it('replaces with a single item — old 2 are gone, new one is at position 0', () => {
    const funnel = getFunnel(33);
    replaceLinks(testDb, funnel.id, [
      { label: 'Один', url: 'https://z' },
    ]);

    const links = listLinks(testDb, funnel.id);
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ label: 'Один', url: 'https://z', position: 0 });
  });

  it('replaces with empty array — clears all links', () => {
    const funnel = getFunnel(33);
    replaceLinks(testDb, funnel.id, []);

    const links = listLinks(testDb, funnel.id);
    expect(links).toEqual([]);
  });
});

describe('replaceLinks — isolation between funnels', () => {
  it('links for funnel A do not affect funnel B', () => {
    const funnelA = getFunnel(33);
    const funnelB = getFunnel(32);

    replaceLinks(testDb, funnelA.id, [
      { label: 'A-link', url: 'https://a' },
    ]);
    replaceLinks(testDb, funnelB.id, [
      { label: 'B-link', url: 'https://b' },
    ]);

    const linksA = listLinks(testDb, funnelA.id);
    const linksB = listLinks(testDb, funnelB.id);

    expect(linksA).toHaveLength(1);
    expect(linksA[0].label).toBe('A-link');

    expect(linksB).toHaveLength(1);
    expect(linksB[0].label).toBe('B-link');

    // Now clear A — B must be unaffected
    replaceLinks(testDb, funnelA.id, []);
    expect(listLinks(testDb, funnelA.id)).toEqual([]);
    expect(listLinks(testDb, funnelB.id)).toHaveLength(1);
  });
});
