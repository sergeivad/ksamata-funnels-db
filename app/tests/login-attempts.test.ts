/**
 * Тесты общего счётчика неудачных попыток входа (`lib/login-attempts.ts`) —
 * отдельно от того, что `/api/auth/login` и `requireEditor` (Basic-заголовок
 * на втором рубеже) теперь считают в одну и ту же Map. Здесь — низкоуровневый
 * контракт модуля: ключ, лимит, уборка.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { LOGIN_MAX_ATTEMPTS, LOGIN_WINDOW_MS, type LoginAttempt } from '../src/lib/auth';
import { attemptKey, clearAttempts, isBlocked, pruneAttempts, registerFailure } from '../src/lib/login-attempts';

const ATTEMPTS_KEY = Symbol.for('ksamata.loginAttempts');
type AttemptsGlobal = typeof globalThis & { [ATTEMPTS_KEY]?: Map<string, LoginAttempt> };

function resetStore(): Map<string, LoginAttempt> {
  const fresh = new Map<string, LoginAttempt>();
  (globalThis as AttemptsGlobal)[ATTEMPTS_KEY] = fresh;
  return fresh;
}

function reqWith(headers: Record<string, string>): Request {
  return new Request('http://admin.example/api/auth/login', { headers }) as never;
}

beforeEach(() => {
  resetStore();
});

describe('attemptKey', () => {
  it('берёт x-forwarded-for первым, x-real-ip запасным, иначе "unknown"', () => {
    expect(attemptKey(reqWith({ 'x-forwarded-for': '1.2.3.4, 5.6.7.8' }), 'ed')).toBe('1.2.3.4|ed');
    expect(attemptKey(reqWith({ 'x-real-ip': '9.9.9.9' }), 'ed')).toBe('9.9.9.9|ed');
    expect(attemptKey(reqWith({}), 'ed')).toBe('unknown|ed');
  });

  it('обрезает произвольно длинное имя — иначе ключ (и Map) растёт вместе с атакующим', () => {
    const huge = 'a'.repeat(10_000);
    const key = attemptKey(reqWith({ 'x-forwarded-for': '1.1.1.1' }), huge);
    expect(key.length).toBeLessThan(200);
  });
});

describe('registerFailure / isBlocked / clearAttempts', () => {
  it('блокирует после LOGIN_MAX_ATTEMPTS и снимает блок при обнулении', () => {
    const now = 1_000_000;
    for (let i = 0; i < LOGIN_MAX_ATTEMPTS; i++) registerFailure('ip|ed', now);
    expect(isBlocked('ip|ed', now)).toBe(true);

    clearAttempts('ip|ed');
    expect(isBlocked('ip|ed', now)).toBe(false);
  });

  it('ключи независимы друг от друга', () => {
    const now = 1_000_000;
    for (let i = 0; i < LOGIN_MAX_ATTEMPTS; i++) registerFailure('ip|a', now);
    expect(isBlocked('ip|b', now)).toBe(false);
  });
});

describe('pruneAttempts', () => {
  it('вычищает истёкшие записи — иначе Map меняющего имя атакующего растёт без границы', () => {
    const store = resetStore();
    const now = 1_000_000;
    store.set('ip|old-1', { count: 3, resetAt: now - 1 });
    store.set('ip|old-2', { count: 3, resetAt: now - 100 });
    store.set('ip|fresh', { count: 3, resetAt: now + LOGIN_WINDOW_MS });

    pruneAttempts(store, now);

    expect(store.has('ip|old-1')).toBe(false);
    expect(store.has('ip|old-2')).toBe(false);
    expect(store.has('ip|fresh')).toBe(true);
  });

  it('registerFailure метёт устаревшее прямо при записи новой попытки', () => {
    const store = resetStore();
    const now = 1_000_000;
    store.set('ip|stale', { count: 5, resetAt: now - 1 });

    registerFailure('ip|new', now);

    expect(store.has('ip|stale')).toBe(false);
    expect(store.has('ip|new')).toBe(true);
  });
});
