'use client';

import { Trash2, Plus } from 'lucide-react';
import type { BlockItem } from '@/lib/funnel-blocks';

interface Props {
  fields: 1 | 2;
  slot: '15' | '19' | null;
  items: BlockItem[];
  onChange: (items: BlockItem[]) => void;
}

export default function BlockListField({ fields, slot, items, onChange }: Props) {
  const rows = items.filter((it) => it.slot === slot);

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

  return (
    <div className="flex flex-col gap-1.5">
      {fields === 2 && rows.length > 0 && (
        <div className="grid grid-cols-[150px_1fr_24px] gap-2 text-[10px] uppercase tracking-wide text-[var(--faint)]">
          <span>Описание</span><span>Ссылка</span><span />
        </div>
      )}
      {rows.map((row, i) => (
        <div
          key={i}
          className={
            fields === 2
              ? 'grid grid-cols-[150px_1fr_24px] items-center gap-2'
              : 'grid grid-cols-[1fr_24px] items-center gap-2'
          }
        >
          {fields === 2 && (
            <input
              value={row.label}
              onChange={(e) => update(i, { label: e.target.value })}
              placeholder="описание…"
              className="h-7 rounded-[6px] border border-[var(--line-soft)] bg-white px-2 text-[12px] text-[var(--ink)]"
            />
          )}
          <input
            value={row.url}
            onChange={(e) => update(i, { url: e.target.value })}
            placeholder="ссылка…"
            className="h-7 rounded-[6px] border border-[var(--line-soft)] bg-white px-2 font-mono text-[12px] text-[var(--ink)]"
          />
          <button type="button" onClick={() => remove(i)} aria-label="Удалить строку" className="text-[var(--faint)] hover:text-[var(--ink)]">
            <Trash2 size={15} />
          </button>
        </div>
      ))}
      <button type="button" onClick={add} className="mt-1 flex w-fit items-center gap-1 text-[12px] font-semibold text-[var(--orange)]">
        <Plus size={13} /> добавить
      </button>
    </div>
  );
}
