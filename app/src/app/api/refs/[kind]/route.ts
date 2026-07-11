import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db/client';
import { refCreateSchema } from '@/lib/validation';
import { listRefs, createRef, isValidKind, VALID_KINDS } from '@/lib/refs';
import { internalError } from '@/lib/http';

type Params = { params: Promise<{ kind: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { kind } = await params;
  if (!isValidKind(kind)) {
    return NextResponse.json(
      { error: `Invalid kind "${kind}". Must be one of: ${VALID_KINDS.join(', ')}.` },
      { status: 400 }
    );
  }
  try {
    const rows = listRefs(db, kind);
    return NextResponse.json(rows);
  } catch (err: unknown) {
    // kind is already whitelisted above — any throw here is unexpected.
    return internalError('GET /api/refs/[kind]', err);
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  const { kind } = await params;

  // Validate kind against the canonical whitelist from refs.ts
  if (!isValidKind(kind)) {
    return NextResponse.json(
      { error: `Invalid kind "${kind}". Must be one of: ${VALID_KINDS.join(', ')}.` },
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
    return internalError('POST /api/refs/[kind]', err);
  }
}
