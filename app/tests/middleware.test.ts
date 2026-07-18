/**
 * Tests for the optional Basic-Auth middleware.
 * ADMIN_BASIC_AUTH and NODE_ENV are mutated per test and restored in afterEach.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { middleware, resolveAuthDecision } from '../src/middleware';

const ORIGINAL_AUTH = process.env.ADMIN_BASIC_AUTH;
const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

// NODE_ENV is a readonly-typed property in @types/node; go through
// Object.defineProperty so tests can freely flip it.
function setNodeEnv(value: string | undefined) {
  if (value === undefined) {
    delete (process.env as Record<string, string | undefined>).NODE_ENV;
    return;
  }
  Object.defineProperty(process.env, 'NODE_ENV', { value, configurable: true, writable: true, enumerable: true });
}

afterEach(() => {
  if (ORIGINAL_AUTH === undefined) delete process.env.ADMIN_BASIC_AUTH;
  else process.env.ADMIN_BASIC_AUTH = ORIGINAL_AUTH;
  setNodeEnv(ORIGINAL_NODE_ENV);
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

  describe('production fail-closed (no valid ADMIN_BASIC_AUTH)', () => {
    it('returns 503 in production when ADMIN_BASIC_AUTH is unset', () => {
      delete process.env.ADMIN_BASIC_AUTH;
      setNodeEnv('production');
      const res = middleware(req());
      expect(res.status).toBe(503);
    });

    it('503 response body names the missing variable', async () => {
      delete process.env.ADMIN_BASIC_AUTH;
      setNodeEnv('production');
      const res = middleware(req());
      expect(await res.text()).toContain('ADMIN_BASIC_AUTH');
    });

    it('returns 503 in production when ADMIN_BASIC_AUTH is an empty string', () => {
      process.env.ADMIN_BASIC_AUTH = '';
      setNodeEnv('production');
      expect(middleware(req()).status).toBe(503);
    });

    it('returns 503 in production when ADMIN_BASIC_AUTH has no ":" separator', () => {
      process.env.ADMIN_BASIC_AUTH = 'not-a-valid-credential';
      setNodeEnv('production');
      expect(middleware(req()).status).toBe(503);
    });

    it('still requires Basic Auth in production when ADMIN_BASIC_AUTH is valid', () => {
      process.env.ADMIN_BASIC_AUTH = 'admin:s3cret';
      setNodeEnv('production');
      expect(middleware(req()).status).toBe(401);
      expect(middleware(req(basic('admin', 's3cret'))).status).not.toBe(401);
      expect(middleware(req(basic('admin', 's3cret'))).status).not.toBe(503);
    });

    it('stays open (non-production) when ADMIN_BASIC_AUTH is unset outside production', () => {
      delete process.env.ADMIN_BASIC_AUTH;
      setNodeEnv('development');
      const res = middleware(req());
      expect(res.status).not.toBe(401);
      expect(res.status).not.toBe(503);
    });
  });
});

describe('resolveAuthDecision (pure decision logic)', () => {
  it('is "open" when unset and not production', () => {
    expect(resolveAuthDecision({ ADMIN_BASIC_AUTH: undefined, NODE_ENV: 'development' }, null)).toBe('open');
    expect(resolveAuthDecision({ ADMIN_BASIC_AUTH: undefined, NODE_ENV: 'test' }, null)).toBe('open');
    expect(resolveAuthDecision({ ADMIN_BASIC_AUTH: undefined, NODE_ENV: undefined }, null)).toBe('open');
  });

  it('is "misconfigured" when unset/empty/invalid and NODE_ENV=production', () => {
    expect(resolveAuthDecision({ ADMIN_BASIC_AUTH: undefined, NODE_ENV: 'production' }, null)).toBe('misconfigured');
    expect(resolveAuthDecision({ ADMIN_BASIC_AUTH: '', NODE_ENV: 'production' }, null)).toBe('misconfigured');
    expect(resolveAuthDecision({ ADMIN_BASIC_AUTH: 'no-colon-here', NODE_ENV: 'production' }, null)).toBe('misconfigured');
  });

  it('is "unauthorized" when configured but header missing or wrong', () => {
    expect(resolveAuthDecision({ ADMIN_BASIC_AUTH: 'admin:s3cret', NODE_ENV: 'production' }, null)).toBe('unauthorized');
    expect(
      resolveAuthDecision({ ADMIN_BASIC_AUTH: 'admin:s3cret', NODE_ENV: 'production' }, basic('admin', 'wrong'))
    ).toBe('unauthorized');
  });

  it('is "ok" when configured and header matches, regardless of NODE_ENV', () => {
    expect(
      resolveAuthDecision({ ADMIN_BASIC_AUTH: 'admin:s3cret', NODE_ENV: 'production' }, basic('admin', 's3cret'))
    ).toBe('ok');
    expect(
      resolveAuthDecision({ ADMIN_BASIC_AUTH: 'admin:s3cret', NODE_ENV: 'development' }, basic('admin', 's3cret'))
    ).toBe('ok');
  });
});
