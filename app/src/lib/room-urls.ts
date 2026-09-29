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

// ── Один слаг — три адреса ──────────────────────────────────────────────────
//
// Замер 29.09.2026: gc.ksamata.ru/<слаг> отвечает 302 на
// web.ksamatacenter.com/room/<слаг>, а тот и start.bizon365.ru/room/135662/<слаг>
// — одна и та же комната Бизона под двумя доменами (одинаковый <title>). Во
// всех 584 днях живой базы слаг GC и слаг Web совпадают, исключений нет.
// Поэтому комната задаётся слагом, а три адреса из него выводятся.
//
// GC при этом не синоним: это страница ГетКурса, которую кто-то должен
// завести. Не заведена — 404, хотя комната жива. Поэтому храним и GC, и Web, и
// мониторинг проверяет их по отдельности.

const ROOM_HOST_RES: RegExp[] = [
  /^https?:\/\/gc\.ksamata\.ru\/([^\s/?#]+)\/?(?:[?#].*)?$/i,
  /^https?:\/\/web\.ksamatacenter\.com\/room\/([^\s/?#]+)\/?(?:[?#].*)?$/i,
  /^https?:\/\/start\.bizon365\.ru\/room\/\d+\/([^\s/?#]+)\/?(?:[?#].*)?$/i,
];

/**
 * Слаг комнаты — то, что сервер вправе подставить в адрес запроса к Бизону:
 * буквы, цифры, дефис, подчёркивание. Всё прочее — не комната.
 */
const ROOM_SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,79}$/i;

export function isRoomSlug(s: string): boolean {
  return ROOM_SLUG_RE.test(s);
}

/**
 * Слаг из любого из трёх адресов комнаты; null — адрес не комнатный (курсовые
 * страницы вида gc.ksamata.ru/svs/bonus1 сюда не проходят: у них два сегмента).
 */
export function roomSlugFromUrl(url: string): string | null {
  const v = url.trim();
  for (const re of ROOM_HOST_RES) {
    const m = re.exec(v);
    if (m && isRoomSlug(m[1])) return m[1];
  }
  return null;
}

export const gcRoomUrl = (slug: string) => `https://gc.ksamata.ru/${slug}`;
export const webRoomUrl = (slug: string) => `https://web.ksamatacenter.com/room/${slug}`;

/**
 * Слаг повтора из слага эфира: `r` (повтор 1) или `rr` (повтор 2) сразу после
 * цифры дня — cvc3-15-yan → cvc3r-15-yan / cvc3rr-15-yan, 4boo-yons →
 * 4rboo-yons. Цифра дня ищется «отдельной», как в mirrorDayUrl, чтобы токены
 * времени 15/19 не сошли за день 1. Null — цифры дня в слаге нет.
 *
 * Это кандидат, а не ответ: правило сходится с 38 из 44 старых повторов базы,
 * поэтому поиск повторов (replay-finder.ts) каждый кандидат проверяет на Бизоне.
 */
export function replaySlug(liveSlug: string, dayNum: number, n: 1 | 2): string | null {
  const re = new RegExp(`(?<!\\d)${dayNum}(?!\\d)`);
  const m = re.exec(liveSlug);
  if (!m) return null;
  const at = m.index + m[0].length;
  return liveSlug.slice(0, at) + 'r'.repeat(n) + liveSlug.slice(at);
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

  // После переставляемого слова хвост обязан либо отсутствовать, либо
  // начинаться с разделителя — иначе цифра дня слипается с соседним словом
  // (1dbo2-x → «dbo12-x» вместо отказа: «2» тут часть слага, а не хвост).
  const m = from === '15'
    ? /^(\d)([a-z]+)(?=[-_.]|$)(.*)$/i.exec(slug)   // 1dbo-bookv → dbo1-bookv
    : /^([a-z]+)(\d)(?=[-_.]|$)(.*)$/i.exec(slug);  // dbo1-bookv → 1dbo-bookv
  return m ? `${head}${m[2]}${m[1]}${m[3]}` : '';
}
