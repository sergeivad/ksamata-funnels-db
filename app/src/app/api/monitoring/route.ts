import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db/client';
import { getMonitorDashboard } from '@/lib/monitor-view';
import { getCanaryState } from '@/lib/monitor-canary';
import { internalError } from '@/lib/http';
import { requireEditor } from '@/lib/auth-server';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const denied = await requireEditor(req);
  if (denied) return denied;

  try {
    // roomCheck отдельным ключом, а не внутри summary: getMonitorDashboard
    // синхронна, а канарейка — сетевой вызов с кэшем.
    const [dashboard, roomCheck] = await Promise.all([
      Promise.resolve(getMonitorDashboard(db)),
      getCanaryState(),
    ]);
    return NextResponse.json({ ...dashboard, roomCheck });
  } catch (err: unknown) {
    return internalError('GET /api/monitoring', err);
  }
}
