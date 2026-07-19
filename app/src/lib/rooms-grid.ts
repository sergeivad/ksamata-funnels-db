/**
 * rooms-grid.ts — pure grid <-> cells transforms for RoomsEditor.
 * No side effects, no DB access (client-safe, unlike funnel-days.ts).
 */

import type { DayCell } from './funnel-days';

export const SLOTS: ('15' | '19')[] = ['15', '19'];

export type RoomCell = { gcRoom: string; webRoom: string; replayUrl: string };
export type RoomGrid = Record<string, RoomCell>; // key `${slot}-${day}`

export function gridKey(slot: string, day: number): string {
  return `${slot}-${day}`;
}

export function buildGrid(days: DayCell[], dayCount: number): RoomGrid {
  const g: RoomGrid = {};
  for (const slot of SLOTS) for (let d = 1; d <= dayCount; d++) g[gridKey(slot, d)] = { gcRoom: '', webRoom: '', replayUrl: '' };
  for (const d of days) g[gridKey(d.timeSlot, d.dayNum)] = { gcRoom: d.gcRoom, webRoom: d.webRoom, replayUrl: d.replayUrl };
  return g;
}

/**
 * Same shape the PUT /days payload uses — reused both for saving and for
 * diffing the live grid against the last-saved snapshot. replayUrl is ALWAYS
 * included: the «повтор» toggle only hides the column in the UI, it must
 * never erase replay links already stored in the DB.
 */
export function cellsFromGrid(grid: RoomGrid, dayCount: number): DayCell[] {
  const cells: DayCell[] = [];
  for (const slot of SLOTS) for (let d = 1; d <= dayCount; d++) {
    const c = grid[gridKey(slot, d)];
    cells.push({ timeSlot: slot, dayNum: d, gcRoom: c.gcRoom, webRoom: c.webRoom, replayUrl: c.replayUrl });
  }
  return cells;
}
