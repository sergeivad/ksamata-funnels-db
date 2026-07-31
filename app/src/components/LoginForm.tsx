'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface Props {
  /** Куда вернуться после входа. Всегда путь внутри сервиса. */
  next: string;
}

/**
 * Форма входа редактора. Отправляет пару имя/пароль в `/api/auth/login`,
 * сервер ставит cookie сессии.
 *
 * После успеха обязателен `router.refresh()`: право на правку приходит из
 * серверного layout, и без обновления RSC-дерева страница осталась бы в
 * режиме просмотра до перезагрузки вкладки.
 */
export default function LoginForm({ next }: Props) {
  const router = useRouter();
  const [user, setUser] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user: user.trim(), password }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(typeof data.error === 'string' ? data.error : 'Не удалось войти');
        setBusy(false);
        return;
      }
      router.replace(next);
      router.refresh();
    } catch {
      setError('Сеть недоступна');
      setBusy(false);
    }
  }

  const field =
    'w-full rounded-[8px] border border-[var(--line-soft)] bg-white px-3 py-2 text-[14px] ' +
    'text-[var(--ink)] focus:outline-none focus:ring-1 focus:ring-[var(--orange)]';

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1">
        <span className="text-[12px] text-[var(--muted)]">Имя</span>
        <input
          type="text"
          autoFocus
          autoComplete="username"
          value={user}
          onChange={(e) => setUser(e.target.value)}
          className={field}
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-[12px] text-[var(--muted)]">Пароль</span>
        <input
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={field}
        />
      </label>

      {error && (
        <p role="alert" className="text-[13px] text-[var(--danger,#c0392b)]">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={busy || user.trim().length === 0 || password.length === 0}
        className="mt-1 rounded-[8px] bg-[var(--orange)] px-4 py-2 text-[14px] font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
      >
        {busy ? 'Вход…' : 'Войти'}
      </button>
    </form>
  );
}
