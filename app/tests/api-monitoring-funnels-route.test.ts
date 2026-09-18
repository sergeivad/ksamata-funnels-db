/**
 * HTTP-слой чтения состояния воронок. Каждая проверка идёт на свежей временной
 * КОПИИ БД, `@/db/client` подменяется drizzle-хендлом над копией (как в
 * api-monitoring-route.test.ts).
 *
 * Роуты закрыты редактору (в отличие от /api/funnels), поэтому здесь, в
 * отличие от api-monitoring-route.test.ts, ADMIN_USERS настраивается по-
 * настоящему: аноним должен получать 401, а не «открыто, т.к. учётки не
 * заданы».
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { runMigratePhase6 } from '../scripts/migrate-phase6';
import * as schema from '../src/db/schema';
import { clearMonitoringState } from './helpers/monitoring';
import { copyDbForTest } from './helpers/db';

const REAL_DB = path.resolve(process.cwd(), '..', 'ksamata_funnels.db');
let tmp: string;
let sqlite: Database.Database;
let db: ReturnType<typeof drizzle<typeof schema>>;
let funnelId: number;

/* eslint-disable @typescript-eslint/consistent-type-imports */
let GET: typeof import('../src/app/api/monitoring/funnels/route').GET;
let GET_ONE: typeof import('../src/app/api/monitoring/funnels/[id]/route').GET;
/* eslint-enable @typescript-eslint/consistent-type-imports */

const ADMIN = 'ed:s3cret';
const AUTH_HEADER = `Basic ${Buffer.from(ADMIN).toString('base64')}`;

function makeRequest(url: string): never {
  return new Request(url) as never;
}

function editorRequest(url: string): never {
  return new Request(url, { headers: { authorization: AUTH_HEADER } }) as never;
}

beforeEach(async () => {
  process.env.ADMIN_USERS = ADMIN;
  // Счётчик перебора Basic живёт на globalThis и переживает тесты — чистим,
  // иначе он занят предыдущим файлом и валит запросы в 429.
  (globalThis as Record<symbol, unknown>)[Symbol.for('ksamata.loginAttempts')] = new Map();

  tmp = path.join(os.tmpdir(), `mfr-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  copyDbForTest(REAL_DB, tmp);
  sqlite = new Database(tmp);
  sqlite.pragma('foreign_keys = ON');
  runMigratePhase6(sqlite);
  clearMonitoringState(sqlite);
  db = drizzle(sqlite, { schema });
  vi.doMock('@/db/client', () => ({ db }));

  funnelId = (sqlite.prepare(`SELECT id FROM funnels WHERE status = 'active' LIMIT 1`)
    .get() as { id: number }).id;

  GET = (await import('../src/app/api/monitoring/funnels/route')).GET;
  GET_ONE = (await import('../src/app/api/monitoring/funnels/[id]/route')).GET;
});

afterEach(() => {
  delete process.env.ADMIN_USERS;
  vi.resetModules();
  sqlite.close();
  fs.rmSync(tmp, { force: true });
});

describe('GET /api/monitoring/funnels', () => {
  it('анониму — 401', async () => {
    const res = await GET(makeRequest('http://localhost/api/monitoring/funnels'));
    expect(res.status).toBe(401);
  });

  it('редактору отдаёт состояние по id воронки', async () => {
    const res = await GET(editorRequest('http://localhost/api/monitoring/funnels'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('health');
  });
});

describe('GET /api/monitoring/funnels/[id]', () => {
  it('нечисловой id — 400', async () => {
    const res = await GET_ONE(editorRequest('http://localhost/api/monitoring/funnels/f101'), {
      params: Promise.resolve({ id: 'f101' }),
    });
    expect(res.status).toBe(400);
  });

  it('несуществующая воронка — 404', async () => {
    const res = await GET_ONE(editorRequest('http://localhost/api/monitoring/funnels/999999'), {
      params: Promise.resolve({ id: '999999' }),
    });
    expect(res.status).toBe(404);
  });

  it('редактору отдаёт агрегат и список проблем существующей воронки', async () => {
    const res = await GET_ONE(editorRequest(`http://localhost/api/monitoring/funnels/${funnelId}`), {
      params: Promise.resolve({ id: String(funnelId) }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('health');
    expect(Array.isArray(body.problems)).toBe(true);
    expect(body).toHaveProperty('checking');
  });

  it('анониму — 401 без обращения к БД', async () => {
    const res = await GET_ONE(makeRequest(`http://localhost/api/monitoring/funnels/${funnelId}`), {
      params: Promise.resolve({ id: String(funnelId) }),
    });
    expect(res.status).toBe(401);
  });
});
