import { describe, it, expect, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { copyFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { eq } from 'drizzle-orm';
import * as schema from '../src/db/schema';
import { funnels } from '../src/db/schema';
import { runBackfill } from '../scripts/backfill-status';

// __dirname = app/tests/  →  go up 2 levels to repo root
const REAL_DB = join(__dirname, '../../ksamata_funnels.db');
const TMP_DB  = join(tmpdir(), `ksamata_test_${Date.now()}.db`);

// Copy real DB to a temp file — backfill runs against the copy only
copyFileSync(REAL_DB, TMP_DB);

const sqlite = new Database(TMP_DB);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');
const testDb = drizzle(sqlite, { schema });

afterAll(() => sqlite.close());

describe('runBackfill', () => {
  it('sets status=active for all rows; front_code=f<num> for num<=26; front_code="" for num>=27', () => {
    runBackfill(testDb);

    const rows = testDb.select().from(funnels).all();

    expect(rows.length).toBeGreaterThan(0);

    // All rows must have status = 'active'
    expect(rows.every(r => r.status === 'active')).toBe(true);

    // num 1–26: front_code must match /^f\d+$/
    const low = rows.filter(r => r.num <= 26);
    expect(low.every(r => /^f\d+$/.test(r.frontCode ?? ''))).toBe(true);

    // num >= 27: front_code must be blank (unknown / to be reconciled)
    const high = rows.filter(r => r.num >= 27);
    expect(high.length).toBeGreaterThan(0);
    expect(high.every(r => r.frontCode === '')).toBe(true);

    // Spot-checks: known good mappings
    const row1  = rows.find(r => r.num === 1);
    const row7  = rows.find(r => r.num === 7);
    const row26 = rows.find(r => r.num === 26);
    expect(row1?.frontCode).toBe('f1');
    expect(row7?.frontCode).toBe('f7');
    expect(row26?.frontCode).toBe('f26');

    // Spot-check: num 32 must be blank, NOT 'f32'
    const row32 = rows.find(r => r.num === 32);
    expect(row32?.frontCode).toBe('');
  });

  it('is idempotent — does not overwrite a genuinely manual front_code on num>=27', () => {
    // Set num=32's front_code to 'f31' (a manually reconciled code that does NOT
    // equal 'f32', so backfill must treat it as a human override and leave it alone).
    testDb
      .update(funnels)
      .set({ frontCode: 'f31' })
      .where(eq(funnels.num, 32))
      .run();

    // Run backfill — it must NOT clear 'f31' because 'f31' != 'f32'
    runBackfill(testDb);

    const rows = testDb.select().from(funnels).all();
    const row32 = rows.find(r => r.num === 32);
    expect(row32?.frontCode).toBe('f31');
  });

  it('clears auto-pattern values on num>=27 even when they were set manually to f{num}', () => {
    // Set num=30's front_code to 'f30' (the wrong auto-pattern value).
    testDb
      .update(funnels)
      .set({ frontCode: 'f30' })
      .where(eq(funnels.num, 30))
      .run();

    // Run backfill — 'f30' == 'f' || 30, so it IS the auto-pattern and must be cleared.
    runBackfill(testDb);

    const rows = testDb.select().from(funnels).all();
    const row30 = rows.find(r => r.num === 30);
    expect(row30?.frontCode).toBe('');
  });

  it('does not overwrite a manually-set front_code on num<=26', () => {
    // Pre-set num=1's front_code to 'f99' (unusual manual override)
    testDb
      .update(funnels)
      .set({ frontCode: 'f99' })
      .where(eq(funnels.num, 1))
      .run();

    // Run backfill again — it must NOT overwrite 'f99' (it is non-empty)
    runBackfill(testDb);

    const rows = testDb.select().from(funnels).all();
    const row1 = rows.find(r => r.num === 1);
    expect(row1?.frontCode).toBe('f99');
  });
});
