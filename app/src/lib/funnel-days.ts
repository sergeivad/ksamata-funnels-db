/**
 * funnel-days.ts — read/write helper for funnel_days (вебинарные комнаты).
 * Manages ONLY the room and replay columns (gc_room, web_room, replay_url,
 * web_replay, replay_time, replay2_url, web_replay2, replay2_time). All other
 * columns are preserved on UPDATE and default to '' on INSERT. Injected `db`
 * handle.
 *
 * replaceDays is a REPLACE within one funnel, not a merge: days absent from the
 * payload are deleted. Callers must send the whole grid they want to keep —
 * which is what RoomsEditor does (both slots × days 1..N).
 */

import { eq, and, ne, inArray } from 'drizzle-orm';
import { type AnyDB } from '../db/client';
import { funnelDays, funnels } from '../db/schema';
import { ValidationError } from './errors';

/**
 * Повторы дня (Phase 19). Первый повтор — `replayUrl` (GC) + `webReplay`
 * (Web), второй — `replay2Url` + `webReplay2`. Время — «ЧЧ:ММ» по Москве,
 * его ставит поиск повторов по странице Бизона; '' — время неизвестно.
 */
export type ReplayFields = {
  webReplay: string;
  replayTime: string;
  replay2Url: string;
  webReplay2: string;
  replay2Time: string;
};

export const REPLAY_FIELDS: readonly (keyof ReplayFields)[] = [
  'webReplay', 'replayTime', 'replay2Url', 'webReplay2', 'replay2Time',
];

/**
 * Ячейка на запись. Поля повторов необязательны, и это не послабление, а
 * защита: разовые скрипты в `scripts/` и открытая до выката вкладка со
 * старым бандлом шлют ячейку без них. Отсутствующее поле при UPDATE не
 * трогается — иначе такой вызов молча стёр бы второй повтор.
 */
export type DayCell = {
  timeSlot: '19' | '15';
  dayNum: number;
  gcRoom: string;
  webRoom: string;
  replayUrl: string;
} & Partial<ReplayFields>;

/** Ячейка при чтении — все поля на месте. */
export type DayRow = DayCell & ReplayFields;

const VALID_TIME_SLOTS = new Set<string>(['19', '15']);
const MIN_DAY_NUM = 1;
const MAX_DAY_NUM = 5;

function validateCell(cell: DayCell): void {
  if (!VALID_TIME_SLOTS.has(cell.timeSlot)) {
    throw new ValidationError(`Invalid timeSlot "${cell.timeSlot}": must be '19' or '15'`);
  }
  if (cell.dayNum < MIN_DAY_NUM || cell.dayNum > MAX_DAY_NUM || !Number.isInteger(cell.dayNum)) {
    throw new ValidationError(`Invalid dayNum ${cell.dayNum}: must be an integer between 1 and 5`);
  }
  for (const f of ['replayTime', 'replay2Time'] as const) {
    const v = cell[f];
    if (v !== undefined && v !== '' && !REPLAY_TIME_RE.test(v)) {
      throw new ValidationError(`Invalid ${f} "${v}": must be HH:MM or empty`);
    }
  }
}

const REPLAY_TIME_RE = /^([01]?\d|2[0-3]):[0-5]\d$/;

export function listDays(db: AnyDB, funnelId: number): DayRow[] {
  const rows = db
    .select({
      timeSlot: funnelDays.timeSlot,
      dayNum: funnelDays.dayNum,
      gcRoom: funnelDays.gcRoom,
      webRoom: funnelDays.webRoom,
      replayUrl: funnelDays.replayUrl,
      webReplay: funnelDays.webReplay,
      replayTime: funnelDays.replayTime,
      replay2Url: funnelDays.replay2Url,
      webReplay2: funnelDays.webReplay2,
      replay2Time: funnelDays.replay2Time,
    })
    .from(funnelDays)
    .where(eq(funnelDays.funnelId, funnelId))
    .orderBy(funnelDays.timeSlot, funnelDays.dayNum)
    .all();

  return rows.map((r: {
    timeSlot: string | null; dayNum: number;
    gcRoom: string | null; webRoom: string | null; replayUrl: string | null;
    webReplay: string | null; replayTime: string | null;
    replay2Url: string | null; webReplay2: string | null; replay2Time: string | null;
  }) => ({
    timeSlot: r.timeSlot as '19' | '15',
    dayNum: r.dayNum,
    gcRoom: r.gcRoom ?? '',
    webRoom: r.webRoom ?? '',
    replayUrl: r.replayUrl ?? '',
    webReplay: r.webReplay ?? '',
    replayTime: r.replayTime ?? '',
    replay2Url: r.replay2Url ?? '',
    webReplay2: r.webReplay2 ?? '',
    replay2Time: r.replay2Time ?? '',
  }));
}

/** Поля повторов, присланные в ячейке, — только они и попадут в UPDATE. */
function presentReplayFields(cell: DayCell): Partial<ReplayFields> {
  const out: Partial<ReplayFields> = {};
  for (const f of REPLAY_FIELDS) if (typeof cell[f] === 'string') out[f] = cell[f];
  return out;
}

/** Пустая ли ячейка: время без ссылки ничего не значит и строку не держит. */
function isEmptyCell(cell: DayCell): boolean {
  return [cell.gcRoom, cell.webRoom, cell.replayUrl, cell.webReplay, cell.replay2Url, cell.webReplay2]
    .every((v) => (v ?? '').trim() === '');
}

export function replaceDays(db: AnyDB, funnelId: number, cells: DayCell[]): void {
  for (const cell of cells) validateCell(cell);

  db.transaction((tx) => {
    // Full replace, not a merge: a day the payload no longer mentions is gone.
    // The editor renumbers days into a contiguous 1..N on delete and then sends
    // only 1..N, so without this the dropped tail row survives and resurfaces
    // as a duplicate of the day that shifted up into its place.
    const keep = new Set(cells.map((c) => `${c.timeSlot}-${c.dayNum}`));
    const existing = tx
      .select({ id: funnelDays.id, timeSlot: funnelDays.timeSlot, dayNum: funnelDays.dayNum })
      .from(funnelDays)
      .where(eq(funnelDays.funnelId, funnelId))
      .all() as { id: number; timeSlot: string | null; dayNum: number }[];
    const orphans = existing
      .filter((r) => !keep.has(`${r.timeSlot}-${r.dayNum}`))
      .map((r) => r.id);
    if (orphans.length > 0) {
      tx.delete(funnelDays).where(inArray(funnelDays.id, orphans)).run();
    }

    let wroteRoom = false;

    for (const cell of cells) {
      // Пустой считается ячейка, где нет ни одной ссылки ИЗ ПРИСЛАННЫХ. Старый
      // вызов без полей повторов не может пустым «гнать» в DELETE строку, где
      // лежит второй повтор, — проверяем, что там записано.
      let isEmpty = isEmptyCell(cell);
      if (isEmpty && REPLAY_FIELDS.some((f) => cell[f] === undefined)) {
        const stored = tx
          .select({ replay2Url: funnelDays.replay2Url, webReplay: funnelDays.webReplay, webReplay2: funnelDays.webReplay2 })
          .from(funnelDays)
          .where(and(
            eq(funnelDays.funnelId, funnelId),
            eq(funnelDays.timeSlot, cell.timeSlot),
            eq(funnelDays.dayNum, cell.dayNum),
          ))
          .get() as { replay2Url: string | null; webReplay: string | null; webReplay2: string | null } | undefined;
        if (stored) {
          const merged = { ...cell, ...Object.fromEntries(
            (['webReplay', 'replay2Url', 'webReplay2'] as const)
              .filter((f) => cell[f] === undefined)
              .map((f) => [f, stored[f] ?? '']),
          ) };
          isEmpty = isEmptyCell(merged);
        }
      }

      if (!isEmpty) wroteRoom = true;

      if (isEmpty) {
        tx.delete(funnelDays)
          .where(and(
            eq(funnelDays.funnelId, funnelId),
            eq(funnelDays.timeSlot, cell.timeSlot),
            eq(funnelDays.dayNum, cell.dayNum),
          ))
          .run();
      } else {
        const replays = presentReplayFields(cell);
        tx.insert(funnelDays)
          .values({
            funnelId,
            timeSlot: cell.timeSlot,
            dayNum: cell.dayNum,
            gcRoom: cell.gcRoom,
            webRoom: cell.webRoom,
            replayUrl: cell.replayUrl,
            ...replays,
          })
          .onConflictDoUpdate({
            target: [funnelDays.funnelId, funnelDays.timeSlot, funnelDays.dayNum],
            set: { gcRoom: cell.gcRoom, webRoom: cell.webRoom, replayUrl: cell.replayUrl, ...replays },
          })
          .run();
      }
    }

    // Записали хоть одну живую комнату — включаем раздел. `rooms_enabled` не
    // «есть ли строки», а переключатель показа: выключенным он прячет комнаты
    // и в карточке, и в ЭКСПОРТЕ (export.ts пропускает дни выключенной
    // воронки). Ставили его до этого ровно два места — бэкфилл Phase-4 и
    // RoomsEditor, который после PUT дней отдельным PATCH сохраняет флаг.
    // Поэтому любая запись мимо админки (питон-скрипты импорта, разовые tsx)
    // оставляла комнаты невидимыми: так разошлись шесть воронок и 52 комнаты,
    // десятая часть всех.
    //
    // Включаем ТОЛЬКО вверх и только при непустой записи. Очистка сетки —
    // законная операция, и превращать её в «включить раздел» нельзя; выключение
    // же остаётся решением человека («вебинаров у воронки нет»), и молча
    // отменять его запись комнат не должна.
    if (wroteRoom) {
      tx.update(funnels)
        .set({ roomsEnabled: 1 })
        .where(and(eq(funnels.id, funnelId), ne(funnels.roomsEnabled, 1)))
        .run();
    }
  });
}

export function funnelExists(db: AnyDB, funnelId: number): boolean {
  const row = db.select({ id: funnels.id }).from(funnels).where(eq(funnels.id, funnelId)).get();
  return row !== undefined;
}
