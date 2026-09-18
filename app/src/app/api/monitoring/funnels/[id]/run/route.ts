import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db/client';
import { runFunnelCheck, runningFunnelCheckId } from '@/lib/monitor-run';
import { funnelExists } from '@/lib/funnel-days';
import { parseRouteId } from '@/lib/validation';
import { internalError } from '@/lib/http';
import { requireEditor } from '@/lib/auth-server';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

/**
 * Отвечает 202, не дожидаясь конца: у воронки в среднем 24 адреса, максимум 49,
 * и при полностью мёртвом наборе (10 с таймаут + 3 с пауза + 10 с ретрай на
 * цель) проверка занимает минуты. Страница узнаёт об окончании опросом
 * GET /api/monitoring/funnels/[id] по полю `checking`.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const denied = await requireEditor(req);
  if (denied) return denied;

  try {
    const { id } = await params;
    const numId = parseRouteId(id);
    if (numId === null) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    if (!funnelExists(db, numId)) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    if (runningFunnelCheckId() !== null) {
      return NextResponse.json({ error: 'Проверка воронки уже идёт' }, { status: 409 });
    }

    // runFunnelCheck поднимает флаг синхронно, до первого await.
    void runFunnelCheck(db, numId).catch((err: unknown) => {
      // Промис никто не ждёт: без catch отказ стал бы unhandled rejection,
      // а это валит процесс Node целиком.
      console.error('POST /api/monitoring/funnels/[id]/run: проверка упала', err);
    });

    return NextResponse.json({ started: true }, { status: 202 });
  } catch (err: unknown) {
    return internalError('POST /api/monitoring/funnels/[id]/run', err);
  }
}
