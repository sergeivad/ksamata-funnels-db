'use client';

import { Plus } from 'lucide-react';
import { useState } from 'react';

interface RefRow {
  id: number;
  name: string;
}

interface RefTableProps {
  title: string;
  rows: RefRow[];
  onAdd: (name: string) => void;
}

export default function RefTable({ title, rows, onAdd }: RefTableProps) {
  const [inputValue, setInputValue] = useState('');

  function handleAdd() {
    const trimmed = inputValue.trim();
    if (!trimmed) return;
    onAdd(trimmed);
    setInputValue('');
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') handleAdd();
  }

  return (
    <div className="rounded-[12px] border border-[var(--color-border-soft)] bg-[var(--color-bg-panel)] p-4">
      <h3 className="mb-3 text-[13px] font-semibold text-[var(--color-text)]">
        {title}
      </h3>

      {rows.length > 0 ? (
        <ul className="mb-3 divide-y divide-[var(--color-border-soft)]">
          {rows.map((row) => (
            <li
              key={row.id}
              className="py-1.5 text-[13px] text-[var(--color-text)]"
            >
              {row.name}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mb-3 text-[12px] text-[var(--color-text-secondary)]">
          Нет записей
        </p>
      )}

      {/* Inline add */}
      <div className="flex gap-2">
        <input
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Добавить..."
          className="min-w-0 flex-1 rounded-[6px] border border-[var(--color-border-soft)] bg-white px-2.5 py-1.5 text-[12px] text-[var(--color-text)] placeholder:text-[var(--color-text-secondary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
        />
        <button
          type="button"
          onClick={handleAdd}
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] border border-[var(--color-border-soft)] bg-white text-[var(--color-text)] transition hover:border-[#111111]"
          aria-label="Добавить"
          title="Добавить"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
