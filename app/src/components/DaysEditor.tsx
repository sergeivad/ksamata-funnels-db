'use client';

import { useRef, useState } from 'react';
import Toast from './Toast';
import type { DayCell } from '@/lib/funnel-days';

interface Props {
  funnelId: number;
  initialDays: DayCell[];
}

type TimeSlot = '19' | '15';

const TIME_SLOTS: TimeSlot[] = ['19', '15'];
const DAY_NUMS = [1, 2, 3, 4, 5] as const;

/** Build a key for the cells map */
function cellKey(timeSlot: TimeSlot, dayNum: number): string {
  return `${timeSlot}-${dayNum}`;
}

type CellsMap = Record<string, { gcRoom: string; webRoom: string; salesPage: string }>;

function buildInitialCells(initialDays: DayCell[]): CellsMap {
  const map: CellsMap = {};
  // Pre-fill blanks
  for (const slot of TIME_SLOTS) {
    for (const day of DAY_NUMS) {
      map[cellKey(slot, day)] = { gcRoom: '', webRoom: '', salesPage: '' };
    }
  }
  // Overlay existing data
  for (const cell of initialDays) {
    const k = cellKey(cell.timeSlot, cell.dayNum);
    map[k] = { gcRoom: cell.gcRoom, webRoom: cell.webRoom, salesPage: cell.salesPage };
  }
  return map;
}

interface ToastState {
  message: string;
  variant: 'success' | 'error';
  key: number;
}

export default function DaysEditor({ funnelId, initialDays }: Props) {
  const [cells, setCells] = useState<CellsMap>(() => buildInitialCells(initialDays));
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);
  const toastKeyRef = useRef(0);

  function showToast(message: string, variant: 'success' | 'error') {
    toastKeyRef.current += 1;
    setToast({ message, variant, key: toastKeyRef.current });
  }

  function updateCell(
    timeSlot: TimeSlot,
    dayNum: number,
    field: 'gcRoom' | 'webRoom' | 'salesPage',
    value: string,
  ) {
    const k = cellKey(timeSlot, dayNum);
    setCells((prev) => ({
      ...prev,
      [k]: { ...prev[k], [field]: value },
    }));
  }

  async function handleSave() {
    setSaving(true);

    const payload: DayCell[] = [];
    for (const slot of TIME_SLOTS) {
      for (const day of DAY_NUMS) {
        const k = cellKey(slot, day);
        payload.push({
          timeSlot: slot,
          dayNum: day,
          gcRoom: cells[k].gcRoom,
          webRoom: cells[k].webRoom,
          salesPage: cells[k].salesPage,
        });
      }
    }

    try {
      const res = await fetch(`/api/funnels/${funnelId}/days`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cells: payload }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? 'Ошибка сервера');
      }

      // Sync state from server response (canonical empty-trimmed data)
      const updated: DayCell[] = await res.json();
      setCells(buildInitialCells(updated));

      showToast('Комнаты сохранены', 'success');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Произошла ошибка';
      showToast(msg, 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <section className="mx-auto max-w-[640px] px-4 pb-10">
        <div className="rounded-[12px] border border-[var(--color-border-soft)] bg-[var(--color-bg-panel)] p-6">
          <h2 className="mb-5 text-[15px] font-semibold text-[var(--color-text)]">
            Вебинарные комнаты и ленды
          </h2>

          {/* Column headers */}
          <div className="mb-3 grid grid-cols-[auto_1fr_1fr] gap-x-4 sm:grid-cols-[auto_1fr_1fr]">
            <div className="w-[60px]" />
            {TIME_SLOTS.map((slot) => (
              <div
                key={slot}
                className="text-center text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]"
              >
                {slot}:00
              </div>
            ))}
          </div>

          {/* Rows: one per day */}
          <div className="flex flex-col gap-4">
            {DAY_NUMS.map((day) => (
              <div key={day} className="grid grid-cols-[auto_1fr_1fr] gap-x-4 gap-y-0">
                {/* Day label */}
                <div className="flex w-[60px] items-start pt-2">
                  <span className="rounded-[6px] border border-[var(--color-border-soft)] bg-[var(--chip)] px-2 py-1 font-mono text-[11px] font-semibold text-[var(--color-text-secondary)]">
                    День {day}
                  </span>
                </div>

                {/* Two time-slot cells side by side */}
                {TIME_SLOTS.map((slot) => {
                  const k = cellKey(slot, day);
                  const cell = cells[k];
                  return (
                    <div
                      key={slot}
                      className="flex flex-col gap-1.5 rounded-[8px] border border-[var(--color-border-soft)] bg-white/70 p-2.5"
                    >
                      {/* GC-комната */}
                      <div className="flex flex-col gap-0.5">
                        <label className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">
                          GC-комната
                        </label>
                        <input
                          type="text"
                          value={cell.gcRoom}
                          onChange={(e) => updateCell(slot, day, 'gcRoom', e.target.value)}
                          placeholder="GC room..."
                          className="h-7 w-full rounded-[6px] border border-[var(--color-border-soft)] bg-white px-2 font-mono text-[11px] text-[var(--color-text)] placeholder:text-[var(--color-text-secondary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
                        />
                      </div>

                      {/* web-комната */}
                      <div className="flex flex-col gap-0.5">
                        <label className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">
                          Web-комната
                        </label>
                        <input
                          type="text"
                          value={cell.webRoom}
                          onChange={(e) => updateCell(slot, day, 'webRoom', e.target.value)}
                          placeholder="web room..."
                          className="h-7 w-full rounded-[6px] border border-[var(--color-border-soft)] bg-white px-2 font-mono text-[11px] text-[var(--color-text)] placeholder:text-[var(--color-text-secondary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
                        />
                      </div>

                      {/* Страница-ленд */}
                      <div className="flex flex-col gap-0.5">
                        <label className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">
                          Страница-ленд
                        </label>
                        <input
                          type="text"
                          value={cell.salesPage}
                          onChange={(e) => updateCell(slot, day, 'salesPage', e.target.value)}
                          placeholder="https://..."
                          className="h-7 w-full rounded-[6px] border border-[var(--color-border-soft)] bg-white px-2 font-mono text-[11px] text-[var(--color-text)] placeholder:text-[var(--color-text-secondary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>

          {/* Save button */}
          <div className="mt-5 flex justify-end">
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="rounded-[8px] bg-[var(--color-accent)] px-5 py-2 text-[13px] font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
            >
              {saving ? 'Сохранение...' : 'Сохранить комнаты'}
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
