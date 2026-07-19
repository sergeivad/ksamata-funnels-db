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
  createFunnel,
  createDraftFunnel,
  updateFunnel,
  deleteFunnel,
  duplicateFunnel,
} from '../src/lib/funnels';
import { runMigratePhase3 } from '../scripts/migrate-phase3';
import { runMigrateMessengerTagType } from '../scripts/migrate-messenger-tagtype';
import { replaceDays, listDays } from '../src/lib/funnel-days';
import { replaceBlock, getBlock } from '../src/lib/funnel-blocks';

// __dirname = app/tests/ → go up 2 levels to repo root for the DB
const REAL_DB = join(__dirname, '../../ksamata_funnels.db');
const TMP_DB  = join(tmpdir(), `ksamata_funnels_test_${Date.now()}_${process.pid}.db`);

// Copy real DB to temp location — never touch the real file
copyFileSync(REAL_DB, TMP_DB);

const sqlite = new Database(TMP_DB);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');
runMigratePhase3(sqlite);
runMigrateMessengerTagType(sqlite);
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
  landingUrl: '',
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
        landingUrl: '',
        startDate: '',
        blockName: '',
        productId: 1,
        contractorId: 1,
        sourceId: 1,
      }).run()
    ).toThrow(/UNIQUE constraint failed: funnels\.num/i);
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
    expect(draft.frontCode).toBe(`f${maxNum + 1}`);
    // Axes are empty — the user fills them on the card
    expect(draft.axes).toEqual({ product: '', contractor: '', channel: '', direction: '' });
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

  it('PATCH axes re-syncs: old AV product tag gone, new present', () => {
    const list = listFunnels(testDb);
    const found = list.find((f) => f.num === 9900)!;

    // Attach a legacy (non-AV) tag to this funnel
    const legacyTagName = 'LEGACY_TAG_NOT_AV';
    const { tags: tagsTable, funnelTags: funnelTagsTable } = schema;
    const { eq } = require('drizzle-orm');

    // Insert legacy tag into tags table
    testDb.insert(tagsTable).values({ name: legacyTagName }).run();
    const legacyTag = testDb.select().from(tagsTable).where(eq(tagsTable.name, legacyTagName)).get()!;

    // Insert into funnelTags with type 'reg'
    testDb.insert(funnelTagsTable).values({
      funnelId: found.id,
      tagId: legacyTag.id,
      tagType: 'reg',
      position: 99,
    }).run();

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

    // Legacy tag MUST still be there (non-AV tags are preserved)
    const remainingTags = testDb
      .select()
      .from(funnelTagsTable)
      .where(eq(funnelTagsTable.funnelId, found.id))
      .all();
    const remainingTagIds = remainingTags.map((t) => t.tagId);

    const allTags = testDb.select().from(tagsTable).all();
    const legacyTagRow = allTags.find((t) => t.name === legacyTagName);
    expect(legacyTagRow).toBeDefined();
    expect(remainingTagIds).toContain(legacyTagRow!.id);
  });

  it('returns null for non-existent funnel', () => {
    const result = updateFunnel(testDb, 999999, { status: 'draft' });
    expect(result).toBeNull();
  });

  it('throws 409 when changing num to one already taken by another funnel', () => {
    const a = createFunnel(testDb, { ...BASE_FUNNEL_DATA, num: 9980 });
    createFunnel(testDb, { ...BASE_FUNNEL_DATA, num: 9981 });
    // Renaming a → 9981 collides with the second funnel.
    expect(() => updateFunnel(testDb, a.id, { num: 9981 })).toThrow(/409/);
    // Setting num to its own current value is a no-op, not a collision.
    expect(() => updateFunnel(testDb, a.id, { num: 9980 })).not.toThrow();
  });
});

// ─── DUPLICATE ────────────────────────────────────────────────────────────────
describe('duplicateFunnel', () => {
  it('creates copy with num=max+1, status=draft, frontCode=""', () => {
    const list = listFunnels(testDb);
    const found = list.find((f) => f.num === 9900)!;
    const maxNum = Math.max(...list.map((f) => f.num));

    const dup = duplicateFunnel(testDb, found.id);
    expect(dup).not.toBeNull();
    expect(dup!.num).toBe(maxNum + 1);
    expect(dup!.status).toBe('draft');
    expect(dup!.frontCode).toBe('');
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
      landingUrl: '',
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
      landingUrl: '',
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
      landingUrl: '',
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
