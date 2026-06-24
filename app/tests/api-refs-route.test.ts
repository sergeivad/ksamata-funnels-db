/**
 * Route-level tests for /api/refs/[kind].
 *
 * Strategy: point FUNNELS_DB_PATH to a temp copy of the real DB *before*
 * importing the route handlers, so the singleton db in @/db/client opens
 * the temp file. The real ksamata_funnels.db is never written.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { copyFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { NextRequest } from 'next/server';

const REAL_DB = join(__dirname, '../../ksamata_funnels.db');
const TMP_DB = join(tmpdir(), `ksamata_refs_route_test_${Date.now()}.db`);

// Must happen before any import that reaches @/db/client
copyFileSync(REAL_DB, TMP_DB);
process.env.FUNNELS_DB_PATH = TMP_DB;

// Dynamic import so the env var is already set when the module initialises
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let GET: typeof import('../src/app/api/refs/[kind]/route').GET;
let POST: typeof import('../src/app/api/refs/[kind]/route').POST;

beforeAll(async () => {
  const mod = await import('../src/app/api/refs/[kind]/route');
  GET = mod.GET;
  POST = mod.POST;
});

afterAll(() => {
  try {
    unlinkSync(TMP_DB);
  } catch {
    // ignore if already gone
  }
});

// Helper to build a NextRequest
function makeReq(method: string, body?: unknown): NextRequest {
  return new NextRequest('http://localhost:3000', {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
}

// Helper to build params promise
function params(kind: string) {
  return { params: Promise.resolve({ kind }) };
}

// ── GET ──────────────────────────────────────────────────────────────────────

describe('GET /api/refs/[kind]', () => {
  it('returns 200 with an array for products', async () => {
    const res = await GET(makeReq('GET'), params('products'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it('returns 200 for channels (previously missing from route whitelist)', async () => {
    const res = await GET(makeReq('GET'), params('channels'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it('returns 200 for directions (previously missing from route whitelist)', async () => {
    const res = await GET(makeReq('GET'), params('directions'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it('returns 400 for an unknown kind', async () => {
    const res = await GET(makeReq('GET'), params('bogus'));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });
});

// ── POST ─────────────────────────────────────────────────────────────────────

describe('POST /api/refs/[kind]', () => {
  it('POST /api/refs/channels with new name returns 200 and creates the row', async () => {
    const name = `RouteTestChannel_${Date.now()}`;
    const res = await POST(makeReq('POST', { name }), params('channels'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('id');
    expect(body.name).toBe(name);

    // Confirm it appears in GET
    const getRes = await GET(makeReq('GET'), params('channels'));
    const list: Array<{ id: number; name: string }> = await getRes.json();
    const found = list.find((r) => r.name === name);
    expect(found).toBeDefined();
    expect(found!.id).toBe(body.id);
  });

  it('POST /api/refs/directions with new name returns 200', async () => {
    const name = `RouteTestDirection_${Date.now()}`;
    const res = await POST(makeReq('POST', { name }), params('directions'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('id');
    expect(body.name).toBe(name);
  });

  it('POST idempotent — second call returns same id, no duplicate', async () => {
    const name = `RouteTestIdempotent_${Date.now()}`;
    const res1 = await POST(makeReq('POST', { name }), params('channels'));
    const body1 = await res1.json();

    const res2 = await POST(makeReq('POST', { name }), params('channels'));
    const body2 = await res2.json();

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
    expect(body1.id).toBe(body2.id);
  });

  it('POST with an unknown kind returns 400', async () => {
    const res = await POST(makeReq('POST', { name: 'test' }), params('bogus'));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
    expect(body.error).toMatch(/invalid kind/i);
  });

  it('POST with missing name field returns 400', async () => {
    const res = await POST(makeReq('POST', {}), params('channels'));
    expect(res.status).toBe(400);
  });

  it('POST with invalid JSON returns 400', async () => {
    const req = new NextRequest('http://localhost:3000', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    });
    const res = await POST(req, params('channels'));
    expect(res.status).toBe(400);
  });
});
