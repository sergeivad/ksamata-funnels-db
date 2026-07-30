import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import {
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  canEditFrom,
  resolveAccess,
  resolveSessionUser,
  type AccessResult,
} from './auth';

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
 * Кто смотрит страницу. Вызывается из серверных компонентов (корневой layout),
 * чтобы клиентское дерево знало, рисовать ли редакторские элементы.
 *
 * Это НЕ рубеж защиты: интерфейс лишь отражает права. Реальный запрет — в
 * мидлваре и в `requireEditor` на самих роутах.
 */
export async function getViewer(): Promise<Viewer> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value ?? null;
  const user = await resolveSessionUser(process.env, token, nowSeconds());

  // Локальная разработка без единой переменной и kill-switch в dev-стеке
  // должны давать полноценный редактор, а не режим просмотра, поэтому право
  // берём из того же решения, что и мидлвара, а не из наличия сессии.
  const result = resolveAccess(process.env, {
    method: 'POST',
    pathname: '/api/funnels',
    sessionUser: user,
    authHeader: null,
    origin: null,
    host: null,
  });

  return { user, canEdit: canEditFrom(result) };
}

/** Разбор запроса в аргументы `resolveAccess` — общий для роутов. */
async function accessFor(req: Request): Promise<AccessResult> {
  const url = new URL(req.url);
  const token = readCookie(req.headers.get('cookie'), SESSION_COOKIE);
  const sessionUser = await resolveSessionUser(process.env, token, nowSeconds());
  return resolveAccess(process.env, {
    method: req.method,
    pathname: url.pathname,
    sessionUser,
    authHeader: req.headers.get('authorization'),
    origin: req.headers.get('origin'),
    host: req.headers.get('host'),
  });
}

/** Извлекает значение cookie из заголовка `Cookie`. */
export function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
}

/**
 * Второй рубеж: проверка прямо в обработчике роута.
 *
 * Мидлвара — не единственная защита, её `matcher` ломается одной правкой и
 * молча. Возвращает готовый отказ либо `null`, если запрос можно выполнять.
 */
export async function requireEditor(req: Request): Promise<NextResponse | null> {
  const result = await accessFor(req);
  if (canEditFrom(result)) return null;

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
