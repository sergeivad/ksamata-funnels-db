import { NextResponse } from 'next/server';
import { db } from '@/db/client';
import { getMonitorDashboard } from '@/lib/monitor-view';
import { internalError } from '@/lib/http';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return NextResponse.json(getMonitorDashboard(db));
  } catch (err: unknown) {
    return internalError('GET /api/monitoring', err);
  }
}
