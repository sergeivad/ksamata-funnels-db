import { NextResponse } from 'next/server';
import { db } from '@/db/client';
import { listTemplate } from '@/lib/tag-templates';
import { internalError } from '@/lib/http';

export async function GET() {
  try {
    return NextResponse.json(listTemplate(db));
  } catch (err: unknown) {
    return internalError('GET /api/tag-templates', err);
  }
}
