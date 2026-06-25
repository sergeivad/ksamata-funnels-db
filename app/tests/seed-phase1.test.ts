/**
 * Task 10 — Phase-1 seed test
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
import { eq } from 'drizzle-orm';
import * as schema from '../src/db/schema';
import { funnels, products, funnelTags, tags } from '../src/db/schema';
import { runSeed } from '../scripts/seed-phase1';
import { runMigratePhase3 } from '../scripts/migrate-phase3';

// __dirname = app/tests/ → go up 2 levels to repo root for the DB
const REAL_DB = join(__dirname, '../../ksamata_funnels.db');
const TMP_DB  = join(tmpdir(), `ksamata_seed_test_${Date.now()}_${process.pid}.db`);

// Copy real DB to temp location — never touch the real file
copyFileSync(REAL_DB, TMP_DB);

const sqlite = new Database(TMP_DB);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');
runMigratePhase3(sqlite);
const testDb = drizzle(sqlite, { schema });

afterAll(() => {
  sqlite.close();
  if (existsSync(TMP_DB)) unlinkSync(TMP_DB);
});

describe('runSeed (Phase-1)', () => {
  it('inserts 6 new funnels so total count == 38', () => {
    runSeed(testDb);

    const rows = testDb.select().from(funnels).all();
    expect(rows.length).toBe(38);
  });

  it('creates product ТКМ', () => {
    const row = testDb
      .select()
      .from(products)
      .where(eq(products.name, 'ТКМ'))
      .get();
    expect(row).toBeDefined();
    expect(row!.name).toBe('ТКМ');
  });

  it('num35 has status=draft and front_code=f34', () => {
    const row = testDb
      .select()
      .from(funnels)
      .where(eq(funnels.num, 35))
      .get();
    expect(row).toBeDefined();
    expect(row!.status).toBe('draft');
    expect(row!.frontCode).toBe('f34');
  });

  it('num36 reg funnelTags include АВ Продукт: ЖИВО and АВ Подрядчик: NR', () => {
    const num36 = testDb
      .select({ id: funnels.id })
      .from(funnels)
      .where(eq(funnels.num, 36))
      .get();
    expect(num36).toBeDefined();

    const tagRows = testDb
      .select({ name: tags.name })
      .from(funnelTags)
      .innerJoin(tags, eq(funnelTags.tagId, tags.id))
      .where(eq(funnelTags.funnelId, num36!.id))
      .all() as { name: string }[];

    const tagNames = tagRows.map((r) => r.name);
    expect(tagNames).toContain('АВ Продукт: ЖИВО');
    expect(tagNames).toContain('АВ Подрядчик: NR');
  });

  it('is idempotent — re-running keeps count at 38', () => {
    runSeed(testDb);

    const rows = testDb.select().from(funnels).all();
    expect(rows.length).toBe(38);
  });
});
