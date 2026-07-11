import { NextResponse } from 'next/server';
import { db } from '@/db/client';
import { createDraftFunnel } from '@/lib/funnels';

/**
 * POST /api/funnels/draft — create a blank draft funnel and return it.
 * Used by the "Новая воронка" action: create-then-edit-in-place flow.
 */
export async function POST() {
  try {
    const funnel = createDraftFunnel(db);
    return NextResponse.json(funnel, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
