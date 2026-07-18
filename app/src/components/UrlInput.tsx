'use client';

import { useRef, useState } from 'react';
import { Copy, Check, ExternalLink } from 'lucide-react';

interface Props {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Classes for the underlying <input> (sizing, border, font, etc.). */
  className?: string;
}

/**
 * URL text field for dense layouts: shows the full link in a hover tooltip
 * (the field itself truncates) and a copy icon that appears inside the field
 * on hover, flipping to a green check for ~1.5s after copying. Copy state is
 * self-contained, so any number of these can live in one grid without wiring.
 */
export default function UrlInput({ value, onChange, placeholder, className }: Props) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasUrl = value.trim() !== '';
  const openableUrl = /^https?:\/\//i.test(value.trim()) ? value.trim() : null;

  async function copy() {
    const v = value.trim();
    if (!v) return;
    try {
      await navigator.clipboard.writeText(v);
    } catch {
      return; // clipboard unavailable (insecure context) — skip confirmation
    }
    if (timer.current) clearTimeout(timer.current);
    setCopied(true);
    timer.current = setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="group relative min-w-0">
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
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
              className="absolute right-[26px] top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-[4px] bg-white text-[var(--faint)] opacity-0 transition hover:text-[var(--ink)] group-hover:opacity-100"
            >
              <ExternalLink size={13} />
            </a>
          )}
          <button
            type="button"
            onClick={copy}
            tabIndex={-1}
            aria-label={copied ? 'Скопировано' : 'Копировать ссылку'}
            title={copied ? 'Скопировано' : 'Копировать ссылку'}
            className={`absolute right-1 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-[4px] bg-white transition ${
              copied
                ? 'text-[#087443] opacity-100'
                : 'text-[var(--faint)] opacity-0 hover:text-[var(--ink)] group-hover:opacity-100'
            }`}
          >
            {copied ? <Check size={13} /> : <Copy size={13} />}
          </button>
        </>
      )}
    </div>
  );
}
