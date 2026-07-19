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
import { runMigratePhase3 } from '../scripts/migrate-phase3';
import { runMigratePhase5 } from '../scripts/migrate-phase5';

// __dirname = app/tests/  →  go up 2 levels to repo root
const REAL_DB = join(__dirname, '../../ksamata_funnels.db');
const TMP_DB  = join(tmpdir(), `ksamata_test_${Date.now()}.db`);

// Copy real DB to a temp file — backfill runs against the copy only
copyFileSync(REAL_DB, TMP_DB);

const sqlite = new Database(TMP_DB);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');
runMigratePhase3(sqlite);
runMigratePhase5(sqlite);
const testDb = drizzle(sqlite, { schema });

afterAll(() => sqlite.close());

describe('runBackfill', () => {
  it('applies transformation rules on a controlled pre-state (independent of seed data)', () => {
    // ── Establish a controlled pre-state ────────────────────────────────────────
    // 1. Blank ALL front_codes so we start from a known baseline.
    testDb.update(funnels).set({ frontCode: '' }).run();

    // 2. Set a manual (non-auto) front_code on a num<=26 row — must be PRESERVED
    //    because backfill only fills in when the value is empty.
    testDb.update(funnels).set({ frontCode: 'fXX' }).where(eq(funnels.num, 5)).run();

    // 3. Set the auto-pattern front_code on a num>=27 row — must be CLEARED to ''.
    testDb.update(funnels).set({ frontCode: 'f30' }).where(eq(funnels.num, 30)).run();

    // 4. Set a manual non-auto front_code on a num>=27 row — must be PRESERVED.
    testDb.update(funnels).set({ frontCode: 'f31' }).where(eq(funnels.num, 32)).run();

    // 5. Blank the status on one row so backfill fills it in.
    testDb.update(funnels).set({ status: '' }).where(eq(funnels.num, 7)).run();

    // 6. Set a non-empty status on another row — backfill must NOT change it.
    testDb.update(funnels).set({ status: 'draft' }).where(eq(funnels.num, 10)).run();

    // ── Run backfill ─────────────────────────────────────────────────────────────
    runBackfill(testDb);

    const rows = testDb.select().from(funnels).all();
    expect(rows.length).toBeGreaterThan(0);

    // ── Assert transformation RULES on representative rows ────────────────────

    // Rule 1: num<=26 with previously-blank front_code → filled to f{num}
    const row1 = rows.find(r => r.num === 1);
    const row7 = rows.find(r => r.num === 7);
    const row26 = rows.find(r => r.num === 26);
    expect(row1?.frontCode).toBe('f1');
    expect(row7?.frontCode).toBe('f7');
    expect(row26?.frontCode).toBe('f26');

    // Rule 2: num<=26 with a manual value → PRESERVED (not overwritten)
    const row5 = rows.find(r => r.num === 5);
    expect(row5?.frontCode).toBe('fXX');

    // Rule 3: num>=27 with auto-pattern 'f{num}' → CLEARED to ''
    const row30 = rows.find(r => r.num === 30);
    expect(row30?.frontCode).toBe('');

    // Rule 4: num>=27 with manual non-auto value → PRESERVED
    const row32 = rows.find(r => r.num === 32);
    expect(row32?.frontCode).toBe('f31');

    // Rule 5: blank status → filled with 'active'
    const row7status = rows.find(r => r.num === 7);
    expect(row7status?.status).toBe('active');

    // Rule 6: non-empty status ('draft') → unchanged
    const row10 = rows.find(r => r.num === 10);
    expect(row10?.status).toBe('draft');
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
