'use client';

import { useCopyFlash } from '@/lib/clipboard';

interface CodeChipProps {
  code: string;
}

/**
 * Funnel code chip (f1, f2, …). Click copies the code to the clipboard;
 * the chip flashes green for ~1.2s as confirmation (red if copying failed).
 * Click never bubbles, so the chip can sit inside a clickable card row
 * without navigating.
 */
export default function CodeChip({ code }: CodeChipProps) {
  const { status, copy } = useCopyFlash(1200);

  function handleClick(e: React.MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    copy(code);
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      title={
        status === 'copied' ? 'Скопировано' : status === 'failed' ? 'Не удалось скопировать' : 'Клик — скопировать код'
      }
      className={`rounded-[5px] border px-1.5 py-0.5 font-mono text-[10px] font-black uppercase leading-none transition ${
        status === 'copied'
          ? 'border-[#087443] bg-[#EDFBF3] text-[#087443]'
          : status === 'failed'
            ? 'border-[#B42318] bg-[#FEF3F2] text-[#B42318]'
            : 'border-[var(--color-border-soft)] bg-white/60 text-[var(--color-text-secondary)] hover:border-[var(--color-text-secondary)]'
      }`}
    >
      {code}
    </button>
  );
}
