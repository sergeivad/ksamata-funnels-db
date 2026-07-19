import { describe, it, expect, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { copyFileSync, unlinkSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import * as schema from '../src/db/schema';
import { runMigratePhase3 } from '../scripts/migrate-phase3';
import { runMigrateMessengerTagType } from '../scripts/migrate-messenger-tagtype';
import { runMigratePhase5 } from '../scripts/migrate-phase5';
import { createFunnel, updateFunnel, getFunnel } from '../src/lib/funnels';
import { replaceOverrides } from '../src/lib/tag-overrides';
import type { OverrideMap } from '../src/lib/ab-tags';

const REAL_DB = join(__dirname, '../../ksamata_funnels.db');
const TMP_DB = join(tmpdir(), `mat_${Date.now()}_${process.pid}.db`);
copyFileSync(REAL_DB, TMP_DB);
const sqlite = new Database(TMP_DB);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');
runMigratePhase3(sqlite);
runMigrateMessengerTagType(sqlite);
runMigratePhase5(sqlite);
const db = drizzle(sqlite, { schema });

afterAll(() => { sqlite.close(); if (existsSync(TMP_DB)) unlinkSync(TMP_DB); });

const nextNum = () => (sqlite.prepare(`SELECT COALESCE(MAX(num),0)+1 AS n FROM funnels`).get() as { n: number }).n;

function makeFunnel(product: string) {
  return createFunnel(db, {
    num: nextNum(), frontCode: '', status: 'active', productName: '', variant: '',
    landingUrl: '', startDate: '', blockName: '',
    product, contractor: 'НИМБ', channel: 'Яндекс', direction: 'РСЯ',
  } as any);
}

describe('materialize on create', () => {
  it('reg tagSet = template defaults + axis tags', () => {
    const f = makeFunnel('СУСТАВЫ');
    const d = getFunnel(db, f.id)!;
    const names = d.tagSets.reg.tags.map((t) => t.name);
    expect(names).toContain('автоворонки');
    expect(names).toContain('АВ Этап: Регистрация');
    expect(names).toContain('АВ Продукт: СУСТАВЫ');
  });
});

describe('Variant A — overrides survive an axis change', () => {
  it('keeps added, keeps removed, updates axis tag', () => {
    const f = makeFunnel('СУСТАВЫ');

    // User adds a custom tag and removes a default, then re-materialize.
    const ov: OverrideMap = {
      reg: { add: ['промо-январь'], remove: ['автоворонки'] },
      time_15: { add: [], remove: [] },
      time_19: { add: [], remove: [] },
      messenger: { add: [], remove: [] },
    };
    replaceOverrides(db, f.id, ov);
    updateFunnel(db, f.id, { product: 'СУСТАВЫ' } as any); // re-materialize, axis unchanged

    let names = getFunnel(db, f.id)!.tagSets.reg.tags.map((t) => t.name);
    expect(names).toContain('промо-январь');
    expect(names).not.toContain('автоворонки');
    expect(names).toContain('АВ Продукт: СУСТАВЫ');

    // Change the product axis — overrides must persist, axis tag must update.
    updateFunnel(db, f.id, { product: 'ЖКТ' } as any);
    names = getFunnel(db, f.id)!.tagSets.reg.tags.map((t) => t.name);
    expect(names).toContain('промо-январь');       // added survives
    expect(names).not.toContain('автоворонки');     // removed stays removed
    expect(names).toContain('АВ Продукт: ЖКТ');      // axis updated
    expect(names).not.toContain('АВ Продукт: СУСТАВЫ');
    expect(getFunnel(db, f.id)!.tagSets.reg.suppressed).toContain('автоворонки');
  });
});
