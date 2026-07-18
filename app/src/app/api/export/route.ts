import { NextResponse } from 'next/server';
import { db } from '@/db/client';
import { buildExportRows, toCsv } from '@/lib/export';
import { internalError } from '@/lib/http';

/**
 * GET /api/export — download a flat CSV of every funnel link, one row per
 * link, for staff who still work in Excel. UTF-8 BOM + ';' delimiter so
 * ru-locale Excel opens it without a manual import step.
 */
export async function GET() {
  try {
    const rows = buildExportRows(db);
    const BOM = '﻿';
    const csv = BOM + toCsv(rows);
    const filename = `ksamata_funnels_${new Date().toISOString().slice(0, 10)}.csv`;

    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition':
          `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      },
    });
  } catch (err: unknown) {
    return internalError('GET /api/export', err);
  }
}
