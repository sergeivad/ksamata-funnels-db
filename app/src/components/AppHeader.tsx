'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { confirmUnsavedNavigation } from '@/lib/useUnsavedGuard';

/**
 * Shared top header rendered on every page via the root layout.
 * - Brand on the left links back to the funnel list (the "back to list" affordance).
 * - "Новая воронка" creates a blank draft server-side, then opens its card
 *   (the same edit surface), per the create-then-edit-in-place flow.
 */
export default function AppHeader() {
  const router = useRouter();
  const pathname = usePathname();
  const [creating, setCreating] = useState(false);

  // The header lives in the root layout and never unmounts, so reset the
  // "creating" state on every route change — otherwise the button stays stuck
  // on "Создание…" after a successful create navigates to the new card.
  useEffect(() => {
    setCreating(false);
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
      const funnel = await res.json();
      router.push(`/funnels/${funnel.id}`);
    } catch {
      setCreating(false);
    }
  }

  const navLink = (href: string, label: string) => {
    const active = pathname === href;
    return (
      <Link
        href={href}
        className={[
          'rounded-[7px] px-2.5 py-1.5 text-[13px] transition',
          active
            ? 'bg-[var(--chip)] font-semibold text-[var(--ink)]'
            : 'text-[var(--muted)] hover:text-[var(--ink)]',
        ].join(' ')}
      >
        {label}
      </Link>
    );
  };

  return (
    <header className="sticky top-0 z-40 border-b border-[var(--line-soft)] bg-[var(--card)]/95 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-[1120px] items-center gap-3 px-4 sm:gap-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2 text-[var(--ink)]">
          <span className="grid h-7 w-7 place-items-center rounded-[8px] bg-[var(--orange)] text-[13px] font-bold text-white">
            К
          </span>
          {/* Wordmark hidden on phones to keep the header on one row; the logo
              square stays as the back-to-list affordance. */}
          <span className="hidden text-[15px] font-semibold tracking-tight sm:inline">
            Ксамата <span className="text-[var(--faint)]">·</span> Воронки
          </span>
        </Link>

        <nav className="ml-1 flex items-center gap-1 sm:ml-4">
          {navLink('/', 'Воронки')}
          {navLink('/refs', 'Справочники')}
          {navLink('/tags', 'Теги')}
        </nav>

        <button
          type="button"
          onClick={createDraft}
          disabled={creating}
          aria-label="Новая воронка"
          className="ml-auto inline-flex items-center gap-1.5 rounded-[8px] bg-[var(--orange)] px-2.5 py-2 text-[13px] font-semibold text-white transition hover:opacity-90 disabled:opacity-60 sm:px-3.5"
        >
          <Plus size={15} />
          {/* Label collapses to the icon on phones to save the row width. */}
          <span className="hidden sm:inline">{creating ? 'Создание…' : 'Новая воронка'}</span>
        </button>
      </div>
    </header>
  );
}
