import { describe, it, expect, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { copyFileSync, unlinkSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { eq, and } from 'drizzle-orm';
import * as schema from '../src/db/schema';
import { funnelTags, tags, funnelTypes } from '../src/db/schema';
import { runMigratePhase3 } from '../scripts/migrate-phase3';
import { runMigrateMessengerTagType } from '../scripts/migrate-messenger-tagtype';
import { runMigratePhase5 } from '../scripts/migrate-phase5';
import { runMigratePhase7 } from '../scripts/migrate-phase7';
import { createFunnel, updateFunnel, getFunnel } from '../src/lib/funnels';
import { replaceOverrides } from '../src/lib/tag-overrides';
import type { OverrideMap, Scenario } from '../src/lib/ab-tags';
import { ValidationError } from '../src/lib/errors';
import { copyDbForTest } from './helpers/db';

const REAL_DB = join(__dirname, '../../ksamata_funnels.db');
const TMP_DB = join(tmpdir(), `mat_${Date.now()}_${process.pid}.db`);
copyDbForTest(REAL_DB, TMP_DB);
const sqlite = new Database(TMP_DB);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');
runMigratePhase3(sqlite);
runMigrateMessengerTagType(sqlite);
runMigratePhase5(sqlite);
runMigratePhase7(sqlite);
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
    // 'АВ Автоворонка' здесь больше не проверяем: makeFunnel не задаёт
    // funnelType, поэтому у свежесозданной воронки type.name === null, а
    // «АВ Автоворонка» как ИМЯ ИЗВЕСТНОГО ТИПА гасится из шаблонного слоя
    // (см. computeTagSet/isIdentity в ab-tags.ts) и не всплывает из осевого —
    // ей просто неоткуда взяться без явного выбора типа. Это не баг:
    // окно двоевластия шаблон/справочник типов закрывает задача 6.
    expect(names).toContain('АВ Этап: Регистрация');
    expect(names).toContain('АВ Продукт: СУСТАВЫ');
  });
});

describe('Variant A — overrides survive an axis change', () => {
  it('keeps added, keeps removed, updates axis tag', () => {
    const f = makeFunnel('СУСТАВЫ');

    // User adds a custom tag and removes a default, then re-materialize.
    // Взят 'АВ Этап: Регистрация', а не 'АВ Автоворонка': последнее теперь
    // ещё и имя известного типа (funnel_types), а такие имена неудаляемы
    // через remove (identity-слой, см. computeTagSet) — этот тест проверяет
    // именно removable-дефолт, а не identity-тег.
    const ov: OverrideMap = {
      reg: { add: ['промо-январь'], remove: ['АВ Этап: Регистрация'] },
      time_15: { add: [], remove: [] },
      time_19: { add: [], remove: [] },
      messenger: { add: [], remove: [] },
    };
    replaceOverrides(db, f.id, ov);
    updateFunnel(db, f.id, { product: 'СУСТАВЫ' } as any); // re-materialize, axis unchanged

    let names = getFunnel(db, f.id)!.tagSets.reg.tags.map((t) => t.name);
    expect(names).toContain('промо-январь');
    expect(names).not.toContain('АВ Этап: Регистрация');
    expect(names).toContain('АВ Продукт: СУСТАВЫ');

    // Change the product axis — overrides must persist, axis tag must update.
    updateFunnel(db, f.id, { product: 'ЖКТ' } as any);
    names = getFunnel(db, f.id)!.tagSets.reg.tags.map((t) => t.name);
    expect(names).toContain('промо-январь');       // added survives
    expect(names).not.toContain('АВ Этап: Регистрация');  // removed stays removed
    expect(names).toContain('АВ Продукт: ЖКТ');      // axis updated
    expect(names).not.toContain('АВ Продукт: СУСТАВЫ');
    expect(getFunnel(db, f.id)!.tagSets.reg.suppressed).toContain('АВ Этап: Регистрация');
  });
});

function listFunnelTagNames(dbh: typeof db, funnelId: number, tagType: string): string[] {
  return (dbh.select({ name: tags.name }).from(funnelTags)
    .innerJoin(tags, eq(tags.id, funnelTags.tagId))
    .where(and(eq(funnelTags.funnelId, funnelId), eq(funnelTags.tagType, tagType as Scenario)))
    .all() as { name: string }[]).map((r) => r.name);
}

describe('тип воронки участвует в материализации', () => {
  it('смена типа без осей перематериализует теги', () => {
    const created = createFunnel(db, {
      num: 9001, frontCode: 'ftest', status: 'draft', productName: '', variant: '',
      landingUrl: '', startDate: '', product: 'ЖИВО', contractor: 'НИМБ',
      channel: 'Яндекс', direction: 'РСЯ',
    } as any);

    updateFunnel(db, created.id, { funnelType: 'АВ Квиз' } as any);

    const names = listFunnelTagNames(db, created.id, 'reg');
    expect(names).toContain('АВ Квиз');
    expect(names).not.toContain('АВ Автоворонка');
  });

  it('неизвестный тип отвергается, а не заводится молча', () => {
    const created = createFunnel(db, {
      num: 9002, frontCode: 'ftest2', status: 'draft', productName: '', variant: '',
      landingUrl: '', startDate: '', product: 'ЖИВО', contractor: 'НИМБ',
      channel: 'Яндекс', direction: 'РСЯ',
    } as any);

    expect(() => updateFunnel(db, created.id, { funnelType: 'АВ Опечатка' } as any))
      .toThrow(ValidationError);
    const rows = db.select().from(funnelTypes).all() as { name: string }[];
    expect(rows.map((r) => r.name)).not.toContain('АВ Опечатка');
  });
});
