/**
 * Task 4 — funnel-days helper tests
 *
 * ISOLATION: All tests operate on a TEMP COPY of the DB.
 * The real ksamata_funnels.db is NEVER opened directly by these tests.
 */
import { describe, it, expect, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq, and } from 'drizzle-orm';
import { copyFileSync, unlinkSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import * as schema from '../src/db/schema';
import { listDays, replaceDays } from '../src/lib/funnel-days';

// __dirname = app/tests/ → go up 2 levels to repo root for the DB
const REAL_DB = join(__dirname, '../../ksamata_funnels.db');
const TMP_DB  = join(tmpdir(), `ksamata_funnels_days_test_${Date.now()}_${process.pid}.db`);

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

// Funnel 33 (num=33) has no funnel_days rows
// Funnel id=2 (num=2) has populated rows with tariffs

describe('listDays', () => {
  it('returns empty array for funnel with no days', () => {
    // funnel id=33 (num=33) has no funnel_days
    const funnel = testDb.select().from(schema.funnels).where(eq(schema.funnels.num, 33)).get()!;
    const days = listDays(testDb, funnel.id);
    expect(days).toEqual([]);
  });
});

describe('replaceDays — create and delete', () => {
  it('creates a row when given one non-empty cell', () => {
    const funnel = testDb.select().from(schema.funnels).where(eq(schema.funnels.num, 33)).get()!;

    replaceDays(testDb, funnel.id, [
      { timeSlot: '19', dayNum: 1, gcRoom: 'gc-test', webRoom: 'web-test', salesPage: 'sales-test' },
    ]);

    const days = listDays(testDb, funnel.id);
    expect(days).toHaveLength(1);
    expect(days[0]).toEqual({
      timeSlot: '19',
      dayNum: 1,
      gcRoom: 'gc-test',
      webRoom: 'web-test',
      salesPage: 'sales-test',
    });
  });

  it('deletes the row when all three fields are empty', () => {
    const funnel = testDb.select().from(schema.funnels).where(eq(schema.funnels.num, 33)).get()!;

    // Ensure the row exists first (from the previous test)
    replaceDays(testDb, funnel.id, [
      { timeSlot: '19', dayNum: 1, gcRoom: '', webRoom: '', salesPage: '' },
    ]);

    const days = listDays(testDb, funnel.id);
    expect(days).toEqual([]);
  });
});

describe('replaceDays — preservation of other columns', () => {
  it('does not overwrite tariffs when updating gc_room on an existing row', () => {
    // funnel id=2 (num=2) has rows with tariffs set; get funnel id first
    const funnel = testDb.select().from(schema.funnels).where(eq(schema.funnels.num, 2)).get()!;

    // Read the existing row for time_slot=19, day_num=1 to know its tariffs
    const rowBefore = testDb
      .select()
      .from(schema.funnelDays)
      .where(
        and(
          eq(schema.funnelDays.funnelId, funnel.id),
          eq(schema.funnelDays.timeSlot, '19'),
          eq(schema.funnelDays.dayNum, 1),
        )
      )
      .get()!;

    expect(rowBefore.tariffs).toBeTruthy(); // confirm pre-condition

    // Now update only gc_room
    replaceDays(testDb, funnel.id, [
      {
        timeSlot: '19',
        dayNum: 1,
        gcRoom: 'new-gc-room',
        webRoom: rowBefore.webRoom ?? '',
        salesPage: rowBefore.salesPage ?? '',
      },
    ]);

    // Re-read from DB and assert tariffs is unchanged
    const rowAfter = testDb
      .select()
      .from(schema.funnelDays)
      .where(
        and(
          eq(schema.funnelDays.funnelId, funnel.id),
          eq(schema.funnelDays.timeSlot, '19'),
          eq(schema.funnelDays.dayNum, 1),
        )
      )
      .get()!;

    expect(rowAfter.gcRoom).toBe('new-gc-room');
    expect(rowAfter.tariffs).toBe(rowBefore.tariffs);
  });
});

describe('replaceDays — input validation', () => {
  it('throws on invalid timeSlot', () => {
    const funnel = testDb.select().from(schema.funnels).where(eq(schema.funnels.num, 33)).get()!;

    expect(() =>
      replaceDays(testDb, funnel.id, [
        // @ts-expect-error intentional bad input
        { timeSlot: '20', dayNum: 1, gcRoom: 'x', webRoom: 'y', salesPage: 'z' },
      ])
    ).toThrow(/timeSlot/i);
  });

  it('throws on invalid dayNum (out of range)', () => {
    const funnel = testDb.select().from(schema.funnels).where(eq(schema.funnels.num, 33)).get()!;

    expect(() =>
      replaceDays(testDb, funnel.id, [
        { timeSlot: '19', dayNum: 6, gcRoom: 'x', webRoom: 'y', salesPage: 'z' },
      ])
    ).toThrow(/dayNum/i);
  });
});
