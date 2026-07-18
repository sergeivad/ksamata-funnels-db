'use client';

import { useRef, useState } from 'react';

interface CodeChipProps {
  code: string;
}

/**
 * Funnel code chip (f1, f2, …). Click copies the code to the clipboard;
 * the chip flashes green for ~1.2s as confirmation. Click never bubbles,
 * so the chip can sit inside a clickable card row without navigating.
 */
export default function CodeChip({ code }: CodeChipProps) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function copy(e: React.MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      return; // clipboard unavailable (insecure context) — skip confirmation
    }
    if (timer.current) clearTimeout(timer.current);
    setCopied(true);
    timer.current = setTimeout(() => setCopied(false), 1200);
  }

  return (
    <button
      type="button"
      onClick={copy}
      title={copied ? 'Скопировано' : 'Клик — скопировать код'}
      className={`rounded-[5px] border px-1.5 py-0.5 font-mono text-[10px] font-black uppercase leading-none transition ${
        copied
          ? 'border-[#087443] bg-[#EDFBF3] text-[#087443]'
          : 'border-[var(--color-border-soft)] bg-white/60 text-[var(--color-text-secondary)] hover:border-[var(--color-text-secondary)]'
      }`}
    >
      {code}
    </button>
  );
}
