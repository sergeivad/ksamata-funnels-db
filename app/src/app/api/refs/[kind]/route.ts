import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db/client';
import { refCreateSchema } from '@/lib/validation';
import {
  listRefs,
  createRef,
  isValidKind,
  isImmutableKind,
  IMMUTABLE_KIND_MESSAGE,
  VALID_KINDS,
  FunnelTypeAxisConflictError,
  FUNNEL_TYPE_AXIS_CONFLICT_MESSAGE,
} from '@/lib/refs';
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

  // Тот же запрет, что у PATCH/DELETE в refs/[kind]/[id]: иначе тег можно
  // создать, но не удалить — он остаётся в справочнике навсегда.
  if (isImmutableKind(kind)) {
    return NextResponse.json({ error: IMMUTABLE_KIND_MESSAGE }, { status: 400 });
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
    // Барьер пункта 1 финальной рецензии: имя funnel_types, похожее на осевой
    // тег, — ожидаемый отказ валидации (400), а не внутренняя ошибка (500).
    if (err instanceof FunnelTypeAxisConflictError) {
      return NextResponse.json({ error: FUNNEL_TYPE_AXIS_CONFLICT_MESSAGE }, { status: 400 });
    }
    return internalError('POST /api/refs/[kind]', err);
  }
}
