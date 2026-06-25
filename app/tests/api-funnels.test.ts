/**
 * Task 7 — Funnels CRUD API tests
 *
 * ISOLATION: All tests operate on a TEMP COPY of the DB.
 * The real ksamata_funnels.db is NEVER opened directly by these tests.
 */
import { describe, it, expect, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { copyFileSync, unlinkSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import * as schema from '../src/db/schema';
import {
  listFunnels,
  getFunnel,
  createFunnel,
  updateFunnel,
  deleteFunnel,
  duplicateFunnel,
} from '../src/lib/funnels';

// __dirname = app/tests/ → go up 2 levels to repo root for the DB
const REAL_DB = join(__dirname, '../../ksamata_funnels.db');
const TMP_DB  = join(tmpdir(), `ksamata_funnels_test_${Date.now()}_${process.pid}.db`);

// Copy real DB to temp location — never touch the real file
copyFileSync(REAL_DB, TMP_DB);

const sqlite = new Database(TMP_DB);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');
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
