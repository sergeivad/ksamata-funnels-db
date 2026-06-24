import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db/client';
import { refCreateSchema } from '@/lib/validation';
import { listRefs, createRef } from '@/lib/refs';

type Params = { params: Promise<{ kind: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { kind } = await params;
  try {
    const rows = listRefs(db, kind);
    return NextResponse.json(rows);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Invalid kind';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  const { kind } = await params;

  // Validate kind first (fast path)
  const validKinds = ['products', 'contractors', 'sources', 'tags'];
  if (!validKinds.includes(kind)) {
    return NextResponse.json(
      { error: `Invalid kind "${kind}". Must be one of: ${validKinds.join(', ')}.` },
      { status: 400 }
    );
  }

  // Parse and validate body
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = refCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.issues },
      { status: 400 }
    );
  }

  try {
    const row = createRef(db, kind, parsed.data.name);
    return NextResponse.json(row, { status: 200 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
