import { NextResponse } from 'next/server';
import { SESSION_COOKIE_NAME, sessionCookieOptions } from '@/lib/auth-server';

/**
 * Выход: гасим cookie сессии.
 *
 * Сессия stateless (подписанный токен, без хранилища), поэтому «выход» — это
 * ровно удаление cookie у этого браузера. Разлогинить всех сразу можно сменой
 * `ADMIN_SESSION_SECRET`, а конкретного человека — удалением его строки из
 * `ADMIN_USERS`: имя из токена сверяется со списком на каждом запросе.
 */
export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE_NAME, '', sessionCookieOptions(0));
  return res;
}
