import { describe, it, expect, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { copyFileSync, unlinkSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import * as schema from '../src/db/schema';
import { runMigratePhase5 } from '../scripts/migrate-phase5';
import { listOverrides, replaceOverrides } from '../src/lib/tag-overrides';
import type { OverrideMap } from '../src/lib/ab-tags';

const REAL_DB = join(__dirname, '../../ksamata_funnels.db');
const TMP_DB = join(tmpdir(), `ovr_${Date.now()}_${process.pid}.db`);
copyFileSync(REAL_DB, TMP_DB);
const sqlite = new Database(TMP_DB);
sqlite.pragma('foreign_keys = ON');
runMigratePhase5(sqlite);
const db = drizzle(sqlite, { schema });

// Any existing funnel id from the seeded DB.
const FID = (sqlite.prepare(`SELECT id FROM funnels LIMIT 1`).get() as { id: number }).id;

afterAll(() => { sqlite.close(); if (existsSync(TMP_DB)) unlinkSync(TMP_DB); });

const empty = (): OverrideMap => ({
  reg: { add: [], remove: [] },
  time_15: { add: [], remove: [] },
  time_19: { add: [], remove: [] },
  messenger: { add: [], remove: [] },
});

describe('tag-overrides', () => {
  it('round-trips add/remove per scenario', () => {
    const ov = empty();
    ov.reg.add = ['промо-январь'];
    ov.reg.remove = ['автоворонки'];
    ov.time_15.add = ['xmas'];
    replaceOverrides(db, FID, ov);

    const back = listOverrides(db, FID);
    expect(back.reg.add).toEqual(['промо-январь']);
    expect(back.reg.remove).toEqual(['автоворонки']);
    expect(back.time_15.add).toEqual(['xmas']);
    expect(back.messenger).toEqual({ add: [], remove: [] });
  });

  it('replace fully swaps previous overrides', () => {
    replaceOverrides(db, FID, empty());
    const back = listOverrides(db, FID);
    expect(back.reg).toEqual({ add: [], remove: [] });
  });

  it('drops axis-tag removes defensively', () => {
    const ov = empty();
    ov.reg.remove = ['АВ Продукт: ТКМ', 'автоворонки'];
    replaceOverrides(db, FID, ov);
    expect(listOverrides(db, FID).reg.remove).toEqual(['автоворонки']);
  });
});
