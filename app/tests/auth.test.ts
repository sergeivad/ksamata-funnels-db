/**
 * Тесты ядра авторизации: разбор учёток, подпись сессии и решение о доступе.
 *
 * `resolveAccess` проверяется таблицей «путь × метод × credential» — это и есть
 * контракт «читают все, пишут свои», и он не должен зависеть от того, как Next
 * строит запросы.
 */
import { describe, it, expect } from 'vitest';
import {
  LOGIN_MAX_ATTEMPTS,
  SESSION_TTL_SECONDS,
  canEditFrom,
  configuredUsers,
  isAllowed,
  isKillSwitchIgnored,
  isLoginBlocked,
  isPublicReadPath,
  isSafeMethod,
  parseUsers,
  registerFailedLogin,
  resolveAccess,
  resolveSessionSecret,
  resolveSessionUser,
  signSession,
  userFromBasicHeader,
  verifyPassword,
  verifySessionToken,
  type AccessRequest,
  type AuthEnv,
  type LoginAttempt,
} from '../src/lib/auth';

const SECRET = 'a-secret-long-enough-to-count';
const NOW = 1_800_000_000;

// Полный запрос по умолчанию — аноним, GET на список воронок.
function reqOf(over: Partial<AccessRequest> = {}): AccessRequest {
  return {
    method: 'GET',
    pathname: '/',
    sessionUser: null,
    authHeader: null,
    origin: null,
    host: 'admin.example',
    ...over,
  };
}

// Настроенное продовое окружение — самый интересный случай.
const PROD: AuthEnv = {
  ADMIN_USERS: 'sergei:s3cret',
  ADMIN_SESSION_SECRET: SECRET,
  NODE_ENV: 'production',
};

const basic = (u: string, p: string) => `Basic ${Buffer.from(`${u}:${p}`).toString('base64')}`;

describe('parseUsers', () => {
  it('разбирает пары через запятую и перевод строки', () => {
    expect(parseUsers('a:1,b:2')).toEqual([
      { name: 'a', password: '1' },
      { name: 'b', password: '2' },
    ]);
    expect(parseUsers('a:1\nb:2')).toEqual([
      { name: 'a', password: '1' },
      { name: 'b', password: '2' },
    ]);
  });

  it('делит по первому двоеточию — пароль может его содержать', () => {
    expect(parseUsers('a:pa:ss')).toEqual([{ name: 'a', password: 'pa:ss' }]);
  });

  it('пропускает мусор, не роняя остальные записи', () => {
    // Одна опечатка в длинной строке не должна лишать доступа всех.
    expect(parseUsers('нет-двоеточия,a:1,:пустое-имя,b:,  , c : 2 ')).toEqual([
      { name: 'a', password: '1' },
      // Запись обрезается целиком (иначе список в несколько строк ловил бы
      // отступы), поэтому крайние пробелы пароля теряются — задокументировано
      // в .env.example как «пароль не должен начинаться и кончаться пробелом».
      { name: 'c', password: ' 2' },
    ]);
  });

  it('первая запись выигрывает у дубля имени', () => {
    expect(parseUsers('a:первый,a:второй')).toEqual([{ name: 'a', password: 'первый' }]);
  });

  it('пустое значение — пустой список', () => {
    expect(parseUsers(undefined)).toEqual([]);
    expect(parseUsers('')).toEqual([]);
  });

  it('поддерживает не-ASCII имена и пароли', () => {
    expect(parseUsers('админ:пароль€')).toEqual([{ name: 'админ', password: 'пароль€' }]);
  });
});

describe('configuredUsers', () => {
  it('добавляет ADMIN_BASIC_AUTH как ещё одну учётку — совместимость со скриптами', () => {
    const users = configuredUsers({ ADMIN_USERS: 'a:1', ADMIN_BASIC_AUTH: 'legacy:2' });
    expect(users).toEqual([
      { name: 'a', password: '1' },
      { name: 'legacy', password: '2' },
    ]);
  });

  it('не переопределяет пароль уже заведённого имени', () => {
    const users = configuredUsers({ ADMIN_USERS: 'a:новый', ADMIN_BASIC_AUTH: 'a:старый' });
    expect(users).toEqual([{ name: 'a', password: 'новый' }]);
  });
});

describe('verifyPassword / userFromBasicHeader', () => {
  const users = parseUsers('sergei:s3cret,админ:пароль€');

  it('пускает по верной паре и отвергает неверную', () => {
    expect(verifyPassword(users, 'sergei', 's3cret')?.name).toBe('sergei');
    expect(verifyPassword(users, 'sergei', 'wrong')).toBeNull();
    expect(verifyPassword(users, 'нет-такого', 's3cret')).toBeNull();
  });

  it('разбирает заголовок Basic в любом регистре схемы (RFC 7235)', () => {
    const cred = basic('sergei', 's3cret').slice(6);
    for (const scheme of ['Basic', 'basic', 'BASIC', 'BaSiC']) {
      expect(userFromBasicHeader(users, `${scheme} ${cred}`)?.name).toBe('sergei');
    }
  });

  it('не путает Bearer с Basic и переживает битый base64', () => {
    const cred = basic('sergei', 's3cret').slice(6);
    expect(userFromBasicHeader(users, `Bearer ${cred}`)).toBeNull();
    expect(userFromBasicHeader(users, 'Basic @@@не-base64@@@')).toBeNull();
    expect(userFromBasicHeader(users, null)).toBeNull();
  });

  it('принимает не-ASCII пароль (UTF-8, а не Latin1)', () => {
    expect(userFromBasicHeader(users, basic('админ', 'пароль€'))?.name).toBe('админ');
    expect(userFromBasicHeader(users, basic('админ', 'пароль'))).toBeNull();
  });
});

describe('resolveSessionSecret', () => {
  it('берёт заданный секрет достаточной длины', () => {
    expect(resolveSessionSecret({ ADMIN_SESSION_SECRET: SECRET, NODE_ENV: 'production' })).toBe(SECRET);
  });

  it('в проде короткий или пустой секрет — это отсутствие секрета', () => {
    // Подпись слабым ключом — подделываемая сессия, то есть право записи всем.
    expect(resolveSessionSecret({ ADMIN_SESSION_SECRET: 'коротко', NODE_ENV: 'production' })).toBeNull();
    expect(resolveSessionSecret({ ADMIN_SESSION_SECRET: '', NODE_ENV: 'production' })).toBeNull();
    expect(resolveSessionSecret({ NODE_ENV: 'production' })).toBeNull();
  });

  it('вне прода выводит секрет из учёток — локально ничего настраивать не нужно', () => {
    const secret = resolveSessionSecret({ ADMIN_USERS: 'a:1', NODE_ENV: 'development' });
    expect(typeof secret).toBe('string');
    expect(secret).not.toBe('');
    // Смена пароля меняет секрет, то есть инвалидирует выданные сессии.
    expect(resolveSessionSecret({ ADMIN_USERS: 'a:2', NODE_ENV: 'development' })).not.toBe(secret);
  });
});

describe('токен сессии', () => {
  it('подписывает и проверяет свою же полезную нагрузку', async () => {
    const token = await signSession({ u: 'sergei', exp: NOW + 100 }, SECRET);
    expect(await verifySessionToken(token, SECRET, NOW)).toEqual({ u: 'sergei', exp: NOW + 100 });
  });

  it('отвергает подменённую полезную нагрузку', async () => {
    const token = await signSession({ u: 'sergei', exp: NOW + 100 }, SECRET);
    const [ver, , sig] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ u: 'админ', exp: NOW + 100 }))
      .toString('base64url');
    expect(await verifySessionToken(`${ver}.${forged}.${sig}`, SECRET, NOW)).toBeNull();
  });

  it('отвергает чужой секрет, просроченный токен и мусор', async () => {
    const token = await signSession({ u: 'sergei', exp: NOW + 100 }, SECRET);
    expect(await verifySessionToken(token, 'другой-секрет-достаточной-длины', NOW)).toBeNull();

    const expired = await signSession({ u: 'sergei', exp: NOW - 1 }, SECRET);
    expect(await verifySessionToken(expired, SECRET, NOW)).toBeNull();

    for (const bad of [null, undefined, '', 'мусор', 'v1.только.две', 'v2.a.b']) {
      expect(await verifySessionToken(bad, SECRET, NOW)).toBeNull();
    }
  });

  it('отвергает верно подписанную, но бессмысленную нагрузку', async () => {
    // Подпись подтверждает происхождение, а не структуру: пустое имя и
    // отсутствующий срок обязаны отсекаться после проверки HMAC.
    const bad = await signSession({ u: '', exp: NOW + 100 } as never, SECRET);
    expect(await verifySessionToken(bad, SECRET, NOW)).toBeNull();
    const noExp = await signSession({ u: 'sergei' } as never, SECRET);
    expect(await verifySessionToken(noExp, SECRET, NOW)).toBeNull();
  });

  it('срок жизни — 30 дней', () => {
    expect(SESSION_TTL_SECONDS).toBe(30 * 24 * 60 * 60);
  });
});

describe('resolveSessionUser', () => {
  it('возвращает имя по валидному токену', async () => {
    const token = await signSession({ u: 'sergei', exp: NOW + 100 }, SECRET);
    expect(await resolveSessionUser(PROD, token, NOW)).toBe('sergei');
  });

  it('отзывает доступ, если пользователя убрали из ADMIN_USERS', async () => {
    // Иначе удалённый сотрудник ходил бы ещё месяц — до истечения токена.
    const token = await signSession({ u: 'уволен', exp: NOW + 100 }, SECRET);
    expect(await resolveSessionUser(PROD, token, NOW)).toBeNull();
  });

  it('без секрета в проде сессии не существует', async () => {
    const token = await signSession({ u: 'sergei', exp: NOW + 100 }, SECRET);
    expect(await resolveSessionUser({ ...PROD, ADMIN_SESSION_SECRET: undefined }, token, NOW)).toBeNull();
  });
});

describe('isPublicReadPath', () => {
  it('открывает список воронок, карточку и нужные им GET-и API', () => {
    for (const p of [
      '/', '/funnels/12', '/funnels/12/',
      '/api/funnels', '/api/funnels/12',
      '/api/funnels/12/days', '/api/funnels/12/blocks/landings',
      '/robots.txt',
    ]) {
      expect(isPublicReadPath(p), p).toBe(true);
    }
  });

  it('оставляет закрытым всё, что не про воронки', () => {
    // Экспорт отдаёт всю базу одним файлом; справочники, шаблон и мониторинг —
    // внутренняя кухня. Новый роут по умолчанию тоже закрыт: список белый.
    for (const p of [
      '/refs', '/tags', '/monitoring',
      '/api/refs/products', '/api/tag-templates', '/api/export',
      '/api/monitoring', '/api/monitoring/events',
      '/api/funnels/draft', '/api/funnels/12/duplicate', '/api/funnels/12/tags',
      '/funnels/abc', '/api/funnels/abc',
    ]) {
      expect(isPublicReadPath(p), p).toBe(false);
    }
  });
});

describe('isSafeMethod', () => {
  it('безопасны только GET/HEAD/OPTIONS', () => {
    expect(['GET', 'get', 'HEAD', 'OPTIONS'].every(isSafeMethod)).toBe(true);
    expect(['POST', 'PATCH', 'PUT', 'DELETE'].some(isSafeMethod)).toBe(false);
  });
});

describe('resolveAccess — публичное чтение', () => {
  it('пускает анонима на список и карточку', () => {
    expect(resolveAccess(PROD, reqOf({ pathname: '/' })).decision).toBe('allow');
    expect(resolveAccess(PROD, reqOf({ pathname: '/funnels/7' })).decision).toBe('allow');
    expect(resolveAccess(PROD, reqOf({ pathname: '/api/funnels' })).decision).toBe('allow');
  });

  it('уводит анонима с закрытой страницы на форму входа', () => {
    for (const p of ['/refs', '/tags', '/monitoring']) {
      expect(resolveAccess(PROD, reqOf({ pathname: p })).decision).toBe('redirect-login');
    }
  });

  it('на закрытый API отвечает 401, а не редиректом', () => {
    // Редирект в ответ на fetch вернул бы HTML вместо JSON — экран «сломался»
    // бы молча, вместо честной ошибки.
    for (const p of ['/api/refs/products', '/api/export', '/api/monitoring']) {
      expect(resolveAccess(PROD, reqOf({ pathname: p })).decision).toBe('unauthorized');
    }
  });

  it('PUBLIC_READ_ENABLED=false закрывает и чтение тоже', () => {
    const env = { ...PROD, PUBLIC_READ_ENABLED: 'false' };
    expect(resolveAccess(env, reqOf({ pathname: '/' })).decision).toBe('redirect-login');
    expect(resolveAccess(env, reqOf({ pathname: '/api/funnels' })).decision).toBe('unauthorized');
    // Любое другое значение оставляет чтение открытым — как MONITOR_ENABLED.
    expect(resolveAccess({ ...PROD, PUBLIC_READ_ENABLED: 'no' }, reqOf()).decision).toBe('allow');
  });
});

describe('resolveAccess — запись', () => {
  it('аноним не пишет даже туда, что читает', () => {
    expect(resolveAccess(PROD, reqOf({ method: 'PATCH', pathname: '/api/funnels/7' })).decision)
      .toBe('unauthorized');
    expect(resolveAccess(PROD, reqOf({ method: 'POST', pathname: '/api/funnels' })).decision)
      .toBe('unauthorized');
  });

  it('редактор по сессии пишет', () => {
    const res = resolveAccess(PROD, reqOf({ method: 'PATCH', pathname: '/api/funnels/7', sessionUser: 'sergei' }));
    expect(res.decision).toBe('allow');
    expect(res.user).toBe('sergei');
    expect(canEditFrom(res)).toBe(true);
  });

  it('редактор по Basic пишет — ключ для curl и скриптов', () => {
    const res = resolveAccess(PROD, reqOf({
      method: 'POST', pathname: '/api/funnels', authHeader: basic('sergei', 's3cret'),
    }));
    expect(res.decision).toBe('allow');
    expect(res.user).toBe('sergei');
  });

  it('неверный Basic — это аноним, а не ошибка', () => {
    expect(resolveAccess(PROD, reqOf({
      method: 'POST', pathname: '/api/funnels', authHeader: basic('sergei', 'wrong'),
    })).decision).toBe('unauthorized');
  });
});

describe('resolveAccess — проверка Origin', () => {
  it('отвергает запись с чужого Origin даже с валидной сессией', () => {
    // Именно этот случай и есть CSRF: cookie приезжает своя, источник чужой.
    const res = resolveAccess(PROD, reqOf({
      method: 'POST', pathname: '/api/funnels',
      sessionUser: 'sergei', origin: 'https://evil.example', host: 'admin.example',
    }));
    expect(res.decision).toBe('forbidden-origin');
    expect(canEditFrom(res)).toBe(false);
  });

  it('пропускает запись со своего Origin', () => {
    expect(resolveAccess(PROD, reqOf({
      method: 'POST', pathname: '/api/funnels',
      sessionUser: 'sergei', origin: 'https://admin.example', host: 'admin.example',
    })).decision).toBe('allow');
  });

  it('не требует Origin вовсе — его не шлют curl и скрипты', () => {
    expect(resolveAccess(PROD, reqOf({
      method: 'POST', pathname: '/api/funnels', authHeader: basic('sergei', 's3cret'), origin: null,
    })).decision).toBe('allow');
  });

  it('битый Origin и отсутствующий Host считаются чужими', () => {
    expect(resolveAccess(PROD, reqOf({
      method: 'POST', pathname: '/api/funnels', sessionUser: 'sergei', origin: 'не-url',
    })).decision).toBe('forbidden-origin');
    expect(resolveAccess(PROD, reqOf({
      method: 'POST', pathname: '/api/funnels', sessionUser: 'sergei',
      origin: 'https://admin.example', host: null,
    })).decision).toBe('forbidden-origin');
  });

  it('чтение с чужого Origin не трогаем — GET ничего не меняет', () => {
    expect(resolveAccess(PROD, reqOf({ origin: 'https://evil.example' })).decision).toBe('allow');
  });
});

describe('resolveAccess — точки входа', () => {
  it('форма входа и её роуты доступны анониму, включая POST', () => {
    for (const p of ['/login', '/api/auth/login', '/api/auth/logout']) {
      expect(resolveAccess(PROD, reqOf({ pathname: p })).decision).toBe('allow');
      expect(resolveAccess(PROD, reqOf({ method: 'POST', pathname: p })).decision).toBe('allow');
    }
  });

  it('но и они подчиняются проверке Origin', () => {
    expect(resolveAccess(PROD, reqOf({
      method: 'POST', pathname: '/api/auth/login', origin: 'https://evil.example',
    })).decision).toBe('forbidden-origin');
  });
});

describe('resolveAccess — ненастроенное окружение', () => {
  it('вне прода без учёток открыто всё — локальная разработка и тесты', () => {
    const res = resolveAccess({ NODE_ENV: 'test' }, reqOf({ method: 'POST', pathname: '/api/funnels' }));
    expect(res.decision).toBe('open');
    expect(isAllowed(res.decision)).toBe(true);
    expect(canEditFrom(res)).toBe(true);
  });

  it('в проде без учёток читать можно, писать нельзя', () => {
    // Забытая переменная не должна означать админку, открытую на запись.
    const env: AuthEnv = { NODE_ENV: 'production' };
    expect(resolveAccess(env, reqOf({ pathname: '/' })).decision).toBe('allow');
    expect(resolveAccess(env, reqOf({ method: 'POST', pathname: '/api/funnels' })).decision)
      .toBe('misconfigured');
  });

  it('в проде с учётками, но без секрета — то же самое: войти нечем', () => {
    const env: AuthEnv = { ADMIN_USERS: 'a:1', NODE_ENV: 'production' };
    expect(resolveAccess(env, reqOf({ method: 'POST', pathname: '/api/funnels' })).decision)
      .toBe('misconfigured');
  });

  it('kill-switch вне прода по-прежнему открывает всё — регрессия сохраняется намеренно', () => {
    // Единственное окружение, где кто-то мог реально полагаться на старое
    // поведение kill-switch, — локальная разработка и dev-стек, и там оно
    // не меняется ни на грамм.
    const env: AuthEnv = { ...PROD, NODE_ENV: 'development', ADMIN_AUTH_DISABLED: 'true' };
    const res = resolveAccess(env, reqOf({ method: 'DELETE', pathname: '/api/funnels/7' }));
    expect(res.decision).toBe('disabled');
    expect(canEditFrom(res)).toBe(true);
  });

  it('в проде kill-switch с заданными учётками игнорируется: чтение allow, запись анониму unauthorized', () => {
    // Это ровно баг, который чинит эта правка: переменную поставили на боевом
    // сервере «на время» и забыли на полтора месяца — сервис был публично
    // РЕДАКТИРУЕМЫМ всё это время, потому что kill-switch стоял в решении
    // раньше учёток. Теперь в проде эта строка ни на что не влияет: решение
    // считается дальше как будто переменной нет вообще.
    const env: AuthEnv = { ...PROD, ADMIN_AUTH_DISABLED: 'true' };
    expect(resolveAccess(env, reqOf({ pathname: '/' })).decision).toBe('allow');
    const write = resolveAccess(env, reqOf({ method: 'DELETE', pathname: '/api/funnels/7' }));
    expect(write.decision).toBe('unauthorized');
    expect(canEditFrom(write)).toBe(false);
  });

  it('в проде kill-switch без учёток игнорируется: чтение allow, запись misconfigured (503)', () => {
    const env: AuthEnv = { NODE_ENV: 'production', ADMIN_AUTH_DISABLED: 'true' };
    expect(resolveAccess(env, reqOf({ pathname: '/' })).decision).toBe('allow');
    expect(resolveAccess(env, reqOf({ method: 'POST', pathname: '/api/funnels' })).decision)
      .toBe('misconfigured');
  });

  it('в проде kill-switch игнорируется, но редактор по сессии и по Basic всё равно проходит', () => {
    const env: AuthEnv = { ...PROD, ADMIN_AUTH_DISABLED: 'true' };

    const bySession = resolveAccess(env, reqOf({
      method: 'PATCH', pathname: '/api/funnels/7', sessionUser: 'sergei',
    }));
    expect(bySession.decision).toBe('allow');
    expect(bySession.user).toBe('sergei');

    const byBasic = resolveAccess(env, reqOf({
      method: 'PATCH', pathname: '/api/funnels/7', authHeader: basic('sergei', 's3cret'),
    }));
    expect(byBasic.decision).toBe('allow');
    expect(byBasic.user).toBe('sergei');
  });

  it('выключает ровно строка "true" — описка админку не открывает', () => {
    for (const value of ['1', 'false', 'TRUE', 'yes']) {
      expect(resolveAccess({ ...PROD, ADMIN_AUTH_DISABLED: value },
        reqOf({ method: 'DELETE', pathname: '/api/funnels/7' })).decision).toBe('unauthorized');
    }
  });
});

describe('isKillSwitchIgnored', () => {
  it('таблица прод/не-прод × задана/не задана', () => {
    expect(isKillSwitchIgnored({ NODE_ENV: 'production', ADMIN_AUTH_DISABLED: 'true' })).toBe(true);
    expect(isKillSwitchIgnored({ NODE_ENV: 'production' })).toBe(false);
    expect(isKillSwitchIgnored({ NODE_ENV: 'development', ADMIN_AUTH_DISABLED: 'true' })).toBe(false);
    expect(isKillSwitchIgnored({ NODE_ENV: 'development' })).toBe(false);
    expect(isKillSwitchIgnored({})).toBe(false);
    // Не ровно "true" — не считается включённым, даже в проде.
    expect(isKillSwitchIgnored({ NODE_ENV: 'production', ADMIN_AUTH_DISABLED: '1' })).toBe(false);
  });
});

describe('ограничение попыток входа', () => {
  it('блокирует после LOGIN_MAX_ATTEMPTS неудач', () => {
    const store = new Map<string, LoginAttempt>();
    for (let i = 0; i < LOGIN_MAX_ATTEMPTS - 1; i++) registerFailedLogin(store, 'ip|a', NOW);
    expect(isLoginBlocked(store, 'ip|a', NOW)).toBe(false);
    registerFailedLogin(store, 'ip|a', NOW);
    expect(isLoginBlocked(store, 'ip|a', NOW)).toBe(true);
  });

  it('считает ключи независимо', () => {
    const store = new Map<string, LoginAttempt>();
    for (let i = 0; i < LOGIN_MAX_ATTEMPTS; i++) registerFailedLogin(store, 'ip|a', NOW);
    expect(isLoginBlocked(store, 'ip|b', NOW)).toBe(false);
  });

  it('окно истекает', () => {
    const store = new Map<string, LoginAttempt>();
    for (let i = 0; i < LOGIN_MAX_ATTEMPTS; i++) registerFailedLogin(store, 'ip|a', NOW);
    const { resetAt } = store.get('ip|a')!;
    expect(isLoginBlocked(store, 'ip|a', resetAt)).toBe(false);
    // После истечения счёт начинается заново, а не продолжается.
    expect(registerFailedLogin(store, 'ip|a', resetAt).count).toBe(1);
  });
});
