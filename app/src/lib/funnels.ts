/**
 * Pure helper functions for funnel CRUD operations.
 *
 * IMPORTANT: Each function takes an injected `db` handle as its first argument.
 * This enables test isolation — tests inject a drizzle handle over a temp copy
 * of the DB; route handlers inject the real singleton `db` from client.ts.
 * This module NEVER imports the singleton `db` from client.ts.
 */

import { eq, sql, inArray, like, and } from 'drizzle-orm';
import { type DB } from '../db/client';
import {
  funnels,
  funnelTags,
  tags,
  type Funnel,
} from '../db/schema';
import { type AbAxes, axesToTagNames, tagNamesToAxes } from './ab-tags';
import { createRef } from './refs';
import { type FunnelCreate, type FunnelUpdate } from './validation';

// ─── Public return shapes ─────────────────────────────────────────────────────

export type FunnelListItem = {
  id: number;
  num: number;
  frontCode: string;
  status: string;
  productName: string;
  axes: AbAxes;
};

export type FunnelDetail = FunnelListItem & {
  sourceId: number;
  productId: number;
  contractorId: number;
  variant: string;
  landingUrl: string;
  startDate: string;
  blockName: string;
  blockCondition: string;
};

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Fetch the reg-type tag names for a funnel and reconstruct AbAxes.
 */
function getAxesForFunnel(db: DB, funnelId: number): AbAxes {
  const rows = db
    .select({ name: tags.name })
    .from(funnelTags)
    .innerJoin(tags, eq(funnelTags.tagId, tags.id))
    .where(and(eq(funnelTags.funnelId, funnelId), eq(funnelTags.tagType, 'reg')))
    .all();

  return tagNamesToAxes(rows.map((r) => r.name));
}

/**
 * Sync AV tags for a funnel for all three tag types.
 * - Deletes existing funnelTags whose tag.name starts with 'АВ ' for this funnel.
 * - Re-inserts based on axesToTagNames(axes).
 * - Legacy non-AV tags are preserved.
 *
 * Must be called INSIDE a transaction.
 */
function syncAvTags(db: DB, funnelId: number, axes: AbAxes): void {
  // Find all funnel_tags for this funnel that join to an 'АВ '-prefixed tag
  const existingAvTags = db
    .select({ id: funnelTags.id })
    .from(funnelTags)
    .innerJoin(tags, eq(funnelTags.tagId, tags.id))
    .where(
      and(
        eq(funnelTags.funnelId, funnelId),
        like(tags.name, 'АВ %'),
      )
    )
    .all();

  if (existingAvTags.length > 0) {
    const ids = existingAvTags.map((r) => r.id);
    db.delete(funnelTags).where(inArray(funnelTags.id, ids)).run();
  }

  // Build new tag sets
  const tagSets = axesToTagNames(axes);

  const insertForType = (names: string[], tagType: 'reg' | 'time_19' | 'time_15') => {
    names.forEach((name, position) => {
      const tagRow = createRef(db, 'tags', name);
      db
        .insert(funnelTags)
        .values({ funnelId, tagId: tagRow.id, tagType, position })
        .onConflictDoNothing()
        .run();
    });
  };

  insertForType(tagSets.reg, 'reg');
  insertForType(tagSets.time19, 'time_19');
  insertForType(tagSets.time15, 'time_15');
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * GET /api/funnels — list all funnels with axes derived from reg tags.
 */
export function listFunnels(db: DB): FunnelListItem[] {
  const rows = db.select().from(funnels).all();

  return rows.map((f) => ({
    id: f.id,
    num: f.num,
    frontCode: f.frontCode ?? '',
    status: f.status ?? 'active',
    productName: f.productName,
    axes: getAxesForFunnel(db, f.id),
  }));
}

/**
 * GET /api/funnels/[id] — single funnel with axes; null if not found.
 */
export function getFunnel(db: DB, id: number): (FunnelListItem & Pick<Funnel, 'sourceId' | 'productId' | 'contractorId' | 'variant' | 'landingUrl' | 'startDate' | 'blockName'>) | null {
  const row = db.select().from(funnels).where(eq(funnels.id, id)).get();
  if (!row) return null;

  return {
    ...row,
    frontCode: row.frontCode ?? '',
    status: row.status ?? 'active',
    axes: getAxesForFunnel(db, row.id),
  };
}

/**
 * POST /api/funnels — create a new funnel.
 * Throws an error with message containing "409" if num already exists.
 */
export function createFunnel(db: DB, data: FunnelCreate): FunnelListItem {
  // Check uniqueness of num before entering transaction
  const existing = db.select({ id: funnels.id }).from(funnels).where(eq(funnels.num, data.num)).get();
  if (existing) {
    throw new Error(`409: Funnel with num=${data.num} already exists`);
  }

  const axes: AbAxes = {
    product: data.product,
    contractor: data.contractor,
    channel: data.channel,
    direction: data.direction,
  };

  let createdFunnel: FunnelListItem;

  db.transaction((tx) => {
    // Get-or-create foreign key refs
    const productRow    = createRef(tx, 'products',    data.product);
    const contractorRow = createRef(tx, 'contractors', data.contractor);
    const sourceRow     = createRef(tx, 'sources',     data.sourceName);

    // Insert funnel row
    const inserted = tx
      .insert(funnels)
      .values({
        num:          data.num,
        frontCode:    data.frontCode,
        status:       data.status,
        productName:  data.productName,
        variant:      data.variant,
        landingUrl:   data.landingUrl,
        startDate:    data.startDate,
        blockName:    data.blockName,
        productId:    productRow.id,
        contractorId: contractorRow.id,
        sourceId:     sourceRow.id,
      })
      .returning()
      .get() as Funnel;

    // Sync AV tags
    syncAvTags(tx, inserted.id, axes);

    createdFunnel = {
      id:          inserted.id,
      num:         inserted.num,
      frontCode:   inserted.frontCode ?? '',
      status:      inserted.status ?? 'active',
      productName: inserted.productName,
      axes,
    };
  });

  return createdFunnel!;
}

/**
 * PATCH /api/funnels/[id] — update scalar fields and/or re-sync axes.
 * Returns null if funnel not found.
 * Preserves non-AV tags when axes are re-synced.
 */
export function updateFunnel(db: DB, id: number, data: FunnelUpdate): FunnelListItem | null {
  const existing = db.select().from(funnels).where(eq(funnels.id, id)).get();
  if (!existing) return null;

  let result: FunnelListItem | null = null;

  db.transaction((tx) => {
    // Build scalar update payload (exclude axes fields)
    const scalarUpdate: Partial<typeof funnels.$inferInsert> = {};

    if (data.num          !== undefined) scalarUpdate.num          = data.num;
    if (data.frontCode    !== undefined) scalarUpdate.frontCode    = data.frontCode;
    if (data.status       !== undefined) scalarUpdate.status       = data.status;
    if (data.productName  !== undefined) scalarUpdate.productName  = data.productName;
    if (data.variant      !== undefined) scalarUpdate.variant      = data.variant;
    if (data.landingUrl   !== undefined) scalarUpdate.landingUrl   = data.landingUrl;
    if (data.startDate    !== undefined) scalarUpdate.startDate    = data.startDate;
    if (data.blockName    !== undefined) scalarUpdate.blockName    = data.blockName;

    // If product/contractor/source names change, update FKs too
    if (data.product !== undefined) {
      const productRow = createRef(tx, 'products', data.product);
      scalarUpdate.productId = productRow.id;
    }
    if (data.contractor !== undefined) {
      const contractorRow = createRef(tx, 'contractors', data.contractor);
      scalarUpdate.contractorId = contractorRow.id;
    }
    if (data.sourceName !== undefined) {
      const sourceRow = createRef(tx, 'sources', data.sourceName);
      scalarUpdate.sourceId = sourceRow.id;
    }

    if (Object.keys(scalarUpdate).length > 0) {
      scalarUpdate.updatedAt = new Date().toISOString().replace('T', ' ').slice(0, 19);
      tx.update(funnels).set(scalarUpdate).where(eq(funnels.id, id)).run();
    }

    // Re-sync AV tags if any axis was provided
    const hasAxes = data.product !== undefined || data.contractor !== undefined
      || data.channel !== undefined || data.direction !== undefined;

    if (hasAxes) {
      const updatedRow = tx.select().from(funnels).where(eq(funnels.id, id)).get()!;
      const axes: AbAxes = {
        product:    data.product    ?? getAxesForFunnel(tx, id).product,
        contractor: data.contractor ?? getAxesForFunnel(tx, id).contractor,
        channel:    data.channel    ?? getAxesForFunnel(tx, id).channel,
        direction:  data.direction  ?? getAxesForFunnel(tx, id).direction,
      };
      syncAvTags(tx, id, axes);
    }

    const finalRow = tx.select().from(funnels).where(eq(funnels.id, id)).get()!;
    result = {
      id:          finalRow.id,
      num:         finalRow.num,
      frontCode:   finalRow.frontCode ?? '',
      status:      finalRow.status ?? 'active',
      productName: finalRow.productName,
      axes:        getAxesForFunnel(tx, id),
    };
  });

  return result;
}

/**
 * DELETE /api/funnels/[id] — removes funnel (funnelTags cascade via FK).
 * Returns true on success, false if not found.
 */
export function deleteFunnel(db: DB, id: number): boolean {
  const existing = db.select({ id: funnels.id }).from(funnels).where(eq(funnels.id, id)).get();
  if (!existing) return false;

  db.delete(funnels).where(eq(funnels.id, id)).run();
  return true;
}

/**
 * POST /api/funnels/[id]/duplicate — copy with num=max(num)+1, frontCode='', status='draft'.
 * Returns null if source funnel not found.
 */
export function duplicateFunnel(db: DB, id: number): FunnelListItem | null {
  const source = db.select().from(funnels).where(eq(funnels.id, id)).get();
  if (!source) return null;

  const sourceAxes = getAxesForFunnel(db, id);

  let duplicated: FunnelListItem | null = null;

  db.transaction((tx) => {
    // Get max num
    const maxResult = tx
      .select({ maxNum: sql<number>`MAX(${funnels.num})` })
      .from(funnels)
      .get();
    const newNum = (maxResult?.maxNum ?? 0) + 1;

    // Insert copy
    const inserted = tx
      .insert(funnels)
      .values({
        num:          newNum,
        frontCode:    '',
        status:       'draft',
        productName:  source.productName,
        variant:      source.variant,
        landingUrl:   source.landingUrl ?? '',
        startDate:    source.startDate ?? '',
        blockName:    source.blockName ?? '',
        productId:    source.productId,
        contractorId: source.contractorId,
        sourceId:     source.sourceId,
      })
      .returning()
      .get() as Funnel;

    // Sync AV tags from source axes
    syncAvTags(tx, inserted.id, sourceAxes);

    duplicated = {
      id:          inserted.id,
      num:         inserted.num,
      frontCode:   '',
      status:      'draft',
      productName: inserted.productName,
      axes:        sourceAxes,
    };
  });

  return duplicated;
}
