/**
 * funnel-compact.ts — pure helpers for the read-only "Просмотр" card view
 * (FunnelCompactView). Kept framework-free so they're easy to unit test.
 */

import type { DayCell, ReplayFields } from './funnel-days';
import type { BlockItem, BlockState } from './funnel-blocks';

export type RoomSlotData = { gcRoom: string; webRoom: string; replayUrl: string } & ReplayFields;
export type RoomDayGroup = { dayNum: number; slots: Partial<Record<'15' | '19', RoomSlotData>> };

/**
 * Group day cells by dayNum (ascending), dropping any cell whose gc/web/replay
 * fields are all empty. `initialDays` normally only contains cells with data
 * already (empty ones are deleted on save — see funnel-days.ts), but this
 * stays defensive so the view never renders a blank row/cell.
 */
export function groupDaysByDay(days: DayCell[]): RoomDayGroup[] {
  const byDay = new Map<number, RoomDayGroup>();
  for (const d of days) {
    const hasContent = [d.gcRoom, d.webRoom, d.replayUrl, d.webReplay, d.replay2Url, d.webReplay2]
      .some((v) => (v ?? '').trim() !== '');
    if (!hasContent) continue;
    let group = byDay.get(d.dayNum);
    if (!group) {
      group = { dayNum: d.dayNum, slots: {} };
      byDay.set(d.dayNum, group);
    }
    group.slots[d.timeSlot] = {
      gcRoom: d.gcRoom, webRoom: d.webRoom, replayUrl: d.replayUrl,
      webReplay: d.webReplay ?? '', replayTime: d.replayTime ?? '',
      replay2Url: d.replay2Url ?? '', webReplay2: d.webReplay2 ?? '', replay2Time: d.replay2Time ?? '',
    };
  }
  return [...byDay.values()].sort((a, b) => a.dayNum - b.dayNum);
}

/** True if at least one item in the list carries a non-empty url. */
export function blockHasContent(items: BlockItem[]): boolean {
  return items.some((it) => it.url.trim() !== '');
}

/** Enabled blocks that have at least one non-empty url, preserving order. */
export function visibleBlocks(blocks: BlockState[]): BlockState[] {
  return blocks.filter((b) => b.enabled && blockHasContent(b.items));
}

/**
 * True if any visible (non-empty url) item carries a non-empty label.
 * When false, the compact view drops the label column entirely instead of
 * rendering a column of "—" placeholders.
 */
export function blockHasLabels(items: BlockItem[]): boolean {
  return items.some((it) => it.url.trim() !== '' && it.label.trim() !== '');
}

/** Matches http(s) URLs eligible for click-to-open (same rule as BlockListField). */
export function isOpenableUrl(url: string): boolean {
  return /^https?:\/\//i.test(url.trim());
}
