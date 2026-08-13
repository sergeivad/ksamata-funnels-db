/**
 * rooms-grid.ts — pure grid <-> cells transforms for RoomsEditor.
 * No side effects, no DB access (client-safe, unlike funnel-days.ts).
 */

import type { DayCell } from './funnel-days';
import { mirrorDayUrl, mirrorSlotRoomUrl, webRoomFromGc } from './room-urls';

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

type FillField = 'gcRoom' | 'webRoom' | 'replayUrl';

/**
 * Источник для пустой ячейки. Своим слотом пользуемся в первую очередь: там
 * нужно только дневное зеркало — единственное преобразование, верное на всех
 * 4032 парах дней живой базы. Чужой слот добавляет к нему слотовое (264/264).
 * Повтор из чужого слота не выводится вовсе: правила, связывающего повтор с
 * комнатой или со вторым временем, в данных нет (38 из 44 — не правило).
 *
 * Источник, в котором дневное зеркало ничего не изменило, отбраковывается:
 * цифры дня в адресе нет, и класть его в другой день значит размножить один
 * и тот же адрес по всей колонке. В живой базе таких нет — но пустая ячейка
 * честнее, чем пять ссылок на одну комнату.
 */
function sourceFor(grid: RoomGrid, slot: string, day: number, field: FillField, dayCount: number): string {
  for (let d = 1; d <= dayCount; d++) {
    // Повтор — запись уже прошедшего эфира: он появляется только у финальных
    // дней (в живой базе — только у дней 4-5), а достройка назад сочиняла бы
    // запись для дня, у которого её не было. gcRoom/webRoom остаются
    // двусторонними — это подтверждено на живых данных (см. room-urls.ts).
    if (field === 'replayUrl' && d > day) continue;
    const v = grid[gridKey(slot, d)]?.[field].trim();
    if (!v) continue;
    const byDay = mirrorDayUrl(v, d, day);
    if (byDay === v && d !== day) continue;
    return byDay;
  }
  if (field === 'replayUrl') return '';
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
 * Достроить пустые ячейки сетки по образцу заполненных. Два прохода: сначала
 * каждое поле выводится из одноимённого (GC из GC, Web из Web, повтор из
 * повтора), затем оставшийся пустым Web берётся из GC своей же ячейки — это и
 * позволяет развернуть всю сетку из одной введённой комнаты.
 *
 * Проход 1 читает исходную сетку, поэтому не зависит от порядка обхода.
 * Проход 2 читает результат прохода 1 (out), но каждая ячейка выводится
 * только из самой себя (webRoom из своего же gcRoom, а не из соседних
 * ячеек) — так что порядок обхода снова ни при чём. Непустое поле не
 * перетирается никогда, даже если отличается от выводимого — это правка
 * человека.
 */
export function fillRoomGrid(grid: RoomGrid, dayCount: number, replayEnabled: boolean): RoomGrid {
  const fields: FillField[] = replayEnabled ? ['gcRoom', 'webRoom', 'replayUrl'] : ['gcRoom', 'webRoom'];
  const out: RoomGrid = { ...grid };

  for (const slot of SLOTS) for (let d = 1; d <= dayCount; d++) {
    const k = gridKey(slot, d);
    const cell: RoomCell = { ...(out[k] ?? { gcRoom: '', webRoom: '', replayUrl: '' }) };
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
