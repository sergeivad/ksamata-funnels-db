import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db/client';
import { getFunnelHealth } from '@/lib/monitor-funnel-health';
import { runningFunnelCheckId } from '@/lib/monitor-run';
import { internalError } from '@/lib/http';
import { requireEditor } from '@/lib/auth-server';

export const dynamic = 'force-dynamic';

/**
 * Состояние ссылок всех воронок — отдельным роутом, а не полем в /api/funnels:
 * тот лежит в белом списке публичного чтения, и мониторинг стал бы публичным.
 */
export async function GET(req: NextRequest) {
  const denied = await requireEditor(req);
  if (denied) return denied;

  try {
    const health = Object.fromEntries(getFunnelHealth(db));
    return NextResponse.json({ health, checkingFunnelId: runningFunnelCheckId() });
  } catch (err: unknown) {
    return internalError('GET /api/monitoring/funnels', err);
  }
}
