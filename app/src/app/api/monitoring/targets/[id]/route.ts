import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db/client';
import { setTargetEnabled } from '@/lib/monitor-targets';
import { monitorTargetPatchSchema, parseRouteId } from '@/lib/validation';
import { internalError } from '@/lib/http';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id: rawId } = await params;
  const id = parseRouteId(rawId);
  if (id === null) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = monitorTargetPatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', issues: parsed.error.issues }, { status: 400 });
  }

  try {
    const found = setTargetEnabled(db, id, parsed.data.enabled);
    if (!found) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ ok: true, id, enabled: parsed.data.enabled });
  } catch (err: unknown) {
    return internalError('PATCH /api/monitoring/targets/[id]', err);
  }
}
