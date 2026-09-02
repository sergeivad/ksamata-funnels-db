/**
 * Task 7 — Funnels CRUD API tests
 *
 * ISOLATION: All tests operate on a TEMP COPY of the DB.
 * The real ksamata_funnels.db is NEVER opened directly by these tests.
 */
import { describe, it, expect, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';
import { copyFileSync, unlinkSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import * as schema from '../src/db/schema';
import {
  listFunnels,
  getFunnel,
  getFunnelByFrontCode,
  createFunnel,
  createDraftFunnel,
  updateFunnel,
  deleteFunnel,
  duplicateFunnel,
  resyncAllFunnels,
} from '../src/lib/funnels';
import { nextFrontCode } from '../src/lib/front-code';
import { runMigratePhase3 } from '../scripts/migrate-phase3';
import { runMigrateMessengerTagType } from '../scripts/migrate-messenger-tagtype';
import { runMigratePhase5 } from '../scripts/migrate-phase5';
import { runMigratePhase7 } from '../scripts/migrate-phase7';
import { runMigratePhase8 } from '../scripts/migrate-phase8';
import { runMigratePhase12 } from '../scripts/migrate-phase12';
import { runMigratePhase14 } from '../scripts/migrate-phase14';
import { replaceDays, listDays } from '../src/lib/funnel-days';
import { ConflictError } from '../src/lib/errors';
import { replaceBlock, getBlock } from '../src/lib/funnel-blocks';
import { replaceOverrides } from '../src/lib/tag-overrides';
import { copyDbForTest } from './helpers/db';

// __dirname = app/tests/ → go up 2 levels to repo root for the DB
const REAL_DB = join(__dirname, '../../ksamata_funnels.db');
const TMP_DB  = join(tmpdir(), `ksamata_funnels_test_${Date.now()}_${process.pid}.db`);

// Copy real DB to temp location — never touch the real file
copyDbForTest(REAL_DB, TMP_DB);

const sqlite = new Database(TMP_DB);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');
runMigratePhase3(sqlite);
runMigrateMessengerTagType(sqlite);
runMigratePhase5(sqlite);
// Уникальный индекс на front_code — чтобы тесты видели ту же защиту, что и
// прод: без него дубль кода ловила бы только предпроверка в funnels.ts.
runMigratePhase7(sqlite);
runMigratePhase8(sqlite);
runMigratePhase12(sqlite);
runMigratePhase14(sqlite);
const testDb = drizzle(sqlite, { schema });

afterAll(() => {
  sqlite.close();
  if (existsSync(TMP_DB)) unlinkSync(TMP_DB);
});

// ─── Shared test axes ─────────────────────────────────────────────────────────
const TEST_AXES = {
  product: 'ТКМ',
  contractor: 'НИМБ',
  channel: 'Яндекс',
  direction: 'РСЯ',
};

const BASE_FUNNEL_DATA = {
  num: 9900,
  frontCode: '',
  status: 'active' as const,
  productName: 'ТКМ Тест',
  variant: 'А',
  startDate: '',
  blockName: 'Тест блок',
  sourceName: 'Тест источник',
  ...TEST_AXES,
};

// ─── CREATE ───────────────────────────────────────────────────────────────────
describe('createFunnel', () => {
  it('creates a funnel with axes ТКМ/НИМБ/Яндекс/РСЯ and returns it', () => {
    const funnel = createFunnel(testDb, BASE_FUNNEL_DATA);
    expect(funnel).toHaveProperty('id');
    expect(funnel.num).toBe(9900);
    expect(funnel.status).toBe('active');
    expect(funnel.frontCode).toBe('');
  });

  it('listFunnels returns the newly created funnel with axes', () => {
    const list = listFunnels(testDb);
    const found = list.find((f) => f.num === 9900);
    expect(found).toBeDefined();
    expect(found!.axes.product).toBe('ТКМ');
    expect(found!.axes.contractor).toBe('НИМБ');
    expect(found!.axes.channel).toBe('Яндекс');
    expect(found!.axes.direction).toBe('РСЯ');
  });

  it('getFunnel returns the created funnel with reg tag АВ Продукт: ТКМ', () => {
    const list = listFunnels(testDb);
    const found = list.find((f) => f.num === 9900)!;
    const detail = getFunnel(testDb, found.id);
    expect(detail).not.toBeNull();
    expect(detail!.axes.product).toBe('ТКМ');
    // The reg tags in funnelTags should include АВ Продукт: ТКМ
    // We verify via the axes reconstruction
    expect(detail!.axes.contractor).toBe('НИМБ');
  });

  it('POST with same num → 409 error (pre-check path)', () => {
    expect(() => createFunnel(testDb, { ...BASE_FUNNEL_DATA })).toThrow(/409|already exists|UNIQUE/i);
  });

  it('UNIQUE constraint path also throws (TOCTOU guard)', () => {
    // Bypass the pre-check by inserting via drizzle directly, then confirm
    // that the raw SQLite UNIQUE constraint error matches the pattern the
    // route handler also catches ("UNIQUE constraint failed: funnels.num").
    const { funnels: funnelsTable } = schema;
    // Funnel num=9900 already exists — inserting again triggers the constraint
    expect(() =>
      testDb.insert(funnelsTable).values({
        num: 9900,
        frontCode: '',
        status: 'active',
        productName: 'Duplicate Test',
        variant: 'А',
        startDate: '',
        blockName: '',
        productId: 1,
        contractorId: 1,
        sourceId: 1,
      }).run()
    ).toThrow(/UNIQUE constraint failed: funnels\.num/i);
  });
});

// ─── F-КОД ────────────────────────────────────────────────────────────────────
// Код — то, чем воронка называется во внешних материалах, поэтому два одинаковых
// кода хуже двух одинаковых num: «f77» и «f77» для человека неразличимы. До
// Phase-7 у колонки не было ни индекса, ни проверки.
describe('уникальность F-кода', () => {
  const withCode = (num: number, frontCode: string) => ({
    ...BASE_FUNNEL_DATA,
    num,
    frontCode,
    productName: `Код ${frontCode}`,
  });

  it('createFunnel отказывает в занятом коде и называет владельца', () => {
    const taken = createFunnel(testDb, withCode(9910, 'f9910'));
    expect(() => createFunnel(testDb, withCode(9911, 'f9910'))).toThrow(ConflictError);
    expect(() => createFunnel(testDb, withCode(9911, 'f9910'))).toThrow(
      new RegExp(`#${taken.id}`),
    );
  });

  it('пустой код не конфликтует ни с чем — таких воронок в базе десяток', () => {
    expect(() => createFunnel(testDb, withCode(9912, ''))).not.toThrow();
    expect(() => createFunnel(testDb, withCode(9913, ''))).not.toThrow();
  });

  it('код приводится к канону на записи: « F9914 » → «f9914»', () => {
    const created = createFunnel(testDb, withCode(9914, ' F9914 '));
    expect(created.frontCode).toBe('f9914');
    // И регистр не даёт обойти проверку занятости.
    expect(() => createFunnel(testDb, withCode(9915, 'F9914'))).toThrow(ConflictError);
  });

  it('updateFunnel отказывает в чужом коде, но пропускает свой собственный', () => {
    const a = createFunnel(testDb, withCode(9916, 'f9916'));
    const b = createFunnel(testDb, withCode(9917, 'f9917'));

    expect(() => updateFunnel(testDb, b.id, { frontCode: 'f9916' })).toThrow(ConflictError);
    // Повторное сохранение той же формы не должно падать в 409.
    expect(() => updateFunnel(testDb, a.id, { frontCode: 'f9916' })).not.toThrow();
  });

  it('уникальный индекс держит и мимо приложения (TOCTOU-путь)', () => {
    createFunnel(testDb, withCode(9918, 'f9918'));
    const { funnels: funnelsTable } = schema;
    expect(() =>
      testDb.insert(funnelsTable).values({
        num: 9919,
        frontCode: 'f9918',
        status: 'active',
        productName: 'Duplicate code',
        variant: 'А',
        startDate: '',
        blockName: '',
        productId: 1,
        contractorId: 1,
        sourceId: 1,
      }).run()
    ).toThrow(/UNIQUE constraint failed: funnels\.front_code/i);
  });
});

// ─── CREATE DRAFT ───────────────────────────────────────────────────────────────
describe('createDraftFunnel', () => {
  it('creates a draft with next free num, status=draft, EMPTY axes', () => {
    const before = listFunnels(testDb);
    const maxNum = Math.max(...before.map((f) => f.num));

    const draft = createDraftFunnel(testDb);

    expect(draft).toHaveProperty('id');
    expect(draft.num).toBe(maxNum + 1);
    expect(draft.status).toBe('draft');
    expect(draft.frontCode).toBe(nextFrontCode(before.map((f) => f.frontCode)));
    // Axes are empty — the user fills them on the card
    expect(draft.axes).toEqual({ product: '', contractor: '', channel: '', direction: '' });
  });

  it('код берётся от максимума КОДОВ, а не от num', () => {
    // Ровно та поломка, ради которой всё затевалось: `f${num}` брал номер из
    // чужой последовательности и мог попасть в уже занятый код.
    const maxNum = Math.max(...listFunnels(testDb).map((f) => f.num));
    createFunnel(testDb, {
      ...BASE_FUNNEL_DATA,
      num: maxNum + 500,
      frontCode: `f${maxNum + 900}`,
      productName: 'Код впереди num',
    });

    const draft = createDraftFunnel(testDb);

    expect(draft.frontCode).toBe(`f${maxNum + 901}`);
    expect(draft.frontCode).not.toBe(`f${draft.num}`);
  });

  it('два черновика подряд не получают один и тот же код', () => {
    const first = createDraftFunnel(testDb);
    const second = createDraftFunnel(testDb);
    expect(second.frontCode).not.toBe(first.frontCode);
  });

  it('reads back empty axes via getFunnel and creates NO AV tags', () => {
    const draft = createDraftFunnel(testDb);
    const detail = getFunnel(testDb, draft.id);
    expect(detail).not.toBeNull();
    expect(detail!.status).toBe('draft');
    expect(detail!.axes).toEqual({ product: '', contractor: '', channel: '', direction: '' });

    // No reg AV tags were attached to the draft
    const { funnelTags: ft, tags: t } = schema;
    const rows = testDb
      .select({ name: t.name })
      .from(ft)
      .innerJoin(t, eq(ft.tagId, t.id))
      .where(eq(ft.funnelId, draft.id))
      .all() as { name: string }[];
    expect(rows.length).toBe(0);
  });
});

// ─── READ ─────────────────────────────────────────────────────────────────────
describe('getFunnel', () => {
  it('returns null for non-existent id', () => {
    const result = getFunnel(testDb, 999999);
    expect(result).toBeNull();
  });
});

// ─── UPDATE ───────────────────────────────────────────────────────────────────
describe('updateFunnel', () => {
  it('PATCH status to draft persists', () => {
    const list = listFunnels(testDb);
    const found = list.find((f) => f.num === 9900)!;

    updateFunnel(testDb, found.id, { status: 'draft' });

    const updated = getFunnel(testDb, found.id);
    expect(updated!.status).toBe('draft');
  });

  it('PATCH axes re-syncs: old AV product tag gone, new present, custom override tag survives', () => {
    const list = listFunnels(testDb);
    const found = list.find((f) => f.num === 9900)!;

    // Under the materialize-from-layers model (Variant A), a persistent extra
    // tag is attached via the per-funnel override 'add' layer — NOT by a raw
    // funnel_tags insert, which materializeFunnelTags now wipes wholesale on
    // every re-sync (see copyFunnelChildren's override-copy for the analogous
    // duplicate-time behavior).
    const customTagName = 'LEGACY_TAG_NOT_AV';
    replaceOverrides(testDb, found.id, {
      reg: { add: [customTagName], remove: [] },
      time_15: { add: [], remove: [] },
      time_19: { add: [], remove: [] },
      messenger: { add: [], remove: [] },
      predspisok: { add: [], remove: [] },
    });

    // Now patch axes: change product from ТКМ to БОО
    updateFunnel(testDb, found.id, {
      product: 'БОО',
      contractor: 'НИМБ',
      channel: 'Яндекс',
      direction: 'РСЯ',
    });

    const updated = getFunnel(testDb, found.id);
    expect(updated!.axes.product).toBe('БОО');
    expect(updated!.axes.contractor).toBe('НИМБ');

    // Custom override-added tag MUST still be there (overrides survive a re-materialize)
    const names = updated!.tagSets.reg.tags.map((t) => t.name);
    expect(names).toContain(customTagName);
    expect(names).toContain('АВ Продукт: БОО');
    expect(names).not.toContain('АВ Продукт: ТКМ');
  });

  it('returns null for non-existent funnel', () => {
    const result = updateFunnel(testDb, 999999, { status: 'draft' });
    expect(result).toBeNull();
  });

  it('throws 409 when changing num to one already taken by another funnel', () => {
    const a = createFunnel(testDb, { ...BASE_FUNNEL_DATA, num: 9980 });
    createFunnel(testDb, { ...BASE_FUNNEL_DATA, num: 9981 });
    // Renaming a → 9981 collides with the second funnel. Тип, а не текст:
    // раньше конфликт опознавали по префиксу «409:» в сообщении.
    expect(() => updateFunnel(testDb, a.id, { num: 9981 })).toThrow(ConflictError);
    // Setting num to its own current value is a no-op, not a collision.
    expect(() => updateFunnel(testDb, a.id, { num: 9980 })).not.toThrow();
  });
});

// ─── DUPLICATE ────────────────────────────────────────────────────────────────
describe('duplicateFunnel', () => {
  it('creates copy with num=max+1, status=draft, a freshly allocated frontCode', () => {
    const list = listFunnels(testDb);
    const found = list.find((f) => f.num === 9900)!;
    const maxNum = Math.max(...list.map((f) => f.num));

    const dup = duplicateFunnel(testDb, found.id);
    expect(dup).not.toBeNull();
    expect(dup!.num).toBe(maxNum + 1);
    expect(dup!.status).toBe('draft');
    // Дубль — не пустая воронка, а полноценная новая: код выдаётся, как и
    // черновику (createDraftFunnel), а не остаётся пустым.
    expect(dup!.frontCode).toBe(nextFrontCode(list.map((f) => f.frontCode)));
  });

  it('дубль получает следующий свободный код, выше максимума и не как у оригинала', () => {
    // Свои строки (num 9900+), ничего не утверждаем про воронки живой базы.
    const src = createFunnel(testDb, { ...BASE_FUNNEL_DATA, num: 9945, frontCode: 'f9930' });
    const before = listFunnels(testDb);
    const maxCodeBefore = Math.max(
      ...before.map((f) => Number(/^f(\d+)$/.exec(f.frontCode)?.[1] ?? 0))
    );

    const dup = duplicateFunnel(testDb, src.id)!;

    expect(dup.frontCode).toMatch(/^f\d+$/);
    expect(Number(/^f(\d+)$/.exec(dup.frontCode)![1])).toBeGreaterThan(maxCodeBefore);
    expect(dup.frontCode).not.toBe(src.frontCode);
  });

  it('duplicate carries over the same axes', () => {
    const list = listFunnels(testDb);
    const found = list.find((f) => f.num === 9900)!;
    const origDetail = getFunnel(testDb, found.id)!;

    const dup = duplicateFunnel(testDb, found.id);
    const dupDetail = getFunnel(testDb, dup!.id)!;

    expect(dupDetail.axes.product).toBe(origDetail.axes.product);
    expect(dupDetail.axes.contractor).toBe(origDetail.axes.contractor);
    expect(dupDetail.axes.channel).toBe(origDetail.axes.channel);
    expect(dupDetail.axes.direction).toBe(origDetail.axes.direction);
  });

  it('returns null for non-existent funnel', () => {
    const result = duplicateFunnel(testDb, 999999);
    expect(result).toBeNull();
  });

  it('duplicate carries over the funnel type (пятая ось), включая метку в тегах', () => {
    // Тип — тот же слой идентичности, что и остальные оси: «faithful copy»
    // не должна тихо терять маркер (funnels.ts:duplicateFunnel копирует
    // funnelTypeId наравне с productId/contractorId).
    const src = createFunnel(testDb, { ...BASE_FUNNEL_DATA, num: 19902, funnelType: 'АВ Квиз' });

    const dup = duplicateFunnel(testDb, src.id)!;
    expect(dup.funnelType).toBe('АВ Квиз');

    const dupDetail = getFunnel(testDb, dup.id)!;
    const names = dupDetail.tagSets.reg.tags.map((t) => t.name);
    expect(names).toContain('АВ Квиз');
  });

  it('deep-copies Phase-3 scalar fields and all child rows', () => {
    const src = createFunnel(testDb, {
      ...BASE_FUNNEL_DATA,
      num: 9990,
      comment: 'src comment',
      timeLabelA: '11:00',
      timeLabelB: '20:30',
      roomsReplayEnabled: true,
    });
    replaceDays(testDb, src.id, [
      { timeSlot: '19', dayNum: 1, gcRoom: 'gc-1', webRoom: 'web-1', replayUrl: 'r-1' },
      { timeSlot: '15', dayNum: 2, gcRoom: 'gc-2', webRoom: 'web-2', replayUrl: 'r-2' },
    ]);
    replaceBlock(testDb, src.id, 'landings', true, 'common', [
      { slot: null, label: 'L', url: 'https://land' },
    ]);

    const dup = duplicateFunnel(testDb, src.id)!;

    // Phase-3 scalar fields carried over (previously lost → reset to defaults).
    const dupDetail = getFunnel(testDb, dup.id)!;
    expect(dupDetail.comment).toBe('src comment');
    expect(dupDetail.timeLabelA).toBe('11:00');
    expect(dupDetail.timeLabelB).toBe('20:30');
    expect(dupDetail.roomsReplayEnabled).toBe(true);

    // Child rows copied faithfully (previously not copied at all).
    expect(listDays(testDb, dup.id)).toEqual(listDays(testDb, src.id));
    expect(getBlock(testDb, dup.id, 'landings')).toEqual(getBlock(testDb, src.id, 'landings'));

    // Copies are independent rows on the new funnel, not the source's.
    expect(dup.id).not.toBe(src.id);
    expect(listDays(testDb, dup.id).length).toBe(2);
  });
});

// ─── TAG-TABLE HYGIENE ────────────────────────────────────────────────────────
describe('updateFunnel — no empty-axis tag pollution', () => {
  it('partial-axis PATCH on a draft does not create "АВ Продукт: " placeholder tags', () => {
    const draft = createDraftFunnel(testDb); // empty axes

    const emptyPlaceholders = () =>
      (testDb.select({ name: schema.tags.name }).from(schema.tags).all() as { name: string }[])
        .filter((t) => ['АВ Продукт: ', 'АВ Подрядчик: ', 'АВ Канал: ', 'АВ Направление: '].includes(t.name));

    expect(emptyPlaceholders()).toHaveLength(0);

    // PATCH only ONE axis — the other three remain empty (draft default).
    updateFunnel(testDb, draft.id, { direction: 'РСЯ-ЧИСТО' });

    // The touched axis must be stored…
    expect(getFunnel(testDb, draft.id)!.axes.direction).toBe('РСЯ-ЧИСТО');
    // …but the three empty axes must NOT have leaked placeholder tags.
    expect(emptyPlaceholders()).toHaveLength(0);
  });
});

describe('duplicateFunnel — copies salebot_configs', () => {
  it('carries per-slot salebot condition/calculator to the duplicate', () => {
    const src = createFunnel(testDb, { ...BASE_FUNNEL_DATA, num: 9970 });
    testDb.insert(schema.salebotConfigs).values([
      { funnelId: src.id, timeSlot: '19', condition: 'cond-19', calculator: 'calc-19' },
      { funnelId: src.id, timeSlot: '15', condition: 'cond-15', calculator: 'calc-15' },
    ]).run();

    const dup = duplicateFunnel(testDb, src.id)!;

    const dupConfigs = testDb
      .select({ timeSlot: schema.salebotConfigs.timeSlot, condition: schema.salebotConfigs.condition, calculator: schema.salebotConfigs.calculator })
      .from(schema.salebotConfigs)
      .where(eq(schema.salebotConfigs.funnelId, dup.id))
      .all() as { timeSlot: string; condition: string; calculator: string }[];

    expect(dupConfigs).toHaveLength(2);
    expect(dupConfigs.find((c) => c.timeSlot === '19')).toMatchObject({ condition: 'cond-19', calculator: 'calc-19' });
    expect(dupConfigs.find((c) => c.timeSlot === '15')).toMatchObject({ condition: 'cond-15', calculator: 'calc-15' });
  });
});

// ─── AUTO-DERIVE SOURCE ───────────────────────────────────────────────────────
describe('createFunnel — auto-derive source', () => {
  it('derives source name from channel+contractor when sourceName is absent', () => {
    const data = {
      num: 9950,
      frontCode: '',
      status: 'active' as const,
      productName: 'ВК Тест',
      variant: 'А',
      startDate: '',
      blockName: '',
      product: 'ТКМ',
      contractor: 'NR',
      channel: 'ВК',
      direction: 'Таргет',
      // NO sourceName
    };

    const funnel = createFunnel(testDb, data);
    expect(funnel).toHaveProperty('id');

    // Look up the source row for this funnel
    const { funnels: funnelsTable } = schema;
    const { eq } = require('drizzle-orm');
    const { sources: sourcesTable } = schema;

    const funnelRow = testDb.select().from(funnelsTable).where(eq(funnelsTable.id, funnel.id)).get()!;
    const sourceRow = testDb.select().from(sourcesTable).where(eq(sourcesTable.id, funnelRow.sourceId)).get()!;

    expect(sourceRow.name).toBe('ВК NR');
  });

  it('uses provided sourceName when given (overrides derive)', () => {
    const data = {
      num: 9951,
      frontCode: '',
      status: 'active' as const,
      productName: 'Кастом Тест',
      variant: 'А',
      startDate: '',
      blockName: '',
      product: 'ТКМ',
      contractor: 'NR',
      channel: 'ВК',
      direction: 'Таргет',
      sourceName: 'Кастом',
    };

    const funnel = createFunnel(testDb, data);

    const { funnels: funnelsTable } = schema;
    const { eq } = require('drizzle-orm');
    const { sources: sourcesTable } = schema;

    const funnelRow = testDb.select().from(funnelsTable).where(eq(funnelsTable.id, funnel.id)).get()!;
    const sourceRow = testDb.select().from(sourcesTable).where(eq(sourcesTable.id, funnelRow.sourceId)).get()!;

    expect(sourceRow.name).toBe('Кастом');
  });
});

// ─── SOURCE REWRITE FIX ───────────────────────────────────────────────────────
describe('updateFunnel — source-id stability', () => {
  // Set up a funnel with a curated source name that differs from "{channel} {contractor}"
  let curatedFunnelId: number;
  const curatedNum = 9960;

  it('setup: create funnel with curated sourceName distinct from auto-derived', () => {
    const funnel = createFunnel(testDb, {
      num: curatedNum,
      frontCode: '',
      status: 'active' as const,
      productName: 'Курирование Тест',
      variant: 'А',
      startDate: '',
      blockName: '',
      product: 'ТКМ',
      contractor: 'NR',
      channel: 'ВК',
      direction: 'Таргет',
      sourceName: 'Курированный',  // != 'ВК NR'
    });
    curatedFunnelId = funnel.id;

    // Verify the source row is 'Курированный'
    const { funnels: funnelsTable, sources: sourcesTable } = schema;
    const { eq } = require('drizzle-orm');
    const funnelRow = testDb.select().from(funnelsTable).where(eq(funnelsTable.id, curatedFunnelId)).get()!;
    const sourceRow = testDb.select().from(sourcesTable).where(eq(sourcesTable.id, funnelRow.sourceId)).get()!;
    expect(sourceRow.name).toBe('Курированный');
  });

  it('PATCH with only { status } — source_id UNCHANGED (curated name preserved)', () => {
    const { funnels: funnelsTable, sources: sourcesTable } = schema;
    const { eq } = require('drizzle-orm');

    const before = testDb.select().from(funnelsTable).where(eq(funnelsTable.id, curatedFunnelId)).get()!;
    const beforeSourceId = before.sourceId;

    updateFunnel(testDb, curatedFunnelId, { status: 'draft' });

    const after = testDb.select().from(funnelsTable).where(eq(funnelsTable.id, curatedFunnelId)).get()!;
    expect(after.sourceId).toBe(beforeSourceId);

    const sourceRow = testDb.select().from(sourcesTable).where(eq(sourcesTable.id, after.sourceId)).get()!;
    expect(sourceRow.name).toBe('Курированный');
  });

  it('PATCH with same channel+contractor values (form sends all axes) — source_id UNCHANGED', () => {
    const { funnels: funnelsTable, sources: sourcesTable } = schema;
    const { eq } = require('drizzle-orm');

    const before = testDb.select().from(funnelsTable).where(eq(funnelsTable.id, curatedFunnelId)).get()!;
    const beforeSourceId = before.sourceId;

    // Simulate the edit form: sends all four axes with their CURRENT values + a scalar change
    updateFunnel(testDb, curatedFunnelId, {
      channel: 'ВК',         // same as current
      contractor: 'NR',      // same as current
      product: 'ТКМ',        // same as current
      direction: 'Таргет',   // same as current
      productName: 'Курирование Тест (edited)',
    });

    const after = testDb.select().from(funnelsTable).where(eq(funnelsTable.id, curatedFunnelId)).get()!;
    expect(after.sourceId).toBe(beforeSourceId);

    const sourceRow = testDb.select().from(sourcesTable).where(eq(sourcesTable.id, after.sourceId)).get()!;
    expect(sourceRow.name).toBe('Курированный');
  });

  it('PATCH with changed channel → source re-derived to "{newChannel} {contractor}"', () => {
    const { funnels: funnelsTable, sources: sourcesTable } = schema;
    const { eq } = require('drizzle-orm');

    updateFunnel(testDb, curatedFunnelId, { channel: 'Яндекс' });  // NR stays

    const after = testDb.select().from(funnelsTable).where(eq(funnelsTable.id, curatedFunnelId)).get()!;
    const sourceRow = testDb.select().from(sourcesTable).where(eq(sourcesTable.id, after.sourceId)).get()!;
    expect(sourceRow.name).toBe('Яндекс NR');
  });

  it('PATCH with explicit sourceName → uses it (overrides derive)', () => {
    const { funnels: funnelsTable, sources: sourcesTable } = schema;
    const { eq } = require('drizzle-orm');

    updateFunnel(testDb, curatedFunnelId, { sourceName: 'Ручной источник' });

    const after = testDb.select().from(funnelsTable).where(eq(funnelsTable.id, curatedFunnelId)).get()!;
    const sourceRow = testDb.select().from(sourcesTable).where(eq(sourcesTable.id, after.sourceId)).get()!;
    expect(sourceRow.name).toBe('Ручной источник');
  });
});

// ─── FUNNEL NAME + IDENTITY FIELDS ───────────────────────────────────────────
describe('funnelName and identity fields', () => {
  it('funnelName derives «product / contractor / channel / direction»', async () => {
    const { funnelName } = await import('../src/lib/funnels');
    expect(funnelName({ product: 'БОО', contractor: 'NR', channel: 'ВК', direction: 'Перелив с БОО' }))
      .toBe('БОО / NR / ВК / Перелив с БОО');
  });

  it('updateFunnel persists comment and time labels', () => {
    const list = listFunnels(testDb);
    const found = list.find((f) => f.num === 9900)!;
    const updated = updateFunnel(testDb, found.id, {
      comment: 'тест', timeLabelA: '12:00', timeLabelB: '20:00', roomsReplayEnabled: true,
    });
    expect(updated).not.toBeNull();
    const detail = getFunnel(testDb, found.id)!;
    expect(detail.comment).toBe('тест');
    expect(detail.timeLabelA).toBe('12:00');
    expect(detail.timeLabelB).toBe('20:00');
    expect(detail.roomsReplayEnabled).toBe(true);
    expect(detail.name).toContain(' / ');
  });
});

// ─── DELETE ───────────────────────────────────────────────────────────────────
describe('deleteFunnel', () => {
  it('removes funnel AND its funnelTags (cascade)', () => {
    const list = listFunnels(testDb);
    // Find a duplicate to delete (the one with highest num)
    const sorted = [...list].sort((a, b) => b.num - a.num);
    const toDelete = sorted[0]; // highest num = duplicate

    const { funnelTags: funnelTagsTable } = schema;
    const { eq } = require('drizzle-orm');

    // Verify it has some tags before deletion
    const tagsBefore = testDb
      .select()
      .from(funnelTagsTable)
      .where(eq(funnelTagsTable.funnelId, toDelete.id))
      .all();
    expect(tagsBefore.length).toBeGreaterThan(0);

    const deleted = deleteFunnel(testDb, toDelete.id);
    expect(deleted).toBe(true);

    // Funnel should be gone
    const gone = getFunnel(testDb, toDelete.id);
    expect(gone).toBeNull();

    // funnelTags should cascade-delete
    const tagsAfter = testDb
      .select()
      .from(funnelTagsTable)
      .where(eq(funnelTagsTable.funnelId, toDelete.id))
      .all();
    expect(tagsAfter.length).toBe(0);
  });

  it('returns false for non-existent funnel', () => {
    const result = deleteFunnel(testDb, 999999);
    expect(result).toBe(false);
  });
});

describe('roomsEnabled flag', () => {
  it('defaults to true on create and round-trips through update', () => {
    const created = createFunnel(testDb, { ...BASE_FUNNEL_DATA, num: 9955 });
    expect(getFunnel(testDb, created.id)!.roomsEnabled).toBe(true);

    updateFunnel(testDb, created.id, { roomsEnabled: false });
    expect(getFunnel(testDb, created.id)!.roomsEnabled).toBe(false);

    updateFunnel(testDb, created.id, { roomsEnabled: true });
    expect(getFunnel(testDb, created.id)!.roomsEnabled).toBe(true);
  });

  it('duplicateFunnel copies roomsEnabled from the source', () => {
    const src = createFunnel(testDb, { ...BASE_FUNNEL_DATA, num: 9956 });
    updateFunnel(testDb, src.id, { roomsEnabled: false });
    const dup = duplicateFunnel(testDb, src.id)!;
    expect(getFunnel(testDb, dup.id)!.roomsEnabled).toBe(false);
  });
});

/**
 * Номера воронок здесь намеренно РАЗНЕСЕНЫ, а не идут подряд: duplicateFunnel
 * выделяет номер как MAX(num)+1, и на сплошном ряде дубль занимает тот номер,
 * который следующий тест собирается завести явно. Ряд 9971…9977 ровно так и
 * падал — ConflictError на num=9977, занятом дублем предыдущего теста.
 */
describe('признак предсписка (Phase 16)', () => {
  const namesOf = (id: number, scenario: 'predspisok' | 'messenger') =>
    getFunnel(testDb, id)!.tagSets[scenario].tags.map((t) => t.name);

  const rowsOf = (id: number, scenario: string) =>
    (
      testDb.$client
        .prepare(`SELECT COUNT(*) AS c FROM funnel_tags WHERE funnel_id = ? AND tag_type = ?`)
        .get(id, scenario) as { c: number }
    ).c;

  it('новая воронка заводится с предпиской', () => {
    const created = createFunnel(testDb, { ...BASE_FUNNEL_DATA, num: 9971 });
    expect(getFunnel(testDb, created.id)!.hasPredspisok).toBe(true);
    expect(namesOf(created.id, 'predspisok').length).toBeGreaterThan(0);
  });

  it('снятие признака убирает набор и из ответа, и из funnel_tags', () => {
    const created = createFunnel(testDb, { ...BASE_FUNNEL_DATA, num: 9982 });
    expect(rowsOf(created.id, 'predspisok')).toBeGreaterThan(0);

    updateFunnel(testDb, created.id, { hasPredspisok: false });

    expect(getFunnel(testDb, created.id)!.hasPredspisok).toBe(false);
    expect(namesOf(created.id, 'predspisok')).toEqual([]);
    // Материализация — не только вид: строки обязаны исчезнуть из базы.
    expect(rowsOf(created.id, 'predspisok')).toBe(0);
  });

  it('остальные сценарии при снятии признака не страдают', () => {
    const created = createFunnel(testDb, { ...BASE_FUNNEL_DATA, num: 9993 });
    const before = namesOf(created.id, 'messenger');
    updateFunnel(testDb, created.id, { hasPredspisok: false });
    expect(namesOf(created.id, 'messenger')).toEqual(before);
  });

  it('возврат признака восстанавливает набор', () => {
    const created = createFunnel(testDb, { ...BASE_FUNNEL_DATA, num: 10004 });
    const before = namesOf(created.id, 'predspisok');
    updateFunnel(testDb, created.id, { hasPredspisok: false });
    updateFunnel(testDb, created.id, { hasPredspisok: true });
    expect(namesOf(created.id, 'predspisok')).toEqual(before);
    expect(rowsOf(created.id, 'predspisok')).toBe(before.length);
  });

  it('оверрайды сценария переживают снятие признака', () => {
    const created = createFunnel(testDb, { ...BASE_FUNNEL_DATA, num: 10015 });
    replaceOverrides(testDb, created.id, {
      predspisok: { add: ['своё-предсписок'], remove: [] },
    } as never);
    updateFunnel(testDb, created.id, { hasPredspisok: false });
    updateFunnel(testDb, created.id, { hasPredspisok: true });
    expect(namesOf(created.id, 'predspisok')).toContain('своё-предсписок');
  });

  it('duplicateFunnel переносит признак с источника', () => {
    const src = createFunnel(testDb, { ...BASE_FUNNEL_DATA, num: 10026 });
    updateFunnel(testDb, src.id, { hasPredspisok: false });
    const dup = duplicateFunnel(testDb, src.id)!;
    expect(getFunnel(testDb, dup.id)!.hasPredspisok).toBe(false);
    expect(rowsOf(dup.id, 'predspisok')).toBe(0);
  });

  it('resyncAllFunnels не воскрешает набор снятой воронке', () => {
    const created = createFunnel(testDb, { ...BASE_FUNNEL_DATA, num: 10047 });
    updateFunnel(testDb, created.id, { hasPredspisok: false });
    resyncAllFunnels(testDb);
    expect(rowsOf(created.id, 'predspisok')).toBe(0);
  });
});

describe('гонка по num между процессами', () => {
  /**
   * Проверка уникальности num идёт до транзакции. Между ней и вставкой другой
   * писатель того же файла БД (python-тулза, второй инстанс) успевает занять
   * номер. Моделируем это буквально: вторым соединением вставляем строку
   * ровно в этот промежуток — прокси перехватывает вызов db.transaction.
   */
  function racingDb(num: number) {
    const other = new Database(TMP_DB);
    const cols = (
      other
        .prepare("select name from pragma_table_info('funnels') where name not in ('id','num')")
        .all() as { name: string }[]
    ).map((r) => `"${r.name}"`);

    return new Proxy(testDb as object, {
      get(target, prop, recv) {
        if (prop === 'transaction') {
          return (cb: unknown) => {
            // Клонируем любую существующую строку под занимаемым номером —
            // так не приходится знать все NOT NULL-колонки наизусть.
            other
              .prepare(
                `insert into funnels (num, ${cols.join(',')}) ` +
                  `select ?, ${cols.join(',')} from funnels order by id limit 1`
              )
              .run(num);
            other.close();
            return (target as { transaction: (c: unknown) => unknown }).transaction(cb);
          };
        }
        const value = Reflect.get(target, prop, recv);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    }) as typeof testDb;
  }

  it('отдаёт ConflictError, а не сырую ошибку UNIQUE (иначе роут ответит 500 вместо 409)', () => {
    expect(() => createFunnel(racingDb(9971), { ...BASE_FUNNEL_DATA, num: 9971 }))
      .toThrow(ConflictError);
  });
});

describe('resyncAllFunnels и пустые черновики', () => {
  it('не наполняет черновик без осей шаблонными тегами', () => {
    // createDraftFunnel намеренно создаёт воронку БЕЗ АВ-тегов: карточка
    // показывает пустые селекты. Пересинк по всем воронкам записывал в такой
    // черновик шаблонные дефолты — и содержимое черновика начинало зависеть от
    // того, правил ли кто-то глобальный шаблон между его созданием и заполнением.
    const draft = createDraftFunnel(testDb);
    const countTags = () =>
      (sqlite.prepare('select count(*) as n from funnel_tags where funnel_id = ?')
        .get(draft.id) as { n: number }).n;
    expect(countTags(), 'черновик создаётся без тегов').toBe(0);

    resyncAllFunnels(testDb);

    expect(countTags(), 'пересинк наполнил пустой черновик шаблоном').toBe(0);
    expect(getFunnel(testDb, draft.id)!.axes)
      .toEqual({ product: '', contractor: '', channel: '', direction: '' });
  });

  it('обычную воронку пересинк по-прежнему обрабатывает', () => {
    const created = createFunnel(testDb, { ...BASE_FUNNEL_DATA, num: 9899 });
    resyncAllFunnels(testDb);
    expect(getFunnel(testDb, created.id)!.axes.product).toBe(BASE_FUNNEL_DATA.product);
  });
});

describe('getFunnelByFrontCode', () => {
  it('находит воронку по её коду', () => {
    const created = createFunnel(testDb, { ...BASE_FUNNEL_DATA, num: 9901, frontCode: 'f9001' });
    expect(getFunnelByFrontCode(testDb, 'f9001')?.id).toBe(created.id);
  });

  it('регистр и пробелы не мешают — код нормализуется', () => {
    createFunnel(testDb, { ...BASE_FUNNEL_DATA, num: 9902, frontCode: 'f9002' });
    expect(getFunnelByFrontCode(testDb, 'F9002')?.frontCode).toBe('f9002');
    expect(getFunnelByFrontCode(testDb, ' f9002 ')?.frontCode).toBe('f9002');
  });

  it('пустой код не ищется никогда — иначе бескодовые склеятся в одну', () => {
    createFunnel(testDb, { ...BASE_FUNNEL_DATA, num: 9903, frontCode: '' });
    expect(getFunnelByFrontCode(testDb, '')).toBeNull();
    expect(getFunnelByFrontCode(testDb, '   ')).toBeNull();
  });

  it('несуществующий код — null, а не чужая воронка', () => {
    expect(getFunnelByFrontCode(testDb, 'f9999')).toBeNull();
  });
});
