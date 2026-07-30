import { NextRequest, NextResponse } from 'next/server';
import {
  LOGIN_MAX_ATTEMPTS,
  SESSION_TTL_SECONDS,
  configuredUsers,
  isLoginBlocked,
  registerFailedLogin,
  resolveSessionSecret,
  signSession,
  verifyPassword,
  type LoginAttempt,
} from '@/lib/auth';
import { SESSION_COOKIE_NAME, sessionCookieOptions } from '@/lib/auth-server';
import { internalError } from '@/lib/http';

/**
 * Вход редактора: пара имя/пароль → подписанная cookie сессии.
 *
 * Ответ на неверные данные один и тот же независимо от того, существует ли
 * имя, — иначе форма превращается в перечислитель учёток.
 */

// Счётчик неудачных попыток живёт на globalThis: в продовом бандле модуль
// дублируется (см. CLAUDE.md про Edge-сборку), и module-level Map оказалась бы
// двумя независимыми счётчиками, то есть вдвое большим лимитом.
const ATTEMPTS_KEY = Symbol.for('ksamata.loginAttempts');
type AttemptsGlobal = typeof globalThis & { [ATTEMPTS_KEY]?: Map<string, LoginAttempt> };

function attemptStore(): Map<string, LoginAttempt> {
  const g = globalThis as AttemptsGlobal;
  if (!g[ATTEMPTS_KEY]) g[ATTEMPTS_KEY] = new Map<string, LoginAttempt>();
  return g[ATTEMPTS_KEY];
}

/** Клиентский адрес за обратным прокси (Dokploy/Traefik). */
function clientKey(req: NextRequest, user: string): string {
  const fwd = req.headers.get('x-forwarded-for');
  const ip = fwd ? fwd.split(',')[0].trim() : (req.headers.get('x-real-ip') ?? 'unknown');
  return `${ip}|${user}`;
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Некорректный запрос' }, { status: 400 });
  }

  const { user, password } = (body ?? {}) as Record<string, unknown>;
  if (typeof user !== 'string' || typeof password !== 'string' || user.length === 0) {
    return NextResponse.json({ error: 'Укажи имя и пароль' }, { status: 400 });
  }

  try {
    const secret = resolveSessionSecret(process.env);
    const users = configuredUsers(process.env);
    if (!secret || users.length === 0) {
      return NextResponse.json(
        { error: 'Авторизация не настроена (ADMIN_USERS / ADMIN_SESSION_SECRET)' },
        { status: 503 }
      );
    }

    const store = attemptStore();
    const key = clientKey(req, user);
    const now = Date.now();
    if (isLoginBlocked(store, key, now)) {
      return NextResponse.json(
        { error: 'Слишком много попыток, попробуй позже' },
        { status: 429 }
      );
    }

    const matched = verifyPassword(users, user, password);
    if (!matched) {
      const attempt = registerFailedLogin(store, key, now);
      const left = Math.max(0, LOGIN_MAX_ATTEMPTS - attempt.count);
      console.warn(`[auth] неудачный вход: user=${JSON.stringify(user)}, осталось попыток ${left}`);
      return NextResponse.json({ error: 'Неверное имя или пароль' }, { status: 401 });
    }

    // Успешный вход обнуляет счётчик: иначе редкие описки копились бы неделями
    // и однажды заблокировали живого человека без единой атаки.
    store.delete(key);

    const exp = Math.floor(now / 1000) + SESSION_TTL_SECONDS;
    const token = await signSession({ u: matched.name, exp }, secret);

    const res = NextResponse.json({ user: matched.name });
    res.cookies.set(SESSION_COOKIE_NAME, token, sessionCookieOptions(SESSION_TTL_SECONDS));
    return res;
  } catch (err: unknown) {
    return internalError('POST /api/auth/login', err);
  }
}
