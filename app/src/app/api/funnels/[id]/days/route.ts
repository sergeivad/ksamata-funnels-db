import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db/client';
import { listDays, replaceDays, funnelExists, type DayCell } from '@/lib/funnel-days';

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
    const message = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const updated = listDays(db, numId);
  return NextResponse.json(updated);
}
