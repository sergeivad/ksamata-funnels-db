/**
 * Backfill: messenger AV tags — tests
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
import { listFunnels } from '../src/lib/funnels';
import { runMigratePhase3 } from '../scripts/migrate-phase3';
import { runMigrateMessengerTagType } from '../scripts/migrate-messenger-tagtype';
import { runMigratePhase5 } from '../scripts/migrate-phase5';
import { runBackfillMessengerTags } from '../scripts/backfill-messenger-tags';

// __dirname = app/tests/ → go up 2 levels to repo root for the DB
const REAL_DB = join(__dirname, '../../ksamata_funnels.db');
const TMP_DB  = join(tmpdir(), `ksamata_funnels_test_backfill_messenger_${Date.now()}_${process.pid}.db`);

// Copy real DB to temp location — never touch the real file
copyFileSync(REAL_DB, TMP_DB);

const sqlite = new Database(TMP_DB);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');
runMigratePhase3(sqlite);
runMigrateMessengerTagType(sqlite);
runMigratePhase5(sqlite);
const testDb = drizzle(sqlite, { schema });

afterAll(() => {
  sqlite.close();
  if (existsSync(TMP_DB)) unlinkSync(TMP_DB);
});

describe('runBackfillMessengerTags', () => {
  it('processes every funnel returned by listFunnels', () => {
    const before = listFunnels(testDb);
    const count = runBackfillMessengerTags(testDb);
    expect(count).toBe(before.length);
    expect(count).toBeGreaterThan(0);
  });

  it('gives at least one existing funnel a messenger tag and a reg "автоворонки" tag', () => {
    const list = listFunnels(testDb);
    expect(list.length).toBeGreaterThan(0);
    const target = list[0];

    const messengerRows = testDb
      .select({ name: schema.tags.name })
      .from(schema.funnelTags)
      .innerJoin(schema.tags, eq(schema.funnelTags.tagId, schema.tags.id))
      .where(and(eq(schema.funnelTags.funnelId, target.id), eq(schema.funnelTags.tagType, 'messenger')))
      .all() as { name: string }[];

    expect(messengerRows.length).toBeGreaterThan(0);
    expect(messengerRows.some((r) => r.name === 'АВ Этап: Мессенджер')).toBe(true);

    const regRows = testDb
      .select({ name: schema.tags.name })
      .from(schema.funnelTags)
      .innerJoin(schema.tags, eq(schema.funnelTags.tagId, schema.tags.id))
      .where(and(eq(schema.funnelTags.funnelId, target.id), eq(schema.funnelTags.tagType, 'reg')))
      .all() as { name: string }[];

    expect(regRows.some((r) => r.name === 'автоворонки')).toBe(true);
  });

  it('is idempotent: running it again does not duplicate messenger tags', () => {
    const list = listFunnels(testDb);
    const target = list[0];

    runBackfillMessengerTags(testDb);
    runBackfillMessengerTags(testDb);

    const messengerRows = testDb
      .select({ tagId: schema.funnelTags.tagId })
      .from(schema.funnelTags)
      .where(and(eq(schema.funnelTags.funnelId, target.id), eq(schema.funnelTags.tagType, 'messenger')))
      .all() as { tagId: number }[];

    const uniqueTagIds = new Set(messengerRows.map((r) => r.tagId));
    expect(messengerRows.length).toBe(uniqueTagIds.size);
  });
});
