import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db/client';
import { listTemplate } from '@/lib/tag-templates';
import { internalError } from '@/lib/http';
import { requireEditor } from '@/lib/auth-server';

export async function GET(req: NextRequest) {
  const denied = await requireEditor(req);
  if (denied) return denied;

  try {
    return NextResponse.json(listTemplate(db));
  } catch (err: unknown) {
    return internalError('GET /api/tag-templates', err);
  }
}
