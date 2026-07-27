import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { runMigratePhase3 } from '../scripts/migrate-phase3';
import { runMigratePhase4 } from '../scripts/migrate-phase4';
import { copyDbForTest } from './helpers/db';

const REAL_DB = path.resolve(process.cwd(), '..', 'ksamata_funnels.db');
let tmp: string;
let sqlite: Database.Database;

beforeEach(() => {
  tmp = path.join(os.tmpdir(), `ph4-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  copyDbForTest(REAL_DB, tmp);
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

function roomsEnabled(id: number): number {
  return (sqlite.prepare(`SELECT rooms_enabled AS e FROM funnels WHERE id = ?`)
    .get(id) as { e: number }).e;
}

/**
 * Готовит копию так, чтобы бэкфилл РЕАЛЬНО отработал, и возвращает две воронки
 * по разные стороны его правила.
 *
 * Живая база давно несёт маркер `phase4_rooms_enabled`, поэтому
 * `backfillRoomsEnabled` выходил по нему сразу, и тесты ниже никогда не
 * проверяли бэкфилл — они читали то, что и так лежало в данных. Держалось это
 * на существовании воронки без дней с `rooms_enabled = 0`, а такая осталась
 * ровно одна: пустой черновик num=39, заведённый ПОСЛЕ фазы 4 и получивший
 * ноль от createDraftFunnel, а не от миграции. Его удалили 2026-07-27 — и
 * проверка развалилась, ничего при этом не сломав в коде.
 *
 * Поэтому: снимаем маркер и выставляем обеим воронкам единицу. Ноль после
 * прогона может взяться только из самого бэкфилла.
 */
function armBackfill(): { withDays: number; withoutDays: number } {
  const withDays = sqlite
    .prepare(`SELECT funnel_id AS id FROM funnel_days GROUP BY funnel_id LIMIT 1`)
    .get() as { id: number } | undefined;
  const withoutDays = sqlite
    .prepare(`SELECT id FROM funnels WHERE id NOT IN (SELECT DISTINCT funnel_id FROM funnel_days) LIMIT 1`)
    .get() as { id: number } | undefined;
  if (!withDays || !withoutDays) {
    throw new Error('в копии базы нет воронок по обе стороны правила бэкфилла');
  }

  runMigratePhase4(sqlite); // колонка нужна раньше, чем мы в неё пишем
  sqlite.exec(`DELETE FROM schema_migrations WHERE name = 'phase4_rooms_enabled'`);
  sqlite.exec(`UPDATE funnels SET rooms_enabled = 1`);
  return { withDays: withDays.id, withoutDays: withoutDays.id };
}

describe('runMigratePhase4', () => {
  it('adds the rooms_enabled column', () => {
    runMigratePhase4(sqlite);
    expect(cols('funnels')).toEqual(expect.arrayContaining(['rooms_enabled']));
  });

  it('backfill: funnel WITH day rows -> 1, funnel WITHOUT -> 0', () => {
    const { withDays, withoutDays } = armBackfill();

    runMigratePhase4(sqlite);

    expect(roomsEnabled(withDays)).toBe(1);
    expect(roomsEnabled(withoutDays)).toBe(0);
  });

  it('records the backfill marker', () => {
    runMigratePhase4(sqlite);
    const marker = sqlite.prepare(`SELECT 1 FROM schema_migrations WHERE name = 'phase4_rooms_enabled'`).get();
    expect(marker).toBeTruthy();
  });

  it('is idempotent and does not re-run the backfill', () => {
    const { withoutDays } = armBackfill();
    runMigratePhase4(sqlite);
    expect(roomsEnabled(withoutDays)).toBe(0); // бэкфилл отработал

    // Ручное переключение после миграции второй прогон обязан оставить в покое.
    sqlite.prepare(`UPDATE funnels SET rooms_enabled = 1 WHERE id = ?`).run(withoutDays);
    expect(() => runMigratePhase4(sqlite)).not.toThrow();
    expect(cols('funnels').filter((c) => c === 'rooms_enabled')).toHaveLength(1);
    expect(roomsEnabled(withoutDays)).toBe(1);
  });
});
