import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db/client';
import { setSourceKindEnabled } from '@/lib/monitor-targets';
import { monitorTargetsBulkPatchSchema } from '@/lib/validation';
import { isKnownSourceKind } from '@/lib/monitor-kinds';
import { internalError } from '@/lib/http';
import { requireEditor } from '@/lib/auth-server';

export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest) {
  const denied = await requireEditor(req);
  if (denied) return denied;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = monitorTargetsBulkPatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', issues: parsed.error.issues }, { status: 400 });
  }

  if (!isKnownSourceKind(parsed.data.sourceKind)) {
    return NextResponse.json(
      { error: `Неизвестный вид источника "${parsed.data.sourceKind}"` },
      { status: 400 }
    );
  }

  try {
    const affected = setSourceKindEnabled(db, parsed.data.sourceKind, parsed.data.enabled);
    return NextResponse.json({ ok: true, affected });
  } catch (err: unknown) {
    return internalError('PATCH /api/monitoring/targets', err);
  }
}
