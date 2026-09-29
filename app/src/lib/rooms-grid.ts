/**
 * rooms-grid.ts — pure grid <-> cells transforms for RoomsEditor.
 * No side effects, no DB access (client-safe, unlike funnel-days.ts).
 */

import type { DayCell, ReplayFields } from './funnel-days';
import type { RoomCheckResult } from './room-check';
import { gcRoomUrl, isRoomSlug, mirrorDayUrl, mirrorSlotRoomUrl, roomSlugFromUrl, webRoomFromGc, webRoomUrl } from './room-urls';

export const SLOTS: ('15' | '19')[] = ['15', '19'];

export const MAX_DAYS = 5;

/**
 * На скольких днях открыть сетку. Пустая — сразу на пяти: пятидневных воронок
 * с комнатами 53 из 62 (замер 29.09.2026), и на трёх днях «добавить день» жали
 * дважды почти всегда. Сетка с данными — по своим дням, но не меньше трёх, как
 * и раньше: дни, которых человек не заводил, мы ему не навязываем.
 * «Пустая» — ни одной непустой ссылки эфира или повтора: строки, которые
 * остались от сохранения пустой сетки, данными не считаются.
 */
export function initialDayCount(days: DayCell[]): number {
  const hasData = days.some((d) =>
    [d.gcRoom, d.webRoom, d.replayUrl, d.webReplay, d.replay2Url, d.webReplay2].some((v) => (v ?? '').trim() !== ''));
  if (!hasData) return MAX_DAYS;
  return Math.min(MAX_DAYS, Math.max(3, ...days.map((d) => d.dayNum)));
}

export type RoomCell = { gcRoom: string; webRoom: string; replayUrl: string } & ReplayFields;
export type RoomGrid = Record<string, RoomCell>; // key `${slot}-${day}`

export function gridKey(slot: string, day: number): string {
  return `${slot}-${day}`;
}

export function emptyCell(): RoomCell {
  return {
    gcRoom: '', webRoom: '', replayUrl: '',
    webReplay: '', replayTime: '', replay2Url: '', webReplay2: '', replay2Time: '',
  };
}

export function buildGrid(days: DayCell[], dayCount: number): RoomGrid {
  const g: RoomGrid = {};
  for (const slot of SLOTS) for (let d = 1; d <= dayCount; d++) g[gridKey(slot, d)] = emptyCell();
  for (const d of days) {
    g[gridKey(d.timeSlot, d.dayNum)] = {
      gcRoom: d.gcRoom, webRoom: d.webRoom, replayUrl: d.replayUrl,
      webReplay: d.webReplay ?? '', replayTime: d.replayTime ?? '',
      replay2Url: d.replay2Url ?? '', webReplay2: d.webReplay2 ?? '', replay2Time: d.replay2Time ?? '',
    };
  }
  return g;
}

/**
 * Same shape the PUT /days payload uses — reused both for saving and for
 * diffing the live grid against the last-saved snapshot. Replay fields are
 * ALWAYS included: the «повтор» toggle only hides the section in the UI, it
 * must never erase replay links already stored in the DB.
 */
export function cellsFromGrid(grid: RoomGrid, dayCount: number): DayCell[] {
  const cells: DayCell[] = [];
  for (const slot of SLOTS) for (let d = 1; d <= dayCount; d++) {
    cells.push({ timeSlot: slot, dayNum: d, ...grid[gridKey(slot, d)] });
  }
  return cells;
}

// ── Повторы ──────────────────────────────────────────────────────────────────

export type ReplayN = 1 | 2;

const REPLAY_KEYS = {
  1: { gc: 'replayUrl', web: 'webReplay', time: 'replayTime' },
  2: { gc: 'replay2Url', web: 'webReplay2', time: 'replay2Time' },
} as const;

export type ReplayView = { gc: string; web: string; time: string };

export function replayOf(cell: RoomCell, n: ReplayN): ReplayView {
  const k = REPLAY_KEYS[n];
  return { gc: cell[k.gc], web: cell[k.web], time: cell[k.time] };
}

/**
 * Что показывать в единственном поле повтора: название комнаты (слаг), а если
 * адрес не комнатный — его как есть. Не адрес целиком: в половине ширины от
 * него виден только «https://web.ksam», а различает повторы как раз хвост.
 * Поле одно, потому что GC и Web — два адреса одной комнаты (room-urls.ts);
 * полные адреса копируются кнопками под полем.
 */
export function replayInputValue(cell: RoomCell, n: ReplayN): string {
  const r = replayOf(cell, n);
  return roomSlugFromUrl(r.web) ?? roomSlugFromUrl(r.gc) ?? (r.web || r.gc);
}

/** Слаг из того, что вставили в поле: любой из трёх адресов или сам слаг. */
function slugFromInput(raw: string): string | null {
  const v = raw.trim();
  return roomSlugFromUrl(v) ?? (isRoomSlug(v) ? v : null);
}

/**
 * Записать то, что человек вставил в поле повтора. Любой из трёх адресов
 * комнаты или её название раскладывается в пару GC + Web; всё прочее ложится
 * в GC как есть — это не комната, но стирать введённое нельзя.
 *
 * Время повтора сбрасывается, если сменилась сама комната: его знает только
 * поиск по Бизону, и время чужой комнаты врало бы.
 */
export function withReplayLink(cell: RoomCell, n: ReplayN, raw: string): RoomCell {
  const k = REPLAY_KEYS[n];
  const before = roomSlugFromUrl(cell[k.web]) ?? roomSlugFromUrl(cell[k.gc]);
  const slug = slugFromInput(raw);
  const next: RoomCell = slug
    ? { ...cell, [k.gc]: gcRoomUrl(slug), [k.web]: webRoomUrl(slug) }
    : { ...cell, [k.gc]: raw, [k.web]: '' };
  if (slug !== before) next[k.time] = '';
  return next;
}

// ── Эфир ─────────────────────────────────────────────────────────────────────
//
// Поле эфира устроено так же, как поле повтора: одно на комнату, показывает
// код, хранит пару GC + Бизон. До 29.09.2026 у эфира было два поля, и Бизон
// выводился из GC на выходе из поля; с одним полем выводить нечего — пара
// пишется сразу. Разойтись паре негде: во всех 584 днях живой базы слаги GC и
// Бизона совпадают (замер 29.09), так что код в поле однозначен.

/** Что показывать в поле эфира: код комнаты, а не комнатный адрес — как есть. */
export function liveInputValue(cell: RoomCell): string {
  return roomSlugFromUrl(cell.webRoom) ?? roomSlugFromUrl(cell.gcRoom) ?? (cell.webRoom || cell.gcRoom);
}

/**
 * Записать вставленное в поле эфира: любой из трёх адресов комнаты или код →
 * пара GC + Бизон; прочее — в GC как есть, Бизон пуст (как у повтора).
 */
export function withLiveLink(cell: RoomCell, raw: string): RoomCell {
  const slug = slugFromInput(raw);
  return slug
    ? { ...cell, gcRoom: gcRoomUrl(slug), webRoom: webRoomUrl(slug) }
    : { ...cell, gcRoom: raw, webRoom: '' };
}

/** Повтор, найденный на Бизоне: ссылка по слагу и время со страницы. */
export function withFoundReplay(cell: RoomCell, n: ReplayN, slug: string, time: string | null): RoomCell {
  const k = REPLAY_KEYS[n];
  return { ...cell, [k.gc]: gcRoomUrl(slug), [k.web]: webRoomUrl(slug), [k.time]: time ?? '' };
}

/**
 * Время, общее для всей колонки повтора, — его показывает заголовок. Null,
 * если у заполненных ячеек время разное или его нет ни у одной: тогда время
 * показывается в самих ячейках.
 */
export function commonReplayTime(grid: RoomGrid, slot: string, n: ReplayN, dayCount: number): string | null {
  const times = new Set<string>();
  for (let d = 1; d <= dayCount; d++) {
    const r = replayOf(grid[gridKey(slot, d)], n);
    if (!(r.gc || r.web)) continue;
    times.add(r.time);
  }
  if (times.size !== 1) return null;
  const [t] = [...times];
  return t || null;
}

// ── Достройка эфиров ─────────────────────────────────────────────────────────

type FillField = 'gcRoom' | 'webRoom';

/**
 * Источник для пустой ячейки. Своим слотом пользуемся в первую очередь: там
 * нужно только дневное зеркало — единственное преобразование, верное на всех
 * 4032 парах дней живой базы. Чужой слот добавляет к нему слотовое (264/264).
 *
 * Повторы достройка не трогает с Phase 19: их выводит поиск по Бизону
 * (room-check.ts), который каждый кандидат проверяет. Зеркало дней
 * сочиняло бы повторы и тем дням, у которых их нет (у F21 — пятый день).
 *
 * Источник, в котором дневное зеркало ничего не изменило, отбраковывается:
 * цифры дня в адресе нет, и класть его в другой день значит размножить один
 * и тот же адрес по всей колонке. В живой базе таких нет — но пустая ячейка
 * честнее, чем пять ссылок на одну комнату.
 */
function sourceFor(grid: RoomGrid, slot: string, day: number, field: FillField, dayCount: number): string {
  for (let d = 1; d <= dayCount; d++) {
    const v = grid[gridKey(slot, d)]?.[field].trim();
    if (!v) continue;
    const byDay = mirrorDayUrl(v, d, day);
    if (byDay === v && d !== day) continue;
    return byDay;
  }
  const other = slot === '15' ? '19' : '15';
  for (let d = 1; d <= dayCount; d++) {
    const v = grid[gridKey(other, d)]?.[field].trim();
    if (!v) continue;
    const byDay = mirrorDayUrl(v, d, day);
    if (byDay === v && d !== day) continue;
    // Пустой результат — не ответ, а повод перейти к следующему дню: слаг
    // мог отбраковаться (см. mirrorSlotRoomUrl), а более поздний день
    // всё ещё может подойти.
    const mirrored = mirrorSlotRoomUrl(byDay, other);
    if (mirrored) return mirrored;
  }
  return '';
}

/**
 * Добавить в сетку пустой день `dayCount + 1`.
 *
 * До 29.09.2026 новый день сразу выводился по правилам достройки, но без
 * проверки на Бизоне, а вписывать теперь можно только комнаты, которые там
 * есть. Строку заполняет та же кнопка «Заполнить и проверить». Пустая сетка
 * открывается сразу на пяти днях, так что этот клик нужен редко.
 */
export function appendDay(grid: RoomGrid, dayCount: number): RoomGrid {
  const out: RoomGrid = { ...grid };
  for (const slot of SLOTS) out[gridKey(slot, dayCount + 1)] = emptyCell();
  return out;
}

/**
 * Достроить пустые ячейки эфиров по образцу заполненных. Два прохода: сначала
 * каждое поле выводится из одноимённого (GC из GC, Web из Web), затем
 * оставшийся пустым Web берётся из GC своей же ячейки — это и позволяет
 * развернуть всю сетку из одной введённой комнаты.
 *
 * Проход 1 читает исходную сетку, поэтому не зависит от порядка обхода.
 * Проход 2 читает результат прохода 1 (out), но каждая ячейка выводится
 * только из самой себя (webRoom из своего же gcRoom, а не из соседних
 * ячеек) — так что порядок обхода снова ни при чём. Непустое поле не
 * перетирается никогда, даже если отличается от выводимого — это правка
 * человека.
 *
 * С 29.09.2026 результат не вписывается напрямую: это кандидаты, которые
 * checkRooms (room-check.ts) проверяет на Бизоне, и в карточку попадают только
 * найденные.
 */
export function fillRoomGrid(grid: RoomGrid, dayCount: number): RoomGrid {
  const fields: FillField[] = ['gcRoom', 'webRoom'];
  const out: RoomGrid = { ...grid };

  for (const slot of SLOTS) for (let d = 1; d <= dayCount; d++) {
    const k = gridKey(slot, d);
    const cell: RoomCell = { ...(out[k] ?? emptyCell()) };
    for (const f of fields) {
      if (cell[f].trim() !== '') continue;
      const v = sourceFor(grid, slot, d, f, dayCount);
      if (v) cell[f] = v;
    }
    out[k] = cell;
  }

  for (const slot of SLOTS) for (let d = 1; d <= dayCount; d++) {
    const c = out[gridKey(slot, d)];
    if (c.webRoom.trim() === '' && c.gcRoom.trim() !== '') {
      const web = webRoomFromGc(c.gcRoom);
      if (web) c.webRoom = web;
    }
  }

  return out;
}

// ── Итог «Заполнить и проверить» ────────────────────────────────────────────

/**
 * Пометка ячейки после проверки:
 *  - `new` — вписано кнопкой, комната на Бизоне есть (подсветка до сохранения);
 *  - `missing` — поле было заполнено, а Бизон отвечает «Веб-комната не найдена»;
 *  - `absent` — поле было пустым, по правилу искали комнату `slug`, её нет;
 *    поле осталось пустым (только у эфира: пустой кандидат повтора — норма,
 *    у F21 нет повторов пятого дня);
 *  - `error` — не дождались ответа: неизвестно, ничего не вписано.
 */
export type CheckMark = { kind: 'new' | 'missing' | 'absent' | 'error'; slug: string };

export const liveMarkKey = (slot: string, day: number) => `${slot}-${day}-0`;
export const replayMarkKey = (slot: string, day: number, n: ReplayN) => `${slot}-${day}-${n}`;

export type RoomCheckCounts = {
  livesAdded: number; livesMissing: number; livesAbsent: number; livesFailed: number;
  replaysAdded: number; replaysAbsent: number; replaysMissing: number; replaysFailed: number;
};

const isBlank = (...vs: string[]) => vs.every((v) => v.trim() === '');

/**
 * Разложить ответ проверки по сетке. Вписывается только найденное и только в
 * пустые поля — ячейку, которую человек успел поменять, пока шла проверка, не
 * трогаем (сравнение со свежей сеткой, а не с той, что уходила на сервер).
 * Непустое поле не перетирается никогда.
 */
export function applyRoomCheck(grid: RoomGrid, result: RoomCheckResult): {
  grid: RoomGrid; marks: Record<string, CheckMark>; counts: RoomCheckCounts;
} {
  const g: RoomGrid = { ...grid };
  const marks: Record<string, CheckMark> = {};
  const counts: RoomCheckCounts = {
    livesAdded: 0, livesMissing: 0, livesAbsent: 0, livesFailed: 0,
    replaysAdded: 0, replaysAbsent: 0, replaysMissing: 0, replaysFailed: 0,
  };

  for (const r of result.lives) {
    const k = gridKey(r.timeSlot, r.dayNum);
    const c = g[k];
    if (!c || !r.slug) continue;
    const empty = isBlank(c.gcRoom, c.webRoom);
    const same = (roomSlugFromUrl(c.webRoom) ?? roomSlugFromUrl(c.gcRoom)) === r.slug;
    // Поле сменилось за время проверки — ответ относится к другому значению.
    if (r.wasFilled ? !same : !empty) continue;
    const mk = liveMarkKey(r.timeSlot, r.dayNum);
    if (r.outcome === 'found') {
      if (!r.wasFilled) {
        g[k] = withLiveLink(c, r.slug);
        marks[mk] = { kind: 'new', slug: r.slug };
        counts.livesAdded++;
      }
    } else if (r.outcome === 'missing') {
      marks[mk] = { kind: r.wasFilled ? 'missing' : 'absent', slug: r.slug };
      if (r.wasFilled) counts.livesMissing++; else counts.livesAbsent++;
    } else if (r.outcome === 'error') {
      marks[mk] = { kind: 'error', slug: r.slug };
      counts.livesFailed++;
    }
  }

  for (const r of result.replays) {
    const k = gridKey(r.timeSlot, r.dayNum);
    const c = g[k];
    if (!c || !r.slug) continue;
    const cur = replayOf(c, r.n);
    const curSlug = roomSlugFromUrl(cur.web) ?? roomSlugFromUrl(cur.gc) ?? (isRoomSlug(cur.gc.trim()) ? cur.gc.trim() : null);
    const empty = isBlank(cur.gc, cur.web);
    if (r.wasFilled ? curSlug !== r.slug : !empty) continue;
    const mk = replayMarkKey(r.timeSlot, r.dayNum, r.n);
    if (r.outcome === 'found') {
      if (!r.wasFilled) {
        g[k] = withFoundReplay(c, r.n, r.slug, r.time);
        marks[mk] = { kind: 'new', slug: r.slug };
        counts.replaysAdded++;
      } else if (r.time && cur.time !== r.time) {
        g[k] = withFoundReplay(c, r.n, r.slug, r.time);
      }
    } else if (r.outcome === 'missing') {
      if (r.wasFilled) { marks[mk] = { kind: 'missing', slug: r.slug }; counts.replaysMissing++; }
      else counts.replaysAbsent++;
    } else if (r.outcome === 'error') {
      marks[mk] = { kind: 'error', slug: r.slug };
      counts.replaysFailed++;
    }
  }

  return { grid: g, marks, counts };
}

/** Сводка под сеткой: что вписано, чего нет, что не проверено. */
export function roomCheckSummary(c: RoomCheckCounts, withReplays: boolean): string {
  const added = [
    c.livesAdded > 0 ? `эфиров ${c.livesAdded}` : '',
    withReplays && c.replaysAdded > 0 ? `повторов ${c.replaysAdded}` : '',
  ].filter(Boolean).join(', ');
  const missing = c.livesMissing + c.replaysMissing;
  const failed = c.livesFailed + c.replaysFailed;
  return [
    added ? `Вписано: ${added}. Они подсвечены, проверьте и сохраните.` : 'Нового не вписано.',
    missing > 0 ? `Вписанных комнат, которых нет на Бизоне: ${missing}, отмечены красным.` : '',
    c.livesAbsent > 0 ? `Эфиров, не найденных по правилу: ${c.livesAbsent}, поля остались пустыми.` : '',
    failed > 0 ? `Не удалось проверить: ${failed}, нажмите ещё раз.` : '',
  ].filter(Boolean).join(' ');
}
