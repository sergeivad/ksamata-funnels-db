import { describe, it, expect, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { copyFileSync, unlinkSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { runMigratePhase5 } from '../scripts/migrate-phase5';

const REAL_DB = join(__dirname, '../../ksamata_funnels.db');
const TMP_DB = join(tmpdir(), `p5_${Date.now()}_${process.pid}.db`);
copyFileSync(REAL_DB, TMP_DB);
const sqlite = new Database(TMP_DB);
sqlite.pragma('foreign_keys = ON');

afterAll(() => { sqlite.close(); if (existsSync(TMP_DB)) unlinkSync(TMP_DB); });

describe('migrate-phase5', () => {
  it('creates both tables and seeds the template idempotently', () => {
    runMigratePhase5(sqlite);
    runMigratePhase5(sqlite); // idempotent — second run must not throw or double-seed

    const tables = sqlite.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name IN ('tag_templates','funnel_tag_overrides')`
    ).all() as { name: string }[];
    expect(tables.map((t) => t.name).sort()).toEqual(['funnel_tag_overrides', 'tag_templates']);

    const reg = sqlite.prepare(
      `SELECT name FROM tag_templates WHERE scenario='reg' ORDER BY position`
    ).all() as { name: string }[];
    expect(reg.map((r) => r.name)).toEqual(['автоворонки', 'АВ Автоворонка', 'АВ Этап: Регистрация']);

    const time15 = sqlite.prepare(
      `SELECT name FROM tag_templates WHERE scenario='time_15' ORDER BY position`
    ).all() as { name: string }[];
    expect(time15.map((r) => r.name)).toEqual(['автоворонки', 'АВ Автоворонка', 'АВ Этап: Оплата', 'АВ Время: 15']);

    const count = sqlite.prepare(`SELECT COUNT(*) AS c FROM tag_templates`).get() as { c: number };
    expect(count.c).toBe(3 + 4 + 4 + 3); // reg + time_15 + time_19 + messenger, seeded once
  });
});
