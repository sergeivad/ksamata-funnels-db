import { NextResponse } from 'next/server';
import { db } from '@/db/client';
import { runMonitorCycle, isCycleRunning } from '@/lib/monitor-run';
import { getMonitorDashboard } from '@/lib/monitor-view';
import { internalError } from '@/lib/http';

export const dynamic = 'force-dynamic';

export async function POST() {
  if (isCycleRunning()) {
    return NextResponse.json({ error: 'Проверка уже идёт' }, { status: 409 });
  }
  try {
    const cycle = await runMonitorCycle(db);
    if (cycle === null) {
      return NextResponse.json({ error: 'Проверка уже идёт' }, { status: 409 });
    }
    return NextResponse.json({ cycle, ...getMonitorDashboard(db) });
  } catch (err: unknown) {
    return internalError('POST /api/monitoring/run', err);
  }
}
