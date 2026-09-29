/**
 * room-check.ts — «Заполнить и проверить»: какие комнаты у дней воронки есть
 * на Бизоне на самом деле — и эфиры, и повторы.
 *
 * Эфиры (checkRooms, фаза 1). Сетку присылает карточка. Сначала проверяются
 * комнаты, вписанные человеком; затем пустые ячейки достраиваются тем же
 * fillRoomGrid, что жил за кнопкой «Заполнить остальные» (правило вывода одно,
 * и оно в rooms-grid.ts), — но только от комнат, которых Бизон не отверг, — и
 * выведенные кандидаты проверяются тоже. До 29.09.2026 выведенная комната
 * вписывалась без проверки, и мёртвую комнату эфира видел только мониторинг
 * после сохранения.
 *
 * Повторы (фаза 2) ищутся только у эфиров, которые нашлись: кандидат `r`/`rr`
 * строится из кода эфира, и у мёртвого эфира он построен от неверного кода.
 * Для каждого дня и каждого из двух повторов:
 *  - повтор уже заполнен комнатным адресом — проверяем его (узнать время);
 *  - пуст — строим кандидата из слага эфира по правилу `r`/`rr` (replaySlug)
 *    и проверяем кандидата;
 *  - заполнен не комнатным адресом — не трогаем: это правка человека, а
 *    проверить нечего.
 *
 * Проверка — GET открытой страницы web.ksamatacenter.com/room/<слаг>, без
 * входа в Бизон. Итогов три, и третий не придирка: сбой сети — не «комнаты
 * нет», иначе проверка тихо записала бы мёртвым то, чего просто не дождалась
 * (тот самый тихий ноль, на котором проект обжигался уже дважды).
 *
 * Хост зашит, в адрес попадает только слаг из [a-z0-9_-] (isRoomSlug), поэтому
 * произвольный адрес через эту функцию запросить нельзя — в отличие от
 * мониторинга, которому нужна полная защита monitor-check.ts.
 *
 * Ничего не пишет: результат уходит в карточку подсвеченным, сохраняет человек.
 */
import { parseBizonRoomPage } from './bizon-room-page';
import { isRoomSlug, replaySlug, roomSlugFromUrl, webRoomUrl } from './room-urls';
import { buildGrid, fillRoomGrid, gridKey, SLOTS } from './rooms-grid';
import type { DayCell } from './funnel-days';

export type FindCellInput = {
  timeSlot: '15' | '19';
  dayNum: number;
  /** Адрес эфира (GC или Web) — из него строятся кандидаты. */
  liveUrl: string;
  /** Текущие значения полей повтора 1 и 2 (Web или GC, как в поле). */
  replay1: string;
  replay2: string;
};

export type FindOutcome =
  | 'found'     // комната есть
  | 'missing'   // Бизон: «Веб-комната не найдена»
  | 'error'     // не дождались ответа — неизвестно
  | 'skipped';  // проверять нечего: нет цифры дня в слаге эфира или поле занято не комнатой

export type FindResult = {
  timeSlot: '15' | '19';
  dayNum: number;
  n: 1 | 2;
  /** Проверенный слаг; null — проверки не было. */
  slug: string | null;
  /** Было ли поле заполнено до поиска: заполненное поиск не перезаписывает. */
  wasFilled: boolean;
  outcome: FindOutcome;
  /** «ЧЧ:ММ» по Москве, если комната есть и на ней запланирован показ. */
  time: string | null;
};

/** Пять дней × два времени — больше ячеек в сетке не бывает. */
export const MAX_CHECK_CELLS = 10;
const CONCURRENCY = 4;
/**
 * Замер 29.09.2026 из dev-сервера: 20 страниц за 15 с, и четыре из них не
 * уложились в 10 с. Отсюда 15 с и один повтор неудачной проверки. На
 * пятидневную воронку — до 10 эфиров и 20 повторов, то есть до 30 страниц:
 * обычно 5–15 с, а если Бизон молчит на всё — около четырёх минут.
 */
const TIMEOUT_MS = 15_000;
/** Страница комнаты ~30 КБ, closestDate лежит в середине скрипта. */
const MAX_BYTES = 256 * 1024;

export type FetchFn = typeof fetch;

type Probe = { outcome: 'found' | 'missing' | 'error'; time: string | null };

async function readCapped(res: Response): Promise<string> {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (size < MAX_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.byteLength;
  }
  await reader.cancel().catch(() => {});
  const buf = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) { buf.set(c.subarray(0, size - at), at); at += c.byteLength; }
  return new TextDecoder().decode(buf);
}

export async function probeRoom(slug: string, fetchImpl: FetchFn = fetch): Promise<Probe> {
  if (!isRoomSlug(slug)) return { outcome: 'error', time: null };
  try {
    const res = await fetchImpl(webRoomUrl(slug), {
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'User-Agent': 'KsamataFunnels/1.0 (room-check)' },
    });
    if (res.status !== 200) {
      await res.body?.cancel().catch(() => {});
      return { outcome: 'error', time: null };
    }
    const page = parseBizonRoomPage(await readCapped(res));
    return page.exists ? { outcome: 'found', time: page.time } : { outcome: 'missing', time: null };
  } catch {
    return { outcome: 'error', time: null };
  }
}

type Job = Omit<FindResult, 'outcome' | 'time'>;

function planJobs(cells: FindCellInput[]): Job[] {
  const jobs: Job[] = [];
  for (const c of cells) {
    const liveSlug = roomSlugFromUrl(c.liveUrl);
    for (const n of [1, 2] as const) {
      const current = (n === 1 ? c.replay1 : c.replay2).trim();
      if (current) {
        // Код комнаты без адреса — тоже комната: так его показывает поле.
        const slug = roomSlugFromUrl(current) ?? (isRoomSlug(current) ? current : null);
        jobs.push({ timeSlot: c.timeSlot, dayNum: c.dayNum, n, slug, wasFilled: true });
      } else {
        const slug = liveSlug ? replaySlug(liveSlug, c.dayNum, n) : null;
        jobs.push({ timeSlot: c.timeSlot, dayNum: c.dayNum, n, slug: slug && isRoomSlug(slug) ? slug : null, wasFilled: false });
      }
    }
  }
  return jobs;
}

/** Проверить слаги пулом в CONCURRENCY потоков; порядок результатов — порядок слагов. */
async function probeAll(slugs: (string | null)[], fetchImpl: FetchFn): Promise<(Probe | null)[]> {
  const out: (Probe | null)[] = new Array(slugs.length).fill(null);
  let next = 0;
  async function worker() {
    while (next < slugs.length) {
      const i = next++;
      const slug = slugs[i];
      if (!slug) continue;
      let p = await probeRoom(slug, fetchImpl);
      if (p.outcome === 'error') p = await probeRoom(slug, fetchImpl);
      out[i] = p;
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return out;
}

export async function findReplays(cells: FindCellInput[], fetchImpl: FetchFn = fetch): Promise<FindResult[]> {
  const jobs = planJobs(cells);
  const probes = await probeAll(jobs.map((j) => j.slug), fetchImpl);
  return jobs.map((job, i) => {
    const p = probes[i];
    return p ? { ...job, outcome: p.outcome, time: p.time } : { ...job, outcome: 'skipped', time: null };
  });
}

// ── Эфиры ────────────────────────────────────────────────────────────────────

export type LiveResult = {
  timeSlot: '15' | '19';
  dayNum: number;
  /** Проверенный слаг: вписанный человеком или выведенный; null — проверки не было. */
  slug: string | null;
  /** Было ли поле эфира заполнено до проверки: заполненное не перезаписывается. */
  wasFilled: boolean;
  /** skipped — в поле не комната или вывести комнату не из чего. */
  outcome: FindOutcome;
};

export type RoomCheckResult = { lives: LiveResult[]; replays: FindResult[] };

const cellSlug = (gc: string, web: string) => roomSlugFromUrl(web) ?? roomSlugFromUrl(gc);

/**
 * Проверить сетку целиком. `withReplays: false` — тумблер «повтор» выключен:
 * человек сказал, что повторов здесь нет, и искать их незачем.
 */
export async function checkRooms(
  cells: DayCell[], withReplays: boolean, fetchImpl: FetchFn = fetch,
): Promise<RoomCheckResult> {
  const dayCount = Math.max(0, ...cells.map((c) => c.dayNum));
  const grid = buildGrid(cells, dayCount);
  const keys = SLOTS.flatMap((slot) => Array.from({ length: dayCount }, (_, i) => ({ slot, day: i + 1 })));

  // Сначала — вписанное человеком. Мёртвая комната не должна становиться
  // образцом: достройка берёт источник в своём слоте раньше чужого, и одна
  // опечатка в 19:00 выводила бы от себя всю колонку 19:00 мёртвой, хотя из
  // живой 15:00 она выводится (поймано на снимке справки 29.09.2026).
  // «Не проверено» образцом остаётся: неизвестно — не значит «нет».
  const own = keys.map(({ slot, day }) => {
    const c = grid[gridKey(slot, day)];
    const wasFilled = Boolean(c.gcRoom.trim() || c.webRoom.trim());
    return { slot, day, wasFilled, slug: wasFilled ? cellSlug(c.gcRoom, c.webRoom) : null };
  });
  const ownProbes = await probeAll(own.map((o) => o.slug), fetchImpl);

  const sources = { ...grid };
  own.forEach((o, i) => {
    if (ownProbes[i]?.outcome === 'missing') {
      sources[gridKey(o.slot, o.day)] = { ...grid[gridKey(o.slot, o.day)], gcRoom: '', webRoom: '' };
    }
  });
  const filled = fillRoomGrid(sources, dayCount);
  const candidates = own.map((o) => {
    if (o.wasFilled) return null;
    const c = filled[gridKey(o.slot, o.day)];
    return cellSlug(c.gcRoom, c.webRoom);
  });
  const candidateProbes = await probeAll(candidates, fetchImpl);

  const liveResults: LiveResult[] = own.map((o, i) => ({
    timeSlot: o.slot, dayNum: o.day, wasFilled: o.wasFilled,
    slug: o.wasFilled ? o.slug : candidates[i],
    outcome: (o.wasFilled ? ownProbes[i] : candidateProbes[i])?.outcome ?? 'skipped',
  }));
  if (!withReplays) return { lives: liveResults, replays: [] };

  const replayCells: FindCellInput[] = liveResults.map((l) => {
    const c = grid[gridKey(l.timeSlot, l.dayNum)];
    return {
      timeSlot: l.timeSlot, dayNum: l.dayNum,
      // Кандидаты повторов — только от найденного эфира; уже вписанные повторы
      // проверяются всё равно (planJobs), чтобы узнать время или пометить мёртвый.
      liveUrl: l.outcome === 'found' && l.slug ? webRoomUrl(l.slug) : '',
      replay1: c.webReplay || c.replayUrl,
      replay2: c.webReplay2 || c.replay2Url,
    };
  });
  return { lives: liveResults, replays: await findReplays(replayCells, fetchImpl) };
}
