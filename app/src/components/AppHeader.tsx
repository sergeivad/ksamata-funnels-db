'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Menu, Plus, X } from 'lucide-react';
import { confirmUnsavedNavigation } from '@/lib/useUnsavedGuard';
import { funnelHref } from '@/lib/front-code';
import type { FunnelListItem } from '@/lib/funnels';
import { useAuth } from './AuthProvider';

/**
 * Shared top header rendered on every page via the root layout.
 * - Brand on the left links back to the funnel list (the "back to list" affordance).
 * - "Новая воронка" creates a blank draft server-side, then opens its card
 *   (the same edit surface), per the create-then-edit-in-place flow.
 *
 * Анониму шапка показывает только «Воронки» и приглашение войти: остальные
 * разделы для него закрыты мидлварой, и вести на страницу, с которой его
 * развернёт редиректом, — это предлагать тупик.
 */
export default function AppHeader() {
  const router = useRouter();
  const pathname = usePathname();
  const { user, canEdit } = useAuth();
  const [creating, setCreating] = useState(false);
  const [leaving, setLeaving] = useState(false);
  // Меню разделов на телефоне. Пять разделов, кнопка «+» и «Выйти» в одну
  // строку шириной 375px не помещаются: шапка раздвигала страницу до 524px, и
  // браузер телефона уменьшал её целиком — мелкий шрифт, промахи по кнопкам.
  const [menuOpen, setMenuOpen] = useState(false);

  // The header lives in the root layout and never unmounts, so reset the
  // "creating" state on every route change — otherwise the button stays stuck
  // on "Создание…" after a successful create navigates to the new card.
  useEffect(() => {
    setCreating(false);
    setMenuOpen(false);
  }, [pathname]);

  async function createDraft() {
    if (creating) return;
    // router.push bypasses the <a>-click guard — check dirty state explicitly
    // before creating the draft, so unsaved edits are not silently abandoned.
    if (!confirmUnsavedNavigation()) return;
    setCreating(true);
    try {
      const res = await fetch('/api/funnels/draft', { method: 'POST' });
      if (!res.ok) throw new Error('draft failed');
      const funnel: FunnelListItem = await res.json();
      router.push(funnelHref(funnel));
    } catch {
      setCreating(false);
    }
  }

  async function logout() {
    if (leaving) return;
    if (!confirmUnsavedNavigation()) return;
    setLeaving(true);
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // Cookie гасится сервером; сетевой сбой на выходе не должен запирать
      // человека в интерфейсе — обновляем в любом случае.
    }
    // Право на правку приходит из серверного layout, поэтому одного push мало:
    // без refresh страница осталась бы редакторской до перезагрузки вкладки.
    router.push('/');
    router.refresh();
    setLeaving(false);
  }

  // Разделы одним списком на оба вида шапки: строка на широком экране и
  // выпадающее меню на телефоне не должны разъехаться составом.
  const sections: { href: string; label: string }[] = [
    { href: '/', label: 'Воронки' },
    // Справка — единственный раздел без `canEdit`: она объясняет в том числе,
    // как получить права, и прятать её от того, у кого их пока нет, значит
    // прятать ровно от адресата.
    { href: '/help', label: 'Справка' },
    ...(canEdit
      ? [
          { href: '/refs', label: 'Справочники' },
          { href: '/tags', label: 'Теги' },
          { href: '/monitoring', label: 'Мониторинг' },
        ]
      : []),
  ];

  const navLink = (href: string, label: string, inMenu = false) => {
    const active = pathname === href;
    return (
      <Link
        key={href}
        href={href}
        aria-current={active ? 'page' : undefined}
        className={[
          'rounded-[7px] transition',
          inMenu ? 'block px-3 py-2.5 text-[15px]' : 'px-2.5 py-1.5 text-[13px]',
          active
            ? 'bg-[var(--chip)] font-semibold text-[var(--ink)]'
            : 'text-[var(--muted)] hover:text-[var(--ink)]',
        ].join(' ')}
      >
        {label}
      </Link>
    );
  };

  // Название текущего раздела рядом с логотипом на телефоне: строки разделов
  // там нет, и без подписи непонятно, где находишься.
  const current =
    sections.find((s) => s.href === pathname) ??
    (pathname.startsWith('/funnels/') ? sections[0] : undefined);

  return (
    <>
      {/* Подложка закрывает меню по тапу мимо него. Стоит вне <header>:
          backdrop-blur делает шапку контейнером для fixed-потомков, и внутри
          неё подложка сжималась бы до высоты самой шапки. */}
      {menuOpen && (
        <button
          type="button"
          aria-hidden
          tabIndex={-1}
          onClick={() => setMenuOpen(false)}
          className="fixed inset-0 z-30 cursor-default bg-black/20 lg:hidden"
        />
      )}
      <header className="sticky top-0 z-40 border-b border-[var(--line-soft)] bg-[var(--card)]/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[1120px] items-center gap-3 px-4 sm:gap-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2 text-[var(--ink)]">
            <span className="grid h-7 w-7 place-items-center rounded-[8px] bg-[var(--orange)] text-[13px] font-bold text-white">
              К
            </span>
            {/* Wordmark hidden below lg to keep the header on one row; the logo
                square stays as the back-to-list affordance. */}
            <span className="hidden text-[15px] font-semibold tracking-tight lg:inline">
              Ксамата <span className="text-[var(--faint)]">·</span> Воронки
            </span>
          </Link>

          {current && (
            <span className="truncate text-[15px] font-semibold text-[var(--ink)] lg:hidden">
              {current.label}
            </span>
          )}

          <nav className="ml-4 hidden items-center gap-1 lg:flex">
            {sections.map((s) => navLink(s.href, s.label))}
          </nav>

          <div className="ml-auto flex items-center gap-2 sm:gap-3">
            {canEdit ? (
              <>
                {user && (
                  <span className="hidden text-[12px] text-[var(--muted)] lg:inline" title="Вы вошли">
                    {user}
                  </span>
                )}
                <button
                  type="button"
                  onClick={createDraft}
                  disabled={creating}
                  aria-label="Новая воронка"
                  className="inline-flex items-center gap-1.5 rounded-[8px] bg-[var(--orange)] px-2.5 py-2 text-[13px] font-semibold text-white transition hover:opacity-90 disabled:opacity-60 sm:px-3.5"
                >
                  <Plus size={15} />
                  {/* Label collapses to the icon on phones to save the row width. */}
                  <span className="hidden sm:inline">{creating ? 'Создание…' : 'Новая воронка'}</span>
                </button>
                {/* Кнопка выхода есть только когда вход вообще состоялся: без
                    учёток (локальная разработка, kill-switch) выходить некуда. */}
                {user && (
                  <button
                    type="button"
                    onClick={logout}
                    disabled={leaving}
                    className="hidden rounded-[7px] px-2 py-1.5 text-[13px] text-[var(--muted)] transition hover:text-[var(--ink)] disabled:opacity-60 lg:inline-block"
                  >
                    Выйти
                  </button>
                )}
              </>
            ) : (
              <>
                <span className="hidden text-[12px] text-[var(--muted)] lg:inline">
                  Только просмотр
                </span>
                <Link
                  href={`/login?next=${encodeURIComponent(pathname)}`}
                  className="rounded-[8px] bg-[var(--orange)] px-3 py-2 text-[13px] font-semibold text-white transition hover:opacity-90"
                >
                  Войти
                </Link>
              </>
            )}
            <button
              type="button"
              onClick={() => setMenuOpen((o) => !o)}
              aria-label={menuOpen ? 'Закрыть меню' : 'Меню'}
              aria-expanded={menuOpen}
              aria-controls="app-mobile-menu"
              className="inline-flex h-9 w-9 items-center justify-center rounded-[8px] text-[var(--ink)] transition hover:bg-[var(--chip)] lg:hidden"
            >
              {menuOpen ? <X size={20} /> : <Menu size={20} />}
            </button>
          </div>
        </div>

        {menuOpen && (
          <nav
            id="app-mobile-menu"
            className="absolute inset-x-0 top-14 z-40 border-b border-[var(--line-soft)] bg-[var(--card)] px-3 pb-3 pt-2 shadow-lg lg:hidden"
          >
            <div className="grid gap-0.5">
              {sections.map((s) => navLink(s.href, s.label, true))}
            </div>
            {canEdit && user && (
              <div className="mt-2 flex items-center justify-between border-t border-[var(--line-soft)] px-3 pt-3">
                <span className="text-[13px] text-[var(--muted)]">{user}</span>
                <button
                  type="button"
                  onClick={logout}
                  disabled={leaving}
                  className="rounded-[7px] px-2 py-1.5 text-[14px] text-[var(--muted)] transition hover:text-[var(--ink)] disabled:opacity-60"
                >
                  Выйти
                </button>
              </div>
            )}
            {!canEdit && (
              <p className="mt-2 border-t border-[var(--line-soft)] px-3 pt-3 text-[13px] text-[var(--muted)]">
                Только просмотр
              </p>
            )}
          </nav>
      )}
      </header>
    </>
  );
}
