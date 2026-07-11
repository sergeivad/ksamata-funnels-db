/**
 * Tests for the optional Basic-Auth middleware.
 * ADMIN_BASIC_AUTH is mutated per test and restored in afterEach.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { middleware } from '../src/middleware';

const ORIGINAL = process.env.ADMIN_BASIC_AUTH;

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.ADMIN_BASIC_AUTH;
  else process.env.ADMIN_BASIC_AUTH = ORIGINAL;
});

function req(auth?: string) {
  const headers = new Headers();
  if (auth) headers.set('authorization', auth);
  return new NextRequest('http://test/funnels/1', { headers });
}
const basic = (u: string, p: string) => `Basic ${Buffer.from(`${u}:${p}`).toString('base64')}`;

describe('auth middleware', () => {
  it('is a no-op when ADMIN_BASIC_AUTH is unset', () => {
    delete process.env.ADMIN_BASIC_AUTH;
    expect(middleware(req()).status).not.toBe(401);
  });

  it('challenges with 401 when configured and no credentials are sent', () => {
    process.env.ADMIN_BASIC_AUTH = 'admin:s3cret';
    const res = middleware(req());
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toContain('Basic');
  });

  it('rejects wrong credentials with 401', () => {
    process.env.ADMIN_BASIC_AUTH = 'admin:s3cret';
    expect(middleware(req(basic('admin', 'wrong'))).status).toBe(401);
  });

  it('allows correct credentials', () => {
    process.env.ADMIN_BASIC_AUTH = 'admin:s3cret';
    expect(middleware(req(basic('admin', 's3cret'))).status).not.toBe(401);
  });

  it('rejects malformed base64 without throwing', () => {
    process.env.ADMIN_BASIC_AUTH = 'admin:s3cret';
    expect(middleware(req('Basic @@@not-base64@@@')).status).toBe(401);
  });

  it('accepts a credential containing non-ASCII (UTF-8) characters', () => {
    process.env.ADMIN_BASIC_AUTH = 'админ:пароль€';
    expect(middleware(req(basic('админ', 'пароль€'))).status).not.toBe(401);
  });

  it('rejects a near-miss non-ASCII credential', () => {
    process.env.ADMIN_BASIC_AUTH = 'админ:пароль€';
    expect(middleware(req(basic('админ', 'пароль'))).status).toBe(401);
  });
});
