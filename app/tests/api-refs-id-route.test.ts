/**
 * Route-level tests for /api/refs/[kind]/[id] — PATCH (rename) and DELETE.
 *
 * Strategy mirrors api-refs-route.test.ts: point FUNNELS_DB_PATH to a temp
 * copy of the real DB *before* importing the route handlers, so the
 * singleton db in @/db/client opens the temp file.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { copyFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { NextRequest } from 'next/server';

const REAL_DB = join(__dirname, '../../ksamata_funnels.db');
const TMP_DB = join(tmpdir(), `ksamata_refs_id_route_test_${Date.now()}.db`);

copyFileSync(REAL_DB, TMP_DB);
process.env.FUNNELS_DB_PATH = TMP_DB;

// A raw handle onto the SAME temp file, used only to seed fixtures (create a
// funnel that uses a ref value) without importing the funnels route/lib —
// that's out of this agent's zone, so we insert directly via SQL instead.
const rawSqlite = new Database(TMP_DB);

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let refsGET: typeof import('../src/app/api/refs/[kind]/route').GET;
let refsPOST: typeof import('../src/app/api/refs/[kind]/route').POST;
let idPATCH: typeof import('../src/app/api/refs/[kind]/[id]/route').PATCH;
let idDELETE: typeof import('../src/app/api/refs/[kind]/[id]/route').DELETE;

beforeAll(async () => {
  const listMod = await import('../src/app/api/refs/[kind]/route');
  refsGET = listMod.GET;
  refsPOST = listMod.POST;
  const idMod = await import('../src/app/api/refs/[kind]/[id]/route');
  idPATCH = idMod.PATCH;
  idDELETE = idMod.DELETE;
});

afterAll(() => {
  rawSqlite.close();
  try {
    unlinkSync(TMP_DB);
  } catch {
    // ignore if already gone
  }
});

function makeReq(method: string, body?: unknown): NextRequest {
  return new NextRequest('http://localhost:3000', {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

function idParams(kind: string, id: string) {
  return { params: Promise.resolve({ kind, id }) };
}

async function createRefRow(kind: string, name: string): Promise<{ id: number; name: string }> {
  const res = await refsPOST(makeReq('POST', { name }), { params: Promise.resolve({ kind }) });
  expect(res.status).toBe(200);
  return res.json();
}

/**
 * Seed a minimal funnel that references the given product/contractor/
 * channel/direction axis value, by inserting raw rows directly (funnels +
 * funnel_tags + tags), mirroring what createFunnel/syncAvTags would do.
 * Kept intentionally minimal — only what's needed to make a ref "used".
 */
function seedFunnelUsing(kind: string, refId: number, refName: string): number {
  const prefixByKind: Record<string, string> = {
    products: 'АВ Продукт: ',
    contractors: 'АВ Подрядчик: ',
    channels: 'АВ Канал: ',
    directions: 'АВ Направление: ',
  };

  // Any valid product/contractor/source id to satisfy NOT NULL FKs.
  const anyProduct = rawSqlite.prepare('SELECT id FROM products LIMIT 1').get() as { id: number };
  const anyContractor = rawSqlite.prepare('SELECT id FROM contractors LIMIT 1').get() as { id: number };
  const anySource = rawSqlite.prepare('SELECT id FROM sources LIMIT 1').get() as { id: number };

  const num = Math.floor(Math.random() * 1_000_000) + 500_000;
  const productId = kind === 'products' ? refId : anyProduct.id;
  const contractorId = kind === 'contractors' ? refId : anyContractor.id;
  const sourceId = kind === 'sources' ? refId : anySource.id;

  const funnelInsert = rawSqlite
    .prepare(
      `INSERT INTO funnels (num, source_id, product_id, contractor_id, status, front_code)
       VALUES (?, ?, ?, ?, 'active', '')`
    )
    .run(num, sourceId, productId, contractorId);
  const funnelId = Number(funnelInsert.lastInsertRowid);

  if (kind === 'tags') {
    rawSqlite
      .prepare(`INSERT INTO funnel_tags (funnel_id, tag_id, tag_type, position) VALUES (?, ?, 'reg', 0)`)
      .run(funnelId, refId);
    return funnelId;
  }

  const prefix = prefixByKind[kind];
  if (prefix) {
    const tagName = `${prefix}${refName}`;
    let tagRow = rawSqlite.prepare('SELECT id FROM tags WHERE name = ?').get(tagName) as
      | { id: number }
      | undefined;
    if (!tagRow) {
      const inserted = rawSqlite.prepare('INSERT INTO tags (name) VALUES (?)').run(tagName);
      tagRow = { id: Number(inserted.lastInsertRowid) };
    }
    rawSqlite
      .prepare(`INSERT INTO funnel_tags (funnel_id, tag_id, tag_type, position) VALUES (?, ?, 'reg', 0)`)
      .run(funnelId, tagRow.id);
  }

  return funnelId;
}

// ── PATCH (rename) ──────────────────────────────────────────────────────────

describe('PATCH /api/refs/[kind]/[id]', () => {
  it('renames an unused ref value → 200 with new name', async () => {
    const created = await createRefRow('products', `IdRouteUnused_${Date.now()}`);
    const newName = `IdRouteUnused_${Date.now()}_renamed`;

    const res = await idPATCH(makeReq('PATCH', { value: newName }), idParams('products', String(created.id)));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe(newName);

    const listRes = await refsGET(makeReq('GET'), { params: Promise.resolve({ kind: 'products' }) });
    const list: Array<{ id: number; name: string }> = await listRes.json();
    expect(list.find((r) => r.id === created.id)?.name).toBe(newName);
  });

  it('renames a ref used by a funnel → 200 and the АВ tag text is updated', async () => {
    const created = await createRefRow('channels', `IdRouteUsedChannel_${Date.now()}`);
    seedFunnelUsing('channels', created.id, created.name);

    const newName = `${created.name}_renamed`;
    const res = await idPATCH(makeReq('PATCH', { value: newName }), idParams('channels', String(created.id)));
    expect(res.status).toBe(200);

    const tagRow = rawSqlite
      .prepare('SELECT id FROM tags WHERE name = ?')
      .get(`АВ Канал: ${newName}`);
    expect(tagRow).toBeDefined();

    const oldTagRow = rawSqlite
      .prepare('SELECT id FROM tags WHERE name = ?')
      .get(`АВ Канал: ${created.name}`);
    expect(oldTagRow).toBeUndefined();
  });

  it('rename to a name already used by another row → 409', async () => {
    const a = await createRefRow('products', `IdRouteDupA_${Date.now()}`);
    const b = await createRefRow('products', `IdRouteDupB_${Date.now()}`);

    const res = await idPATCH(makeReq('PATCH', { value: b.name }), idParams('products', String(a.id)));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  it('rename with empty value → 400', async () => {
    const created = await createRefRow('products', `IdRouteEmpty_${Date.now()}`);
    const res = await idPATCH(makeReq('PATCH', { value: '   ' }), idParams('products', String(created.id)));
    expect(res.status).toBe(400);
  });

  it('rename of an unknown kind → 400', async () => {
    const res = await idPATCH(makeReq('PATCH', { value: 'x' }), idParams('bogus', '1'));
    expect(res.status).toBe(400);
  });

  it('rename of a non-existent id → 404', async () => {
    const res = await idPATCH(makeReq('PATCH', { value: 'x' }), idParams('products', '999999999'));
    expect(res.status).toBe(404);
  });
});

// ── DELETE ───────────────────────────────────────────────────────────────────

describe('DELETE /api/refs/[kind]/[id]', () => {
  it('deletes an unused ref value → 204', async () => {
    const created = await createRefRow('products', `IdRouteDeleteUnused_${Date.now()}`);
    const res = await idDELETE(makeReq('DELETE'), idParams('products', String(created.id)));
    expect(res.status).toBe(204);

    const listRes = await refsGET(makeReq('GET'), { params: Promise.resolve({ kind: 'products' }) });
    const list: Array<{ id: number; name: string }> = await listRes.json();
    expect(list.find((r) => r.id === created.id)).toBeUndefined();
  });

  it('refuses to delete a ref used by a funnel → 409 with usedBy count', async () => {
    const created = await createRefRow('directions', `IdRouteDeleteUsed_${Date.now()}`);
    seedFunnelUsing('directions', created.id, created.name);

    const res = await idDELETE(makeReq('DELETE'), idParams('directions', String(created.id)));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body).toHaveProperty('usedBy', 1);
    expect(body.error).toMatch(/1/);
  });

  it('delete of an unknown kind → 400', async () => {
    const res = await idDELETE(makeReq('DELETE'), idParams('bogus', '1'));
    expect(res.status).toBe(400);
  });

  it('delete of a non-existent id → 404', async () => {
    const res = await idDELETE(makeReq('DELETE'), idParams('products', '999999999'));
    expect(res.status).toBe(404);
  });

  it('tags kind is immutable: PATCH and DELETE → 400', async () => {
    const tagRow = rawSqlite
      .prepare('SELECT id FROM tags LIMIT 1')
      .get() as { id: number } | undefined;
    expect(tagRow).toBeDefined();

    const patchRes = await idPATCH(
      makeReq('PATCH', { value: 'Новое имя' }),
      idParams('tags', String(tagRow!.id))
    );
    expect(patchRes.status).toBe(400);

    const delRes = await idDELETE(makeReq('DELETE'), idParams('tags', String(tagRow!.id)));
    expect(delRes.status).toBe(400);
  });

  it('refuses to delete a product with product_durations rows → 409', async () => {
    const created = await createRefRow('products', `IdRouteDeleteDurations_${Date.now()}`);
    rawSqlite
      .prepare('INSERT INTO product_durations (product_id, day_num, duration_minutes) VALUES (?, 1, 90)')
      .run(created.id);

    const res = await idDELETE(makeReq('DELETE'), idParams('products', String(created.id)));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/длительност/);

    rawSqlite.prepare('DELETE FROM product_durations WHERE product_id = ?').run(created.id);
    const res2 = await idDELETE(makeReq('DELETE'), idParams('products', String(created.id)));
    expect(res2.status).toBe(204);
  });
});
