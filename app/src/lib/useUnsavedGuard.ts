'use client';

import { useEffect } from 'react';

const UNSAVED_MESSAGE = 'Есть несохранённые изменения. Уйти без сохранения?';

// Module-level registry of currently-dirty editors, so imperative navigation
// (router.push in buttons — «Новая воронка», «Дублировать», …) can consult
// the same dirty state the click guard uses. The click guard only sees <a>
// clicks; router.push bypasses it entirely.
const dirtyGuards = new Set<symbol>();

/** Mark an editor dirty; call the returned function to unmark it. */
export function registerUnsavedGuard(): () => void {
  const id = Symbol('unsaved-guard');
  dirtyGuards.add(id);
  return () => {
    dirtyGuards.delete(id);
  };
}

/**
 * Gate for imperative navigation (router.push): returns true when it is OK
 * to leave — nothing is dirty, or the user confirmed losing the changes.
 */
export function confirmUnsavedNavigation(): boolean {
  if (dirtyGuards.size === 0) return true;
  return window.confirm(UNSAVED_MESSAGE);
}

/**
 * Guards against losing unsaved changes:
 * - `beforeunload` shows the browser's native prompt for tab close, reload
 *   and external navigation;
 * - a capture-phase click listener intercepts internal links (`<Link>`,
 *   `<a href="/...">`) — App Router gives no navigation event, so this is
 *   the only hook point for SPA transitions. Modifier/middle clicks and
 *   `target="_blank"` are ignored (they keep the page open), and the
 *   browser Back button is a known remaining gap;
 * - registers into the dirty registry above so buttons that navigate via
 *   router.push can ask `confirmUnsavedNavigation()` first.
 */
export function useUnsavedGuard(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const unregister = registerUnsavedGuard();
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
      // Some browsers require returnValue to be set to show the prompt.
      e.returnValue = '';
    }
    function handleClickCapture(e: MouseEvent) {
      if (e.defaultPrevented) return;
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const target = e.target instanceof Element ? e.target : null;
      const anchor = target?.closest('a[href]');
      if (!anchor) return;
      const href = anchor.getAttribute('href') ?? '';
      // External links and anchors are left to beforeunload / the browser.
      if (!href.startsWith('/')) return;
      if (anchor.getAttribute('target') === '_blank') return;
      if (!window.confirm(UNSAVED_MESSAGE)) {
        e.preventDefault();
        e.stopPropagation();
      }
    }
    window.addEventListener('beforeunload', handleBeforeUnload);
    document.addEventListener('click', handleClickCapture, true);
    return () => {
      unregister();
      window.removeEventListener('beforeunload', handleBeforeUnload);
      document.removeEventListener('click', handleClickCapture, true);
    };
  }, [dirty]);
}
