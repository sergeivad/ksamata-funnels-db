/**
 * HTTP-layer tests for the global tag-templates routes (GET map / PUT scenario).
 *
 * ISOLATION: each test runs against a fresh temp COPY of the DB, with `@/db/client`
 * mocked to a drizzle handle over that copy (same pattern as api-funnels-route.test.ts).
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
import { replaceOverrides } from '../src/lib/tag-overrides';

const REAL_DB = path.resolve(process.cwd(), '..', 'ksamata_funnels.db');
let tmp: string;
let sqlite: Database.Database;
let db: ReturnType<typeof drizzle<typeof schema>>;

/* eslint-disable @typescript-eslint/consistent-type-imports */
let GET: typeof import('../src/app/api/tag-templates/route').GET;
let PUT: typeof import('../src/app/api/tag-templates/[scenario]/route').PUT;
/* eslint-enable @typescript-eslint/consistent-type-imports */

beforeEach(async () => {
  tmp = path.join(os.tmpdir(), `tpl-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  fs.copyFileSync(REAL_DB, tmp);
  sqlite = new Database(tmp);
  sqlite.pragma('foreign_keys = ON');
  runMigratePhase3(sqlite);
  runMigrateMessengerTagType(sqlite);
  runMigratePhase5(sqlite);
  db = drizzle(sqlite, { schema });
  vi.doMock('@/db/client', () => ({ db }));

  GET = (await import('../src/app/api/tag-templates/route')).GET;
  PUT = (await import('../src/app/api/tag-templates/[scenario]/route')).PUT;
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
const params = (scenario: string) => ({ params: Promise.resolve({ scenario }) });

describe('GET /api/tag-templates', () => {
  it('returns the template grouped by scenario', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.reg).toContain('автоворонки');
    expect(body.messenger).toContain('АВ Этап: Мессенджер');
  });
});

describe('PUT /api/tag-templates/[scenario]', () => {
  it('replaces a scenario and 200s', async () => {
    const res = await PUT(jsonReq('PUT', { names: ['автоворонки', 'новый'] }), params('reg'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.names).toEqual(['автоворонки', 'новый']);

    const after = await (await GET()).json();
    expect(after.reg).toEqual(['автоворонки', 'новый']);
  });

  it('rejects an invalid scenario with 400', async () => {
    const res = await PUT(jsonReq('PUT', { names: [] }), params('nope'));
    expect(res.status).toBe(400);
  });

  it('rejects invalid JSON with 400', async () => {
    const res = await PUT(rawReq('PUT', '{bad'), params('reg'));
    expect(res.status).toBe(400);
  });

  it('rejects a body that fails validation with 400', async () => {
    const res = await PUT(jsonReq('PUT', { names: 'not-an-array' }), params('reg'));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.issues).toBeDefined();
  });

  it('resyncs funnels: overrides survive, defaults from the new template propagate', async () => {
    const funnelId = (sqlite.prepare('SELECT id FROM funnels LIMIT 1').get() as { id: number }).id;
    replaceOverrides(db, funnelId, {
      reg: { add: ['кастом'], remove: [] },
      time_15: { add: [], remove: [] },
      time_19: { add: [], remove: [] },
      messenger: { add: [], remove: [] },
    });

    const res = await PUT(jsonReq('PUT', { names: ['автоворонки', 'новый-дефолт'] }), params('reg'));
    expect(res.status).toBe(200);

    const tagRows = sqlite
      .prepare(
        `SELECT t.name FROM funnel_tags ft JOIN tags t ON t.id = ft.tag_id WHERE ft.funnel_id = ? AND ft.tag_type = 'reg'`
      )
      .all(funnelId) as { name: string }[];
    const names = tagRows.map((r) => r.name);
    expect(names).toContain('новый-дефолт');
    expect(names).toContain('кастом');
  });
});
