/**
 * Pure helper functions for funnel CRUD operations.
 *
 * IMPORTANT: Each function takes an injected `db` handle as its first argument.
 * This enables test isolation — tests inject a drizzle handle over a temp copy
 * of the DB; route handlers inject the real singleton `db` from client.ts.
 * This module NEVER imports the singleton `db` from client.ts.
 */

import { eq, sql, inArray, like, notLike, and } from 'drizzle-orm';
import { type AnyDB, type DB } from '../db/client';
import {
  funnels,
  funnelTags,
  funnelDays,
  funnelBlocks,
  funnelBlockItems,
  salebotConfigs,
  tags,
  type Funnel,
} from '../db/schema';
import { type AbAxes, axesToTagNames, tagNamesToAxes } from './ab-tags';
import { createRef, listRefs } from './refs';
import { type FunnelCreate, type FunnelUpdate } from './validation';

// ─── Public return shapes ─────────────────────────────────────────────────────

export function funnelName(axes: AbAxes): string {
  return `${axes.product} / ${axes.contractor} / ${axes.channel} / ${axes.direction}`;
}

export type FunnelListItem = {
  id: number;
  num: number;
  frontCode: string;
  status: string;
  productName: string;
  name: string;
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
  comment: string;
  timeLabelA: string;
  timeLabelB: string;
  roomsReplayEnabled: boolean;
  roomsEnabled: boolean;
};

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Fetch the reg-type tag names for a funnel and reconstruct AbAxes.
 */
function getAxesForFunnel(db: AnyDB, funnelId: number): AbAxes {
  const rows = db
    .select({ name: tags.name })
    .from(funnelTags)
    .innerJoin(tags, eq(funnelTags.tagId, tags.id))
    .where(and(eq(funnelTags.funnelId, funnelId), eq(funnelTags.tagType, 'reg')))
    .all();

  return tagNamesToAxes((rows as { name: string }[]).map((r) => r.name));
}

/**
 * Sync AV tags for a funnel for all three tag types.
 * - Deletes existing funnelTags whose tag.name starts with 'АВ ' for this funnel.
 * - Re-inserts based on axesToTagNames(axes).
 * - Legacy non-AV tags are preserved.
 *
 * Must be called INSIDE a transaction.
 */
function syncAvTags(db: AnyDB, funnelId: number, axes: AbAxes): void {
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
    const ids = (existingAvTags as { id: number }[]).map((r) => r.id);
    db.delete(funnelTags).where(inArray(funnelTags.id, ids)).run();
  }

  // Build new tag sets
  const tagSets = axesToTagNames(axes);

  const insertForType = (names: string[], tagType: 'reg' | 'time_19' | 'time_15' | 'messenger') => {
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
  insertForType(tagSets.messenger, 'messenger');
}

/**
 * `num` is allocated as MAX(num)+1. Within one Node process that read→insert is
 * atomic (better-sqlite3 is synchronous), but across processes sharing the DB
 * file two allocations can collide on the UNIQUE constraint. Retry a few times
 * on that specific conflict so the loser recomputes MAX+1 instead of failing.
 */
function isNumConflict(err: unknown): boolean {
  return err instanceof Error
    && err.message.includes('UNIQUE constraint failed: funnels.num');
}

function withNumRetry<T>(fn: () => T, attempts = 5): T {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return fn();
    } catch (err) {
      if (!isNumConflict(err)) throw err;
      lastErr = err;
    }
  }
  throw lastErr;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * GET /api/funnels — list all funnels with axes derived from reg tags.
 */
export function listFunnels(db: DB): FunnelListItem[] {
  const rows = db.select().from(funnels).all();

  return rows.map((f) => {
    const axes = getAxesForFunnel(db, f.id);
    return {
      id: f.id,
      num: f.num,
      frontCode: f.frontCode ?? '',
      status: f.status ?? 'active',
      productName: f.productName,
      name: funnelName(axes),
      axes,
    };
  });
}

/**
 * GET /api/funnels/[id] — single funnel with axes; null if not found.
 */
export function getFunnel(db: DB, id: number): FunnelDetail | null {
  const row = db.select().from(funnels).where(eq(funnels.id, id)).get();
  if (!row) return null;

  const axes = getAxesForFunnel(db, row.id);
  return {
    id:           row.id,
    num:          row.num,
    frontCode:    row.frontCode    ?? '',
    status:       row.status       ?? 'active',
    productName:  row.productName,
    name:         funnelName(axes),
    sourceId:     row.sourceId,
    productId:    row.productId,
    contractorId: row.contractorId,
    variant:      row.variant      ?? '',
    landingUrl:   row.landingUrl   ?? '',
    startDate:    row.startDate    ?? '',
    blockName:    row.blockName    ?? '',
    comment:      row.comment      ?? '',
    timeLabelA:   row.timeLabelA   ?? '15:00',
    timeLabelB:   row.timeLabelB   ?? '19:00',
    roomsReplayEnabled: (row.roomsReplayEnabled ?? 0) === 1,
    roomsEnabled: (row.roomsEnabled ?? 1) === 1,
    axes,
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
    const srcName = data.sourceName?.trim() || `${data.channel} ${data.contractor}`;
    const sourceRow     = createRef(tx, 'sources',     srcName);

    // Insert funnel row
    const inserted = tx
      .insert(funnels)
      .values({
        num:                data.num,
        frontCode:          data.frontCode,
        status:             data.status,
        productName:        data.productName,
        variant:            data.variant,
        landingUrl:         data.landingUrl,
        startDate:          data.startDate,
        blockName:          data.blockName,
        productId:          productRow.id,
        contractorId:       contractorRow.id,
        sourceId:           sourceRow.id,
        comment:            data.comment            ?? '',
        timeLabelA:         data.timeLabelA         ?? '15:00',
        timeLabelB:         data.timeLabelB         ?? '19:00',
        roomsReplayEnabled: data.roomsReplayEnabled ? 1 : 0,
        roomsEnabled:       data.roomsEnabled === false ? 0 : 1,
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
      name:        funnelName(axes),
      axes,
    };
  });

  return createdFunnel!;
}

/**
 * POST /api/funnels/draft — create a blank draft funnel and return it.
 *
 * The draft gets the next free `num`, status='draft', and EMPTY axes.
 *
 * Axes shown on the card come from AV reg-tags (see getAxesForFunnel), so a
 * draft is created with NO AV tags → all four axes read back empty and the
 * card shows blank selects. The NOT NULL product/contractor/source FK columns
 * are satisfied with the first existing ref of each table purely as a
 * placeholder — those columns are not displayed anywhere on the card and get
 * overwritten the moment the user saves identity (updateFunnel). No new refs or
 * tags are created, so nothing pollutes the reference/tag tables.
 */
export function createDraftFunnel(db: DB): FunnelListItem {
  const emptyAxes: AbAxes = { product: '', contractor: '', channel: '', direction: '' };

  const firstId = (kind: string): number | undefined => listRefs(db, kind)[0]?.id;
  const productId    = firstId('products');
  const contractorId = firstId('contractors');
  const sourceId     = firstId('sources');
  if (productId === undefined || contractorId === undefined || sourceId === undefined) {
    throw new Error('Cannot create draft: reference tables (products/contractors/sources) are empty');
  }

  const inserted = withNumRetry(() => {
    const maxRow = db
      .select({ maxNum: sql<number>`COALESCE(MAX(${funnels.num}), 0)` })
      .from(funnels)
      .get();
    const num = (maxRow?.maxNum ?? 0) + 1;

    return db
      .insert(funnels)
      .values({
        num,
        frontCode:    `f${num}`,
        status:       'draft',
        productName:  '',
        variant:      '',
        landingUrl:   '',
        startDate:    '',
        blockName:    '',
        productId,
        contractorId,
        sourceId,
        comment:      '',
        timeLabelA:   '15:00',
        timeLabelB:   '19:00',
        roomsReplayEnabled: 0,
        roomsEnabled: 1,
      })
      .returning()
      .get() as Funnel;
  });

  return {
    id:          inserted.id,
    num:         inserted.num,
    frontCode:   inserted.frontCode ?? '',
    status:      inserted.status ?? 'draft',
    productName: inserted.productName,
    name:        funnelName(emptyAxes),
    axes:        emptyAxes,
  };
}

/**
 * PATCH /api/funnels/[id] — update scalar fields and/or re-sync axes.
 * Returns null if funnel not found.
 * Preserves non-AV tags when axes are re-synced.
 */
export function updateFunnel(db: DB, id: number, data: FunnelUpdate): FunnelListItem | null {
  const existing = db.select().from(funnels).where(eq(funnels.id, id)).get();
  if (!existing) return null;

  // Reject a num change that collides with another funnel BEFORE hitting the
  // raw UNIQUE constraint, so the route can surface a clean 409 (mirrors createFunnel).
  if (data.num !== undefined && data.num !== existing.num) {
    const clash = db
      .select({ id: funnels.id })
      .from(funnels)
      .where(eq(funnels.num, data.num))
      .get();
    if (clash) {
      throw new Error(`409: Funnel with num=${data.num} already exists`);
    }
  }

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
    if (data.comment            !== undefined) scalarUpdate.comment            = data.comment;
    if (data.timeLabelA         !== undefined) scalarUpdate.timeLabelA         = data.timeLabelA;
    if (data.timeLabelB         !== undefined) scalarUpdate.timeLabelB         = data.timeLabelB;
    if (data.roomsReplayEnabled !== undefined) scalarUpdate.roomsReplayEnabled = data.roomsReplayEnabled ? 1 : 0;
    if (data.roomsEnabled       !== undefined) scalarUpdate.roomsEnabled       = data.roomsEnabled ? 1 : 0;

    // If product/contractor/source names change, update FKs too
    if (data.product !== undefined) {
      const productRow = createRef(tx, 'products', data.product);
      scalarUpdate.productId = productRow.id;
    }
    if (data.contractor !== undefined) {
      const contractorRow = createRef(tx, 'contractors', data.contractor);
      scalarUpdate.contractorId = contractorRow.id;
    }
    // Re-derive source only when:
    //   (a) sourceName is explicitly provided (non-empty) → use it as-is, OR
    //   (b) channel or contractor VALUE actually changed from the current stored value.
    // If the form sends the same channel/contractor as already stored, leave source_id untouched.
    if (data.sourceName?.trim()) {
      // (a) Explicit sourceName wins unconditionally
      const sourceRow = createRef(tx, 'sources', data.sourceName.trim());
      scalarUpdate.sourceId = sourceRow.id;
    } else if (data.channel !== undefined || data.contractor !== undefined) {
      // (b) Axes were sent — only re-derive if the VALUE actually changed
      const currentAxes = getAxesForFunnel(tx, id);
      const effectiveChannel    = data.channel    ?? currentAxes.channel;
      const effectiveContractor = data.contractor ?? currentAxes.contractor;
      const channelChanged    = effectiveChannel    !== currentAxes.channel;
      const contractorChanged = effectiveContractor !== currentAxes.contractor;
      if (channelChanged || contractorChanged) {
        const derivedName = `${effectiveChannel} ${effectiveContractor}`;
        const sourceRow = createRef(tx, 'sources', derivedName);
        scalarUpdate.sourceId = sourceRow.id;
      }
      // else: same values as before → do NOT touch source_id
    }

    if (Object.keys(scalarUpdate).length > 0) {
      scalarUpdate.updatedAt = new Date().toISOString().replace('T', ' ').slice(0, 19);
      tx.update(funnels).set(scalarUpdate).where(eq(funnels.id, id)).run();
    }

    // Re-sync AV tags if any axis was provided
    const hasAxes = data.product !== undefined || data.contractor !== undefined
      || data.channel !== undefined || data.direction !== undefined;

    if (hasAxes) {
      const currentAxes = getAxesForFunnel(tx, id);
      const axes: AbAxes = {
        product:    data.product    ?? currentAxes.product,
        contractor: data.contractor ?? currentAxes.contractor,
        channel:    data.channel    ?? currentAxes.channel,
        direction:  data.direction  ?? currentAxes.direction,
      };
      syncAvTags(tx, id, axes);
    }

    const finalRow = tx.select().from(funnels).where(eq(funnels.id, id)).get()!;
    const finalAxes = getAxesForFunnel(tx, id);
    result = {
      id:          finalRow.id,
      num:         finalRow.num,
      frontCode:   finalRow.frontCode ?? '',
      status:      finalRow.status ?? 'active',
      productName: finalRow.productName,
      name:        funnelName(finalAxes),
      axes:        finalAxes,
    };
  });

  return result;
}

/**
 * Re-generate the AV tag sets for a funnel from its CURRENT axes (derived from
 * existing reg tags), without touching any scalar columns or reference tables.
 *
 * Used by backfills to roll new tag-generation rules (extra common tags, new
 * scenario sets like `messenger`) onto existing funnels. Unlike updateFunnel it
 * never calls createRef, so empty axes can't spawn blank "" reference rows.
 * Returns false if the funnel does not exist.
 */
export function resyncFunnelAvTags(db: DB, id: number): boolean {
  const existing = db.select({ id: funnels.id }).from(funnels).where(eq(funnels.id, id)).get();
  if (!existing) return false;
  db.transaction((tx) => {
    const axes = getAxesForFunnel(tx, id);
    syncAvTags(tx, id, axes);
  });
  return true;
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
 * Deep-copy every child row of `srcId` onto `dstId` (days, blocks + block items),
 * preserving order and per-slot data. Must run inside a transaction.
 */
function copyFunnelChildren(tx: AnyDB, srcId: number, dstId: number): void {
  // funnel_days — copy all data columns, swap funnelId, drop the PK.
  const days = tx.select().from(funnelDays).where(eq(funnelDays.funnelId, srcId)).all();
  for (const d of days) {
    const { id: _id, funnelId: _fid, ...rest } = d;
    tx.insert(funnelDays).values({ ...rest, funnelId: dstId }).run();
  }

  // funnel_blocks + funnel_block_items — copy each block then its items.
  const blocks = tx.select().from(funnelBlocks).where(eq(funnelBlocks.funnelId, srcId)).all();
  for (const b of blocks) {
    const newBlock = tx
      .insert(funnelBlocks)
      .values({ funnelId: dstId, kind: b.kind, enabled: b.enabled, mode: b.mode })
      .returning()
      .get();
    const items = tx.select().from(funnelBlockItems).where(eq(funnelBlockItems.blockId, b.id)).all();
    for (const it of items) {
      tx.insert(funnelBlockItems).values({
        blockId:  newBlock.id,
        slot:     it.slot,
        label:    it.label,
        url:      it.url,
        position: it.position,
      }).run();
    }
  }

  // salebot_configs — per-slot condition/calculator. Part of the funnel's
  // content, so a faithful duplicate must carry it over.
  const configs = tx.select().from(salebotConfigs).where(eq(salebotConfigs.funnelId, srcId)).all();
  for (const c of configs) {
    const { id: _id, funnelId: _fid, ...rest } = c;
    tx.insert(salebotConfigs).values({ ...rest, funnelId: dstId }).run();
  }

  // Legacy non-AV funnel_tags. AV tags are re-synced from axes by the caller,
  // but any manually-attached non-AV tags would otherwise be silently dropped.
  const legacyTags = tx
    .select({ tagId: funnelTags.tagId, tagType: funnelTags.tagType, position: funnelTags.position })
    .from(funnelTags)
    .innerJoin(tags, eq(funnelTags.tagId, tags.id))
    .where(and(eq(funnelTags.funnelId, srcId), notLike(tags.name, 'АВ %')))
    .all() as { tagId: number; tagType: 'reg' | 'time_19' | 'time_15' | 'messenger'; position: number }[];
  for (const t of legacyTags) {
    tx.insert(funnelTags)
      .values({ funnelId: dstId, tagId: t.tagId, tagType: t.tagType, position: t.position })
      .onConflictDoNothing()
      .run();
  }
}

/**
 * POST /api/funnels/[id]/duplicate — copy with num=max(num)+1, frontCode='', status='draft'.
 * Copies all editable scalar fields and every child row. Returns null if source not found.
 */
export function duplicateFunnel(db: DB, id: number): FunnelListItem | null {
  const source = db.select().from(funnels).where(eq(funnels.id, id)).get();
  if (!source) return null;

  const sourceAxes = getAxesForFunnel(db, id);

  const duplicated = withNumRetry(() => db.transaction((tx) => {
    // Get max num
    const maxResult = tx
      .select({ maxNum: sql<number>`MAX(${funnels.num})` })
      .from(funnels)
      .get();
    const newNum = (maxResult?.maxNum ?? 0) + 1;

    // Insert copy — carry over ALL editable scalar fields (incl. Phase-3),
    // resetting only identity fields (num/frontCode/status) for the new draft.
    const inserted = tx
      .insert(funnels)
      .values({
        num:                newNum,
        frontCode:          '',
        status:             'draft',
        productName:        source.productName,
        variant:            source.variant,
        landingUrl:         source.landingUrl ?? '',
        startDate:          source.startDate ?? '',
        blockName:          source.blockName ?? '',
        productId:          source.productId,
        contractorId:       source.contractorId,
        sourceId:           source.sourceId,
        comment:            source.comment ?? '',
        timeLabelA:         source.timeLabelA ?? '15:00',
        timeLabelB:         source.timeLabelB ?? '19:00',
        roomsReplayEnabled: source.roomsReplayEnabled ?? 0,
        roomsEnabled:       (source.roomsEnabled ?? 1) ? 1 : 0,
      })
      .returning()
      .get() as Funnel;

    // Sync AV tags from source axes
    syncAvTags(tx, inserted.id, sourceAxes);

    // Deep-copy child rows so a duplicate is a faithful copy, not an empty draft.
    copyFunnelChildren(tx, id, inserted.id);

    return {
      id:          inserted.id,
      num:         inserted.num,
      frontCode:   '',
      status:      'draft',
      productName: inserted.productName,
      name:        funnelName(sourceAxes),
      axes:        sourceAxes,
    };
  }));

  return duplicated;
}
