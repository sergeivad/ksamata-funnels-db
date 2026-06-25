import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import * as schema from '../src/db/schema';

const REAL_DB = path.resolve(process.cwd(), '..', 'ksamata_funnels.db');
let tmp: string;
let sqlite: Database.Database;
let funnelId: number;

// Typed handler references — same pattern as api-blocks-route.test.ts
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let GET: typeof import('../src/app/api/funnels/[id]/days/route').GET;
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let PUT: typeof import('../src/app/api/funnels/[id]/days/route').PUT;

beforeEach(async () => {
  tmp = path.join(os.tmpdir(), `dr-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  fs.copyFileSync(REAL_DB, tmp);
  sqlite = new Database(tmp);
  funnelId = (sqlite.prepare('SELECT id FROM funnels LIMIT 1').get() as { id: number }).id;
  sqlite.prepare('DELETE FROM funnel_days WHERE funnel_id = ?').run(funnelId);
  const db = drizzle(sqlite, { schema });
  vi.doMock('@/db/client', () => ({ db }));

  const mod = await import('../src/app/api/funnels/[id]/days/route');
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

describe('days route', () => {
  it('PUT cells with replayUrl, GET returns them', async () => {
    const params = Promise.resolve({ id: String(funnelId) });
    const putRes = await PUT(
      putReq({ cells: [{ timeSlot: '15', dayNum: 1, gcRoom: 'g', webRoom: 'w', replayUrl: 'r' }] }),
      { params },
    );
    expect(putRes.status).toBe(200);

    const getRes = await GET({} as never, { params: Promise.resolve({ id: String(funnelId) }) });
    const body = await getRes.json();
    expect(body).toContainEqual({ timeSlot: '15', dayNum: 1, gcRoom: 'g', webRoom: 'w', replayUrl: 'r' });
  });

  it('rejects cells missing replayUrl with 400', async () => {
    const params = Promise.resolve({ id: String(funnelId) });
    const putRes = await PUT(
      putReq({ cells: [{ timeSlot: '15', dayNum: 1, gcRoom: 'g', webRoom: 'w', salesPage: 's' }] }),
      { params },
    );
    expect(putRes.status).toBe(400);
  });
});
