/**
 * Тесты роутов входа и второго рубежа (`requireEditor` в обработчиках).
 *
 * Второй рубеж проверяется отдельно от мидлвары намеренно: он и существует на
 * случай, когда мидлвара до запроса не доехала — сломанный `matcher`, прямой
 * вызов обработчика. Тест, который дошёл бы только через мидлвару, эту дыру бы
 * не увидел.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { POST as loginPOST } from '../src/app/api/auth/login/route';
import { POST as logoutPOST } from '../src/app/api/auth/logout/route';
import { LOGIN_MAX_ATTEMPTS, SESSION_COOKIE, signSession } from '../src/lib/auth';
import { readCookie } from '../src/lib/auth-server';

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

beforeEach(() => {
  for (const k of KEYS) ORIGINAL[k] = process.env[k];
  process.env.ADMIN_USERS = 'sergei:s3cret,маша:пароль€';
  process.env.ADMIN_SESSION_SECRET = SECRET;
  delete process.env.ADMIN_BASIC_AUTH;
  delete process.env.ADMIN_AUTH_DISABLED;
  delete process.env.PUBLIC_READ_ENABLED;
  setNodeEnv('production');
  // Счётчик попыток живёт на globalThis и переживает тесты — чистим.
  (globalThis as Record<symbol, unknown>)[Symbol.for('ksamata.loginAttempts')] = new Map();
});

afterEach(() => {
  for (const k of KEYS) {
    if (ORIGINAL[k] === undefined) delete process.env[k];
    else process.env[k] = ORIGINAL[k];
  }
  setNodeEnv(ORIGINAL_NODE_ENV);
});

function loginReq(body: unknown, headers: Record<string, string> = {}) {
  return new Request('http://admin.example/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', host: 'admin.example', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }) as never;
}

/** Значение Set-Cookie нужного нам имени. */
function setCookie(res: Response): string | null {
  const raw = res.headers.get('set-cookie');
  if (!raw) return null;
  const m = raw.match(new RegExp(`${SESSION_COOKIE}=([^;]*)`));
  return m ? m[1] : null;
}

describe('POST /api/auth/login', () => {
  it('выдаёт подписанную cookie на верную пару', async () => {
    const res = await loginPOST(loginReq({ user: 'sergei', password: 's3cret' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ user: 'sergei' });

    const token = setCookie(res);
    expect(token).toBeTruthy();
    const raw = res.headers.get('set-cookie')!;
    // HttpOnly — чтобы токен не читался из JS; Lax — основная защита от CSRF;
    // Secure в проде — чтобы cookie не уехала по http.
    expect(raw).toContain('HttpOnly');
    expect(raw.toLowerCase()).toContain('samesite=lax');
    expect(raw).toContain('Secure');
    expect(raw).toContain('Path=/');
  });

  it('принимает не-ASCII имя и пароль', async () => {
    const res = await loginPOST(loginReq({ user: 'маша', password: 'пароль€' }));
    expect(res.status).toBe(200);
  });

  it('на неверный пароль и на несуществующее имя отвечает одинаково', async () => {
    // Иначе форма превращается в перечислитель учёток.
    const wrongPass = await loginPOST(loginReq({ user: 'sergei', password: 'nope' }));
    const noUser = await loginPOST(loginReq({ user: 'нет-такого', password: 'nope' }));
    expect(wrongPass.status).toBe(401);
    expect(noUser.status).toBe(401);
    expect(await wrongPass.json()).toEqual(await noUser.json());
    expect(setCookie(wrongPass)).toBeNull();
  });

  it('отвергает мусорное тело и неполные данные', async () => {
    expect((await loginPOST(loginReq('не-json'))).status).toBe(400);
    expect((await loginPOST(loginReq({ user: 'sergei' }))).status).toBe(400);
    expect((await loginPOST(loginReq({ user: '', password: 'x' }))).status).toBe(400);
    expect((await loginPOST(loginReq({ user: 1, password: 2 }))).status).toBe(400);
  });

  it('без настроенной авторизации отвечает 503, а не пускает', async () => {
    delete process.env.ADMIN_SESSION_SECRET;
    const res = await loginPOST(loginReq({ user: 'sergei', password: 's3cret' }));
    expect(res.status).toBe(503);
  });

  it('блокирует перебор после LOGIN_MAX_ATTEMPTS и отпускает после верного входа', async () => {
    const headers = { 'x-forwarded-for': '10.1.2.3' };
    for (let i = 0; i < LOGIN_MAX_ATTEMPTS; i++) {
      await loginPOST(loginReq({ user: 'sergei', password: 'nope' }, headers));
    }
    const blocked = await loginPOST(loginReq({ user: 'sergei', password: 'nope' }, headers));
    expect(blocked.status).toBe(429);
    // Даже верный пароль в окне блокировки не проходит.
    expect((await loginPOST(loginReq({ user: 'sergei', password: 's3cret' }, headers))).status).toBe(429);

    // Другой адрес не задет.
    const other = await loginPOST(loginReq({ user: 'sergei', password: 's3cret' }, { 'x-forwarded-for': '10.9.9.9' }));
    expect(other.status).toBe(200);
  });

  it('успешный вход обнуляет счётчик неудач', async () => {
    // Иначе редкие описки копились бы неделями и однажды заперли живого человека.
    const headers = { 'x-forwarded-for': '10.2.2.2' };
    for (let i = 0; i < LOGIN_MAX_ATTEMPTS - 1; i++) {
      await loginPOST(loginReq({ user: 'sergei', password: 'nope' }, headers));
    }
    expect((await loginPOST(loginReq({ user: 'sergei', password: 's3cret' }, headers))).status).toBe(200);
    for (let i = 0; i < LOGIN_MAX_ATTEMPTS - 1; i++) {
      expect((await loginPOST(loginReq({ user: 'sergei', password: 'nope' }, headers))).status).toBe(401);
    }
  });
});

describe('POST /api/auth/logout', () => {
  it('гасит cookie сессии', async () => {
    const res = await logoutPOST();
    expect(res.status).toBe(200);
    const raw = res.headers.get('set-cookie')!;
    expect(raw).toContain(`${SESSION_COOKIE}=`);
    expect(raw).toMatch(/Max-Age=0|Expires=/i);
  });
});

describe('readCookie', () => {
  it('достаёт значение среди прочих cookie', () => {
    expect(readCookie(`a=1; ${SESSION_COOKIE}=tok; b=2`, SESSION_COOKIE)).toBe('tok');
    expect(readCookie('a=1', SESSION_COOKIE)).toBeNull();
    expect(readCookie(null, SESSION_COOKIE)).toBeNull();
  });
});

describe('второй рубеж: requireEditor в обработчиках', () => {
  // Роуты дёргаются напрямую, минуя мидлвару, — как если бы её matcher поехал.
  //
  // БД подменена заглушкой: проверяется отказ ДО обращения к данным, и настоящая
  // фикстура тут только замедляла бы тест. Разрешённый запрос до БД доходит и
  // законно падает в 500 — это дело тестов самого роута.
  beforeEach(() => {
    vi.resetModules();
    vi.doMock('@/db/client', () => ({ db: {} }));
  });
  afterEach(() => {
    vi.doUnmock('@/db/client');
    vi.resetModules();
  });

  function apiReq(path: string, method: string, cookie?: string) {
    const headers: Record<string, string> = { host: 'admin.example', 'Content-Type': 'application/json' };
    if (cookie) headers.cookie = `${SESSION_COOKIE}=${cookie}`;
    return new Request(`http://admin.example${path}`, {
      method,
      headers,
      body: method === 'GET' ? undefined : '{}',
    }) as never;
  }

  async function session(user = 'sergei') {
    return signSession({ u: user, exp: Math.floor(Date.now() / 1000) + 3600 }, SECRET);
  }

  it('закрывает запись анониму', async () => {
    const { POST } = await import('../src/app/api/funnels/draft/route');
    const res = await POST(apiReq('/api/funnels/draft', 'POST'));
    expect(res.status).toBe(401);
  });

  it('закрывает анониму чтение приватного API', async () => {
    const { GET } = await import('../src/app/api/export/route');
    expect((await GET(apiReq('/api/export', 'GET'))).status).toBe(401);

    const { GET: templatesGET } = await import('../src/app/api/tag-templates/route');
    expect((await templatesGET(apiReq('/api/tag-templates', 'GET'))).status).toBe(401);
  });

  it('открывает то же самое редактору с сессией', async () => {
    const { GET } = await import('../src/app/api/tag-templates/route');
    const res = await GET(apiReq('/api/tag-templates', 'GET', await session()));
    // Не 401/403/503 — дальше роут работает со своей БД, это дело других тестов.
    expect([200, 500]).toContain(res.status);
  });

  it('удалённый пользователь теряет доступ сразу, не дожидаясь истечения токена', async () => {
    const token = await signSession(
      { u: 'уволен', exp: Math.floor(Date.now() / 1000) + 3600 },
      SECRET
    );
    const { GET } = await import('../src/app/api/export/route');
    expect((await GET(apiReq('/api/export', 'GET', token))).status).toBe(401);
  });
});
