import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/db/client';
import {
  isValidKind,
  isImmutableKind,
  IMMUTABLE_KIND_MESSAGE,
  VALID_KINDS,
  renameRef,
  deleteRef,
  FUNNEL_TYPE_AXIS_CONFLICT_MESSAGE,
} from '@/lib/refs';
import { REF_MAX, parseRouteId } from '@/lib/validation';
import { internalError } from '@/lib/http';

type Params = { params: Promise<{ kind: string; id: string }> };

const refRenameSchema = z.object({
  value: z.string().trim().min(1).max(REF_MAX),
});

/**
 * Строгий разбор, общий с остальными роутами. Свой Number(id) здесь принимал
 * '1e2' как 100 и '0x10' как 16 — запрос переименовывал или удалял строку,
 * которой в адресе визуально не было, и DELETE здесь разрушающий.
 */
function parseId(id: string): number | null {
  const numId = parseRouteId(id);
  return numId !== null && numId > 0 ? numId : null;
}

/**
 * The tags table mixes user tags with system "АВ …" rows that funnel axes are
 * derived from; renaming/deleting them here would desync axes from the
 * products/contractors/channels/directions tables. Axis tags are managed
 * automatically by renameRef/deleteRef on those kinds instead.
 */
function guardMutableKind(kind: string): NextResponse | null {
  if (isImmutableKind(kind)) {
    return NextResponse.json({ error: IMMUTABLE_KIND_MESSAGE }, { status: 400 });
  }
  return null;
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const { kind, id } = await params;

  if (!isValidKind(kind)) {
    return NextResponse.json(
      { error: `Invalid kind "${kind}". Must be one of: ${VALID_KINDS.join(', ')}.` },
      { status: 400 }
    );
  }

  const guarded = guardMutableKind(kind);
  if (guarded) return guarded;

  const numId = parseId(id);
  if (numId === null) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = refRenameSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.issues },
      { status: 400 }
    );
  }

  try {
    const result = renameRef(db, kind, numId, parsed.data.value);
    if (!result.ok) {
      if (result.error === 'not_found') {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
      }
      if (result.error === 'axis_conflict') {
        return NextResponse.json({ error: FUNNEL_TYPE_AXIS_CONFLICT_MESSAGE }, { status: 400 });
      }
      // duplicate
      return NextResponse.json(
        { error: `Значение "${parsed.data.value}" уже существует` },
        { status: 409 }
      );
    }
    return NextResponse.json(result.row);
  } catch (err: unknown) {
    return internalError('PATCH /api/refs/[kind]/[id]', err);
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { kind, id } = await params;

  if (!isValidKind(kind)) {
    return NextResponse.json(
      { error: `Invalid kind "${kind}". Must be one of: ${VALID_KINDS.join(', ')}.` },
      { status: 400 }
    );
  }

  const guarded = guardMutableKind(kind);
  if (guarded) return guarded;

  const numId = parseId(id);
  if (numId === null) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  }

  try {
    const result = deleteRef(db, kind, numId);
    if (!result.ok) {
      if (result.error === 'not_found') {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
      }
      if (result.error === 'has_durations') {
        return NextResponse.json(
          { error: `Есть записи длительностей (${result.rows}) — удалить нельзя` },
          { status: 409 }
        );
      }
      // in_use
      return NextResponse.json(
        { error: `Используется ${result.usedBy} воронками — удалить нельзя`, usedBy: result.usedBy },
        { status: 409 }
      );
    }
    return new NextResponse(null, { status: 204 });
  } catch (err: unknown) {
    return internalError('DELETE /api/refs/[kind]/[id]', err);
  }
}
