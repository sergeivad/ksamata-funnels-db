import { NextResponse } from 'next/server';

/**
 * Log an unexpected error server-side and return a generic 500 to the client.
 * Never echo `err.message` to callers — it can leak DB/internal details.
 */
export function internalError(context: string, err: unknown): NextResponse {
  console.error(`[${context}]`, err);
  return NextResponse.json({ error: 'Internal error' }, { status: 500 });
}
