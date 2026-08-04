/**
 * Ядро авторизации: разбор учёток, подпись сессии и решение о доступе.
 *
 * Модель доступа — «читают все, пишут свои»:
 *  - список воронок и карточки воронок открыты анонимно (GET);
 *  - справочники, теги, мониторинг и экспорт — только редактору;
 *  - любой не-GET куда угодно — только редактору.
 *
 * Файл чистый и Edge-безопасный: ни `node:*`, ни `next/headers`, ни обращений
 * к БД. Мидлвара компилируется Edge-компилятором, а те же функции вызываются
 * из Node-роутов — одна реализация на оба рантайма, иначе два рубежа защиты
 * неизбежно разъедутся. Всё, что требует Node, живёт в `auth-server.ts`.
 */

// ── Учётки ───────────────────────────────────────────────────────────────────

export interface AuthUser {
  name: string;
  password: string;
}

export interface AuthEnv {
  ADMIN_USERS?: string;
  ADMIN_BASIC_AUTH?: string;
  ADMIN_SESSION_SECRET?: string;
  ADMIN_AUTH_DISABLED?: string;
  PUBLIC_READ_ENABLED?: string;
  NODE_ENV?: string;
}

/**
 * Разбирает `ADMIN_USERS` — пары `имя:пароль`, разделённые переводом строки
 * или запятой. Делится по ПЕРВОМУ двоеточию: двоеточие внутри пароля законно,
 * внутри имени — нет. Запятая и перенос строки в пароле невозможны by design
 * (это разделители записей); такой пароль просто обрежется, поэтому формат
 * задокументирован в `.env.example`.
 *
 * Мусорные записи пропускаются молча, а не роняют разбор: одна опечатка в
 * длинной строке не должна лишать доступа всех остальных. Совсем пустой
 * результат вызывающая сторона трактует как «авторизация не настроена».
 */
export function parseUsers(value: string | undefined): AuthUser[] {
  if (typeof value !== 'string' || value.length === 0) return [];

  const out: AuthUser[] = [];
  const seen = new Set<string>();

  for (const rawEntry of value.split(/[\n,]/)) {
    const entry = rawEntry.trim();
    if (entry.length === 0) continue;

    const sep = entry.indexOf(':');
    if (sep <= 0) continue; // нет разделителя или пустое имя

    const name = entry.slice(0, sep).trim();
    const password = entry.slice(sep + 1);
    if (name.length === 0 || password.length === 0) continue;

    // Первая запись выигрывает: тихо переопределить пароль уже заведённого
    // имени второй строкой — худший из возможных сюрпризов.
    if (seen.has(name)) continue;
    seen.add(name);
    out.push({ name, password });
  }

  return out;
}

/**
 * Все учётки, которыми можно править: `ADMIN_USERS` плюс — ради совместимости —
 * одиночная пара из `ADMIN_BASIC_AUTH`. Старая переменная больше ничего не
 * закрывает (чтение теперь публично), но продолжает работать как ключ для
 * curl и скриптов, у которых она прописана.
 */
export function configuredUsers(env: AuthEnv): AuthUser[] {
  const users = parseUsers(env.ADMIN_USERS);
  const legacy = parseUsers(env.ADMIN_BASIC_AUTH);
  for (const u of legacy) {
    if (!users.some((x) => x.name === u.name)) users.push(u);
  }
  return users;
}

/** Сравнение без ранней остановки — не выдаёт таймингом длину совпавшего префикса. */
export function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}

/**
 * Проверка пары имя/пароль. Перебирает ВЕСЬ список даже после совпадения, и
 * для каждой учётки сравнивает ОБА поля без короткого замыкания `&&` между
 * ними: `timingSafeEqual(name) && timingSafeEqual(password)` вернулось бы
 * сразу на несовпавшем имени, вообще не трогая пароль, — и по времени ответа
 * стало бы видно, существует ли такое имя.
 */
export function verifyPassword(users: AuthUser[], name: string, password: string): AuthUser | null {
  let found: AuthUser | null = null;
  for (const u of users) {
    const nameOk = timingSafeEqual(u.name, name);
    const passwordOk = timingSafeEqual(u.password, password);
    if (nameOk && passwordOk && found === null) found = u;
  }
  return found;
}

/** Декодирование base64 как UTF-8 (без Buffer — Edge). */
function decodeBase64Utf8(b64: string): string {
  const binary = atob(b64);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder('utf-8').decode(bytes);
}

/**
 * Разбирает заголовок `Authorization: Basic` в имя/пароль, НЕ проверяя пару
 * против списка учёток. Нужен отдельно от `userFromBasicHeader`, потому что
 * ключ счётчика неудачных попыток (см. `login-attempts.ts`) строится из имени
 * ещё до того, как известно, совпал ли пароль, — а `verifyPassword` в случае
 * неудачи такого имени вообще не отдаёт.
 *
 * Имя схемы регистронезависимо (RFC 7235).
 */
export function parseBasicHeader(header: string | null): { name: string; password: string } | null {
  if (!header || header.slice(0, 6).toLowerCase() !== 'basic ') return null;
  let decoded: string;
  try {
    decoded = decodeBase64Utf8(header.slice(6));
  } catch {
    return null;
  }
  const sep = decoded.indexOf(':');
  if (sep <= 0) return null;
  return { name: decoded.slice(0, sep), password: decoded.slice(sep + 1) };
}

/**
 * Разбирает заголовок `Authorization: Basic` и возвращает совпавшую учётку.
 */
export function userFromBasicHeader(users: AuthUser[], header: string | null): AuthUser | null {
  const parsed = parseBasicHeader(header);
  if (!parsed) return null;
  return verifyPassword(users, parsed.name, parsed.password);
}

// ── Секрет подписи ───────────────────────────────────────────────────────────

/** Ниже этой длины секрет не считается секретом. */
export const MIN_SESSION_SECRET_LENGTH = 16;

/**
 * Секрет для подписи сессии.
 *
 * В проде `ADMIN_SESSION_SECRET` обязателен: подпись слабым или предсказуемым
 * ключом — это подделываемая сессия, то есть право записи для любого. Нет
 * секрета в проде → `null`, и вызывающая сторона отвечает на запись 503
 * (чтение при этом продолжает работать — оно и так публично).
 *
 * Вне прода секрет выводится из самих учёток, чтобы локальная разработка и
 * тесты не требовали ещё одной переменной. Смена пароля инвалидирует выданные
 * сессии — это ровно то поведение, которого от смены пароля и ждут.
 */
export function resolveSessionSecret(env: AuthEnv): string | null {
  const explicit = env.ADMIN_SESSION_SECRET;
  if (typeof explicit === 'string' && explicit.trim().length >= MIN_SESSION_SECRET_LENGTH) {
    return explicit.trim();
  }
  if (env.NODE_ENV === 'production') return null;
  // Разделитель — экранированный \x00, а не сырой байт: сырой NUL внутри
  // шаблонной строки git считает бинарными данными, и весь файл (самый
  // security-критичный в репозитории) перестаёт быть ревьюабельным диффом.
  return `dev-session-secret\x00${env.ADMIN_USERS ?? ''}\x00${env.ADMIN_BASIC_AUTH ?? ''}`;
}

// ── Токен сессии ─────────────────────────────────────────────────────────────

export const SESSION_COOKIE = 'kf_session';
/** Срок жизни сессии — абсолютный, без скользящего продления. */
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

const TOKEN_VERSION = 'v1';

export interface SessionPayload {
  /** Имя пользователя. */
  u: string;
  /** Unix-время истечения, секунды. */
  exp: number;
}

function base64urlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlDecode(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

async function hmac(secret: string, data: string): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  return new Uint8Array(sig);
}

/** Подписывает полезную нагрузку: `v1.<payload>.<hmac>`, обе части base64url. */
export async function signSession(payload: SessionPayload, secret: string): Promise<string> {
  const body = base64urlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const signed = `${TOKEN_VERSION}.${body}`;
  return `${signed}.${base64urlEncode(await hmac(secret, signed))}`;
}

/**
 * Проверяет токен и возвращает полезную нагрузку либо `null`.
 *
 * Подпись сверяется ДО разбора JSON: разбирать неподтверждённые данные —
 * лишняя поверхность. Просроченный токен так же `null`.
 */
export async function verifySessionToken(
  token: string | null | undefined,
  secret: string,
  nowSeconds: number
): Promise<SessionPayload | null> {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== TOKEN_VERSION) return null;

  const signed = `${parts[0]}.${parts[1]}`;
  let expected: string;
  try {
    expected = base64urlEncode(await hmac(secret, signed));
  } catch {
    return null;
  }
  if (!timingSafeEqual(expected, parts[2])) return null;

  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(base64urlDecode(parts[1])));
  } catch {
    return null;
  }
  if (typeof payload !== 'object' || payload === null) return null;

  const { u, exp } = payload as Record<string, unknown>;
  if (typeof u !== 'string' || u.length === 0) return null;
  if (typeof exp !== 'number' || !Number.isFinite(exp) || exp <= nowSeconds) return null;

  return { u, exp };
}

/**
 * Имя редактора по токену — или `null`.
 *
 * Помимо подписи проверяет, что пользователь всё ещё заведён: убрать строку из
 * `ADMIN_USERS` должно отзывать доступ сразу, а не через месяц, когда истечёт
 * ранее выданная сессия.
 */
export async function resolveSessionUser(
  env: AuthEnv,
  token: string | null | undefined,
  nowSeconds: number
): Promise<string | null> {
  const secret = resolveSessionSecret(env);
  if (!secret) return null;
  const payload = await verifySessionToken(token, secret, nowSeconds);
  if (!payload) return null;
  return configuredUsers(env).some((u) => u.name === payload.u) ? payload.u : null;
}

// ── Публичная поверхность ────────────────────────────────────────────────────

/** Методы, не меняющие состояние. */
export function isSafeMethod(method: string): boolean {
  const m = method.toUpperCase();
  return m === 'GET' || m === 'HEAD' || m === 'OPTIONS';
}

/** Точки входа: сами по себе всегда доступны, иначе войти было бы нечем. */
export function isAuthEndpoint(pathname: string): boolean {
  return pathname === '/login' || pathname === '/api/auth/login' || pathname === '/api/auth/logout';
}

const PUBLIC_GET_PATTERNS: RegExp[] = [
  /^\/$/,
  /^\/funnels\/\d+$/,
  // Справка — статический текст без единого обращения к БД. Открыта анониму
  // намеренно: инструкцию кидают ссылкой тому, у кого учётки ещё нет, и
  // редирект на форму входа сделал бы её бесполезной ровно для адресата.
  /^\/help$/,
  /^\/api\/funnels$/,
  /^\/api\/funnels\/\d+$/,
  /^\/api\/funnels\/\d+\/days$/,
  /^\/api\/funnels\/\d+\/blocks\/[a-z_]+$/,
  /^\/robots\.txt$/,
  /^\/favicon\.ico$/,
];

/**
 * Пути, открытые анониму на чтение: ровно список воронок и карточка воронки
 * плюс те GET-и API, без которых они не отрисуются.
 *
 * Перечисление белым списком, а не «всё, кроме»: новый роут по умолчанию
 * оказывается закрытым, и это правильная сторона ошибки. Сюда сознательно НЕ
 * входят `/api/refs` (справочники), `/api/tag-templates`, `/api/monitoring/*`
 * и `/api/export` — последний отдаёт всю базу одним файлом.
 */
export function isPublicReadPath(pathname: string): boolean {
  const path = pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
  return PUBLIC_GET_PATTERNS.some((re) => re.test(path));
}

/** Публичное чтение выключается ровно строкой "false" — как MONITOR_ENABLED. */
export function isPublicReadEnabled(env: AuthEnv): boolean {
  return env.PUBLIC_READ_ENABLED !== 'false';
}

// ── Решение о доступе ────────────────────────────────────────────────────────

export type AccessDecision =
  | 'disabled'         // kill-switch вне прода — авторизации нет вообще, пропускаем всё
  | 'open'             // ничего не настроено, не прод — пропускаем всё (локальная разработка)
  | 'allow'            // разрешено: публичное чтение либо редактор
  | 'redirect-login'   // аноним на закрытой странице — на форму входа
  | 'unauthorized'     // аноним на закрытом API или на записи — 401
  | 'forbidden-origin' // запись с чужого Origin — 403
  | 'misconfigured';   // прод без учёток/секрета — запись отвечает 503

export interface AccessRequest {
  method: string;
  pathname: string;
  /** Имя редактора из проверенной сессии, если она есть. */
  sessionUser: string | null;
  authHeader: string | null;
  origin: string | null;
  host: string | null;
}

export interface AccessResult {
  decision: AccessDecision;
  /** Имя редактора, если запрос авторизован. */
  user: string | null;
}

function originMatchesHost(origin: string, host: string | null): boolean {
  if (!host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/**
 * Игнорируется ли `ADMIN_AUTH_DISABLED=true` в этом окружении.
 *
 * В проде — да, всегда: переменную однажды поставили на боевом сервере «на
 * время», чтобы зайти без пароля, и забыли больше чем на месяц — всё это время
 * kill-switch стоял в решении раньше самих учёток и раньше fail-closed-503
 * прода, поэтому сервис был публично РЕДАКТИРУЕМЫМ, а не только читаемым.
 * Аварии, которую решает поголовное отключение авторизации в проде, не
 * существует: потеряли пароль — задают новый `ADMIN_USERS`; нужно снять
 * защиту чтения — для этого есть `PUBLIC_READ_ENABLED`, не трогающий запись.
 * Поэтому в проде эта переменная теперь ни на что не влияет, а не выключает
 * весь сервис одной опечаткой в конфиге хостинга.
 */
export function isKillSwitchIgnored(env: AuthEnv): boolean {
  return env.ADMIN_AUTH_DISABLED === 'true' && env.NODE_ENV === 'production';
}

/**
 * Чистое решение о доступе: без NextRequest/NextResponse, чтобы проверялось
 * таблицей «путь × метод × credential», а не постройкой запросов Next.
 */
export function resolveAccess(env: AuthEnv, req: AccessRequest): AccessResult {
  // Kill-switch — но не в проде (см. isKillSwitchIgnored выше). Вне прода
  // ветка остаётся как была: выше всего остального, выключает ровно строка
  // "true", чтобы описка не открывала админку локально.
  if (env.ADMIN_AUTH_DISABLED === 'true' && !isKillSwitchIgnored(env)) {
    return { decision: 'disabled', user: null };
  }

  const safe = isSafeMethod(req.method);

  // Проверка Origin — до определения редактора: CSRF-запрос как раз приходит
  // С валидной cookie, поэтому «свой» здесь ничего не доказывает. Отсутствие
  // Origin не блокируем: его не шлют curl и скрипты с Basic, а браузер от
  // кросс-сайтовой записи уже отсечён SameSite=Lax на самой cookie.
  if (!safe && req.origin !== null && !originMatchesHost(req.origin, req.host)) {
    return { decision: 'forbidden-origin', user: null };
  }

  const users = configuredUsers(env);
  const editor = req.sessionUser ?? userFromBasicHeader(users, req.authHeader)?.name ?? null;
  if (editor !== null) {
    return { decision: 'allow', user: editor };
  }

  // Авторизация не настроена: вне прода — открыто (локальная разработка и
  // тесты работают без единой переменной), в проде — читать можно, писать
  // нельзя. Забытая переменная не должна означать админку, открытую на запись.
  const configured = users.length > 0 && resolveSessionSecret(env) !== null;
  if (!configured) {
    if (env.NODE_ENV !== 'production') return { decision: 'open', user: null };
    if (!safe) return { decision: 'misconfigured', user: null };
  }

  // Дальше — аноним. Форма входа и её роуты доступны всегда.
  if (isAuthEndpoint(req.pathname)) {
    return { decision: 'allow', user: null };
  }

  if (!safe) {
    return { decision: 'unauthorized', user: null };
  }

  if (isPublicReadEnabled(env) && isPublicReadPath(req.pathname)) {
    return { decision: 'allow', user: null };
  }

  // Закрытая страница — на форму входа; закрытый API — 401 (редирект в ответ
  // на fetch превратился бы в HTML вместо JSON и «сломанный» экран).
  return {
    decision: req.pathname.startsWith('/api/') ? 'unauthorized' : 'redirect-login',
    user: null,
  };
}

/** Итог решения: доступ разрешён? */
export function isAllowed(decision: AccessDecision): boolean {
  return decision === 'allow' || decision === 'disabled' || decision === 'open';
}

/**
 * Может ли этот запрос править данные. Используется и мидлварой, и вторым
 * рубежом в роутах: одна функция — значит два рубежа не разъедутся.
 */
export function canEditFrom(result: AccessResult): boolean {
  return result.decision === 'disabled' || result.decision === 'open' || result.user !== null;
}

// ── Ограничение попыток входа ────────────────────────────────────────────────

export const LOGIN_MAX_ATTEMPTS = 10;
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;

export interface LoginAttempt {
  count: number;
  resetAt: number;
}

/**
 * Счётчик неудачных входов. Состояние передаётся снаружи (Map живёт на
 * `globalThis` — в продовом бандле модуль дублируется, и module-level `let`
 * молча оказался бы двумя разными счётчиками).
 */
export function registerFailedLogin(
  store: Map<string, LoginAttempt>,
  key: string,
  now: number
): LoginAttempt {
  const current = store.get(key);
  if (!current || current.resetAt <= now) {
    const fresh = { count: 1, resetAt: now + LOGIN_WINDOW_MS };
    store.set(key, fresh);
    return fresh;
  }
  current.count += 1;
  return current;
}

export function isLoginBlocked(
  store: Map<string, LoginAttempt>,
  key: string,
  now: number
): boolean {
  const current = store.get(key);
  if (!current || current.resetAt <= now) return false;
  return current.count >= LOGIN_MAX_ATTEMPTS;
}
