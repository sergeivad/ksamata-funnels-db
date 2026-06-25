'use client';

import { useRef, useState } from 'react';
import { ChevronUp, ChevronDown, Trash2 } from 'lucide-react';
import Toast from './Toast';

// XSS guard: only render as <a href> when protocol is safe
function isSafeUrl(url: string): boolean {
  return url.startsWith('http://') || url.startsWith('https://');
}

interface LinkRow {
  label: string;
  url: string;
}

interface Props {
  funnelId: number;
  initialLinks: LinkRow[];
}

interface ToastState {
  message: string;
  variant: 'success' | 'error';
  key: number;
}

export default function LinksEditor({ funnelId, initialLinks }: Props) {
  const [rows, setRows] = useState<LinkRow[]>(() =>
    initialLinks.map((l) => ({ label: l.label, url: l.url })),
  );
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);
  const toastKeyRef = useRef(0);

  function showToast(message: string, variant: 'success' | 'error') {
    toastKeyRef.current += 1;
    setToast({ message, variant, key: toastKeyRef.current });
  }

  function addRow() {
    setRows((prev) => [...prev, { label: '', url: '' }]);
  }

  function deleteRow(index: number) {
    setRows((prev) => prev.filter((_, i) => i !== index));
  }

  function moveUp(index: number) {
    if (index === 0) return;
    setRows((prev) => {
      const next = [...prev];
      [next[index - 1], next[index]] = [next[index], next[index - 1]];
      return next;
    });
  }

  function moveDown(index: number) {
    setRows((prev) => {
      if (index >= prev.length - 1) return prev;
      const next = [...prev];
      [next[index], next[index + 1]] = [next[index + 1], next[index]];
      return next;
    });
  }

  function updateLabel(index: number, value: string) {
    setRows((prev) =>
      prev.map((r, i) => (i === index ? { ...r, label: value } : r)),
    );
  }

  function updateUrl(index: number, value: string) {
    setRows((prev) =>
      prev.map((r, i) => (i === index ? { ...r, url: value } : r)),
    );
  }

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch(`/api/funnels/${funnelId}/links`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: rows }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? 'Ошибка сервера');
      }

      // Sync state from server response (canonical order from DB)
      const updated: { id: number; label: string; url: string; position: number }[] =
        await res.json();
      setRows(updated.map((l) => ({ label: l.label, url: l.url })));

      showToast('Ссылки сохранены', 'success');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Произошла ошибка';
      showToast(msg, 'error');
    } finally {
      setSaving(false);
    }
  }

  const iconBtnClass =
    'flex h-7 w-7 items-center justify-center rounded-[6px] border border-[var(--color-border-soft)] bg-white text-[var(--color-text-secondary)] transition hover:border-[#111111] hover:text-[var(--color-text)] disabled:opacity-30 disabled:cursor-not-allowed';

  return (
    <>
      <section className="mx-auto max-w-[640px] px-4 pb-10">
        <div className="rounded-[12px] border border-[var(--color-border-soft)] bg-[var(--color-bg-panel)] p-6">
          <h2 className="mb-5 text-[15px] font-semibold text-[var(--color-text)]">
            Ссылки / дашборды
          </h2>

          {/* Rows */}
          <div className="flex flex-col gap-3">
            {rows.length === 0 && (
              <p className="text-[12px] text-[var(--color-text-secondary)]">
                Нет ссылок. Нажмите «+ Добавить ссылку», чтобы добавить первую.
              </p>
            )}

            {rows.map((row, i) => (
              <div
                key={i}
                className="flex items-start gap-2 rounded-[8px] border border-[var(--color-border-soft)] bg-white/70 p-3"
              >
                {/* Reorder buttons */}
                <div className="flex flex-col gap-1 pt-0.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => moveUp(i)}
                    disabled={i === 0}
                    className={iconBtnClass}
                    aria-label="Переместить вверх"
                  >
                    <ChevronUp className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => moveDown(i)}
                    disabled={i === rows.length - 1}
                    className={iconBtnClass}
                    aria-label="Переместить вниз"
                  >
                    <ChevronDown className="h-3.5 w-3.5" />
                  </button>
                </div>

                {/* Label + URL inputs */}
                <div className="flex-1 flex flex-col gap-2 min-w-0">
                  <input
                    type="text"
                    value={row.label}
                    onChange={(e) => updateLabel(i, e.target.value)}
                    placeholder="Название (напр. Дашборд продаж)"
                    className="h-8 w-full rounded-[6px] border border-[var(--color-border-soft)] bg-white px-2.5 text-[12px] text-[var(--color-text)] placeholder:text-[var(--color-text-secondary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
                  />
                  <input
                    type="text"
                    value={row.url}
                    onChange={(e) => updateUrl(i, e.target.value)}
                    placeholder="https://..."
                    className="h-8 w-full rounded-[6px] border border-[var(--color-border-soft)] bg-white px-2.5 font-mono text-[11px] text-[var(--color-text)] placeholder:text-[var(--color-text-secondary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
                  />
                  {/* Render guard: clickable link only for safe URLs */}
                  {row.url && (
                    <div className="text-[11px]">
                      {isSafeUrl(row.url) ? (
                        <a
                          href={row.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[var(--color-accent)] underline break-all"
                        >
                          {row.url}
                        </a>
                      ) : (
                        <span className="text-[#B42318] break-all">
                          Небезопасный URL — не будет открыт как ссылка
                        </span>
                      )}
                    </div>
                  )}
                </div>

                {/* Delete button */}
                <button
                  type="button"
                  onClick={() => deleteRow(i)}
                  className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] border border-[var(--color-border-soft)] bg-white text-[var(--color-text-secondary)] transition hover:border-[#B42318] hover:text-[#B42318]"
                  aria-label="Удалить ссылку"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>

          {/* Add row + Save */}
          <div className="mt-4 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={addRow}
              className="rounded-[8px] border border-[var(--color-border-soft)] bg-white px-4 py-2 text-[13px] text-[var(--color-text)] transition hover:border-[#111111]"
            >
              + Добавить ссылку
            </button>

            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="rounded-[8px] bg-[var(--color-accent)] px-5 py-2 text-[13px] font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
            >
              {saving ? 'Сохранение...' : 'Сохранить ссылки'}
            </button>
          </div>
        </div>
      </section>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 pointer-events-none">
          <Toast
            key={toast.key}
            message={toast.message}
            variant={toast.variant}
            onClose={() => setToast(null)}
          />
        </div>
      )}
    </>
  );
}
