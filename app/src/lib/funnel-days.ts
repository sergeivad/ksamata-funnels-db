/**
 * funnel-days.ts — helper for reading and writing funnel_days rows.
 *
 * Only gc_room, web_room, sales_page are managed here.
 * All other columns (tariffs, oto, bonuses, mission, etc.) are PRESERVED on
 * UPDATE and DEFAULT to '' on INSERT.
 *
 * Pattern: injected `db` handle (same as funnels.ts) so tests can pass a
 * drizzle handle over a temp copy of the DB without touching the real one.
 */

import { eq, and } from 'drizzle-orm';
import { type AnyDB } from '../db/client';
import { funnelDays, funnels } from '../db/schema';

// ─── Public types ─────────────────────────────────────────────────────────────

export type DayCell = {
  timeSlot: '19' | '15';
  dayNum: number;
  gcRoom: string;
  webRoom: string;
  salesPage: string;
};

// ─── Validation ───────────────────────────────────────────────────────────────

const VALID_TIME_SLOTS = new Set<string>(['19', '15']);
const MIN_DAY_NUM = 1;
const MAX_DAY_NUM = 5;

function validateCell(cell: DayCell): void {
  if (!VALID_TIME_SLOTS.has(cell.timeSlot)) {
    throw new Error(`Invalid timeSlot "${cell.timeSlot}": must be '19' or '15'`);
  }
  if (cell.dayNum < MIN_DAY_NUM || cell.dayNum > MAX_DAY_NUM || !Number.isInteger(cell.dayNum)) {
    throw new Error(`Invalid dayNum ${cell.dayNum}: must be an integer between 1 and 5`);
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * List existing funnel_days rows for a funnel, ordered by timeSlot then dayNum.
 * Returns only the 5 DayCell fields; other columns are not exposed.
 */
export function listDays(db: AnyDB, funnelId: number): DayCell[] {
  const rows = db
    .select({
      timeSlot: funnelDays.timeSlot,
      dayNum: funnelDays.dayNum,
      gcRoom: funnelDays.gcRoom,
      webRoom: funnelDays.webRoom,
      salesPage: funnelDays.salesPage,
    })
    .from(funnelDays)
    .where(eq(funnelDays.funnelId, funnelId))
    .orderBy(funnelDays.timeSlot, funnelDays.dayNum)
    .all();

  return rows.map((r) => ({
    timeSlot: r.timeSlot as '19' | '15',
    dayNum: r.dayNum,
    gcRoom: r.gcRoom ?? '',
    webRoom: r.webRoom ?? '',
    salesPage: r.salesPage ?? '',
  }));
}

/**
 * Reconcile funnel_days for a funnel in ONE transaction:
 * - For each cell where all three of gcRoom/webRoom/salesPage are empty → DELETE
 *   the row (funnel_id, time_slot, day_num) if it exists.
 * - Otherwise → UPSERT by (funnel_id, time_slot, day_num):
 *     INSERT sets only gc_room/web_room/sales_page + defaults '' for other cols.
 *     ON CONFLICT UPDATE sets only gc_room/web_room/sales_page (preserves tariffs etc).
 *
 * Validates timeSlot ∈ {'19','15'} and dayNum ∈ [1..5]; throws on bad input.
 * Does NOT check whether the funnel exists — callers (route handlers) must do that.
 */
export function replaceDays(db: AnyDB, funnelId: number, cells: DayCell[]): void {
  // Validate all cells first (before opening a transaction)
  for (const cell of cells) {
    validateCell(cell);
  }

  db.transaction((tx) => {
    for (const cell of cells) {
      const isEmpty =
        cell.gcRoom.trim() === '' &&
        cell.webRoom.trim() === '' &&
        cell.salesPage.trim() === '';

      if (isEmpty) {
        // DELETE the row if it exists
        tx.delete(funnelDays)
          .where(
            and(
              eq(funnelDays.funnelId, funnelId),
              eq(funnelDays.timeSlot, cell.timeSlot),
              eq(funnelDays.dayNum, cell.dayNum),
            )
          )
          .run();
      } else {
        // UPSERT: insert with defaults; on conflict update ONLY the 3 editable cols
        tx
          .insert(funnelDays)
          .values({
            funnelId,
            timeSlot: cell.timeSlot,
            dayNum: cell.dayNum,
            gcRoom: cell.gcRoom,
            webRoom: cell.webRoom,
            salesPage: cell.salesPage,
            // All other columns left to their schema defaults ('')
            replayUrl: '',
            webReplay: '',
            salesNote: '',
            tariffs: '',
            oto: '',
            bonuses: '',
            mission: '',
            missionType: '',
            meditation: '',
            dojimNote: '',
          })
          .onConflictDoUpdate({
            target: [funnelDays.funnelId, funnelDays.timeSlot, funnelDays.dayNum],
            set: {
              gcRoom: cell.gcRoom,
              webRoom: cell.webRoom,
              salesPage: cell.salesPage,
            },
          })
          .run();
      }
    }
  });
}

/**
 * Check whether a funnel exists by id.
 * Returns true if found.
 */
export function funnelExists(db: AnyDB, funnelId: number): boolean {
  const row = db
    .select({ id: funnels.id })
    .from(funnels)
    .where(eq(funnels.id, funnelId))
    .get();
  return row !== undefined;
}
