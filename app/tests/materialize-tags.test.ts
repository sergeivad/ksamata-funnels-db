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
import { runMigratePhase8 } from '../scripts/migrate-phase8';
import { runMigratePhase12 } from '../scripts/migrate-phase12';
import { runMigratePhase14 } from '../scripts/migrate-phase14';
import { createFunnel, updateFunnel, getFunnel, applyTagOverrides } from '../src/lib/funnels';
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
runMigratePhase8(sqlite);
runMigratePhase12(sqlite);
runMigratePhase14(sqlite);
const db = drizzle(sqlite, { schema });

afterAll(() => { sqlite.close(); if (existsSync(TMP_DB)) unlinkSync(TMP_DB); });

const nextNum = () => (sqlite.prepare(`SELECT COALESCE(MAX(num),0)+1 AS n FROM funnels`).get() as { n: number }).n;

function makeFunnel(product: string) {
  return createFunnel(db, {
    num: nextNum(), frontCode: '', status: 'active', productName: '', variant: '', startDate: '', blockName: '',
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
      predspisok: { add: [], remove: [] },
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
      num: 9001, frontCode: 'ftest', status: 'draft', productName: '', variant: '', startDate: '', product: 'ЖИВО', contractor: 'НИМБ',
      channel: 'Яндекс', direction: 'РСЯ',
    } as any);

    updateFunnel(db, created.id, { funnelType: 'АВ Квиз' } as any);

    const names = listFunnelTagNames(db, created.id, 'reg');
    expect(names).toContain('АВ Квиз');
    expect(names).not.toContain('АВ Автоворонка');
  });

  it('неизвестный тип отвергается, а не заводится молча', () => {
    const created = createFunnel(db, {
      num: 9002, frontCode: 'ftest2', status: 'draft', productName: '', variant: '', startDate: '', product: 'ЖИВО', contractor: 'НИМБ',
      channel: 'Яндекс', direction: 'РСЯ',
    } as any);

    expect(() => updateFunnel(db, created.id, { funnelType: 'АВ Опечатка' } as any))
      .toThrow(ValidationError);
    const rows = db.select().from(funnelTypes).all() as { name: string }[];
    expect(rows.map((r) => r.name)).not.toContain('АВ Опечатка');
  });

  it('маркер, попавший в add-оверрайд в обход applyTagOverrides, не материализуется в тег', () => {
    // Рецензия задачи 6 (Important) проверила руками: applyTagOverrides
    // теперь отвергает маркер в add ДО записи (assertNotFunnelTypeMarker), но
    // если бы имя маркера всё же оказалось в funnel_tag_overrides — легаси-
    // данные, прямой SQL, будущая правка, убравшая проверку выше по стеку —
    // движок обязан погасить его сам на материализации, а не полагаться
    // только на входной барьер. Пишем оверрайд НАПРЯМУЮ через replaceOverrides
    // (минуя applyTagOverrides) — ровно то бездействие, о которое рецензент
    // проверял: строка в funnel_tag_overrides есть, а тега — нет.
    const created = createFunnel(db, {
      num: 9004, frontCode: 'ftest4', status: 'draft', productName: '', variant: '', startDate: '', product: 'ЖИВО', contractor: 'НИМБ',
      channel: 'Яндекс', direction: 'РСЯ',
    } as any); // funnelType не задан — identity-слой этой воронки 'АВ Квиз' не содержит

    replaceOverrides(db, created.id, {
      reg: { add: ['АВ Квиз'], remove: [] },
      time_15: { add: [], remove: [] },
      time_19: { add: [], remove: [] },
      messenger: { add: [], remove: [] },
      predspisok: { add: [], remove: [] },
    });
    updateFunnel(db, created.id, { product: 'ЖИВО' } as any); // ре-материализация, оси не менялись

    const names = listFunnelTagNames(db, created.id, 'reg');
    expect(names).not.toContain('АВ Квиз');
  });
});

describe('тип без эфиров по времени', () => {
  /** Воронка заданного типа с заполненными осями. */
  function funnelOfType(num: number, code: string, type: string) {
    const created = createFunnel(db, {
      num, frontCode: code, status: 'draft', productName: '', variant: '', startDate: '', blockName: '',
      product: 'ЖИВО', contractor: 'НИМБ', channel: 'Яндекс', direction: 'РСЯ',
    } as any);
    updateFunnel(db, created.id, { funnelType: type } as any);
    return created.id;
  }

  const emptyOv = (): OverrideMap => ({
    reg: { add: [], remove: [] }, time_15: { add: [], remove: [] },
    time_19: { add: [], remove: [] }, messenger: { add: [], remove: [] },
    predspisok: { add: [], remove: [] },
  });

  it('в материализованных тегах времени нет ни в одном сценарии', () => {
    const id = funnelOfType(9101, 'ftime1', 'АВ Прямые');
    for (const scenario of ['reg', 'time_15', 'time_19', 'messenger'] as Scenario[]) {
      const names = listFunnelTagNames(db, id, scenario);
      expect(names.some((n) => n.startsWith('АВ Время: ')), scenario).toBe(false);
    }
  });

  it('оба сценария оплаты совпадают', () => {
    const id = funnelOfType(9102, 'ftime2', 'АВ Прямые');
    expect(listFunnelTagNames(db, id, 'time_15')).toEqual(listFunnelTagNames(db, id, 'time_19'));
  });

  it('смена типа на вебинарный возвращает время', () => {
    const id = funnelOfType(9103, 'ftime3', 'АВ Прямые');
    updateFunnel(db, id, { funnelType: 'АВ Автоворонка' } as any);
    expect(listFunnelTagNames(db, id, 'time_19')).toContain('АВ Время: 19');
  });

  it('тег, добавленный в оплату, попадает в оба сценария', () => {
    const id = funnelOfType(9104, 'ftime4', 'АВ Прямые');
    applyTagOverrides(db, id, { ...emptyOv(), time_19: { add: ['допродажа'], remove: [] } });
    expect(listFunnelTagNames(db, id, 'time_19')).toContain('допродажа');
    expect(listFunnelTagNames(db, id, 'time_15')).toContain('допродажа');
  });

  it('правка через time_15 тоже зеркалится — главным считается изменившийся сценарий', () => {
    const id = funnelOfType(9105, 'ftime5', 'АВ Прямые');
    applyTagOverrides(db, id, { ...emptyOv(), time_15: { add: ['вебинарка'], remove: [] } });
    expect(listFunnelTagNames(db, id, 'time_15')).toContain('вебинарка');
    expect(listFunnelTagNames(db, id, 'time_19')).toContain('вебинарка');
  });

  it('у вебинарной воронки сценарии оплаты независимы', () => {
    const id = funnelOfType(9106, 'ftime6', 'АВ Автоворонка');
    applyTagOverrides(db, id, { ...emptyOv(), time_19: { add: ['только19'], remove: [] } });
    expect(listFunnelTagNames(db, id, 'time_19')).toContain('только19');
    expect(listFunnelTagNames(db, id, 'time_15')).not.toContain('только19');
  });
});
