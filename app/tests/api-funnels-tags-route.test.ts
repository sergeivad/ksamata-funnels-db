/**
 * HTTP-layer test for PATCH /api/funnels/[id]/tags — per-funnel tag overrides.
 *
 * ISOLATION: fresh temp COPY of the DB per test file, with `@/db/client` mocked
 * to a drizzle handle over that copy (same pattern as api-funnels-route.test.ts).
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

/* eslint-disable @typescript-eslint/consistent-type-imports */
let PATCH: typeof import('../src/app/api/funnels/[id]/tags/route').PATCH;
/* eslint-enable @typescript-eslint/consistent-type-imports */

beforeEach(async () => {
  tmp = path.join(os.tmpdir(), `frtags-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  fs.copyFileSync(REAL_DB, tmp);
  sqlite = new Database(tmp);
  sqlite.pragma('foreign_keys = ON');
  runMigratePhase3(sqlite);
  runMigrateMessengerTagType(sqlite);
  runMigratePhase5(sqlite);
  const rows = sqlite.prepare('SELECT id FROM funnels ORDER BY num LIMIT 1').all() as { id: number }[];
  existingId = rows[0].id;
  const db = drizzle(sqlite, { schema });
  vi.doMock('@/db/client', () => ({ db }));

  const route = await import('../src/app/api/funnels/[id]/tags/route');
  PATCH = route.PATCH;
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

describe('PATCH /api/funnels/[id]/tags', () => {
  it('adds a custom tag and removes a default, reflected in tagSets', async () => {
    const res = await PATCH(
      jsonReq('PATCH', { reg: { add: ['промо-тест'], remove: ['автоворонки'] } }),
      params(existingId)
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    const names = body.tagSets.reg.tags.map((t: { name: string }) => t.name);
    expect(names).toContain('промо-тест');
    expect(names).not.toContain('автоворонки');
    expect(body.tagSets.reg.suppressed).toContain('автоворонки');
  });

  it('returns 400 for a non-numeric id', async () => {
    const res = await PATCH(jsonReq('PATCH', {}), params('abc'));
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid JSON', async () => {
    const res = await PATCH(rawReq('PATCH', '{bad'), params(existingId));
    expect(res.status).toBe(400);
  });

  it('returns 400 for a body that fails validation (unknown scenario key)', async () => {
    const res = await PATCH(jsonReq('PATCH', { bogus: { add: [], remove: [] } }), params(existingId));
    expect(res.status).toBe(400);
  });

  it('404 for a missing funnel', async () => {
    const res = await PATCH(jsonReq('PATCH', {}), params(99999999));
    expect(res.status).toBe(404);
  });
});
