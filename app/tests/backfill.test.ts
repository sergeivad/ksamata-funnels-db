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
  it('sets status=active and front_code=f<num> for all rows', () => {
    runBackfill(testDb);

    const rows = testDb.select().from(funnels).all();

    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every(r => r.status === 'active')).toBe(true);
    expect(rows.every(r => /^f\d+$/.test(r.frontCode ?? ''))).toBe(true);

    // Spot-check: num=1 → front_code='f1', num=7 → 'f7'
    const row1 = rows.find(r => r.num === 1);
    const row7 = rows.find(r => r.num === 7);
    expect(row1?.frontCode).toBe('f1');
    expect(row7?.frontCode).toBe('f7');
  });

  it('is idempotent — does not overwrite a manually-set front_code', () => {
    // Pre-set one row to a custom front_code
    const customRow = testDb.select().from(funnels).all()[0];
    testDb
      .update(funnels)
      .set({ frontCode: 'f99' })
      .where(eq(funnels.num, customRow.num))
      .run();

    // Run backfill again — it must NOT overwrite 'f99'
    runBackfill(testDb);

    const rows = testDb.select().from(funnels).all();
    const updated = rows.find(r => r.num === customRow.num);
    expect(updated?.frontCode).toBe('f99');
  });
});
