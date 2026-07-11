import { NextResponse } from 'next/server';
import { db } from '@/db/client';
import { createDraftFunnel } from '@/lib/funnels';
import { internalError } from '@/lib/http';

/**
 * POST /api/funnels/draft — create a blank draft funnel and return it.
 * Used by the "Новая воронка" action: create-then-edit-in-place flow.
 */
export async function POST() {
  try {
    const funnel = createDraftFunnel(db);
    return NextResponse.json(funnel, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : '';
    // Across multiple processes sharing the DB file, two concurrent draft
    // creations can race on num=MAX+1 and hit the UNIQUE constraint. The helper
    // retries, but if it still loses, surface a clean 409 instead of a 500.
    if (message.includes('UNIQUE constraint failed: funnels.num')) {
      return NextResponse.json(
        { error: 'Could not allocate a unique funnel number, please retry' },
        { status: 409 }
      );
    }
    return internalError('POST /api/funnels/draft', err);
  }
}
