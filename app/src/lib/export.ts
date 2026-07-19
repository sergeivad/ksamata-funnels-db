/**
 * export.ts — pure helpers for the "Экспорт CSV" feature.
 *
 * buildExportRows() flattens every funnel into one row per link (Excel-friendly:
 * one link per row so staff can filter/sort). toCsv() serializes rows into a
 * RFC-4180 CSV string using ';' as the field separator (ru-locale Excel default).
 *
 * Both functions are DB-injected and HTTP-free so they can be unit-tested
 * without spinning up a route handler.
 */

import { type DB } from '../db/client';
import { listFunnels, getFunnel } from './funnels';
import { listBlocks } from './funnel-blocks';
import { listDays } from './funnel-days';
import { getBlockDef } from './blocks';

export type ExportRow = {
  num: number;
  frontCode: string;
  name: string;
  status: string;
  product: string;
  contractor: string;
  channel: string;
  direction: string;
  section: string;
  time: string;
  day: string;
  description: string;
  url: string;
};

export const EXPORT_HEADERS = [
  'Номер',
  'Код',
  'Воронка',
  'Статус',
  'Продукт',
  'Подрядчик',
  'Канал',
  'Направление',
  'Раздел',
  'Время',
  'День',
  'Описание',
  'Ссылка',
] as const;

/**
 * Build one flat row per link across every funnel:
 *   - one row per non-empty item URL in every funnel_blocks kind (title from
 *     the blocks.ts catalog; slot '15'/'19' resolves to the funnel's own
 *     timeLabelA/timeLabelB, 'common'-mode items leave Время empty).
 *   - one row per non-empty gcRoom / webRoom in funnel_days ("Комнаты (GC)" /
 *     "Комнаты (Web)"), День = dayNum.
 * A funnel with zero links still gets exactly one row (empty Раздел/Ссылка) so
 * the funnel list in the export is complete.
 */
export function buildExportRows(db: DB): ExportRow[] {
  const rows: ExportRow[] = [];

  for (const f of listFunnels(db)) {
    const detail = getFunnel(db, f.id);
    if (!detail) continue;

    const timeLabelFor = (slot: '15' | '19' | null): string => {
      if (slot === '15') return detail.timeLabelA;
      if (slot === '19') return detail.timeLabelB;
      return '';
    };

    const base = {
      num: f.num,
      frontCode: f.frontCode,
      name: f.name,
      status: f.status,
      product: f.axes.product,
      contractor: f.axes.contractor,
      channel: f.axes.channel,
      direction: f.axes.direction,
    };

    let rowCount = 0;

    for (const block of listBlocks(db, f.id)) {
      const title = getBlockDef(block.kind).title;
      for (const item of block.items) {
        if (!item.url.trim()) continue;
        rows.push({
          ...base,
          section: title,
          time: timeLabelFor(item.slot),
          day: '',
          description: item.label,
          url: item.url,
        });
        rowCount++;
      }
    }

    // Skip room links when the block is disabled, mirroring the UI (view mode
    // hides rooms on !roomsEnabled). Disable is non-destructive, so day rows may
    // still exist for a funnel the user marked as having no webinar rooms.
    for (const cell of detail.roomsEnabled ? listDays(db, f.id) : []) {
      const time = timeLabelFor(cell.timeSlot);
      if (cell.gcRoom.trim()) {
        rows.push({
          ...base,
          section: 'Комнаты (GC)',
          time,
          day: String(cell.dayNum),
          description: '',
          url: cell.gcRoom,
        });
        rowCount++;
      }
      if (cell.webRoom.trim()) {
        rows.push({
          ...base,
          section: 'Комнаты (Web)',
          time,
          day: String(cell.dayNum),
          description: '',
          url: cell.webRoom,
        });
        rowCount++;
      }
    }

    if (rowCount === 0) {
      rows.push({ ...base, section: '', time: '', day: '', description: '', url: '' });
    }
  }

  return rows;
}

/** Escape a single CSV field per RFC 4180 for a ';'-delimited dialect. */
function escapeCsvField(value: string): string {
  if (/[;"\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function rowToLine(values: string[]): string {
  return values.map(escapeCsvField).join(';');
}

/**
 * Serialize rows into a ';'-delimited CSV body (no BOM — callers prepend it
 * when writing an HTTP response so the string stays plain for unit tests).
 */
export function toCsv(rows: ExportRow[]): string {
  const lines = [rowToLine([...EXPORT_HEADERS])];

  for (const r of rows) {
    lines.push(
      rowToLine([
        String(r.num),
        r.frontCode,
        r.name,
        r.status,
        r.product,
        r.contractor,
        r.channel,
        r.direction,
        r.section,
        r.time,
        r.day,
        r.description,
        r.url,
      ])
    );
  }

  return lines.join('\r\n');
}
