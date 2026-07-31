import { LOGIN_MAX_ATTEMPTS, isLoginBlocked, registerFailedLogin, type LoginAttempt } from './auth';

/**
 * Общее хранилище неудачных попыток входа — раньше жило только внутри
 * `POST /api/auth/login`, поэтому перебор пароля через заголовок
 * `Authorization: Basic` (второй рубеж, `requireEditor` в `auth-server.ts`)
 * ничем не ограничивался: сюда этот запрос никогда не заходит. Вынесено в
 * отдельный модуль, чтобы обе точки входа считали в одну и ту же Map по
 * одному и тому же ключу — иначе перебор просто переехал бы на тот вход,
 * где лимита не завели.
 *
 * Состояние — на `globalThis` через `Symbol.for`: в продовом бандле
 * инструментация (Edge) и роуты (Node) — это два разных экземпляра модуля
 * (см. CLAUDE.md, «Process state must be a real singleton»), и module-level
 * `let`/`Map` молча оказались бы двумя независимыми счётчиками, то есть
 * вдвое большим лимитом.
 */

const ATTEMPTS_KEY = Symbol.for('ksamata.loginAttempts');
type AttemptsGlobal = typeof globalThis & { [ATTEMPTS_KEY]?: Map<string, LoginAttempt> };

/** Имя пользователя в Basic-заголовке ничем не ограничено атакующим по длине;
 *  без обрезки ключ (а с ним и запись в Map) рос бы вместе с длиной строки. */
const MAX_KEY_USER_LENGTH = 100;

/** Потолок числа одновременно хранимых ключей. Без него атакующий, каждый раз
 *  меняющий имя в заголовке, надувает Map без границы — эксплуатация не
 *  пароля, а памяти процесса. */
const MAX_STORE_SIZE = 5000;

function attemptStore(): Map<string, LoginAttempt> {
  const g = globalThis as AttemptsGlobal;
  if (!g[ATTEMPTS_KEY]) g[ATTEMPTS_KEY] = new Map<string, LoginAttempt>();
  return g[ATTEMPTS_KEY];
}

/** Клиентский адрес за обратным прокси (Dokploy/Traefik) + имя попытки. */
export function attemptKey(req: { headers: { get(name: string): string | null } }, user: string): string {
  const fwd = req.headers.get('x-forwarded-for');
  const ip = fwd ? fwd.split(',')[0].trim() : (req.headers.get('x-real-ip') ?? 'unknown');
  return `${ip}|${user.slice(0, MAX_KEY_USER_LENGTH)}`;
}

/**
 * Метёт истёкшие записи и, если Map всё равно больше потолка, довытесняет
 * самые старые по порядку вставки. Вызывается только при записи (на каждый
 * провал) — отдельного расписания уборки нет и не нужно: без новых попыток
 * Map просто не растёт.
 */
export function pruneAttempts(store: Map<string, LoginAttempt>, now: number): void {
  for (const [key, attempt] of store) {
    if (attempt.resetAt <= now) store.delete(key);
  }
  if (store.size > MAX_STORE_SIZE) {
    let excess = store.size - MAX_STORE_SIZE;
    for (const key of store.keys()) {
      if (excess <= 0) break;
      store.delete(key);
      excess -= 1;
    }
  }
}

export function isBlocked(key: string, now: number): boolean {
  return isLoginBlocked(attemptStore(), key, now);
}

export function registerFailure(key: string, now: number): LoginAttempt {
  const store = attemptStore();
  pruneAttempts(store, now);
  return registerFailedLogin(store, key, now);
}

/** Успешная авторизация обнуляет счётчик для своего ключа. */
export function clearAttempts(key: string): void {
  attemptStore().delete(key);
}

export { LOGIN_MAX_ATTEMPTS };
