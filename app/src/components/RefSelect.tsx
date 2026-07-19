'use client';

import { useEffect, useState } from 'react';

interface RefRow {
  id: number;
  name: string;
}

interface RefSelectProps {
  kind: 'products' | 'contractors' | 'channels' | 'directions';
  label: string;
  value: string;
  onChange: (val: string) => void;
  required?: boolean;
  error?: string;
}

async function fetchRefs(kind: string): Promise<RefRow[]> {
  const res = await fetch(`/api/refs/${kind}`);
  if (!res.ok) return [];
  return res.json();
}

async function addRef(kind: string, name: string): Promise<RefRow | null> {
  const res = await fetch(`/api/refs/${kind}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) return null;
  return res.json();
}

export default function RefSelect({ kind, label, value, onChange, required, error }: RefSelectProps) {
  const [refs, setRefs] = useState<RefRow[]>([]);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [addError, setAddError] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadFailed(false);
    fetchRefs(kind)
      .then((rows) => {
        if (cancelled) return;
        setRefs(rows);
        setLoading(false);
      })
      .catch(() => {
        // Network failure — without this the select is stuck on «Загрузка...»
        if (cancelled) return;
        setLoading(false);
        setLoadFailed(true);
      });
    return () => { cancelled = true; };
  }, [kind, reloadKey]);

  async function handleAdd() {
    const trimmed = newName.trim();
    if (!trimmed) {
      setAddError('Введите название');
      return;
    }
    setAddError('');
    const row = await addRef(kind, trimmed);
    if (!row) {
      setAddError('Ошибка при добавлении');
      return;
    }
    setRefs((prev) => {
      // Avoid duplicate
      if (prev.some((r) => r.id === row.id)) return prev;
      return [...prev, row].sort((a, b) => a.name.localeCompare(b.name));
    });
    onChange(row.name);
    setNewName('');
    setAdding(false);
  }

  return (
    <div className="flex flex-col gap-1">
      <label className="text-[12px] font-semibold text-[var(--color-text-secondary)]">
        {label}
        {required && <span className="ml-1 text-[#B42318]">*</span>}
      </label>

      {loading ? (
        <div className="h-9 rounded-[8px] border border-[var(--color-border-soft)] bg-white/60 px-3 py-2 text-[13px] text-[var(--color-text-secondary)]">
          Загрузка...
        </div>
      ) : loadFailed ? (
        <div className="flex h-9 items-center gap-2 rounded-[8px] border border-[#F3B2AA] bg-[#FEF3F2] px-3 text-[13px] text-[#B42318]">
          Не удалось загрузить
          <button
            type="button"
            onClick={() => setReloadKey((k) => k + 1)}
            className="ml-auto text-[12px] font-semibold underline hover:no-underline"
          >
            Повторить
          </button>
        </div>
      ) : (
        <select
          value={value}
          onChange={(e) => {
            if (e.target.value === '__add__') {
              setAdding(true);
            } else {
              onChange(e.target.value);
            }
          }}
          className={[
            'h-9 w-full rounded-[8px] border bg-white px-3 py-2 text-[13px] text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]',
            error
              ? 'border-[#B42318]'
              : 'border-[var(--color-border-soft)]',
          ].join(' ')}
        >
          <option value="">— выберите —</option>
          {/* If the stored value isn't in the ref table (e.g. contractor names
              that live only in AV tags), still show it so the select reflects
              the real value instead of silently falling back to the placeholder. */}
          {value && !refs.some((r) => r.name === value) && (
            <option value={value}>{value}</option>
          )}
          {refs.map((r) => (
            <option key={r.id} value={r.name}>
              {r.name}
            </option>
          ))}
          <option value="__add__">＋ Добавить новое...</option>
        </select>
      )}

      {adding && (
        <div className="mt-1 flex gap-2">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
            placeholder="Название..."
            className="min-w-0 flex-1 rounded-[6px] border border-[var(--color-border-soft)] bg-white px-2.5 py-1.5 text-[12px] text-[var(--color-text)] placeholder:text-[var(--color-text-secondary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
            autoFocus
          />
          <button
            type="button"
            onClick={handleAdd}
            className="rounded-[6px] border border-[var(--color-border-soft)] bg-white px-3 py-1.5 text-[12px] font-semibold text-[var(--color-text)] transition hover:border-[#111111]"
          >
            Добавить
          </button>
          <button
            type="button"
            onClick={() => {
              setAdding(false);
              setNewName('');
              setAddError('');
            }}
            className="rounded-[6px] border border-[var(--color-border-soft)] bg-white px-3 py-1.5 text-[12px] text-[var(--color-text-secondary)] transition hover:border-[#111111]"
          >
            Отмена
          </button>
        </div>
      )}

      {(error || addError) && (
        <p className="text-[11px] text-[#B42318]">{error || addError}</p>
      )}
    </div>
  );
}
