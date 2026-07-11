/**
 * funnel-days.ts — read/write helper for funnel_days (вебинарные комнаты).
 * Manages ONLY gc_room, web_room, replay_url. All other columns are preserved
 * on UPDATE and default to '' on INSERT. Injected `db` handle.
 */

import { eq, and } from 'drizzle-orm';
import { type AnyDB } from '../db/client';
import { funnelDays, funnels } from '../db/schema';
import { ValidationError } from './errors';

export type DayCell = {
  timeSlot: '19' | '15';
  dayNum: number;
  gcRoom: string;
  webRoom: string;
  replayUrl: string;
};

const VALID_TIME_SLOTS = new Set<string>(['19', '15']);
const MIN_DAY_NUM = 1;
const MAX_DAY_NUM = 5;

function validateCell(cell: DayCell): void {
  if (!VALID_TIME_SLOTS.has(cell.timeSlot)) {
    throw new ValidationError(`Invalid timeSlot "${cell.timeSlot}": must be '19' or '15'`);
  }
  if (cell.dayNum < MIN_DAY_NUM || cell.dayNum > MAX_DAY_NUM || !Number.isInteger(cell.dayNum)) {
    throw new ValidationError(`Invalid dayNum ${cell.dayNum}: must be an integer between 1 and 5`);
  }
}

export function listDays(db: AnyDB, funnelId: number): DayCell[] {
  const rows = db
    .select({
      timeSlot: funnelDays.timeSlot,
      dayNum: funnelDays.dayNum,
      gcRoom: funnelDays.gcRoom,
      webRoom: funnelDays.webRoom,
      replayUrl: funnelDays.replayUrl,
    })
    .from(funnelDays)
    .where(eq(funnelDays.funnelId, funnelId))
    .orderBy(funnelDays.timeSlot, funnelDays.dayNum)
    .all();

  return rows.map((r: {
    timeSlot: string | null; dayNum: number;
    gcRoom: string | null; webRoom: string | null; replayUrl: string | null;
  }) => ({
    timeSlot: r.timeSlot as '19' | '15',
    dayNum: r.dayNum,
    gcRoom: r.gcRoom ?? '',
    webRoom: r.webRoom ?? '',
    replayUrl: r.replayUrl ?? '',
  }));
}

export function replaceDays(db: AnyDB, funnelId: number, cells: DayCell[]): void {
  for (const cell of cells) validateCell(cell);

  db.transaction((tx) => {
    for (const cell of cells) {
      const isEmpty =
        cell.gcRoom.trim() === '' &&
        cell.webRoom.trim() === '' &&
        cell.replayUrl.trim() === '';

      if (isEmpty) {
        tx.delete(funnelDays)
          .where(and(
            eq(funnelDays.funnelId, funnelId),
            eq(funnelDays.timeSlot, cell.timeSlot),
            eq(funnelDays.dayNum, cell.dayNum),
          ))
          .run();
      } else {
        tx.insert(funnelDays)
          .values({
            funnelId,
            timeSlot: cell.timeSlot,
            dayNum: cell.dayNum,
            gcRoom: cell.gcRoom,
            webRoom: cell.webRoom,
            replayUrl: cell.replayUrl,
          })
          .onConflictDoUpdate({
            target: [funnelDays.funnelId, funnelDays.timeSlot, funnelDays.dayNum],
            set: { gcRoom: cell.gcRoom, webRoom: cell.webRoom, replayUrl: cell.replayUrl },
          })
          .run();
      }
    }
  });
}

export function funnelExists(db: AnyDB, funnelId: number): boolean {
  const row = db.select({ id: funnels.id }).from(funnels).where(eq(funnels.id, funnelId)).get();
  return row !== undefined;
}
