import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db/client';
import { funnelExists } from '@/lib/funnel-days';
import { findReplays, MAX_FIND_CELLS, type FindCellInput } from '@/lib/replay-finder';
import { parseRouteId } from '@/lib/validation';
import { internalError } from '@/lib/http';
import { requireEditor } from '@/lib/auth-server';

type Params = { params: Promise<{ id: string }> };

/**
 * «Найти повторы». Сетку присылает карточка, а не читает база: поиск идёт по
 * тому, что человек видит, включая несохранённое. Ничего не пишет — результат
 * уходит в карточку, сохраняет человек.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const denied = await requireEditor(req);
  if (denied) return denied;

  const { id } = await params;
  const numId = parseRouteId(id);
  if (numId === null) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  if (!funnelExists(db, numId)) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const raw = (body as { cells?: unknown } | null)?.cells;
  if (!Array.isArray(raw)) {
    return NextResponse.json({ error: 'Body must be { cells: FindCellInput[] }' }, { status: 400 });
  }
  if (raw.length > MAX_FIND_CELLS) {
    return NextResponse.json({ error: `too many cells (max ${MAX_FIND_CELLS})` }, { status: 400 });
  }

  const cells: FindCellInput[] = [];
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i] as Record<string, unknown>;
    if (
      !c || typeof c !== 'object' ||
      (c.timeSlot !== '15' && c.timeSlot !== '19') ||
      typeof c.dayNum !== 'number' || !Number.isInteger(c.dayNum) || c.dayNum < 1 || c.dayNum > 5 ||
      typeof c.liveUrl !== 'string' || typeof c.replay1 !== 'string' || typeof c.replay2 !== 'string'
    ) {
      return NextResponse.json({ error: `cells[${i}] has invalid shape` }, { status: 400 });
    }
    cells.push({
      timeSlot: c.timeSlot, dayNum: c.dayNum,
      liveUrl: c.liveUrl, replay1: c.replay1, replay2: c.replay2,
    });
  }

  try {
    return NextResponse.json({ results: await findReplays(cells) });
  } catch (err) {
    return internalError('POST /api/funnels/[id]/replays/find', err);
  }
}
