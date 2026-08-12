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
import { setFunnelTypeHasTime } from '@/lib/funnels';
import { FUNNEL_TYPE_KIND } from '@/lib/funnel-type';
import { REF_MAX, parseRouteId } from '@/lib/validation';
import { internalError } from '@/lib/http';
import { requireEditor } from '@/lib/auth-server';

type Params = { params: Promise<{ kind: string; id: string }> };

const refRenameSchema = z.object({
  value: z.string().trim().min(1).max(REF_MAX),
});

/**
 * Признак «есть эфиры по времени» у типа воронки. Отдельная форма тела, а не
 * необязательное поле рядом с `value`: переименование и переключение флага —
 * разные операции с разными последствиями (второе пересобирает теги всех
 * воронок этого типа), и смешивать их в одном запросе незачем.
 */
const funnelTypeHasTimeSchema = z.object({
  hasTime: z.boolean(),
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
  const denied = await requireEditor(req);
  if (denied) return denied;

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

  // Тело с `hasTime` — переключение флага у типа воронки. Проверяем до разбора
  // переименования: иначе `{ hasTime: false }` провалилось бы на отсутствии
  // `value` с невнятным «Validation failed».
  const hasTimeBody = funnelTypeHasTimeSchema.safeParse(body);
  if (hasTimeBody.success) {
    if (kind !== FUNNEL_TYPE_KIND) {
      return NextResponse.json(
        { error: 'Признак «эфиры по времени» есть только у типов воронок' },
        { status: 400 }
      );
    }
    try {
      const affected = setFunnelTypeHasTime(db, numId, hasTimeBody.data.hasTime);
      if (affected === null) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
      }
      return NextResponse.json({ id: numId, hasTime: hasTimeBody.data.hasTime, resynced: affected });
    } catch (err: unknown) {
      return internalError('PATCH /api/refs/[kind]/[id] hasTime', err);
    }
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

export async function DELETE(req: NextRequest, { params }: Params) {
  const denied = await requireEditor(req);
  if (denied) return denied;

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
