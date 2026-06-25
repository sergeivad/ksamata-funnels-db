/**
 * funnel-blocks.ts — read/write helper for funnel_blocks + funnel_block_items.
 * Injected `db` handle (same pattern as funnel-links.ts).
 */

import { eq, and, asc } from 'drizzle-orm';
import { type AnyDB } from '../db/client';
import { funnelBlocks, funnelBlockItems } from '../db/schema';
import { BLOCK_KINDS, getBlockDef, type BlockKind, type BlockMode } from './blocks';

export type BlockItem = { slot: '15' | '19' | null; label: string; url: string };
export type BlockState = { kind: BlockKind; enabled: boolean; mode: BlockMode; items: BlockItem[] };

/** Read a single block's config + items. Falls back to catalog default if no row. */
export function getBlock(db: AnyDB, funnelId: number, kind: BlockKind): BlockState {
  const def = getBlockDef(kind);
  const cfg = db
    .select({ id: funnelBlocks.id, enabled: funnelBlocks.enabled, mode: funnelBlocks.mode })
    .from(funnelBlocks)
    .where(and(eq(funnelBlocks.funnelId, funnelId), eq(funnelBlocks.kind, kind)))
    .get() as { id: number; enabled: number; mode: BlockMode } | undefined;

  if (!cfg) {
    return { kind, enabled: def.defaultEnabled, mode: 'common', items: [] };
  }

  const items = db
    .select({ slot: funnelBlockItems.slot, label: funnelBlockItems.label, url: funnelBlockItems.url })
    .from(funnelBlockItems)
    .where(eq(funnelBlockItems.blockId, cfg.id))
    .orderBy(asc(funnelBlockItems.position))
    .all() as { slot: '15' | '19' | null; label: string; url: string }[];

  return {
    kind,
    enabled: cfg.enabled === 1,
    mode: cfg.mode,
    items: items.map((i) => ({ slot: i.slot ?? null, label: i.label, url: i.url })),
  };
}

/** All 9 blocks for a funnel, in catalog order. */
export function listBlocks(db: AnyDB, funnelId: number): BlockState[] {
  return BLOCK_KINDS.map((d) => getBlock(db, funnelId, d.kind));
}

/** Upsert block config and replace its items in one transaction. */
export function replaceBlock(
  db: AnyDB,
  funnelId: number,
  kind: BlockKind,
  enabled: boolean,
  mode: BlockMode,
  items: BlockItem[],
): BlockState {
  db.transaction((tx) => {
    const existing = tx
      .select({ id: funnelBlocks.id })
      .from(funnelBlocks)
      .where(and(eq(funnelBlocks.funnelId, funnelId), eq(funnelBlocks.kind, kind)))
      .get() as { id: number } | undefined;

    let blockId: number;
    if (existing) {
      blockId = existing.id;
      tx.update(funnelBlocks)
        .set({ enabled: enabled ? 1 : 0, mode })
        .where(eq(funnelBlocks.id, blockId))
        .run();
      tx.delete(funnelBlockItems).where(eq(funnelBlockItems.blockId, blockId)).run();
    } else {
      const inserted = tx
        .insert(funnelBlocks)
        .values({ funnelId, kind, enabled: enabled ? 1 : 0, mode })
        .returning({ id: funnelBlocks.id })
        .get() as { id: number };
      blockId = inserted.id;
    }

    items.forEach((it, i) => {
      tx.insert(funnelBlockItems)
        .values({ blockId, slot: it.slot ?? null, label: it.label, url: it.url, position: i })
        .run();
    });
  });

  return getBlock(db, funnelId, kind);
}
