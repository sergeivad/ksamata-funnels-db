import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db/client';
import { getBlock, replaceBlock, type BlockItem } from '@/lib/funnel-blocks';
import { funnelExists } from '@/lib/funnel-days';
import { isBlockKind, getBlockDef, type BlockKind } from '@/lib/blocks';
import { internalError } from '@/lib/http';

// Upper bound on items per block — guards against insert-amplification from a
// pathological payload. A real block has at most a handful of links.
const MAX_ITEMS = 100;
const MAX_STR = 2000;

type Params = { params: Promise<{ id: string; kind: string }> };

function parse(id: string, kind: string): { error: NextResponse } | { numId: number; kind: BlockKind } {
  const numId = parseInt(id, 10);
  if (isNaN(numId)) return { error: NextResponse.json({ error: 'Invalid id' }, { status: 400 }) };
  if (!isBlockKind(kind)) return { error: NextResponse.json({ error: 'Invalid kind' }, { status: 400 }) };
  return { numId, kind };
}

export async function GET(_req: NextRequest, { params }: Params) {
  const { id, kind } = await params;
  const p = parse(id, kind);
  if ('error' in p) return p.error;
  if (!funnelExists(db, p.numId)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(getBlock(db, p.numId, p.kind));
}

export async function PUT(req: NextRequest, { params }: Params) {
  const { id, kind } = await params;
  const p = parse(id, kind);
  if ('error' in p) return p.error;
  if (!funnelExists(db, p.numId)) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }); }
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Body must be an object' }, { status: 400 });

  const b = body as { enabled?: unknown; mode?: unknown; items?: unknown };
  const def = getBlockDef(p.kind);

  if (typeof b.enabled !== 'boolean') return NextResponse.json({ error: 'enabled must be boolean' }, { status: 400 });
  if (b.mode !== 'common' && b.mode !== 'by_time') return NextResponse.json({ error: 'invalid mode' }, { status: 400 });
  if (!def.modes.includes(b.mode)) return NextResponse.json({ error: `mode ${b.mode} not allowed for ${p.kind}` }, { status: 400 });
  if (!Array.isArray(b.items)) return NextResponse.json({ error: 'items must be an array' }, { status: 400 });
  if (b.items.length > MAX_ITEMS) return NextResponse.json({ error: `too many items (max ${MAX_ITEMS})` }, { status: 400 });

  const items: BlockItem[] = [];
  for (let i = 0; i < b.items.length; i++) {
    const it = b.items[i] as { slot?: unknown; label?: unknown; url?: unknown };
    if (typeof it?.label !== 'string' || typeof it?.url !== 'string') {
      return NextResponse.json({ error: `items[${i}] needs string label and url` }, { status: 400 });
    }
    if (it.label.length > MAX_STR || it.url.length > MAX_STR) {
      return NextResponse.json({ error: `items[${i}] label/url too long (max ${MAX_STR})` }, { status: 400 });
    }
    const slot = it.slot === '15' || it.slot === '19' ? it.slot : null;
    items.push({ slot, label: it.label, url: it.url });
  }

  try {
    const result = replaceBlock(db, p.numId, p.kind, b.enabled, b.mode, items);
    return NextResponse.json(result);
  } catch (err: unknown) {
    // e.g. the funnel was deleted between funnelExists() and this write (the FK
    // then rejects the insert). Keep it a generic 500 without leaking internals.
    return internalError('PUT /api/funnels/[id]/blocks/[kind]', err);
  }
}
