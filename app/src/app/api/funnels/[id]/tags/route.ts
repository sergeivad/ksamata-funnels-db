import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db/client';
import { parseRouteId, tagsPatchSchema } from '@/lib/validation';
import { applyTagOverrides } from '@/lib/funnels';
import { internalError } from '@/lib/http';
import { SCENARIOS, type OverrideMap } from '@/lib/ab-tags';

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const funnelId = parseRouteId(id);
  if (funnelId === null) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = tagsPatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', issues: parsed.error.issues }, { status: 400 });
  }

  // Normalize the partial patch into a full OverrideMap (missing scenarios cleared).
  const patch = {} as OverrideMap;
  for (const s of SCENARIOS) {
    patch[s] = { add: parsed.data[s]?.add ?? [], remove: parsed.data[s]?.remove ?? [] };
  }

  try {
    const updated = applyTagOverrides(db, funnelId, patch);
    if (!updated) return NextResponse.json({ error: 'Funnel not found' }, { status: 404 });
    return NextResponse.json(updated);
  } catch (err: unknown) {
    return internalError('PATCH /api/funnels/[id]/tags', err);
  }
}
