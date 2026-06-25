import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { runMigratePhase3 } from '../scripts/migrate-phase3';
import { migrateFunnelData } from '../scripts/migrate-funnel-data';

let tmp: string;
let sqlite: Database.Database;

beforeEach(() => {
  tmp = path.join(os.tmpdir(), `mfd-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  sqlite = new Database(tmp);
  // Minimal fixture schema (subset of real DB needed by the migration)
  sqlite.exec(`
    CREATE TABLE funnels (
      id INTEGER PRIMARY KEY AUTOINCREMENT, num INTEGER, landing_url TEXT DEFAULT '',
      dash_sales_url TEXT DEFAULT '', dash_pereliv_url TEXT DEFAULT '',
      regi_total_url TEXT DEFAULT '', regi_15_url TEXT DEFAULT '', regi_19_url TEXT DEFAULT '',
      regi_notime_url TEXT DEFAULT '', predspisok_url TEXT DEFAULT ''
    );
    CREATE TABLE funnel_days (
      id INTEGER PRIMARY KEY AUTOINCREMENT, funnel_id INTEGER, time_slot TEXT, day_num INTEGER,
      gc_room TEXT DEFAULT '', web_room TEXT DEFAULT '', replay_url TEXT DEFAULT '', web_replay TEXT DEFAULT '',
      sales_page TEXT DEFAULT '', sales_note TEXT DEFAULT '', tariffs TEXT DEFAULT '', oto TEXT DEFAULT '',
      bonuses TEXT DEFAULT '', mission TEXT DEFAULT '', mission_type TEXT DEFAULT '',
      meditation TEXT DEFAULT '', dojim_note TEXT DEFAULT ''
    );
  `);
  runMigratePhase3(sqlite);
  sqlite.prepare(`INSERT INTO funnels (id, num, landing_url, dash_sales_url) VALUES (1, 1, 'https://land', 'https://dash')`).run();
  // tariffs only in slot 19 -> common; sales_page in both slots -> by_time
  sqlite.prepare(`INSERT INTO funnel_days (funnel_id,time_slot,day_num,tariffs,sales_page,replay_url,mission,mission_type)
                  VALUES (1,'19',1,'https://t19','https://s19','https://r19','https://m19','сейлбот')`).run();
  sqlite.prepare(`INSERT INTO funnel_days (funnel_id,time_slot,day_num,sales_page)
                  VALUES (1,'15',1,'https://s15')`).run();
});

afterEach(() => {
  sqlite.close();
  fs.rmSync(tmp, { force: true });
});

function blockItems(kind: string) {
  return sqlite.prepare(`
    SELECT i.slot, i.label, i.url FROM funnel_block_items i
    JOIN funnel_blocks b ON b.id = i.block_id
    WHERE b.funnel_id = 1 AND b.kind = ? ORDER BY i.position
  `).all(kind) as { slot: string | null; label: string; url: string }[];
}
function blockRow(kind: string) {
  return sqlite.prepare(`SELECT enabled, mode FROM funnel_blocks WHERE funnel_id=1 AND kind=?`).get(kind) as
    { enabled: number; mode: string } | undefined;
}

describe('migrateFunnelData', () => {
  it('migrates landing_url to landings (common)', () => {
    migrateFunnelData(sqlite);
    expect(blockItems('landings')).toEqual([{ slot: null, label: '', url: 'https://land' }]);
    expect(blockRow('landings')).toEqual({ enabled: 1, mode: 'common' });
  });

  it('single-slot tariffs -> common (slot null)', () => {
    migrateFunnelData(sqlite);
    expect(blockRow('tariffs')!.mode).toBe('common');
    expect(blockItems('tariffs')).toEqual([{ slot: null, label: '', url: 'https://t19' }]);
  });

  it('both-slot sales_page -> applications by_time (slots kept)', () => {
    migrateFunnelData(sqlite);
    expect(blockRow('applications')!.mode).toBe('by_time');
    const urls = blockItems('applications').map((i) => `${i.slot}:${i.url}`).sort();
    expect(urls).toEqual(['15:https://s15', '19:https://s19']);
  });

  it('mission -> processes with mission_type label', () => {
    migrateFunnelData(sqlite);
    expect(blockItems('processes')).toEqual([{ slot: null, label: 'сейлбот', url: 'https://m19' }]);
  });

  it('dashboard cols -> links', () => {
    migrateFunnelData(sqlite);
    expect(blockItems('links')).toEqual([{ slot: null, label: 'Дашборд продаж', url: 'https://dash' }]);
  });

  it('rooms_replay_enabled set when replay present; replay NOT in records', () => {
    migrateFunnelData(sqlite);
    const f = sqlite.prepare('SELECT rooms_replay_enabled FROM funnels WHERE id=1').get() as { rooms_replay_enabled: number };
    expect(f.rooms_replay_enabled).toBe(1);
    expect(blockRow('records')).toBeUndefined();
  });

  it('is idempotent (second run does not duplicate)', () => {
    migrateFunnelData(sqlite);
    migrateFunnelData(sqlite);
    expect(blockItems('tariffs')).toHaveLength(1);
  });
});
