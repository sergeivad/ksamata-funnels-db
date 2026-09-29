import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db/client';
import { funnelExists, type DayCell } from '@/lib/funnel-days';
import { checkRooms, MAX_CHECK_CELLS } from '@/lib/room-check';
import { parseRouteId } from '@/lib/validation';
import { internalError } from '@/lib/http';
import { requireEditor } from '@/lib/auth-server';

type Params = { params: Promise<{ id: string }> };

/** Длиннее адрес комнаты не бывает; предел — чтобы тело не раздували. */
const FIELD_MAX = 4096;
const TEXT_FIELDS = ['gcRoom', 'webRoom', 'replayUrl', 'webReplay', 'replay2Url', 'webReplay2'] as const;

/**
 * «Заполнить и проверить». Сетку присылает карточка, а не читает база:
 * проверка идёт по тому, что человек видит, включая несохранённое. Ничего не
 * пишет — результат уходит в карточку, сохраняет человек.
 *
 * Тело: `{ cells: DayCell[], replays: boolean }`; `replays: false` — тумблер
 * «повтор» выключен, повторы не ищутся.
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
  const b = body as { cells?: unknown; replays?: unknown } | null;
  if (!b || !Array.isArray(b.cells) || typeof b.replays !== 'boolean') {
    return NextResponse.json({ error: 'Body must be { cells: DayCell[], replays: boolean }' }, { status: 400 });
  }
  if (b.cells.length > MAX_CHECK_CELLS) {
    return NextResponse.json({ error: `too many cells (max ${MAX_CHECK_CELLS})` }, { status: 400 });
  }

  const cells: DayCell[] = [];
  for (let i = 0; i < b.cells.length; i++) {
    const c = b.cells[i] as Record<string, unknown>;
    const ok =
      c && typeof c === 'object' &&
      (c.timeSlot === '15' || c.timeSlot === '19') &&
      typeof c.dayNum === 'number' && Number.isInteger(c.dayNum) && c.dayNum >= 1 && c.dayNum <= 5 &&
      TEXT_FIELDS.every((f) => c[f] === undefined || (typeof c[f] === 'string' && (c[f] as string).length <= FIELD_MAX));
    if (!ok) return NextResponse.json({ error: `cells[${i}] has invalid shape` }, { status: 400 });
    const str = (f: (typeof TEXT_FIELDS)[number]) => (c[f] as string | undefined) ?? '';
    cells.push({
      timeSlot: c.timeSlot as '15' | '19', dayNum: c.dayNum as number,
      gcRoom: str('gcRoom'), webRoom: str('webRoom'), replayUrl: str('replayUrl'),
      webReplay: str('webReplay'), replay2Url: str('replay2Url'), webReplay2: str('webReplay2'),
    });
  }

  try {
    return NextResponse.json(await checkRooms(cells, b.replays));
  } catch (err) {
    return internalError('POST /api/funnels/[id]/rooms/check', err);
  }
}
