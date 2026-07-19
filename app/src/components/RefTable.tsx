'use client';

import { Plus, Pencil, Trash2, Check, X } from 'lucide-react';
import { useState } from 'react';

interface RefRow {
  id: number;
  name: string;
}

interface RefTableProps {
  title: string;
  rows: RefRow[];
  onAdd: (name: string) => Promise<{ ok: boolean; error?: string }>;
  onRename: (id: number, newName: string) => Promise<{ ok: boolean; error?: string }>;
  onDelete: (id: number) => Promise<{ ok: boolean; error?: string }>;
  /** Hide rename/delete (e.g. tags: system АВ-rows are managed by the app). */
  readOnly?: boolean;
}

// Row action icons are hover-revealed on pointer devices; on touch (no hover)
// they stay visible, and while hidden they don't intercept taps.
const REVEAL =
  'opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto focus-visible:opacity-100 focus-visible:pointer-events-auto [@media(hover:none)]:opacity-100 [@media(hover:none)]:pointer-events-auto';

export default function RefTable({ title, rows, onAdd, onRename, onDelete, readOnly }: RefTableProps) {
  const [inputValue, setInputValue] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editValue, setEditValue] = useState('');
  const [rowError, setRowError] = useState<{ id: number; message: string } | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  async function handleAdd() {
    const trimmed = inputValue.trim();
    if (!trimmed) return;
    setAddError(null);
    const result = await onAdd(trimmed);
    if (result.ok) {
      setInputValue('');
    } else {
      // Keep the typed name so the employee can fix it instead of retyping.
      setAddError(result.error ?? 'Не удалось добавить');
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') handleAdd();
  }

  function startEdit(row: RefRow) {
    setEditingId(row.id);
    setEditValue(row.name);
    setRowError(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditValue('');
  }

  async function commitEdit(row: RefRow) {
    const trimmed = editValue.trim();
    if (!trimmed || trimmed === row.name) {
      cancelEdit();
      return;
    }
    setBusyId(row.id);
    const result = await onRename(row.id, trimmed);
    setBusyId(null);
    if (result.ok) {
      cancelEdit();
      setRowError(null);
    } else {
      setRowError({ id: row.id, message: result.error ?? 'Не удалось переименовать' });
    }
  }

  function handleEditKeyDown(e: React.KeyboardEvent<HTMLInputElement>, row: RefRow) {
    if (e.key === 'Enter') commitEdit(row);
    if (e.key === 'Escape') cancelEdit();
  }

  async function handleDelete(row: RefRow) {
    if (!window.confirm(`Удалить «${row.name}»?`)) return;
    setBusyId(row.id);
    setRowError(null);
    const result = await onDelete(row.id);
    setBusyId(null);
    if (!result.ok) {
      setRowError({ id: row.id, message: result.error ?? 'Не удалось удалить' });
    }
  }

  return (
    <div className="rounded-[12px] border border-[var(--color-border-soft)] bg-[var(--color-bg-panel)] p-4">
      <h3 className="mb-3 text-[13px] font-semibold text-[var(--color-text)]">
        {title}
      </h3>

      {rows.length > 0 ? (
        <ul className="mb-3 divide-y divide-[var(--color-border-soft)]">
          {rows.map((row) => {
            const isEditing = editingId === row.id;
            const isBusy = busyId === row.id;
            return (
              <li key={row.id} className="group py-1.5 text-[13px] text-[var(--color-text)]">
                <div className="flex items-center gap-2">
                  {isEditing ? (
                    <>
                      <input
                        autoFocus
                        type="text"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onKeyDown={(e) => handleEditKeyDown(e, row)}
                        className="min-w-0 flex-1 rounded-[6px] border border-[var(--color-border-soft)] bg-white px-2 py-1 text-[13px] text-[var(--color-text)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
                      />
                      <button
                        type="button"
                        onClick={() => commitEdit(row)}
                        disabled={isBusy}
                        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] text-[var(--color-text-secondary)] transition hover:text-[var(--color-text)] disabled:opacity-50"
                        aria-label="Сохранить"
                        title="Сохранить (Enter)"
                      >
                        <Check className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={cancelEdit}
                        disabled={isBusy}
                        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] text-[var(--color-text-secondary)] transition hover:text-[var(--color-text)] disabled:opacity-50"
                        aria-label="Отменить"
                        title="Отменить (Esc)"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </>
                  ) : (
                    <>
                      <span className="min-w-0 flex-1 truncate">{row.name}</span>
                      {!readOnly && (
                      <>
                      <button
                        type="button"
                        onClick={() => startEdit(row)}
                        className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] text-[var(--color-text-secondary)] transition hover:text-[var(--color-text)] ${REVEAL}`}
                        aria-label="Переименовать"
                        title="Переименовать"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(row)}
                        disabled={isBusy}
                        className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] text-[var(--color-text-secondary)] transition hover:text-[#c0392b] disabled:opacity-50 ${REVEAL}`}
                        aria-label="Удалить"
                        title="Удалить"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                      </>
                      )}
                    </>
                  )}
                </div>
                {rowError?.id === row.id && (
                  <p className="mt-1 text-[11px] text-[#c0392b]">{rowError.message}</p>
                )}
              </li>
            );
          })}
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
          onChange={(e) => { setInputValue(e.target.value); setAddError(null); }}
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
      {addError && <p className="mt-1 text-[11px] text-[#c0392b]">{addError}</p>}
    </div>
  );
}
