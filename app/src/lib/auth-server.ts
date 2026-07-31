import { cookies, headers } from 'next/headers';
import { NextResponse } from 'next/server';
import {
  LOGIN_MAX_ATTEMPTS,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  canEditFrom,
  parseBasicHeader,
  resolveAccess,
  resolveSessionUser,
  type AccessResult,
} from './auth';
import { attemptKey, clearAttempts, isBlocked, registerFailure } from './login-attempts';

/**
 * Серверная обвязка авторизации: всё, что требует Node/RSC-контекста и потому
 * не может лежать в `auth.ts` (тот компилируется ещё и Edge-компилятором для
 * мидлвары). Решения принимает всё тот же `resolveAccess` — здесь только
 * извлечение запроса и построение ответов.
 */

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export interface Viewer {
  /** Имя редактора или `null` для анонимного посетителя. */
  user: string | null;
  /** Право на изменение данных. */
  canEdit: boolean;
}

/**
 * Общее ядро решения о доступе: токен сессии → `resolveSessionUser` →
 * `resolveAccess`. Источники самих строк (`next/headers` в RSC против
 * `Request` в роуте) остаются разными и передаются уже прочитанными — именно
 * это разное извлечение когда-то и разъехалось: `getViewer` не читал
 * `Authorization` вовсе, а `requireEditor` — читал, и редактор по Basic видел
 * на странице режим просмотра, хотя его запись API уже принимала.
 */
async function resolveAccessFrom(params: {
  cookieToken: string | null;
  authHeader: string | null;
  method: string;
  pathname: string;
  origin: string | null;
  host: string | null;
}): Promise<{ result: AccessResult; sessionUser: string | null }> {
  const sessionUser = await resolveSessionUser(process.env, params.cookieToken, nowSeconds());
  const result = resolveAccess(process.env, {
    method: params.method,
    pathname: params.pathname,
    sessionUser,
    authHeader: params.authHeader,
    origin: params.origin,
    host: params.host,
  });
  return { result, sessionUser };
}

/**
 * Кто смотрит страницу. Вызывается из серверных компонентов (корневой layout),
 * чтобы клиентское дерево знало, рисовать ли редакторские элементы.
 *
 * Это НЕ рубеж защиты: интерфейс лишь отражает права. Реальный запрет — в
 * мидлваре и в `requireEditor` на самих роутах.
 */
export async function getViewer(): Promise<Viewer> {
  const store = await cookies();
  const hdrs = await headers();
  const token = store.get(SESSION_COOKIE)?.value ?? null;

  // Редактор, авторизованный через `Authorization: Basic` (ADMIN_USERS /
  // ADMIN_BASIC_AUTH), должен видеть себя редактором и на страницах, а не
  // только в ответах API — та же пара учёток решает оба рубежа. Origin/Host
  // намеренно `null`: это рендер страницы, а не запись, и проверка Origin на
  // `null` не срабатывает (см. resolveAccess).
  const { result } = await resolveAccessFrom({
    cookieToken: token,
    authHeader: hdrs.get('authorization'),
    method: 'POST',
    pathname: '/api/funnels',
    origin: null,
    host: null,
  });

  return { user: result.user, canEdit: canEditFrom(result) };
}

/** Извлекает значение cookie из заголовка `Cookie`. Битое percent-encoding
 *  (`kf_session=%`) трактуется как «cookie нет», а не как исключение —
 *  `requireEditor` вызывается роутами ДО своего `try`, и необработанный
 *  `URIError` превратил бы честный 401 в 500 ровно в том сценарии, ради
 *  которого второй рубеж и существует (мидлвара его иначе маскирует, отбивая
 *  раньше). */
export function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Второй рубеж: проверка прямо в обработчике роута.
 *
 * Мидлвара — не единственная защита, её `matcher` ломается одной правкой и
 * молча. Возвращает готовый отказ либо `null`, если запрос можно выполнять.
 *
 * Заодно — единственное место, где перебор пароля через `Authorization: Basic`
 * упирается в лимит: сам заголовок никогда не попадает в форму входа
 * (`/api/auth/login`), а `resolveAccess` обязана оставаться чистой и
 * Edge-безопасной, так что считать попытки внутри неё нельзя. Считаем только
 * запросы, где Basic реально был предъявлен и решение принял именно он —
 * анонимное чтение и cookie-сессия под лимит не попадают.
 */
export async function requireEditor(req: Request): Promise<NextResponse | null> {
  const url = new URL(req.url);
  const authHeader = req.headers.get('authorization');
  const basic = parseBasicHeader(authHeader);

  if (basic) {
    const key = attemptKey(req, basic.name);
    if (isBlocked(key, Date.now())) {
      console.warn(`[auth] Basic заблокирован: user=${JSON.stringify(basic.name)}`);
      return NextResponse.json({ error: 'Слишком много попыток, попробуй позже' }, { status: 429 });
    }
  }

  const { result } = await resolveAccessFrom({
    cookieToken: readCookie(req.headers.get('cookie'), SESSION_COOKIE),
    authHeader,
    method: req.method,
    pathname: url.pathname,
    origin: req.headers.get('origin'),
    host: req.headers.get('host'),
  });

  if (canEditFrom(result)) {
    // Обнуляем счётчик, только если доступ дал именно этот Basic — не сессия,
    // не kill-switch, не открытый дев-режим: иначе можно было бы сбросить
    // чужой лимит, просто угадав его имя рядом с валидной cookie.
    if (basic && result.user === basic.name) {
      clearAttempts(attemptKey(req, basic.name));
    }
    return null;
  }

  // `forbidden-origin` срабатывает ДО проверки пароля (см. resolveAccess), то
  // есть Basic здесь мог быть и верным — считать его как провал нельзя, иначе
  // легитимный запрос с чужим Origin забанил бы свою же учётку. Во всех
  // остальных ветках, раз доступа нет, пароль (если Basic вообще был) уже
  // проверен и не совпал.
  if (basic && result.decision !== 'forbidden-origin') {
    const attempt = registerFailure(attemptKey(req, basic.name), Date.now());
    const left = Math.max(0, LOGIN_MAX_ATTEMPTS - attempt.count);
    console.warn(`[auth] неудачный Basic: user=${JSON.stringify(basic.name)}, осталось попыток ${left}`);
  }

  if (result.decision === 'forbidden-origin') {
    return NextResponse.json({ error: 'Запрос с постороннего источника' }, { status: 403 });
  }
  if (result.decision === 'misconfigured') {
    return NextResponse.json(
      { error: 'Авторизация не настроена (ADMIN_USERS / ADMIN_SESSION_SECRET)' },
      { status: 503 }
    );
  }
  return NextResponse.json({ error: 'Требуется авторизация' }, { status: 401 });
}

/** Параметры cookie сессии. `Secure` — только в проде: локально нет https. */
export function sessionCookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge,
  };
}

export const SESSION_COOKIE_NAME = SESSION_COOKIE;
export const SESSION_MAX_AGE = SESSION_TTL_SECONDS;
