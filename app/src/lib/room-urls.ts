/**
 * room-urls.ts — правила адресов вебинарных комнат. Чистые функции: ни БД,
 * ни node:*, ни побочных эффектов — их зовёт клиентский RoomsEditor.
 *
 * Три преобразования, каждое замерено по живой базе (спека
 * docs/superpowers/specs/2026-08-13-rooms-grid-autofill-design.md):
 * дневное зеркало 4032/4032, слотовое 264/264, Web из GC 528/528.
 */

const GC_ROOM_RE = /^https?:\/\/gc\.ksamata\.ru\/([^\s/]+)$/i;

/**
 * Derive the Web-room URL from a GC-room URL: the slug is shared between the
 * two platforms. Only single-segment gc.ksamata.ru paths qualify — course
 * pages like gc.ksamata.ru/svs/bonus1 are not rooms.
 * Returns '' when the value doesn't look like a GC room link.
 */
export function webRoomFromGc(gc: string): string {
  const m = GC_ROOM_RE.exec(gc.trim());
  return m ? `https://web.ksamatacenter.com/room/${m[1]}` : '';
}

/**
 * Mirror a room url into another day by replacing the standalone day digit:
 * 1dbo-bookv → 2dbo-bookv, dih1-15-rsya → dih2-15-rsya. "Standalone" means not
 * adjacent to another digit, so the 15/19 time tokens survive.
 */
export function mirrorDayUrl(s: string, fromDay: number, toDay: number): string {
  return s.replace(new RegExp(`(?<!\\d)${fromDay}(?!\\d)`, 'g'), String(toDay));
}

/** Replace a standalone time token inside a slug; null when it isn't there. */
function swapTime(slug: string, from: string, to: string): string | null {
  const re = new RegExp(`(^|[-_.])${from}(?=[-_.]|$)`);
  return re.test(slug) ? slug.replace(re, `$1${to}`) : null;
}

/**
 * Mirror a room url from one time slot to the other. Two families, and the
 * slug itself says which one (264/264 historical pairs, no third case):
 *   A — the slug carries the time token: dbo1-15-vks ↔ dbo1-19-vks;
 *   B — the day digit moves across the first word: 1dbo-bookv ↔ dbo1-bookv.
 * Returns '' when neither applies, and also when the slug carries the OTHER
 * slot's token — such an address contradicts the cell it sits in, and family B
 * would happily rearrange it into garbage.
 */
export function mirrorSlotRoomUrl(url: string, from: '15' | '19'): string {
  const to = from === '15' ? '19' : '15';
  const cut = url.lastIndexOf('/');
  if (cut < 0) return '';
  const head = url.slice(0, cut + 1);
  const slug = url.slice(cut + 1);
  if (!slug) return '';

  const swapped = swapTime(slug, from, to);
  if (swapped) return head + swapped;
  if (swapTime(slug, to, from)) return '';

  const m = from === '15'
    ? /^(\d)([a-z]+)(.*)$/i.exec(slug)   // 1dbo-bookv → dbo1-bookv
    : /^([a-z]+)(\d)(.*)$/i.exec(slug);  // dbo1-bookv → 1dbo-bookv
  return m ? `${head}${m[2]}${m[1]}${m[3]}` : '';
}
