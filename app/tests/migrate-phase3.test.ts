import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { runMigratePhase3 } from '../scripts/migrate-phase3';

const REAL_DB = path.resolve(process.cwd(), '..', 'ksamata_funnels.db');
let tmp: string;
let sqlite: Database.Database;

beforeEach(() => {
  tmp = path.join(os.tmpdir(), `ph3-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  fs.copyFileSync(REAL_DB, tmp);
  sqlite = new Database(tmp);
});

afterEach(() => {
  sqlite.close();
  fs.rmSync(tmp, { force: true });
});

function cols(table: string): string[] {
  return (sqlite.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((r) => r.name);
}
function tableExists(name: string): boolean {
  return !!sqlite.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(name);
}

describe('runMigratePhase3', () => {
  it('adds new funnels columns', () => {
    runMigratePhase3(sqlite);
    expect(cols('funnels')).toEqual(expect.arrayContaining([
      'comment', 'time_label_a', 'time_label_b', 'rooms_replay_enabled',
    ]));
  });

  it('creates block tables', () => {
    runMigratePhase3(sqlite);
    expect(tableExists('funnel_blocks')).toBe(true);
    expect(tableExists('funnel_block_items')).toBe(true);
  });

  it('sets default time labels 15:00/19:00', () => {
    runMigratePhase3(sqlite);
    const row = sqlite.prepare('SELECT time_label_a, time_label_b FROM funnels LIMIT 1').get() as {
      time_label_a: string; time_label_b: string;
    };
    expect(row.time_label_a).toBe('15:00');
    expect(row.time_label_b).toBe('19:00');
  });

  it('is idempotent (second run does not throw)', () => {
    runMigratePhase3(sqlite);
    expect(() => runMigratePhase3(sqlite)).not.toThrow();
    expect(cols('funnels').filter((c) => c === 'comment')).toHaveLength(1);
  });
});
