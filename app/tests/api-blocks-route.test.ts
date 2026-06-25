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

// Typed handler references — same pattern as api-refs-route.test.ts
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let GET: typeof import('../src/app/api/funnels/[id]/blocks/[kind]/route').GET;
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let PUT: typeof import('../src/app/api/funnels/[id]/blocks/[kind]/route').PUT;

beforeEach(async () => {
  tmp = path.join(os.tmpdir(), `br-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  fs.copyFileSync(REAL_DB, tmp);
  sqlite = new Database(tmp);
  runMigratePhase3(sqlite);
  funnelId = (sqlite.prepare('SELECT id FROM funnels LIMIT 1').get() as { id: number }).id;
  const db = drizzle(sqlite, { schema });
  vi.doMock('@/db/client', () => ({ db }));

  const mod = await import('../src/app/api/funnels/[id]/blocks/[kind]/route');
  GET = mod.GET;
  PUT = mod.PUT;
});

afterEach(() => {
  vi.resetModules();
  sqlite.close();
  fs.rmSync(tmp, { force: true });
});

function req(body: unknown) {
  return new Request('http://test', { method: 'PUT', body: JSON.stringify(body) }) as never;
}

describe('blocks route', () => {
  it('PUT then GET round-trips a block', async () => {
    const params = Promise.resolve({ id: String(funnelId), kind: 'tariffs' });
    const putRes = await PUT(req({ enabled: true, mode: 'common', items: [{ slot: null, label: '', url: 'https://a' }] }), { params });
    expect(putRes.status).toBe(200);
    const getRes = await GET({} as never, { params: Promise.resolve({ id: String(funnelId), kind: 'tariffs' }) });
    const body = await getRes.json();
    expect(body.enabled).toBe(true);
    expect(body.items).toEqual([{ slot: null, label: '', url: 'https://a' }]);
  });

  it('rejects unknown kind with 400', async () => {
    const res = await GET({} as never, { params: Promise.resolve({ id: String(funnelId), kind: 'rooms' }) });
    expect(res.status).toBe(400);
  });

  it('rejects invalid mode for landings (common-only) with 400', async () => {
    const res = await PUT(req({ enabled: true, mode: 'by_time', items: [] }), { params: Promise.resolve({ id: String(funnelId), kind: 'landings' }) });
    expect(res.status).toBe(400);
  });
});
