import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { runMigratePhase3 } from '../scripts/migrate-phase3';
import { runMigratePhase4 } from '../scripts/migrate-phase4';

const REAL_DB = path.resolve(process.cwd(), '..', 'ksamata_funnels.db');
let tmp: string;
let sqlite: Database.Database;

beforeEach(() => {
  tmp = path.join(os.tmpdir(), `ph4-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  fs.copyFileSync(REAL_DB, tmp);
  sqlite = new Database(tmp);
  runMigratePhase3(sqlite); // Phase-4 assumes Phase-3 tables/columns exist.
});

afterEach(() => {
  sqlite.close();
  fs.rmSync(tmp, { force: true });
});

function cols(table: string): string[] {
  return (sqlite.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((r) => r.name);
}

describe('runMigratePhase4', () => {
  it('adds the rooms_enabled column', () => {
    runMigratePhase4(sqlite);
    expect(cols('funnels')).toEqual(expect.arrayContaining(['rooms_enabled']));
  });

  it('backfill: funnel WITH day rows -> 1, funnel WITHOUT -> 0', () => {
    const withDays = sqlite
      .prepare(`SELECT funnel_id AS id FROM funnel_days GROUP BY funnel_id LIMIT 1`)
      .get() as { id: number } | undefined;
    const withoutDays = sqlite
      .prepare(`SELECT id FROM funnels WHERE id NOT IN (SELECT DISTINCT funnel_id FROM funnel_days) LIMIT 1`)
      .get() as { id: number } | undefined;

    runMigratePhase4(sqlite);

    if (withDays) {
      const r = sqlite.prepare(`SELECT rooms_enabled AS e FROM funnels WHERE id = ?`).get(withDays.id) as { e: number };
      expect(r.e).toBe(1);
    }
    if (withoutDays) {
      const r = sqlite.prepare(`SELECT rooms_enabled AS e FROM funnels WHERE id = ?`).get(withoutDays.id) as { e: number };
      expect(r.e).toBe(0);
    }
    expect(Boolean(withDays) || Boolean(withoutDays)).toBe(true);
  });

  it('records the backfill marker', () => {
    runMigratePhase4(sqlite);
    const marker = sqlite.prepare(`SELECT 1 FROM schema_migrations WHERE name = 'phase4_rooms_enabled'`).get();
    expect(marker).toBeTruthy();
  });

  it('is idempotent and does not re-run the backfill', () => {
    runMigratePhase4(sqlite);
    const disabled = sqlite.prepare(`SELECT id FROM funnels WHERE rooms_enabled = 0 LIMIT 1`).get() as { id: number } | undefined;
    if (disabled) sqlite.prepare(`UPDATE funnels SET rooms_enabled = 1 WHERE id = ?`).run(disabled.id);
    expect(() => runMigratePhase4(sqlite)).not.toThrow();
    expect(cols('funnels').filter((c) => c === 'rooms_enabled')).toHaveLength(1);
    if (disabled) {
      const r = sqlite.prepare(`SELECT rooms_enabled AS e FROM funnels WHERE id = ?`).get(disabled.id) as { e: number };
      expect(r.e).toBe(1); // untouched by the second run
    }
  });
});
