/**
 * block-fill.ts — pure helper functions for BlockEditor / BlockListField UX features:
 * bulk paste of links, mirroring 15:00 -> 19:00 rows, standard link set, and
 * copy-all-links formatting. No side effects, no DB access.
 */

import type { BlockItem } from './funnel-blocks';
import type { BlockMode } from './blocks';

const URL_RE = /https?:\/\/\S+/;

/**
 * Parse a single pasted line into { label, url }.
 * - If the line contains a URL, everything before it (minus separators like
 *   " — ", ": ", tabs, trailing spaces) becomes the label.
 * - If the line is only a URL, label is ''.
 * - If there is no URL at all, the whole line goes into `url` as-is so the
 *   user can see and fix it manually.
 */
export function parsePastedLine(line: string): { label: string; url: string } {
  const match = URL_RE.exec(line);
  if (!match) {
    return { label: '', url: line.trim() };
  }
  const url = match[0].trim();
  const before = line.slice(0, match.index);
  const label = before
    .replace(/[\t]+/g, ' ')
    .replace(/[-–—:]+\s*$/, '')
    .trim();
  return { label, url };
}

/**
 * Mirror a slot-15 url/label string into its slot-19 equivalent by replacing
 * the standalone token "15" with "19". A token is bounded by -, _, /, ., :,
 * whitespace, or the start/end of the string, so numbers like 1534353
 * (no boundary between "5" and "3") are left alone.
 */
export function mirrorSlotUrl(s: string): string {
  return s.replace(/(^|[-_/.:\s])15(?=[-_/.:\s]|$)/g, '$119');
}

/**
 * Derive the Web-room URL from a GC-room URL: the slug is shared between
 * platforms (295/299 historical pairs). Only single-segment gc.ksamata.ru
 * paths qualify — course pages like gc.ksamata.ru/svs/bonus1 are not rooms.
 * Returns '' when the value doesn't look like a GC room link.
 */
const GC_ROOM_RE = /^https?:\/\/gc\.ksamata\.ru\/([^\s/]+)$/i;

export function webRoomFromGc(gc: string): string {
  const m = GC_ROOM_RE.exec(gc.trim());
  return m ? `https://web.ksamatacenter.com/room/${m[1]}` : '';
}

/**
 * Mirror a day-1 room url into another day by replacing the standalone day
 * digit: 1dbo-bookv → 2dbo-bookv, dih1-15-rsya → dih2-15-rsya. "Standalone"
 * means not adjacent to another digit, so the 15/19 time tokens survive.
 * (Verified against history: 232/235 rows follow this rule.)
 */
export function mirrorDayUrl(s: string, fromDay: number, toDay: number): string {
  return s.replace(new RegExp(`(?<!\\d)${fromDay}(?!\\d)`, 'g'), String(toDay));
}

/** The 6 labels ever used in the `links` block, in canonical order. */
export const STANDARD_LINKS_LABELS: string[] = [
  'Дашборд продаж',
  'Дашборд перелива',
  'Регистрации всего',
  'Регистрации 15:00',
  'Регистрации 19:00',
  'Регистрации без времени',
];

/** Standard labels not yet present among `existing` (trim + case-insensitive compare). */
export function missingStandardLabels(existing: string[]): string[] {
  const have = new Set(existing.map((l) => l.trim().toLowerCase()));
  return STANDARD_LINKS_LABELS.filter((l) => !have.has(l.trim().toLowerCase()));
}

/**
 * Format all non-empty-url items of a block into a plain-text list suitable
 * for clipboard copy. In `by_time` mode, items are grouped under `15:00:` /
 * `19:00:` section headers (using the real timeLabels), with a blank line
 * between sections. In `common` mode it's a flat list.
 */
export function formatBlockLinks(
  items: BlockItem[],
  mode: BlockMode,
  timeLabelA: string,
  timeLabelB: string,
): string {
  const lineFor = (it: BlockItem) => (it.label.trim() ? `${it.label.trim()} — ${it.url.trim()}` : it.url.trim());

  const nonEmpty = items.filter((it) => it.url.trim() !== '');

  if (mode !== 'by_time') {
    return nonEmpty.map(lineFor).join('\n');
  }

  const slotA = nonEmpty.filter((it) => it.slot === '15');
  const slotB = nonEmpty.filter((it) => it.slot === '19');
  const other = nonEmpty.filter((it) => it.slot !== '15' && it.slot !== '19');

  const sections: string[] = [];
  if (slotA.length) sections.push(`${timeLabelA}:\n${slotA.map(lineFor).join('\n')}`);
  if (slotB.length) sections.push(`${timeLabelB}:\n${slotB.map(lineFor).join('\n')}`);
  if (other.length) sections.push(other.map(lineFor).join('\n'));

  return sections.join('\n\n');
}

/**
 * Mode-switch transforms for BlockEditor. Switching «По времени» → «Общее»
 * flattens slots to null; the caller stashes the pre-flatten items so that
 * switching back restores the original 15/19 split instead of dumping every
 * row into slot 15 (a round-trip toggle must be lossless). Neither function
 * saves anything — persisting a flatten is the caller's (confirmed) decision.
 */
export function flattenToCommon(items: BlockItem[]): BlockItem[] {
  return items.map((it) => ({ ...it, slot: null }));
}

/**
 * Items for switching «Общее» → «По времени»: if `stash` (the items as they
 * were before the last flatten) still flattens to exactly the current items —
 * i.e. nothing was edited while in common mode — restore the stash with its
 * slot split; otherwise assign slot 15 to slotless rows.
 */
export function restoreByTime(items: BlockItem[], stash: BlockItem[] | null): BlockItem[] {
  if (stash && JSON.stringify(flattenToCommon(stash)) === JSON.stringify(items)) {
    return stash;
  }
  return items.map((it) => ({ ...it, slot: it.slot ?? '15' }));
}
