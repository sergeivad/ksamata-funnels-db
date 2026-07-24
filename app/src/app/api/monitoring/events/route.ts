import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db/client';
import { listMonitorEvents } from '@/lib/monitor-view';
import { internalError } from '@/lib/http';

export const dynamic = 'force-dynamic';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/** Мусор в query не должен ронять страницу — молча падаем на значение по умолчанию. */
function readNumber(raw: string | null, fallback: number, max: number): number {
  if (raw === null || !/^\d+$/.test(raw)) return fallback;
  return Math.min(Number(raw), max);
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const limit = readNumber(url.searchParams.get('limit'), DEFAULT_LIMIT, MAX_LIMIT);
  const offset = readNumber(url.searchParams.get('offset'), 0, Number.MAX_SAFE_INTEGER);

  try {
    return NextResponse.json({ events: listMonitorEvents(db, limit, offset) });
  } catch (err: unknown) {
    return internalError('GET /api/monitoring/events', err);
  }
}
