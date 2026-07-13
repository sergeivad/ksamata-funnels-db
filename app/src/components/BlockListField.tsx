'use client';

import { useRef, useState } from 'react';
import { Trash2, Plus, Copy, Check } from 'lucide-react';
import type { BlockItem } from '@/lib/funnel-blocks';

interface Props {
  fields: 1 | 2;
  slot: '15' | '19' | null;
  items: BlockItem[];
  onChange: (items: BlockItem[]) => void;
}

export default function BlockListField({ fields, slot, items, onChange }: Props) {
  const rows = items.filter((it) => it.slot === slot);

  // Which row currently shows the "copied ✓" confirmation (index within `rows`).
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function update(indexInRows: number, patch: Partial<BlockItem>) {
    let seen = -1;
    onChange(
      items.map((it) => {
        if (it.slot !== slot) return it;
        seen += 1;
        return seen === indexInRows ? { ...it, ...patch } : it;
      }),
    );
  }

  function remove(indexInRows: number) {
    let seen = -1;
    onChange(items.filter((it) => (it.slot === slot ? ++seen !== indexInRows : true)));
  }

  function add() {
    onChange([...items, { slot, label: '', url: '' }]);
  }

  async function copy(indexInRows: number, url: string) {
    const value = url.trim();
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      return; // clipboard unavailable (insecure context) — no confirmation
    }
    if (copyTimer.current) clearTimeout(copyTimer.current);
    setCopiedIndex(indexInRows);
    copyTimer.current = setTimeout(() => setCopiedIndex(null), 1500);
  }

  const gtc =
    fields === 2
      ? 'minmax(120px,260px) minmax(0,1fr) 24px 24px'
      : 'minmax(0,1fr) 24px 24px';

  return (
    <div className="flex flex-col gap-1.5">
      {fields === 2 && rows.length > 0 && (
        <div className="grid gap-2 text-[10px] uppercase tracking-wide text-[var(--faint)]" style={{ gridTemplateColumns: gtc }}>
          <span>Описание</span><span>Ссылка</span><span /><span />
        </div>
      )}
      {rows.map((row, i) => {
        const hasUrl = row.url.trim() !== '';
        const copied = copiedIndex === i;
        return (
          <div key={i} className="grid items-center gap-2" style={{ gridTemplateColumns: gtc }}>
            {fields === 2 && (
              <input
                value={row.label}
                onChange={(e) => update(i, { label: e.target.value })}
                placeholder="описание…"
                className="h-7 w-full min-w-0 rounded-[6px] border border-[var(--line-soft)] bg-white px-2 text-[12px] text-[var(--ink)]"
              />
            )}
            {/* URL input + hover tooltip showing the full link */}
            <div className="group relative min-w-0">
              <input
                value={row.url}
                onChange={(e) => update(i, { url: e.target.value })}
                placeholder="ссылка…"
                title={row.url}
                className="h-7 w-full min-w-0 rounded-[6px] border border-[var(--line-soft)] bg-white px-2 font-mono text-[12px] text-[var(--ink)]"
              />
              {hasUrl && (
                <span
                  role="tooltip"
                  className="pointer-events-none absolute bottom-full left-0 z-10 mb-1 hidden w-max max-w-[min(420px,90vw)] break-all rounded-[6px] bg-[var(--ink)] px-2 py-1 font-mono text-[11px] leading-snug text-white opacity-0 shadow-md transition-opacity duration-150 group-hover:block group-hover:opacity-100"
                >
                  {row.url}
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={() => copy(i, row.url)}
              disabled={!hasUrl}
              aria-label={copied ? 'Скопировано' : 'Копировать ссылку'}
              title={copied ? 'Скопировано' : 'Копировать ссылку'}
              className={`flex justify-center transition disabled:cursor-default disabled:opacity-30 ${
                copied ? 'text-[#087443]' : 'text-[var(--faint)] hover:text-[var(--ink)]'
              }`}
            >
              {copied ? <Check size={15} /> : <Copy size={15} />}
            </button>
            <button type="button" onClick={() => remove(i)} aria-label="Удалить строку" className="flex justify-center text-[var(--faint)] hover:text-[var(--ink)]">
              <Trash2 size={15} />
            </button>
          </div>
        );
      })}
      <button type="button" onClick={add} className="mt-1 flex w-fit items-center gap-1 text-[12px] font-semibold text-[var(--orange)]">
        <Plus size={13} /> добавить
      </button>
    </div>
  );
}
