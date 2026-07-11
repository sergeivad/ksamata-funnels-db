/**
 * HTTP-layer tests for the funnel links route (GET/PUT).
 * The underlying lib (funnel-links.ts) is covered by funnel-links.test.ts;
 * this exercises the route's 400/404 branches and per-item validation.
 *
 * ISOLATION: fresh temp COPY of the DB per test with `@/db/client` mocked.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { runMigratePhase3 } from '../scripts/migrate-phase3';
import * as schema from '../src/db/schema';

const REAL_DB = path.resolve(process.cwd(), '..', 'ksamata_funnels.db');
let tmp: string;
let sqlite: Database.Database;
let funnelId: number;

/* eslint-disable @typescript-eslint/consistent-type-imports */
let GET: typeof import('../src/app/api/funnels/[id]/links/route').GET;
let PUT: typeof import('../src/app/api/funnels/[id]/links/route').PUT;
/* eslint-enable @typescript-eslint/consistent-type-imports */

beforeEach(async () => {
  tmp = path.join(os.tmpdir(), `lr-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  fs.copyFileSync(REAL_DB, tmp);
  sqlite = new Database(tmp);
  runMigratePhase3(sqlite);
  funnelId = (sqlite.prepare('SELECT id FROM funnels LIMIT 1').get() as { id: number }).id;
  const db = drizzle(sqlite, { schema });
  vi.doMock('@/db/client', () => ({ db }));
  const mod = await import('../src/app/api/funnels/[id]/links/route');
  GET = mod.GET;
  PUT = mod.PUT;
});

afterEach(() => {
  vi.resetModules();
  sqlite.close();
  fs.rmSync(tmp, { force: true });
});

function putReq(body: unknown) {
  return new Request('http://test', { method: 'PUT', body: JSON.stringify(body) }) as never;
}
function rawPut(raw: string) {
  return new Request('http://test', { method: 'PUT', body: raw }) as never;
}
const params = (id: string | number) => ({ params: Promise.resolve({ id: String(id) }) });

describe('links route — GET', () => {
  it('returns 400 for a non-numeric id', async () => {
    const res = await GET({} as never, params('abc'));
    expect(res.status).toBe(400);
  });
  it('returns 404 for a missing funnel', async () => {
    const res = await GET({} as never, params(999999));
    expect(res.status).toBe(404);
  });
  it('returns a (possibly empty) array for a valid funnel', async () => {
    const res = await GET({} as never, params(funnelId));
    expect(res.status).toBe(200);
    expect(Array.isArray(await res.json())).toBe(true);
  });
});

describe('links route — PUT', () => {
  it('returns 404 for a missing funnel', async () => {
    const res = await PUT(putReq({ items: [] }), params(999999));
    expect(res.status).toBe(404);
  });
  it('returns 400 for invalid JSON', async () => {
    const res = await PUT(rawPut('{oops'), params(funnelId));
    expect(res.status).toBe(400);
  });
  it('returns 400 when body is not { items: [] }', async () => {
    const res = await PUT(putReq({ nope: true }), params(funnelId));
    expect(res.status).toBe(400);
  });
  it('returns 400 when an item is missing label/url', async () => {
    const res = await PUT(putReq({ items: [{ label: 'x' }] }), params(funnelId));
    expect(res.status).toBe(400);
  });
  it('replaces links and round-trips them', async () => {
    const res = await PUT(putReq({ items: [{ label: 'A', url: 'https://a' }] }), params(funnelId));
    expect(res.status).toBe(200);
    const getRes = await GET({} as never, params(funnelId));
    const body = await getRes.json();
    expect(body.map((l: { label: string; url: string }) => ({ label: l.label, url: l.url })))
      .toEqual([{ label: 'A', url: 'https://a' }]);
  });
});
