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

  it('доливает manual_override в таблицу, созданную ранним вариантом Phase-6', () => {
    // Копия реальной БД: там monitor_targets создана до появления колонки,
    // то есть здесь реально проверяется ветка ALTER TABLE, а не CREATE TABLE.
    const cols = (sqlite.prepare(`PRAGMA table_info(monitor_targets)`).all() as { name: string }[])
      .map((c) => c.name);
    expect(cols).toContain('manual_override');

    runMigratePhase6(sqlite); // третий прогон — ALTER не должен дублироваться
    const again = (sqlite.prepare(`PRAGMA table_info(monitor_targets)`).all() as { name: string }[])
      .filter((c) => c.name === 'manual_override');
    expect(again).toHaveLength(1);
  });

  it('создаёт monitor_targets с manual_override и на пустой базе', () => {
    const fresh = new Database(':memory:');
    runMigratePhase6(fresh);
    const cols = (fresh.prepare(`PRAGMA table_info(monitor_targets)`).all() as { name: string }[])
      .map((c) => c.name);
    expect(cols).toContain('manual_override');

    fresh.prepare(`INSERT INTO monitor_targets (url, source_kind) VALUES ('https://x.ru/', 'landings')`).run();
    const row = fresh.prepare(`SELECT manual_override FROM monitor_targets`).get() as {
      manual_override: number;
    };
    expect(row.manual_override).toBe(0); // по умолчанию — «человек не трогал»
    fresh.close();
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
