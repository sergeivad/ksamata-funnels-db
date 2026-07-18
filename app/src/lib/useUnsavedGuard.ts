'use client';

import { useEffect } from 'react';

/**
 * Warns the user with the browser's native "leave page?" prompt when there
 * are unsaved changes somewhere on the page (closing the tab, reloading,
 * navigating to an external URL). Internal SPA navigation is intentionally
 * not intercepted — only `beforeunload`.
 */
export function useUnsavedGuard(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
      // Some browsers require returnValue to be set to show the prompt.
      e.returnValue = '';
    }
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [dirty]);
}
