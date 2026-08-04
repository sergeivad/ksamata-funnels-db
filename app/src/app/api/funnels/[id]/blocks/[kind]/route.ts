import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db/client';
import { getBlock, replaceBlock, type BlockItem } from '@/lib/funnel-blocks';
import { funnelExists } from '@/lib/funnel-days';
import { isBlockKind, getBlockDef, type BlockKind } from '@/lib/blocks';
import { checkUrlField } from '@/lib/url-field';
import { internalError } from '@/lib/http';
import { parseRouteId } from '@/lib/validation';
import { requireEditor } from '@/lib/auth-server';

// Upper bound on items per block — guards against insert-amplification from a
// pathological payload. A real block has at most a handful of links.
const MAX_ITEMS = 100;
// Подпись — несколько слов рядом со ссылкой; мегабайт текста в ней означал бы
// ошибку ввода.
const MAX_LABEL = 2000;
// У ссылки предел свой и заметно больше: в блоке «Ссылки» живой базы лежат
// сегментные ссылки GetCourse длиной 2007–2019 символов. Пока на оба поля
// стоял общий предел 2000, такой блок нельзя было сохранить вообще — PUT
// отвечал 400 на строку, которая уже была в базе, и правка любой другой
// строки того же блока упиралась в неё.
const MAX_URL = 4096;

type Params = { params: Promise<{ id: string; kind: string }> };

function parse(id: string, kind: string): { error: NextResponse } | { numId: number; kind: BlockKind } {
  const numId = parseRouteId(id);
  if (numId === null) return { error: NextResponse.json({ error: 'Invalid id' }, { status: 400 }) };
  if (!isBlockKind(kind)) return { error: NextResponse.json({ error: 'Invalid kind' }, { status: 400 }) };
  return { numId, kind };
}

export async function GET(_req: NextRequest, { params }: Params) {
  const { id, kind } = await params;
  const p = parse(id, kind);
  if ('error' in p) return p.error;
  if (!funnelExists(db, p.numId)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(getBlock(db, p.numId, p.kind));
}

export async function PUT(req: NextRequest, { params }: Params) {
  const denied = await requireEditor(req);
  if (denied) return denied;

  const { id, kind } = await params;
  const p = parse(id, kind);
  if ('error' in p) return p.error;
  if (!funnelExists(db, p.numId)) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }); }
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Body must be an object' }, { status: 400 });

  const b = body as { enabled?: unknown; mode?: unknown; items?: unknown };
  const def = getBlockDef(p.kind);

  if (typeof b.enabled !== 'boolean') return NextResponse.json({ error: 'enabled must be boolean' }, { status: 400 });
  if (b.mode !== 'common' && b.mode !== 'by_time') return NextResponse.json({ error: 'invalid mode' }, { status: 400 });
  if (!def.modes.includes(b.mode)) return NextResponse.json({ error: `mode ${b.mode} not allowed for ${p.kind}` }, { status: 400 });
  if (!Array.isArray(b.items)) return NextResponse.json({ error: 'items must be an array' }, { status: 400 });
  if (b.items.length > MAX_ITEMS) return NextResponse.json({ error: `too many items (max ${MAX_ITEMS})` }, { status: 400 });

  const items: BlockItem[] = [];
  for (let i = 0; i < b.items.length; i++) {
    const it = b.items[i] as { slot?: unknown; label?: unknown; url?: unknown };
    if (typeof it?.label !== 'string' || typeof it?.url !== 'string') {
      return NextResponse.json({ error: `items[${i}] needs string label and url` }, { status: 400 });
    }
    if (it.label.length > MAX_LABEL) {
      return NextResponse.json({ error: `items[${i}] label too long (max ${MAX_LABEL})` }, { status: 400 });
    }
    if (it.url.length > MAX_URL) {
      return NextResponse.json({ error: `items[${i}] url too long (max ${MAX_URL})` }, { status: 400 });
    }
    // Ссылка со слипшейся подписью (`…/a (ADS)`) не отбрасывается нормализацией,
    // а кодируется в %20 и заводит в мониторинге отдельную вечно падающую цель.
    // Правило то же, что в редакторе (url-field.ts): текст без http(s) пропускаем
    // — это пометки, а вот мусор внутри ссылки не сохраняем.
    const check = checkUrlField(it.url);
    if (check.level === 'error') {
      return NextResponse.json({ error: `items[${i}]: ${check.message}` }, { status: 400 });
    }
    // Отсутствующий slot и null — это «общий» режим. А вот '17' или 'вечер'
    // раньше молча становились null: строка теряла привязку ко времени, и
    // человек узнавал об этом, только увидев ссылку не в той колонке.
    if (it.slot !== undefined && it.slot !== null && it.slot !== '15' && it.slot !== '19') {
      return NextResponse.json(
        { error: `items[${i}]: slot должен быть "15", "19" или null` },
        { status: 400 }
      );
    }
    const slot = it.slot === '15' || it.slot === '19' ? it.slot : null;
    items.push({ slot, label: it.label, url: it.url });
  }

  try {
    const result = replaceBlock(db, p.numId, p.kind, b.enabled, b.mode, items);
    return NextResponse.json(result);
  } catch (err: unknown) {
    // e.g. the funnel was deleted between funnelExists() and this write (the FK
    // then rejects the insert). Keep it a generic 500 without leaking internals.
    return internalError('PUT /api/funnels/[id]/blocks/[kind]', err);
  }
}
