/**
 * rooms-grid.ts — pure grid <-> cells transforms for RoomsEditor.
 * No side effects, no DB access (client-safe, unlike funnel-days.ts).
 */

import type { DayCell, ReplayFields } from './funnel-days';
import { gcRoomUrl, isRoomSlug, mirrorDayUrl, mirrorSlotRoomUrl, roomSlugFromUrl, webRoomFromGc, webRoomUrl } from './room-urls';

export const SLOTS: ('15' | '19')[] = ['15', '19'];

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
 * (replay-finder.ts), который каждый кандидат проверяет. Зеркало дней
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
 * Добавить в сетку день `dayCount + 1`, сразу выведя его ячейки по тем же
 * правилам, что и «Заполнить остальные».
 *
 * Почему автоматически: сетка открывается на трёх днях, а пятидневных воронок
 * в живой базе 53 из 62 — то есть «добавить день» жмут почти всегда, и пустая
 * строка после него требовала второго клика по «Заполнить остальные».
 *
 * Почему только новый день: достройка берётся из `fillRoomGrid`, но
 * применяется исключительно к добавленной паре ячеек. День, который человек
 * оставил пустым, — это его решение, и добавление шестой строки не повод его
 * отменять. Кнопка «Заполнить остальные» рядом никуда не делась.
 */
export function appendDay(grid: RoomGrid, dayCount: number): RoomGrid {
  const day = dayCount + 1;
  const widened: RoomGrid = { ...grid };
  for (const slot of SLOTS) widened[gridKey(slot, day)] = emptyCell();
  const filled = fillRoomGrid(widened, day);
  const out: RoomGrid = { ...widened };
  for (const slot of SLOTS) out[gridKey(slot, day)] = filled[gridKey(slot, day)];
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
