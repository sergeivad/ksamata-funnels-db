/**
 * replay-finder.ts — «Найти повторы»: какие повторы у дней воронки есть на
 * самом деле и во сколько они идут.
 *
 * Для каждого дня и каждого из двух повторов:
 *  - повтор уже заполнен комнатным адресом — проверяем его (узнать время);
 *  - пуст — строим кандидата из слага эфира по правилу `r`/`rr` (replaySlug)
 *    и проверяем кандидата;
 *  - заполнен не комнатным адресом — не трогаем: это правка человека, а
 *    проверить нечего.
 * Проверка — GET открытой страницы web.ksamatacenter.com/room/<слаг>, без
 * входа в Бизон. Итогов три, и третий не придирка: сбой сети — не «повтора
 * нет», иначе поиск тихо записал бы мёртвым то, чего просто не дождался (тот
 * самый тихий ноль, на котором проект обжигался уже дважды).
 *
 * Хост зашит, в адрес попадает только слаг из [a-z0-9_-] (isRoomSlug), поэтому
 * произвольный адрес через эту функцию запросить нельзя — в отличие от
 * мониторинга, которому нужна полная защита monitor-check.ts.
 *
 * Сохраняет не поиск, а человек: результат уходит в карточку подсвеченным.
 */
import { parseBizonRoomPage } from './bizon-room-page';
import { isRoomSlug, replaySlug, roomSlugFromUrl, webRoomUrl } from './room-urls';

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

export const MAX_FIND_CELLS = 10;
const CONCURRENCY = 4;
/**
 * Замер 29.09.2026 из dev-сервера: 20 страниц за 15 с, и четыре из них не
 * уложились в 10 с. Отсюда 15 с и один повтор неудачной проверки.
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
      headers: { 'User-Agent': 'KsamataFunnels/1.0 (replay-finder)' },
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
        jobs.push({ timeSlot: c.timeSlot, dayNum: c.dayNum, n, slug: roomSlugFromUrl(current), wasFilled: true });
      } else {
        const slug = liveSlug ? replaySlug(liveSlug, c.dayNum, n) : null;
        jobs.push({ timeSlot: c.timeSlot, dayNum: c.dayNum, n, slug: slug && isRoomSlug(slug) ? slug : null, wasFilled: false });
      }
    }
  }
  return jobs;
}

export async function findReplays(cells: FindCellInput[], fetchImpl: FetchFn = fetch): Promise<FindResult[]> {
  const jobs = planJobs(cells);
  const results: FindResult[] = new Array(jobs.length);
  let next = 0;
  async function worker() {
    while (next < jobs.length) {
      const i = next++;
      const job = jobs[i];
      if (!job.slug) {
        results[i] = { ...job, outcome: 'skipped', time: null };
        continue;
      }
      let p = await probeRoom(job.slug, fetchImpl);
      if (p.outcome === 'error') p = await probeRoom(job.slug, fetchImpl);
      results[i] = { ...job, outcome: p.outcome, time: p.time };
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return results;
}
