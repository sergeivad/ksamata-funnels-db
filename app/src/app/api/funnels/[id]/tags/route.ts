import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db/client';
import { parseRouteId, tagsPatchSchema } from '@/lib/validation';
import { applyTagOverrides } from '@/lib/funnels';
import { internalError } from '@/lib/http';
import { ValidationError } from '@/lib/errors';
import { SCENARIOS, type OverrideMap } from '@/lib/ab-tags';
import { listOverrides } from '@/lib/tag-overrides';

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

  // Normalize the partial patch into the full OverrideMap replaceOverrides needs.
  // A scenario the body does not mention keeps whatever is stored — this is a
  // PATCH, not a PUT. Clearing one is still possible, by naming it with empty
  // lists (`{ time_15: { add: [], remove: [] } }`).
  const current = listOverrides(db, funnelId);
  const patch = {} as OverrideMap;
  for (const s of SCENARIOS) {
    patch[s] = parsed.data[s] ?? current[s];
  }

  try {
    const updated = applyTagOverrides(db, funnelId, patch);
    if (!updated) return NextResponse.json({ error: 'Funnel not found' }, { status: 404 });
    return NextResponse.json(updated);
  } catch (err: unknown) {
    // Противоречивый набор оверрайдов — вина запроса, а не сервера.
    if (err instanceof ValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return internalError('PATCH /api/funnels/[id]/tags', err);
  }
}
