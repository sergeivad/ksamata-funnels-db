import { describe, it, expect, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { copyFileSync, unlinkSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { runMigratePhase6 } from '../scripts/migrate-phase6';

const REAL_DB = join(__dirname, '../../ksamata_funnels.db');
const TMP_DB = join(tmpdir(), `p6_${Date.now()}_${process.pid}.db`);
copyFileSync(REAL_DB, TMP_DB);
const sqlite = new Database(TMP_DB);
sqlite.pragma('foreign_keys = ON');

afterAll(() => { sqlite.close(); if (existsSync(TMP_DB)) unlinkSync(TMP_DB); });

describe('migrate-phase6', () => {
  it('создаёт четыре таблицы мониторинга идемпотентно', () => {
    runMigratePhase6(sqlite);
    runMigratePhase6(sqlite); // второй прогон не должен падать

    const tables = sqlite
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='table'
           AND name IN ('monitor_targets','monitor_target_funnels','monitor_state','monitor_events')`
      )
      .all() as { name: string }[];
    expect(tables.map((t) => t.name).sort()).toEqual([
      'monitor_events',
      'monitor_state',
      'monitor_target_funnels',
      'monitor_targets',
    ]);
  });

  it('держит url уникальным', () => {
    sqlite.prepare(`INSERT INTO monitor_targets (url, source_kind) VALUES (?, ?)`)
      .run('https://example.com/a', 'landings');
    expect(() =>
      sqlite.prepare(`INSERT INTO monitor_targets (url, source_kind) VALUES (?, ?)`)
        .run('https://example.com/a', 'links')
    ).toThrow();
  });

  it('ограничивает status допустимым набором', () => {
    const t = sqlite.prepare(`SELECT id FROM monitor_targets WHERE url = ?`)
      .get('https://example.com/a') as { id: number };
    expect(() =>
      sqlite.prepare(`INSERT INTO monitor_state (target_id, status) VALUES (?, ?)`)
        .run(t.id, 'broken')
    ).toThrow();
  });

  it('каскадно удаляет состояние и события вместе с целью', () => {
    const t = sqlite.prepare(`SELECT id FROM monitor_targets WHERE url = ?`)
      .get('https://example.com/a') as { id: number };
    sqlite.prepare(`INSERT INTO monitor_state (target_id, status) VALUES (?, 'up')`).run(t.id);
    sqlite.prepare(
      `INSERT INTO monitor_events (target_id, from_status, to_status) VALUES (?, 'up', 'down')`
    ).run(t.id);

    sqlite.prepare(`DELETE FROM monitor_targets WHERE id = ?`).run(t.id);

    const state = sqlite.prepare(`SELECT COUNT(*) AS c FROM monitor_state WHERE target_id = ?`)
      .get(t.id) as { c: number };
    const events = sqlite.prepare(`SELECT COUNT(*) AS c FROM monitor_events WHERE target_id = ?`)
      .get(t.id) as { c: number };
    expect(state.c).toBe(0);
    expect(events.c).toBe(0);
  });
});
