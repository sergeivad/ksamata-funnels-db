'use client';

import { useEffect } from 'react';

/**
 * Guards against losing unsaved changes:
 * - `beforeunload` shows the browser's native prompt for tab close, reload
 *   and external navigation;
 * - a capture-phase click listener intercepts internal links (`<Link>`,
 *   `<a href="/...">`) — App Router gives no navigation event, so this is
 *   the only hook point for SPA transitions. Modifier/middle clicks and
 *   `target="_blank"` are ignored (they keep the page open), and the
 *   browser Back button is a known remaining gap.
 */
export function useUnsavedGuard(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
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
      if (!window.confirm('Есть несохранённые изменения. Уйти без сохранения?')) {
        e.preventDefault();
        e.stopPropagation();
      }
    }
    window.addEventListener('beforeunload', handleBeforeUnload);
    document.addEventListener('click', handleClickCapture, true);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      document.removeEventListener('click', handleClickCapture, true);
    };
  }, [dirty]);
}
