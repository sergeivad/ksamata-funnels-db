/**
 * Тесты мидлвары — первого рубежа доступа.
 *
 * Логика решения проверена таблицей в auth.test.ts; здесь — что мидлвара
 * правильно превращает решение в ответ: редирект на форму, 401 на API, 403 на
 * чужой Origin, 503 на ненастроенный прод, заголовок против индексации.
 *
 * Переменные окружения мутируются по тесту и восстанавливаются в afterEach.
 */
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { middleware } from '../src/middleware';
import { SESSION_COOKIE, signSession } from '../src/lib/auth';

const KEYS = ['ADMIN_USERS', 'ADMIN_BASIC_AUTH', 'ADMIN_SESSION_SECRET', 'ADMIN_AUTH_DISABLED', 'PUBLIC_READ_ENABLED'] as const;
const ORIGINAL: Record<string, string | undefined> = {};
const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

const SECRET = 'a-secret-long-enough-to-count';

// NODE_ENV типизирован readonly в @types/node — идём через defineProperty.
function setNodeEnv(value: string | undefined) {
  if (value === undefined) {
    delete (process.env as Record<string, string | undefined>).NODE_ENV;
    return;
  }
  Object.defineProperty(process.env, 'NODE_ENV', { value, configurable: true, writable: true, enumerable: true });
}

beforeEach(() => {
  for (const k of KEYS) ORIGINAL[k] = process.env[k];
  // Настроенный прод — самый интересный режим, от него и пляшем.
  process.env.ADMIN_USERS = 'sergei:s3cret';
  process.env.ADMIN_SESSION_SECRET = SECRET;
  delete process.env.ADMIN_BASIC_AUTH;
  delete process.env.ADMIN_AUTH_DISABLED;
  delete process.env.PUBLIC_READ_ENABLED;
  setNodeEnv('production');
});

afterEach(() => {
  for (const k of KEYS) {
    if (ORIGINAL[k] === undefined) delete process.env[k];
    else process.env[k] = ORIGINAL[k];
  }
  setNodeEnv(ORIGINAL_NODE_ENV);
});

interface ReqOpts {
  method?: string;
  auth?: string;
  cookie?: string;
  origin?: string;
}

function req(path = '/', { method = 'GET', auth, cookie, origin }: ReqOpts = {}) {
  const headers = new Headers({ host: 'admin.example' });
  if (auth) headers.set('authorization', auth);
  if (cookie) headers.set('cookie', `${SESSION_COOKIE}=${cookie}`);
  if (origin) headers.set('origin', origin);
  return new NextRequest(`http://admin.example${path}`, { method, headers });
}

const basic = (u: string, p: string) => `Basic ${Buffer.from(`${u}:${p}`).toString('base64')}`;

async function session(user = 'sergei') {
  return signSession({ u: user, exp: Math.floor(Date.now() / 1000) + 3600 }, SECRET);
}

describe('публичное чтение', () => {
  it('пускает анонима на список и карточку воронки', async () => {
    for (const path of ['/', '/funnels/7', '/api/funnels', '/api/funnels/7/days']) {
      const res = await middleware(req(path));
      expect(res.status, path).toBe(200);
    }
  });

  it('вешает X-Robots-Tag на любой ответ, включая API', async () => {
    // robots.txt покрывает только вежливые краулеры; заголовок — всех.
    expect((await middleware(req('/'))).headers.get('X-Robots-Tag')).toBe('noindex, nofollow');
    expect((await middleware(req('/api/funnels'))).headers.get('X-Robots-Tag')).toBe('noindex, nofollow');
    expect((await middleware(req('/refs'))).headers.get('X-Robots-Tag')).toBe('noindex, nofollow');
  });
});

describe('закрытые страницы', () => {
  it('уводит анонима на /login с возвратом', async () => {
    const res = await middleware(req('/refs'));
    expect(res.status).toBe(307);
    const location = new URL(res.headers.get('location')!);
    expect(location.pathname).toBe('/login');
    expect(location.searchParams.get('next')).toBe('/refs');
  });

  it('в `next` кладёт только внутренний путь', async () => {
    // `//evil.example` браузер трактует как абсолютный URL — открытый редирект
    // из-под собственной формы входа.
    const res = await middleware(req('//evil.example'));
    const location = new URL(res.headers.get('location')!);
    expect(location.searchParams.get('next')).toBeNull();
  });

  it('пускает редактора по сессии', async () => {
    const res = await middleware(req('/refs', { cookie: await session() }));
    expect(res.status).toBe(200);
  });

  it('не верит токену, подписанному чужим секретом', async () => {
    const forged = await signSession(
      { u: 'sergei', exp: Math.floor(Date.now() / 1000) + 3600 },
      'другой-секрет-достаточной-длины'
    );
    expect((await middleware(req('/refs', { cookie: forged }))).status).toBe(307);
  });
});

describe('закрытый API', () => {
  it('отвечает 401 с вызовом Basic — для curl и скриптов', async () => {
    const res = await middleware(req('/api/export'));
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toContain('Basic');
  });

  it('пускает по верному Basic и отвергает неверный', async () => {
    expect((await middleware(req('/api/export', { auth: basic('sergei', 's3cret') }))).status).toBe(200);
    expect((await middleware(req('/api/export', { auth: basic('sergei', 'wrong') }))).status).toBe(401);
  });

  it('принимает совместимый ADMIN_BASIC_AUTH', async () => {
    process.env.ADMIN_BASIC_AUTH = 'legacy:pass';
    expect((await middleware(req('/api/export', { auth: basic('legacy', 'pass') }))).status).toBe(200);
  });
});

describe('запись', () => {
  it('анониму запрещена даже там, где чтение открыто', async () => {
    const res = await middleware(req('/api/funnels/7', { method: 'PATCH' }));
    expect(res.status).toBe(401);
  });

  it('редактору по сессии разрешена', async () => {
    const res = await middleware(req('/api/funnels/7', { method: 'PATCH', cookie: await session() }));
    expect(res.status).toBe(200);
  });

  it('с чужого Origin — 403, даже с валидной сессией', async () => {
    const res = await middleware(req('/api/funnels/7', {
      method: 'PATCH', cookie: await session(), origin: 'https://evil.example',
    }));
    expect(res.status).toBe(403);
  });

  it('со своего Origin проходит', async () => {
    const res = await middleware(req('/api/funnels/7', {
      method: 'PATCH', cookie: await session(), origin: 'http://admin.example',
    }));
    expect(res.status).toBe(200);
  });
});

describe('форма входа', () => {
  it('доступна анониму, включая POST на её роут', async () => {
    expect((await middleware(req('/login'))).status).toBe(200);
    expect((await middleware(req('/api/auth/login', { method: 'POST' }))).status).toBe(200);
  });
});

describe('ненастроенное окружение', () => {
  it('в проде без учёток: читать можно, писать — 503', async () => {
    delete process.env.ADMIN_USERS;
    delete process.env.ADMIN_SESSION_SECRET;
    expect((await middleware(req('/'))).status).toBe(200);
    const res = await middleware(req('/api/funnels', { method: 'POST' }));
    expect(res.status).toBe(503);
    expect(await res.text()).toContain('ADMIN_USERS');
  });

  it('в проде с учётками, но без секрета — тоже 503 на запись', async () => {
    delete process.env.ADMIN_SESSION_SECRET;
    expect((await middleware(req('/api/funnels', { method: 'POST' }))).status).toBe(503);
  });

  it('вне прода без учёток открыто всё — локальная разработка', async () => {
    delete process.env.ADMIN_USERS;
    delete process.env.ADMIN_SESSION_SECRET;
    setNodeEnv('development');
    expect((await middleware(req('/refs'))).status).toBe(200);
    expect((await middleware(req('/api/funnels', { method: 'POST' }))).status).toBe(200);
  });
});

describe('kill-switch ADMIN_AUTH_DISABLED', () => {
  it('пропускает всё, включая запись в проде с заданными учётками', async () => {
    process.env.ADMIN_AUTH_DISABLED = 'true';
    expect((await middleware(req('/refs'))).status).toBe(200);
    expect((await middleware(req('/api/funnels/7', { method: 'DELETE' }))).status).toBe(200);
  });

  it('выключает ровно "true" — прочие значения авторизацию сохраняют', async () => {
    process.env.ADMIN_AUTH_DISABLED = '1';
    expect((await middleware(req('/api/funnels/7', { method: 'DELETE' }))).status).toBe(401);
  });
});

describe('PUBLIC_READ_ENABLED=false', () => {
  it('возвращает прежнюю модель — всё под авторизацией', async () => {
    process.env.PUBLIC_READ_ENABLED = 'false';
    expect((await middleware(req('/'))).status).toBe(307);
    expect((await middleware(req('/api/funnels'))).status).toBe(401);
    // Редактора это не касается.
    expect((await middleware(req('/', { cookie: await session() }))).status).toBe(200);
  });
});
