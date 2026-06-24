import { eq, asc } from 'drizzle-orm';
import { type AnyDB, type DB } from '../db/client';
import {
  products,
  contractors,
  sources,
  tags,
  channels,
  directions,
} from '../db/schema';

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
