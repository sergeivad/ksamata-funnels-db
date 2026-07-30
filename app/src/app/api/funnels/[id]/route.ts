import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db/client';
import { funnelUpdateSchema, parseRouteId } from '@/lib/validation';
import { getFunnel, updateFunnel, deleteFunnel } from '@/lib/funnels';
import { internalError } from '@/lib/http';
import { ConflictError, ValidationError } from '@/lib/errors';
import { requireEditor } from '@/lib/auth-server';

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const numId = parseRouteId(id);
  if (numId === null) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  }

  const funnel = getFunnel(db, numId);
  if (!funnel) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  return NextResponse.json(funnel);
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const denied = await requireEditor(req);
  if (denied) return denied;

  const { id } = await params;
  const numId = parseRouteId(id);
  if (numId === null) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = funnelUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.issues },
      { status: 400 }
    );
  }

  try {
    const updated = updateFunnel(db, numId, parsed.data);
    if (!updated) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json(updated);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal error';
    // updateFunnel throws ConflictError на занятый num ИЛИ на занятый F-код —
    // сообщение берём из ошибки, иначе конфликт кода приезжал бы на экран
    // как «Funnel with num=… already exists», то есть про не то поле.
    if (err instanceof ConflictError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    // SQLite may also raise the raw UNIQUE constraint under a TOCTOU race.
    // Текстовое сравнение оставлено только для строки от драйвера.
    if (message.includes('UNIQUE constraint failed: funnels.num')) {
      return NextResponse.json(
        { error: `Funnel with num=${parsed.data.num} already exists` },
        { status: 409 }
      );
    }
    if (message.includes('UNIQUE constraint failed: funnels.front_code')) {
      return NextResponse.json(
        { error: `Код ${parsed.data.frontCode} уже занят другой воронкой` },
        { status: 409 }
      );
    }
    // Неизвестный тип воронки (resolveFunnelTypeId) — вина запроса, не сервера.
    if (err instanceof ValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return internalError('PATCH /api/funnels/[id]', err);
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const denied = await requireEditor(req);
  if (denied) return denied;

  const { id } = await params;
  const numId = parseRouteId(id);
  if (numId === null) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  }

  const deleted = deleteFunnel(db, numId);
  if (!deleted) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
