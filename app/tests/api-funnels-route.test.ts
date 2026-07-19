/**
 * HTTP-layer tests for the funnels routes (list/create, [id] CRUD, draft, duplicate).
 *
 * These exercise the actual route handlers — status codes, JSON parsing, and the
 * 400/404/409 branches — which the lib-level tests in api-funnels.test.ts do not cover.
 *
 * ISOLATION: each test runs against a fresh temp COPY of the DB, with `@/db/client`
 * mocked to a drizzle handle over that copy (same pattern as api-blocks-route.test.ts).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { runMigratePhase3 } from '../scripts/migrate-phase3';
import { runMigrateMessengerTagType } from '../scripts/migrate-messenger-tagtype';
import { runMigratePhase5 } from '../scripts/migrate-phase5';
import * as schema from '../src/db/schema';

const REAL_DB = path.resolve(process.cwd(), '..', 'ksamata_funnels.db');
let tmp: string;
let sqlite: Database.Database;
let existingId: number;
let numA: number;
let numB: number;

/* eslint-disable @typescript-eslint/consistent-type-imports */
let listGET: typeof import('../src/app/api/funnels/route').GET;
let listPOST: typeof import('../src/app/api/funnels/route').POST;
let idGET: typeof import('../src/app/api/funnels/[id]/route').GET;
let idPATCH: typeof import('../src/app/api/funnels/[id]/route').PATCH;
let idDELETE: typeof import('../src/app/api/funnels/[id]/route').DELETE;
let dupPOST: typeof import('../src/app/api/funnels/[id]/duplicate/route').POST;
let draftPOST: typeof import('../src/app/api/funnels/draft/route').POST;
/* eslint-enable @typescript-eslint/consistent-type-imports */

beforeEach(async () => {
  tmp = path.join(os.tmpdir(), `fr-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  fs.copyFileSync(REAL_DB, tmp);
  sqlite = new Database(tmp);
  runMigratePhase3(sqlite);
  runMigrateMessengerTagType(sqlite);
  runMigratePhase5(sqlite);
  const rows = sqlite.prepare('SELECT id, num FROM funnels ORDER BY num LIMIT 2').all() as { id: number; num: number }[];
  existingId = rows[0].id;
  numA = rows[0].num;
  numB = rows[1].num;
  const db = drizzle(sqlite, { schema });
  vi.doMock('@/db/client', () => ({ db }));

  const list = await import('../src/app/api/funnels/route');
  listGET = list.GET; listPOST = list.POST;
  const byId = await import('../src/app/api/funnels/[id]/route');
  idGET = byId.GET; idPATCH = byId.PATCH; idDELETE = byId.DELETE;
  dupPOST = (await import('../src/app/api/funnels/[id]/duplicate/route')).POST;
  draftPOST = (await import('../src/app/api/funnels/draft/route')).POST;
});

afterEach(() => {
  vi.resetModules();
  sqlite.close();
  fs.rmSync(tmp, { force: true });
});

function jsonReq(method: string, body: unknown) {
  return new Request('http://test', { method, body: JSON.stringify(body) }) as never;
}
function rawReq(method: string, raw: string) {
  return new Request('http://test', { method, body: raw }) as never;
}
const params = (id: string | number) => ({ params: Promise.resolve({ id: String(id) }) });

const VALID_CREATE = {
  num: 9700, frontCode: '', status: 'active', productName: 'Route Test', variant: 'А',
  landingUrl: '', startDate: '', product: 'ТКМ', contractor: 'НИМБ', channel: 'Яндекс', direction: 'РСЯ',
};

describe('POST /api/funnels', () => {
  it('creates a funnel and returns 201', async () => {
    const res = await listPOST(jsonReq('POST', VALID_CREATE));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.num).toBe(9700);
  });

  it('rejects invalid JSON with 400', async () => {
    const res = await listPOST(rawReq('POST', 'not json{'));
    expect(res.status).toBe(400);
  });

  it('rejects a body that fails validation with 400', async () => {
    const res = await listPOST(jsonReq('POST', { ...VALID_CREATE, product: '' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.issues).toBeDefined();
  });

  it('rejects a duplicate num with 409', async () => {
    const res = await listPOST(jsonReq('POST', { ...VALID_CREATE, num: numA }));
    expect(res.status).toBe(409);
  });
});

describe('GET /api/funnels', () => {
  it('returns the funnel list', async () => {
    const res = await listGET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
  });
});

describe('GET /api/funnels/[id]', () => {
  it('returns 400 for a non-numeric id', async () => {
    const res = await idGET({} as never, params('abc'));
    expect(res.status).toBe(400);
  });
  it('returns 404 for a missing funnel', async () => {
    const res = await idGET({} as never, params(999999));
    expect(res.status).toBe(404);
  });
  it('returns the funnel for a valid id', async () => {
    const res = await idGET({} as never, params(existingId));
    expect(res.status).toBe(200);
  });
});

describe('PATCH /api/funnels/[id]', () => {
  it('returns 400 for invalid JSON', async () => {
    const res = await idPATCH(rawReq('PATCH', '{bad'), params(existingId));
    expect(res.status).toBe(400);
  });
  it('returns 404 for a missing funnel', async () => {
    const res = await idPATCH(jsonReq('PATCH', { status: 'draft' }), params(999999));
    expect(res.status).toBe(404);
  });
  it('returns 409 when changing num to one already taken', async () => {
    const res = await idPATCH(jsonReq('PATCH', { num: numB }), params(existingId));
    expect(res.status).toBe(409);
  });
  it('applies a valid patch', async () => {
    const res = await idPATCH(jsonReq('PATCH', { status: 'draft' }), params(existingId));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('draft');
  });
});

describe('DELETE /api/funnels/[id]', () => {
  it('returns 404 for a missing funnel', async () => {
    const res = await idDELETE({} as never, params(999999));
    expect(res.status).toBe(404);
  });
  it('deletes an existing funnel', async () => {
    const created = await (await listPOST(jsonReq('POST', VALID_CREATE))).json();
    const res = await idDELETE({} as never, params(created.id));
    expect(res.status).toBe(200);
  });
});

describe('POST /api/funnels/[id]/duplicate', () => {
  it('returns 400 for a non-numeric id', async () => {
    const res = await dupPOST({} as never, params('x'));
    expect(res.status).toBe(400);
  });
  it('returns 404 for a missing funnel', async () => {
    const res = await dupPOST({} as never, params(999999));
    expect(res.status).toBe(404);
  });
  it('duplicates an existing funnel with 201', async () => {
    const res = await dupPOST({} as never, params(existingId));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.status).toBe('draft');
  });
});

describe('POST /api/funnels/draft', () => {
  it('creates a draft funnel with 201', async () => {
    const res = await draftPOST();
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.status).toBe('draft');
  });
});
