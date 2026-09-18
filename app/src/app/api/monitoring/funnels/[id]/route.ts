import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db/client';
import { getFunnelHealth, listFunnelProblems } from '@/lib/monitor-funnel-health';
import { runningFunnelCheckId } from '@/lib/monitor-run';
import { funnelExists } from '@/lib/funnel-days';
import { parseRouteId } from '@/lib/validation';
import { internalError } from '@/lib/http';
import { requireEditor } from '@/lib/auth-server';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

const EMPTY = { down: 0, unknown: 0, enabled: 0, total: 0, lastCheckedAt: null };

export async function GET(req: NextRequest, { params }: Params) {
  const denied = await requireEditor(req);
  if (denied) return denied;

  const { id } = await params;
  const numId = parseRouteId(id);
  if (numId === null) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  if (!funnelExists(db, numId)) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  try {
    return NextResponse.json({
      // Воронка без единой цели — законное состояние (пустой черновик), и
      // пустой агрегат честнее отсутствующего ключа.
      health: getFunnelHealth(db, [numId]).get(numId) ?? EMPTY,
      problems: listFunnelProblems(db, numId),
      checking: runningFunnelCheckId() === numId,
    });
  } catch (err: unknown) {
    return internalError('GET /api/monitoring/funnels/[id]', err);
  }
}
