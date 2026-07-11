import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db/client';
import { duplicateFunnel } from '@/lib/funnels';
import { internalError } from '@/lib/http';

type Params = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const numId = parseInt(id, 10);
  if (isNaN(numId)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  }

  try {
    const duplicated = duplicateFunnel(db, numId);
    if (!duplicated) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json(duplicated, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : '';
    // Cross-process race on num=MAX+1 (see draft route) → clean 409, not 500.
    if (message.includes('UNIQUE constraint failed: funnels.num')) {
      return NextResponse.json(
        { error: 'Could not allocate a unique funnel number, please retry' },
        { status: 409 }
      );
    }
    return internalError('POST /api/funnels/[id]/duplicate', err);
  }
}
