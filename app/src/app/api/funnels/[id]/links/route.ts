import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db/client';
import { listLinks, replaceLinks, funnelExists, type LinkItem } from '@/lib/funnel-links';

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const numId = parseInt(id, 10);
  if (isNaN(numId)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  }

  if (!funnelExists(db, numId)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const links = listLinks(db, numId);
  return NextResponse.json(links);
}

export async function PUT(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const numId = parseInt(id, 10);
  if (isNaN(numId)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  }

  if (!funnelExists(db, numId)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (
    !body ||
    typeof body !== 'object' ||
    !Array.isArray((body as { items?: unknown }).items)
  ) {
    return NextResponse.json(
      { error: 'Body must be { items: LinkItem[] }' },
      { status: 400 },
    );
  }

  const rawItems = (body as { items: unknown[] }).items;

  // Validate each item: label and url must be strings
  const items: LinkItem[] = [];
  for (let i = 0; i < rawItems.length; i++) {
    const item = rawItems[i];
    if (
      !item ||
      typeof item !== 'object' ||
      typeof (item as { label?: unknown }).label !== 'string' ||
      typeof (item as { url?: unknown }).url !== 'string'
    ) {
      return NextResponse.json(
        { error: `items[${i}] must have string label and url` },
        { status: 400 },
      );
    }
    items.push({
      label: (item as { label: string }).label,
      url:   (item as { url: string }).url,
    });
  }

  replaceLinks(db, numId, items);

  const updated = listLinks(db, numId);
  return NextResponse.json(updated);
}
