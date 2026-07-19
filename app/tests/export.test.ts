/**
 * Tests for GET /api/export and the pure export.ts helpers.
 *
 * Route-level tests follow the pattern from api-refs-id-route.test.ts: point
 * FUNNELS_DB_PATH to a temp copy of the real DB *before* importing the route
 * handler, so the singleton db in @/db/client opens the temp file.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { copyFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { runMigratePhase5 } from '../scripts/migrate-phase5';

const REAL_DB = join(__dirname, '../../ksamata_funnels.db');
const TMP_DB = join(tmpdir(), `ksamata_export_route_test_${Date.now()}.db`);

copyFileSync(REAL_DB, TMP_DB);

// Seed Phase-5 (tag_templates + funnel_tag_overrides) via a throwaway handle
// on the same temp file — getFunnel/listFunnels now read tag_templates when
// computing tagSets, so the route under test needs it present.
const migrationSqlite = new Database(TMP_DB);
runMigratePhase5(migrationSqlite);
migrationSqlite.close();

process.env.FUNNELS_DB_PATH = TMP_DB;

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let exportGET: typeof import('../src/app/api/export/route').GET;

beforeAll(async () => {
  const mod = await import('../src/app/api/export/route');
  exportGET = mod.GET;
});

afterAll(() => {
  try {
    unlinkSync(TMP_DB);
  } catch {
    // ignore if already gone
  }
});

// ── Route ────────────────────────────────────────────────────────────────────

describe('GET /api/export', () => {
  it('returns a 200 CSV response with BOM, headers, and full funnel coverage', async () => {
    const res = await exportGET();
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/csv');
    expect(res.headers.get('Content-Disposition')).toContain('filename=');

    // Response.text()/TextDecoder strips a leading BOM per spec, so check the
    // raw bytes instead: UTF-8 BOM is EF BB BF.
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));

    const withoutBom = buf.subarray(3).toString('utf8');
    const lines = withoutBom.split('\r\n').filter((l) => l.length > 0);

    // Header row uses ';' delimiter
    expect(lines[0]).toBe(
      'Номер;Код;Воронка;Статус;Продукт;Подрядчик;Канал;Направление;Раздел;Время;День;Описание;Ссылка'
    );

    // ~700+ links across ~32 funnels
    expect(lines.length).toBeGreaterThan(500);

    // A known GC-room link should be present somewhere in the export
    expect(withoutBom).toContain('gc.ksamata.ru');
  });
});

// ── roomsEnabled gating ──────────────────────────────────────────────────────

describe('buildExportRows — roomsEnabled gating', () => {
  it('omits Комнаты rows for a funnel that has day rows but roomsEnabled=false', async () => {
    const Database = (await import('better-sqlite3')).default;
    const { drizzle } = await import('drizzle-orm/better-sqlite3');
    const schema = await import('../src/db/schema');
    const { buildExportRows } = await import('../src/lib/export');
    const { updateFunnel } = await import('../src/lib/funnels');

    const tmp = join(tmpdir(), `ksamata_export_gate_${Date.now()}.db`);
    copyFileSync(REAL_DB, tmp);
    const sqlite = new Database(tmp);
    const db = drizzle(sqlite, { schema });

    const roomsRowsFor = (num: number) =>
      buildExportRows(db).filter((r) => r.num === num && r.section.startsWith('Комнаты'));

    // Funnel #1 has day rows and is enabled by the Phase-4 backfill.
    expect(roomsRowsFor(1).length).toBeGreaterThan(0);

    // Manually disabling rooms is non-destructive (day rows stay), but the
    // export must mirror the UI and stop emitting room links.
    updateFunnel(db, 1, { roomsEnabled: false });
    expect(roomsRowsFor(1).length).toBe(0);

    sqlite.close();
    unlinkSync(tmp);
  });
});

// ── Pure helpers ─────────────────────────────────────────────────────────────

describe('toCsv (unit)', () => {
  it('escapes fields containing ";", quotes, or newlines per RFC 4180', async () => {
    const { toCsv } = await import('../src/lib/export');

    const rows = [
      {
        num: 1,
        frontCode: 'f1',
        name: 'Продукт; с точкой с запятой',
        status: 'active',
        product: 'П',
        contractor: 'К',
        channel: 'Ч',
        direction: 'Н',
        section: 'Лендинги',
        time: '15:00',
        day: '',
        description: 'Ссылка с "кавычками" и\nпереносом',
        url: 'https://example.com',
      },
    ];

    const csv = toCsv(rows);
    const lines = csv.split('\r\n');

    expect(lines[0]).toBe(
      'Номер;Код;Воронка;Статус;Продукт;Подрядчик;Канал;Направление;Раздел;Время;День;Описание;Ссылка'
    );

    // The ';'-containing name field must be quoted
    expect(lines[1]).toContain('"Продукт; с точкой с запятой"');
    // Internal quotes must be doubled, and the whole field quoted (contains \n too)
    expect(lines[1]).toContain('"Ссылка с ""кавычками"" и\nпереносом"');
  });
});
