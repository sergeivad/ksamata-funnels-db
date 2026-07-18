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
