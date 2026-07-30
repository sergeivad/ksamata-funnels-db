import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db/client';
import { getMonitorDashboard } from '@/lib/monitor-view';
import { internalError } from '@/lib/http';
import { requireEditor } from '@/lib/auth-server';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const denied = await requireEditor(req);
  if (denied) return denied;

  try {
    return NextResponse.json(getMonitorDashboard(db));
  } catch (err: unknown) {
    return internalError('GET /api/monitoring', err);
  }
}
