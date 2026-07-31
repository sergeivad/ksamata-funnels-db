import { NextRequest, NextResponse } from 'next/server';
import {
  SESSION_TTL_SECONDS,
  configuredUsers,
  resolveSessionSecret,
  signSession,
  verifyPassword,
} from '@/lib/auth';
import { SESSION_COOKIE_NAME, sessionCookieOptions } from '@/lib/auth-server';
import { internalError } from '@/lib/http';
import { LOGIN_MAX_ATTEMPTS, attemptKey, clearAttempts, isBlocked, registerFailure } from '@/lib/login-attempts';

/**
 * Вход редактора: пара имя/пароль → подписанная cookie сессии.
 *
 * Ответ на неверные данные один и тот же независимо от того, существует ли
 * имя, — иначе форма превращается в перечислитель учёток.
 *
 * Счётчик неудачных попыток общий с Basic-заголовком на втором рубеже
 * (`requireEditor` в `auth-server.ts`) — вынесен в `lib/login-attempts.ts`,
 * подробности состояния на `globalThis` там же.
 */
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

    const key = attemptKey(req, user);
    const now = Date.now();
    if (isBlocked(key, now)) {
      return NextResponse.json(
        { error: 'Слишком много попыток, попробуй позже' },
        { status: 429 }
      );
    }

    const matched = verifyPassword(users, user, password);
    if (!matched) {
      const attempt = registerFailure(key, now);
      const left = Math.max(0, LOGIN_MAX_ATTEMPTS - attempt.count);
      console.warn(`[auth] неудачный вход: user=${JSON.stringify(user)}, осталось попыток ${left}`);
      return NextResponse.json({ error: 'Неверное имя или пароль' }, { status: 401 });
    }

    // Успешный вход обнуляет счётчик: иначе редкие описки копились бы неделями
    // и однажды заблокировали живого человека без единой атаки.
    clearAttempts(key);

    const exp = Math.floor(now / 1000) + SESSION_TTL_SECONDS;
    const token = await signSession({ u: matched.name, exp }, secret);

    const res = NextResponse.json({ user: matched.name });
    res.cookies.set(SESSION_COOKIE_NAME, token, sessionCookieOptions(SESSION_TTL_SECONDS));
    return res;
  } catch (err: unknown) {
    return internalError('POST /api/auth/login', err);
  }
}
