import { describe, it, expect, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { copyFileSync, unlinkSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import * as schema from '../src/db/schema';
import { runMigratePhase5 } from '../scripts/migrate-phase5';
import { listTemplate, replaceTemplateScenario } from '../src/lib/tag-templates';

const REAL_DB = join(__dirname, '../../ksamata_funnels.db');
const TMP_DB = join(tmpdir(), `tpl_${Date.now()}_${process.pid}.db`);
copyFileSync(REAL_DB, TMP_DB);
const sqlite = new Database(TMP_DB);
sqlite.pragma('foreign_keys = ON');
runMigratePhase5(sqlite);
const db = drizzle(sqlite, { schema });

afterAll(() => { sqlite.close(); if (existsSync(TMP_DB)) unlinkSync(TMP_DB); });

describe('tag-templates', () => {
  it('lists the seeded template grouped by scenario in order', () => {
    const t = listTemplate(db);
    expect(t.reg).toEqual(['автоворонки', 'АВ Автоворонка', 'АВ Этап: Регистрация']);
    expect(t.messenger).toEqual(['автоворонки', 'АВ Автоворонка', 'АВ Этап: Мессенджер']);
  });

  it('replaceTemplateScenario swaps the whole ordered list for one scenario', () => {
    replaceTemplateScenario(db, 'reg', ['автоворонки', 'АВ Этап: Регистрация', 'новый-дефолт']);
    const t = listTemplate(db);
    expect(t.reg).toEqual(['автоворонки', 'АВ Этап: Регистрация', 'новый-дефолт']);
    expect(t.messenger).toEqual(['автоворонки', 'АВ Автоворонка', 'АВ Этап: Мессенджер']); // untouched
  });

  it('replace with empty list clears the scenario', () => {
    replaceTemplateScenario(db, 'time_15', []);
    expect(listTemplate(db).time_15).toEqual([]);
  });
});
