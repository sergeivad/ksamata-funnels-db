/**
 * Тесты `getViewer()` — конкретно того, что он смотрит на `Authorization`
 * заголовок так же, как второй рубеж (`requireEditor` в `auth-server.ts`).
 *
 * Замер на прод-сборке показал расхождение: редактор, авторизованный через
 * `Authorization: Basic` (ADMIN_USERS / ADMIN_BASIC_AUTH), получал 200 и
 * успешную запись на `PATCH /api/funnels/:id` (там `requireEditor` читает
 * заголовок), но страницы `/refs`, `/tags`, `/monitoring` уводили его на
 * `/login`, а карточка воронки показывала режим «Только просмотр» — потому
 * что `getViewer()` вызывал `resolveAccess` с `authHeader: null`. Этот файл
 * мокает `next/headers`, чтобы проверить `getViewer()` в изоляции: отдельный
 * файл — чтобы мок `next/headers` не задевал остальные тесты `auth-server.ts`,
 * которые вызывают `requireEditor`/`readCookie` напрямую от `Request`, а не
 * через RSC-контекст.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const mockCookies = vi.fn();
const mockHeaders = vi.fn();
vi.mock('next/headers', () => ({
  cookies: () => mockCookies(),
  headers: () => mockHeaders(),
}));

import { getViewer } from '../src/lib/auth-server';
import { signSession } from '../src/lib/auth';

const KEYS = ['ADMIN_USERS', 'ADMIN_BASIC_AUTH', 'ADMIN_SESSION_SECRET', 'ADMIN_AUTH_DISABLED', 'PUBLIC_READ_ENABLED'] as const;
const ORIGINAL: Record<string, string | undefined> = {};
const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const SECRET = 'a-secret-long-enough-to-count';

function setNodeEnv(value: string | undefined) {
  if (value === undefined) {
    delete (process.env as Record<string, string | undefined>).NODE_ENV;
    return;
  }
  Object.defineProperty(process.env, 'NODE_ENV', { value, configurable: true, writable: true, enumerable: true });
}

function basic(user: string, password: string): string {
  return `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;
}

/** Пустая cookie-обвязка и заголовок Authorization по требованию теста. */
function mockRequestContext(authHeader: string | null, cookieValue: string | null = null) {
  mockCookies.mockResolvedValue({
    get: (name: string) => (name === 'kf_session' && cookieValue !== null ? { value: cookieValue } : undefined),
  });
  mockHeaders.mockResolvedValue({
    get: (name: string) => (name.toLowerCase() === 'authorization' ? authHeader : null),
  });
}

beforeEach(() => {
  for (const k of KEYS) ORIGINAL[k] = process.env[k];
  process.env.ADMIN_USERS = 'ed:s3cret';
  process.env.ADMIN_SESSION_SECRET = SECRET;
  delete process.env.ADMIN_BASIC_AUTH;
  delete process.env.ADMIN_AUTH_DISABLED;
  delete process.env.PUBLIC_READ_ENABLED;
  setNodeEnv('production');
  mockCookies.mockReset();
  mockHeaders.mockReset();
});

afterEach(() => {
  for (const k of KEYS) {
    if (ORIGINAL[k] === undefined) delete process.env[k];
    else process.env[k] = ORIGINAL[k];
  }
  setNodeEnv(ORIGINAL_NODE_ENV);
});

describe('getViewer — заголовок Authorization', () => {
  it('аноним без cookie и без Authorization — режим просмотра', async () => {
    mockRequestContext(null);
    const viewer = await getViewer();
    expect(viewer).toEqual({ user: null, canEdit: false });
  });

  it('верная сессионная cookie — редактор, как и раньше', async () => {
    const token = await signSession({ u: 'ed', exp: Math.floor(Date.now() / 1000) + 3600 }, SECRET);
    mockRequestContext(null, token);
    const viewer = await getViewer();
    expect(viewer).toEqual({ user: 'ed', canEdit: true });
  });

  it('верный Authorization: Basic без cookie — тоже редактор', async () => {
    // Это и есть сам баг: до фикса getViewer передавал authHeader: null и
    // не видел в этом редакторе ничего, кроме анонима.
    mockRequestContext(basic('ed', 's3cret'));
    const viewer = await getViewer();
    expect(viewer).toEqual({ user: 'ed', canEdit: true });
  });

  it('неверный Basic — остаётся анонимом', async () => {
    mockRequestContext(basic('ed', 'wrong'));
    const viewer = await getViewer();
    expect(viewer).toEqual({ user: null, canEdit: false });
  });
});
