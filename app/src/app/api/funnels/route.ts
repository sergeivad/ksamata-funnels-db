import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db/client';
import { funnelCreateSchema } from '@/lib/validation';
import { listFunnels, createFunnel } from '@/lib/funnels';
import { internalError } from '@/lib/http';

export async function GET() {
  try {
    const list = listFunnels(db);
    return NextResponse.json(list);
  } catch (err: unknown) {
    return internalError('GET /api/funnels', err);
  }
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = funnelCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.issues },
      { status: 400 }
    );
  }

  try {
    const funnel = createFunnel(db, parsed.data);
    return NextResponse.json(funnel, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal error';
    // Friendly pre-check path: createFunnel throws "409: ..." on duplicate num
    // TOCTOU path: SQLite UNIQUE constraint fires inside the transaction
    if (
      message.includes('409') ||
      message.includes('UNIQUE constraint failed: funnels.num')
    ) {
      return NextResponse.json(
        { error: `Funnel with num=${parsed.data.num} already exists` },
        { status: 409 }
      );
    }
    return internalError('POST /api/funnels', err);
  }
}
