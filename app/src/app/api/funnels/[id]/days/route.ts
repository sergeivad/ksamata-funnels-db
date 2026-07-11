import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db/client';
import { listDays, replaceDays, funnelExists, type DayCell } from '@/lib/funnel-days';
import { ValidationError } from '@/lib/errors';
import { internalError } from '@/lib/http';

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const numId = parseInt(id, 10);
  if (isNaN(numId)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  }

  if (!funnelExists(db, numId)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const days = listDays(db, numId);
  return NextResponse.json(days);
}

export async function PUT(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const numId = parseInt(id, 10);
  if (isNaN(numId)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  }

  if (!funnelExists(db, numId)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (
    !body ||
    typeof body !== 'object' ||
    !Array.isArray((body as { cells?: unknown }).cells)
  ) {
    return NextResponse.json(
      { error: 'Body must be { cells: DayCell[] }' },
      { status: 400 }
    );
  }

  const rawCells = (body as { cells: unknown[] }).cells;
  // Valid space is 2 slots × 5 days = 10 cells; cap generously to block
  // insert-amplification from a pathological payload.
  if (rawCells.length > 100) {
    return NextResponse.json({ error: 'too many cells (max 100)' }, { status: 400 });
  }
  const cells: DayCell[] = [];
  for (let i = 0; i < rawCells.length; i++) {
    const cell = rawCells[i] as Record<string, unknown>;
    if (
      (cell.timeSlot !== '19' && cell.timeSlot !== '15') ||
      typeof cell.dayNum !== 'number' ||
      typeof cell.gcRoom !== 'string' ||
      typeof cell.webRoom !== 'string' ||
      typeof cell.replayUrl !== 'string'
    ) {
      return NextResponse.json({ error: `cells[${i}] has invalid shape` }, { status: 400 });
    }
    cells.push({
      timeSlot: cell.timeSlot,
      dayNum: cell.dayNum,
      gcRoom: cell.gcRoom,
      webRoom: cell.webRoom,
      replayUrl: cell.replayUrl,
    });
  }

  try {
    replaceDays(db, numId, cells);
  } catch (err: unknown) {
    // Domain-validation problems are the caller's fault → 400 with the message.
    // Anything else (DB/FK error, e.g. funnel deleted mid-request) is unexpected
    // → generic 500 without leaking internal details.
    if (err instanceof ValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return internalError('PUT /api/funnels/[id]/days', err);
  }

  const updated = listDays(db, numId);
  return NextResponse.json(updated);
}
