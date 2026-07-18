import { eq, asc } from 'drizzle-orm';
import { type AnyDB } from '../db/client';
import {
  products,
  contractors,
  sources,
  tags,
  channels,
  directions,
  funnels,
  funnelTags,
  productDurations,
} from '../db/schema';
import { AXIS_PREFIXES, type AbAxes } from './ab-tags';

// Explicit whitelist — never interpolate `kind` into SQL
const TABLE_MAP = {
  products,
  contractors,
  sources,
  tags,
  channels,
  directions,
} as const;

export type RefKind = keyof typeof TABLE_MAP;

export const VALID_KINDS = Object.keys(TABLE_MAP) as RefKind[];

export function isValidKind(kind: string): kind is RefKind {
  return VALID_KINDS.includes(kind as RefKind);
}

function resolveTable(kind: string) {
  if (!VALID_KINDS.includes(kind as RefKind)) {
    throw new Error(
      `Invalid kind "${kind}". Must be one of: ${VALID_KINDS.join(', ')}.`
    );
  }
  return TABLE_MAP[kind as RefKind];
}

// Ref kinds whose value is also embedded as an "АВ <Axis>: <value>" tag
// (see ab-tags.ts). `sources` and `tags` have no axis counterpart — sources
// is a plain FK with no AV-tag mirror, and `tags` IS the tags table itself.
const AXIS_KIND_TO_AXIS: Partial<Record<RefKind, keyof AbAxes>> = {
  products: 'product',
  contractors: 'contractor',
  channels: 'channel',
  directions: 'direction',
};

export type RefRow = { id: number; name: string };

/** Return all rows for a reference table, ordered by name. */
export function listRefs(db: AnyDB, kind: string): RefRow[] {
  const table = resolveTable(kind);
  return db
    .select({ id: table.id, name: table.name })
    .from(table)
    .orderBy(asc(table.name))
    .all() as RefRow[];
}

/**
 * Get-or-create a row in a reference table by name.
 * Returns the existing row if found, inserts and returns the new row otherwise.
 */
export function createRef(db: AnyDB, kind: string, name: string): RefRow {
  const table = resolveTable(kind);

  // Try to find existing row
  const existing = db
    .select({ id: table.id, name: table.name })
    .from(table)
    .where(eq(table.name, name))
    .get() as RefRow | undefined;

  if (existing) {
    return existing;
  }

  // Insert and return
  const inserted = db
    .insert(table)
    .values({ name })
    .returning({ id: table.id, name: table.name })
    .get() as RefRow;

  return inserted;
}

/** Fetch a single row by id, or undefined if it doesn't exist. */
export function getRefById(db: AnyDB, kind: string, id: number): RefRow | undefined {
  const table = resolveTable(kind);
  return db
    .select({ id: table.id, name: table.name })
    .from(table)
    .where(eq(table.id, id))
    .get() as RefRow | undefined;
}

/** Fetch a single row by exact name, or undefined if it doesn't exist. */
function getRefByName(db: AnyDB, kind: string, name: string): RefRow | undefined {
  const table = resolveTable(kind);
  return db
    .select({ id: table.id, name: table.name })
    .from(table)
    .where(eq(table.name, name))
    .get() as RefRow | undefined;
}

/**
 * Direct FK usage on the `funnels` row itself. Only products/contractors/
 * sources are stored as FK columns — channels/directions/tags have no FK
 * column and are only ever referenced through funnel_tags.
 */
function directFkFunnelIds(db: AnyDB, kind: RefKind, id: number): number[] {
  const column =
    kind === 'products' ? funnels.productId
    : kind === 'contractors' ? funnels.contractorId
    : kind === 'sources' ? funnels.sourceId
    : undefined;
  if (!column) return [];
  return (
    db
      .select({ funnelId: funnels.id })
      .from(funnels)
      .where(eq(column, id))
      .all() as { funnelId: number }[]
  ).map((r) => r.funnelId);
}

/** All funnel ids that carry a funnel_tags row pointing at this tag id. */
function funnelIdsForTagId(db: AnyDB, tagId: number): number[] {
  return (
    db
      .select({ funnelId: funnelTags.funnelId })
      .from(funnelTags)
      .where(eq(funnelTags.tagId, tagId))
      .all() as { funnelId: number }[]
  ).map((r) => r.funnelId);
}

/**
 * Look up the "АВ <Axis>: <value>" tag row that mirrors a products/
 * contractors/channels/directions ref value, if the axis has ever been
 * synced onto a funnel. Returns undefined for kinds with no axis mapping
 * (sources, tags) or if the tag was never created.
 */
function findAxisTagRow(db: AnyDB, kind: RefKind, value: string): RefRow | undefined {
  const axis = AXIS_KIND_TO_AXIS[kind];
  if (!axis) return undefined;
  const tagName = `${AXIS_PREFIXES[axis]}${value}`;
  return getRefByName(db, 'tags', tagName);
}

export type RefUsage = { count: number; funnelIds: number[] };

/**
 * Number of DISTINCT funnels that reference this ref row — via a direct FK
 * column (products/contractors/sources), via funnel_tags directly (tags),
 * and/or via the mirrored "АВ <Axis>: <value>" tag (products/contractors/
 * channels/directions). Union of every source, deduplicated by funnel id.
 */
export function getRefUsage(db: AnyDB, kind: RefKind, row: RefRow): RefUsage {
  const ids = new Set<number>();

  for (const fid of directFkFunnelIds(db, kind, row.id)) ids.add(fid);

  if (kind === 'tags') {
    for (const fid of funnelIdsForTagId(db, row.id)) ids.add(fid);
  } else {
    const axisTag = findAxisTagRow(db, kind, row.name);
    if (axisTag) {
      for (const fid of funnelIdsForTagId(db, axisTag.id)) ids.add(fid);
    }
  }

  return { count: ids.size, funnelIds: [...ids] };
}

/**
 * Rename the tag `oldName` → `newName` inside `tags`, merging into an
 * existing `newName` tag row if one already exists (repointing every
 * funnel_tags row from the old tag id to the existing one, then dropping the
 * now-orphaned old tag). No-op if `oldName` doesn't exist as a tag — the axis
 * value may simply never have been synced onto any funnel yet.
 * Must be called INSIDE a transaction.
 */
function renameOrMergeTag(db: AnyDB, oldName: string, newName: string): void {
  const oldTag = getRefByName(db, 'tags', oldName);
  if (!oldTag) return;

  const newTag = getRefByName(db, 'tags', newName);

  if (!newTag) {
    db.update(tags).set({ name: newName }).where(eq(tags.id, oldTag.id)).run();
    return;
  }
  if (newTag.id === oldTag.id) return;

  // Merge: repoint every funnel_tags row from oldTag onto the existing newTag,
  // then drop the old tag row (and any funnel_tags left pointing at it, which
  // would only happen if a funnel somehow already carried both — the
  // onConflictDoNothing + explicit cleanup below keeps this safe either way).
  const rows = db
    .select({
      funnelId: funnelTags.funnelId,
      tagType: funnelTags.tagType,
      position: funnelTags.position,
    })
    .from(funnelTags)
    .where(eq(funnelTags.tagId, oldTag.id))
    .all() as { funnelId: number; tagType: 'reg' | 'time_19' | 'time_15' | 'messenger'; position: number }[];

  for (const r of rows) {
    db.insert(funnelTags)
      .values({ funnelId: r.funnelId, tagId: newTag.id, tagType: r.tagType, position: r.position })
      .onConflictDoNothing()
      .run();
  }

  db.delete(funnelTags).where(eq(funnelTags.tagId, oldTag.id)).run();
  db.delete(tags).where(eq(tags.id, oldTag.id)).run();
}

export type RenameRefResult =
  | { ok: true; row: RefRow }
  | { ok: false; error: 'not_found' }
  | { ok: false; error: 'duplicate' };

/**
 * Rename a reference value. Validates uniqueness within the same table.
 * For products/contractors/channels/directions, also renames (or merges) the
 * mirrored "АВ <Axis>: <value>" tag so every funnel referencing it — via
 * funnel_tags, for all scenario tag types (reg/time_19/time_15/messenger) —
 * picks up the new text immediately. Funnel names are derived live from
 * these tags (see funnelName/getAxesForFunnel in lib/funnels.ts), so no
 * further per-funnel update is needed.
 */
export function renameRef(db: AnyDB, kind: RefKind, id: number, newName: string): RenameRefResult {
  const table = resolveTable(kind);
  const existing = getRefById(db, kind, id);
  if (!existing) return { ok: false, error: 'not_found' };

  if (existing.name === newName) {
    return { ok: true, row: existing };
  }

  const dup = getRefByName(db, kind, newName);
  if (dup && dup.id !== id) {
    return { ok: false, error: 'duplicate' };
  }

  let result: RefRow = { id, name: newName };
  db.transaction((tx) => {
    tx.update(table).set({ name: newName }).where(eq(table.id, id)).run();

    const axis = AXIS_KIND_TO_AXIS[kind];
    if (axis) {
      renameOrMergeTag(tx, `${AXIS_PREFIXES[axis]}${existing.name}`, `${AXIS_PREFIXES[axis]}${newName}`);
    }

    result = { id, name: newName };
  });

  return { ok: true, row: result };
}

export type DeleteRefResult =
  | { ok: true }
  | { ok: false; error: 'not_found' }
  | { ok: false; error: 'in_use'; usedBy: number }
  | { ok: false; error: 'has_durations'; rows: number };

/**
 * Delete a reference value. Refuses if any funnel still uses it (via FK
 * column and/or the mirrored AV tag) and reports how many funnels do.
 * On success, also drops the now-orphaned mirrored AV tag row (if any) —
 * safe because usedBy===0 guarantees no funnel_tags row points at it.
 */
export function deleteRef(db: AnyDB, kind: RefKind, id: number): DeleteRefResult {
  const table = resolveTable(kind);
  const existing = getRefById(db, kind, id);
  if (!existing) return { ok: false, error: 'not_found' };

  const usage = getRefUsage(db, kind, existing);
  if (usage.count > 0) {
    return { ok: false, error: 'in_use', usedBy: usage.count };
  }

  // products has a second FK inbound: product_durations. Without this guard
  // the DELETE would hit the FK constraint and surface as a 500.
  if (kind === 'products') {
    const durationRows = db
      .select({ id: productDurations.id })
      .from(productDurations)
      .where(eq(productDurations.productId, id))
      .all();
    if (durationRows.length > 0) {
      return { ok: false, error: 'has_durations', rows: durationRows.length };
    }
  }

  db.transaction((tx) => {
    tx.delete(table).where(eq(table.id, id)).run();

    const axis = AXIS_KIND_TO_AXIS[kind];
    if (axis) {
      const axisTag = findAxisTagRow(tx, kind, existing.name);
      if (axisTag) {
        tx.delete(funnelTags).where(eq(funnelTags.tagId, axisTag.id)).run();
        tx.delete(tags).where(eq(tags.id, axisTag.id)).run();
      }
    }
  });

  return { ok: true };
}
