import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { listDays, replaceDays, type DayCell } from '../src/lib/funnel-days';
import * as schema from '../src/db/schema';
import { copyDbForTest } from './helpers/db';

const REAL_DB = path.resolve(process.cwd(), '..', 'ksamata_funnels.db');
let tmp: string;
let sqlite: Database.Database;
let db: ReturnType<typeof drizzle>;
let funnelId: number;

beforeEach(() => {
  tmp = path.join(os.tmpdir(), `fd-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  copyDbForTest(REAL_DB, tmp);
  sqlite = new Database(tmp);
  db = drizzle(sqlite, { schema });
  funnelId = (sqlite.prepare('SELECT id FROM funnels LIMIT 1').get() as { id: number }).id;
  sqlite.prepare('DELETE FROM funnel_days WHERE funnel_id = ?').run(funnelId);
});

afterEach(() => {
  sqlite.close();
  fs.rmSync(tmp, { force: true });
});

describe('funnel-days (rooms)', () => {
  it('replaceDays writes gc/web/replay and listDays reads them', () => {
    const cells: DayCell[] = [
      { timeSlot: '15', dayNum: 1, gcRoom: 'g1', webRoom: 'w1', replayUrl: 'r1' },
      { timeSlot: '19', dayNum: 1, gcRoom: 'g2', webRoom: 'w2', replayUrl: '' },
    ];
    replaceDays(db, funnelId, cells);
    const got = listDays(db, funnelId);
    expect(got).toContainEqual({ timeSlot: '15', dayNum: 1, gcRoom: 'g1', webRoom: 'w1', replayUrl: 'r1' });
    expect(got).toContainEqual({ timeSlot: '19', dayNum: 1, gcRoom: 'g2', webRoom: 'w2', replayUrl: '' });
  });

  it('empty cell deletes the row', () => {
    replaceDays(db, funnelId, [{ timeSlot: '15', dayNum: 1, gcRoom: 'g', webRoom: '', replayUrl: '' }]);
    replaceDays(db, funnelId, [{ timeSlot: '15', dayNum: 1, gcRoom: '', webRoom: '', replayUrl: '' }]);
    expect(listDays(db, funnelId)).toHaveLength(0);
  });

  it('preserves other columns (tariffs) on update', () => {
    replaceDays(db, funnelId, [{ timeSlot: '15', dayNum: 1, gcRoom: 'g', webRoom: '', replayUrl: '' }]);
    sqlite.prepare(`UPDATE funnel_days SET tariffs='https://t' WHERE funnel_id=? AND time_slot='15' AND day_num=1`).run(funnelId);
    replaceDays(db, funnelId, [{ timeSlot: '15', dayNum: 1, gcRoom: 'g2', webRoom: '', replayUrl: '' }]);
    const t = sqlite.prepare(`SELECT tariffs FROM funnel_days WHERE funnel_id=? AND time_slot='15' AND day_num=1`).get(funnelId) as { tariffs: string };
    expect(t.tariffs).toBe('https://t');
  });

  it('drops rows for days missing from the payload', () => {
    replaceDays(db, funnelId, [
      { timeSlot: '15', dayNum: 1, gcRoom: 'g1', webRoom: '', replayUrl: '' },
      { timeSlot: '15', dayNum: 2, gcRoom: 'g2', webRoom: '', replayUrl: '' },
      { timeSlot: '15', dayNum: 3, gcRoom: 'g3', webRoom: '', replayUrl: '' },
    ]);

    // Deleting the middle day shifts day 3 up into day 2 — the editor then
    // sends only days 1..2. Day 3 must not survive in the DB.
    replaceDays(db, funnelId, [
      { timeSlot: '15', dayNum: 1, gcRoom: 'g1', webRoom: '', replayUrl: '' },
      { timeSlot: '15', dayNum: 2, gcRoom: 'g3', webRoom: '', replayUrl: '' },
    ]);

    expect(listDays(db, funnelId)).toEqual([
      { timeSlot: '15', dayNum: 1, gcRoom: 'g1', webRoom: '', replayUrl: '' },
      { timeSlot: '15', dayNum: 2, gcRoom: 'g3', webRoom: '', replayUrl: '' },
    ]);
  });

  it('never touches days of another funnel', () => {
    const other = (sqlite
      .prepare('SELECT id FROM funnels WHERE id <> ? LIMIT 1')
      .get(funnelId) as { id: number }).id;
    sqlite.prepare('DELETE FROM funnel_days WHERE funnel_id = ?').run(other);
    replaceDays(db, other, [{ timeSlot: '19', dayNum: 4, gcRoom: 'keep', webRoom: '', replayUrl: '' }]);

    replaceDays(db, funnelId, [{ timeSlot: '15', dayNum: 1, gcRoom: 'g', webRoom: '', replayUrl: '' }]);

    expect(listDays(db, other)).toEqual([
      { timeSlot: '19', dayNum: 4, gcRoom: 'keep', webRoom: '', replayUrl: '' },
    ]);
  });

  it('rejects dayNum outside 1..5', () => {
    expect(() => replaceDays(db, funnelId, [{ timeSlot: '15', dayNum: 6, gcRoom: 'g', webRoom: '', replayUrl: '' }])).toThrow();
  });
});
