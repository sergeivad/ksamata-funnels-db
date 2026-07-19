'use client';

import { Copy, Check, AlertCircle, ExternalLink } from 'lucide-react';
import { useCopyFlash } from '@/lib/clipboard';

interface Props {
  value: string;
  onChange: (value: string) => void;
  onFocus?: () => void;
  onBlur?: () => void;
  placeholder?: string;
  /** Classes for the underlying <input> (sizing, border, font, etc.). */
  className?: string;
}

// Icons are hover-revealed on pointer devices; on touch (no hover) they stay
// visible, and while hidden they don't intercept taps aimed at the input.
const REVEAL =
  'opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto [@media(hover:none)]:opacity-100 [@media(hover:none)]:pointer-events-auto';

/**
 * URL text field for dense layouts: shows the full link in a hover tooltip
 * (the field itself truncates) and a copy icon that appears inside the field
 * on hover, flipping to a green check (or a red alert on failure) for ~1.5s
 * after copying. Copy state is self-contained, so any number of these can
 * live in one grid without wiring.
 */
export default function UrlInput({ value, onChange, onFocus, onBlur, placeholder, className }: Props) {
  const { status, copy } = useCopyFlash(1500);
  const hasUrl = value.trim() !== '';
  const openableUrl = /^https?:\/\//i.test(value.trim()) ? value.trim() : null;

  const copyTitle =
    status === 'copied' ? 'Скопировано' : status === 'failed' ? 'Не удалось скопировать' : 'Копировать ссылку';

  return (
    <div className="group relative min-w-0">
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={onFocus}
        onBlur={onBlur}
        placeholder={placeholder}
        title={value}
        className={className}
      />
      {hasUrl && (
        <>
          <span
            role="tooltip"
            className="pointer-events-none absolute bottom-full left-0 z-10 mb-1 hidden w-max max-w-[min(420px,90vw)] break-all rounded-[6px] bg-[var(--ink)] px-2 py-1 font-mono text-[11px] leading-snug text-white shadow-md group-hover:block"
          >
            {value}
          </span>
          {openableUrl && (
            <a
              href={openableUrl}
              target="_blank"
              rel="noreferrer"
              tabIndex={-1}
              aria-label="Открыть в новой вкладке"
              title="Открыть в новой вкладке"
              className={`absolute right-[26px] top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-[4px] bg-white text-[var(--faint)] transition hover:text-[var(--ink)] ${REVEAL}`}
            >
              <ExternalLink size={13} />
            </a>
          )}
          <button
            type="button"
            onClick={() => copy(value)}
            tabIndex={-1}
            aria-label={copyTitle}
            title={copyTitle}
            className={`absolute right-1 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-[4px] bg-white transition ${
              status === 'copied'
                ? 'pointer-events-auto text-[#087443] opacity-100'
                : status === 'failed'
                  ? 'pointer-events-auto text-[#B42318] opacity-100'
                  : `text-[var(--faint)] hover:text-[var(--ink)] ${REVEAL}`
            }`}
          >
            {status === 'copied' ? <Check size={13} /> : status === 'failed' ? <AlertCircle size={13} /> : <Copy size={13} />}
          </button>
        </>
      )}
    </div>
  );
}
