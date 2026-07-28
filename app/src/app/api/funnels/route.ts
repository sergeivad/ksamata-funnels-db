import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db/client';
import { funnelCreateSchema } from '@/lib/validation';
import { listFunnels, createFunnel } from '@/lib/funnels';
import { internalError } from '@/lib/http';
import { ConflictError } from '@/lib/errors';

export async function GET() {
  try {
    const list = listFunnels(db);
    return NextResponse.json(list);
  } catch (err: unknown) {
    return internalError('GET /api/funnels', err);
  }
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = funnelCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.issues },
      { status: 400 }
    );
  }

  try {
    const funnel = createFunnel(db, parsed.data);
    return NextResponse.json(funnel, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal error';
    // Friendly pre-check path: createFunnel throws ConflictError — на занятый
    // num ИЛИ на занятый F-код, поэтому причину берём из самой ошибки. Пока
    // ответ был захардкожен под num, конфликт кода приезжал на экран как
    // «Funnel with num=… already exists» — то есть про не то поле.
    if (err instanceof ConflictError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    // TOCTOU path: SQLite UNIQUE constraint fires inside the transaction — эта
    // строка приходит из драйвера, поэтому здесь сравнение с текстом уместно.
    // Штатно её перехватывают asNumConflict/asFrontCodeConflict; это страховка.
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
    return internalError('POST /api/funnels', err);
  }
}
