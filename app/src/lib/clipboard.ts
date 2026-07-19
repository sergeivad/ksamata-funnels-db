'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * clipboard.ts — shared copy-to-clipboard helper + flash-state hook.
 *
 * copyText works in insecure contexts too (plain HTTP deployments, where
 * navigator.clipboard is undefined) via the legacy execCommand fallback, and
 * reports success/failure instead of failing silently — copying links is the
 * app's primary daily use, so a broken copy must be visible to the user.
 */
export async function copyText(text: string): Promise<boolean> {
  const v = text.trim();
  if (!v) return false;
  try {
    await navigator.clipboard.writeText(v);
    return true;
  } catch {
    // navigator.clipboard unavailable (insecure context) or write rejected —
    // fall through to the legacy path
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = v;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

export type CopyStatus = 'idle' | 'copied' | 'failed';

/**
 * Copy with a temporary status flash: 'copied' (green check) or 'failed'
 * (red icon + «Не удалось скопировать») for `ms`, then back to 'idle'.
 * Self-contained, so any number of buttons can use their own instance.
 */
export function useCopyFlash(ms = 1500) {
  const [status, setStatus] = useState<CopyStatus>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  async function copy(text: string) {
    const ok = await copyText(text);
    if (timer.current) clearTimeout(timer.current);
    setStatus(ok ? 'copied' : 'failed');
    timer.current = setTimeout(() => setStatus('idle'), ms);
  }

  return { status, copy };
}
