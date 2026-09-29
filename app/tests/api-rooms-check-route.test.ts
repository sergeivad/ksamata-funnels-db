/**
 * POST /api/funnels/[id]/rooms/check — форма тела. Сеть подменена: роут не
 * должен уходить на Бизон, пока тело не прошло проверку.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import * as schema from '../src/db/schema';
import { copyDbForTest } from './helpers/db';

const REAL_DB = path.resolve(process.cwd(), '..', 'ksamata_funnels.db');
let tmp: string;
let sqlite: Database.Database;
let funnelId: number;
const fetchSpy = vi.fn();

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let POST: typeof import('../src/app/api/funnels/[id]/rooms/check/route').POST;

beforeEach(async () => {
  tmp = path.join(os.tmpdir(), `rc-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  copyDbForTest(REAL_DB, tmp);
  sqlite = new Database(tmp);
  funnelId = (sqlite.prepare('SELECT id FROM funnels LIMIT 1').get() as { id: number }).id;
  const db = drizzle(sqlite, { schema });
  vi.doMock('@/db/client', () => ({ db }));
  fetchSpy.mockReset();
  fetchSpy.mockImplementation(async () =>
    new Response('<html><head><title>Комната</title></head></html>', { status: 200 }));
  vi.stubGlobal('fetch', fetchSpy);
  POST = (await import('../src/app/api/funnels/[id]/rooms/check/route')).POST;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
  sqlite.close();
  fs.rmSync(tmp, { force: true });
});

const post = (id: number | string, body: unknown) =>
  POST(new Request('http://test', { method: 'POST', body: JSON.stringify(body) }) as never,
    { params: Promise.resolve({ id: String(id) }) });

const cell = { timeSlot: '15', dayNum: 1, gcRoom: '', webRoom: 'https://web.ksamatacenter.com/room/dbo1-15-vks', replayUrl: '' };

describe('POST /api/funnels/[id]/rooms/check', () => {
  it('проверяет присланную сетку и ничего не пишет', async () => {
    const before = sqlite.prepare('SELECT COUNT(*) AS n FROM funnel_days WHERE funnel_id = ?').get(funnelId);
    const res = await post(funnelId, { cells: [cell], replays: false });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.lives[0]).toMatchObject({ timeSlot: '15', dayNum: 1, slug: 'dbo1-15-vks', outcome: 'found' });
    expect(body.replays).toEqual([]);
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM funnel_days WHERE funnel_id = ?').get(funnelId)).toEqual(before);
  });

  it('без признака «повтор» — 400', async () => {
    expect((await post(funnelId, { cells: [cell] })).status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('ячеек больше десяти — 400', async () => {
    const cells = Array.from({ length: 11 }, (_, i) => ({ ...cell, dayNum: (i % 5) + 1 }));
    expect((await post(funnelId, { cells, replays: false })).status).toBe(400);
  });

  it('день вне 1–5 и не строка в поле — 400', async () => {
    expect((await post(funnelId, { cells: [{ ...cell, dayNum: 6 }], replays: false })).status).toBe(400);
    expect((await post(funnelId, { cells: [{ ...cell, gcRoom: 5 }], replays: false })).status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('несуществующая воронка — 404', async () => {
    expect((await post(999999, { cells: [cell], replays: false })).status).toBe(404);
  });
});
