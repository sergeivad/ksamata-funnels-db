'use client';

import { useState } from 'react';
import { Tv, Plus, X } from 'lucide-react';
import Switch from './Switch';
import UrlInput from './UrlInput';
import type { DayCell } from '@/lib/funnel-days';

interface Props {
  funnelId: number;
  initialDays: DayCell[];
  replayEnabled: boolean;
  timeLabelA: string;
  timeLabelB: string;
}

const SLOTS: ('15' | '19')[] = ['15', '19'];
const MAX_DAYS = 5;

type Cell = { gcRoom: string; webRoom: string; replayUrl: string };
type Grid = Record<string, Cell>; // key `${slot}-${day}`

function key(slot: string, day: number) { return `${slot}-${day}`; }

function buildGrid(days: DayCell[], dayCount: number): Grid {
  const g: Grid = {};
  for (const slot of SLOTS) for (let d = 1; d <= dayCount; d++) g[key(slot, d)] = { gcRoom: '', webRoom: '', replayUrl: '' };
  for (const d of days) g[key(d.timeSlot, d.dayNum)] = { gcRoom: d.gcRoom, webRoom: d.webRoom, replayUrl: d.replayUrl };
  return g;
}

export default function RoomsEditor({ funnelId, initialDays, replayEnabled, timeLabelA, timeLabelB }: Props) {
  const initialDayCount = Math.max(3, ...initialDays.map((d) => d.dayNum), 0) || 3;
  const [dayCount, setDayCount] = useState(Math.min(MAX_DAYS, initialDayCount));
  const [replay, setReplay] = useState(replayEnabled);
  const [grid, setGrid] = useState<Grid>(() => buildGrid(initialDays, Math.min(MAX_DAYS, initialDayCount)));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const labels = { '15': timeLabelA, '19': timeLabelB } as const;

  function set(slot: string, day: number, field: keyof Cell, value: string) {
    setGrid((p) => ({ ...p, [key(slot, day)]: { ...p[key(slot, day)], [field]: value } }));
  }

  function addDay() {
    if (dayCount >= MAX_DAYS) return;
    const next = dayCount + 1;
    setGrid((p) => {
      const g = { ...p };
      for (const slot of SLOTS) g[key(slot, next)] = { gcRoom: '', webRoom: '', replayUrl: '' };
      return g;
    });
    setDayCount(next);
  }

  // Remove a day from both slots and renumber the remaining days so they stay
  // a contiguous 1..N sequence. Never removes the last remaining day.
  function removeDay(target: number) {
    if (dayCount <= 1) return;
    setGrid((p) => {
      const g: Grid = {};
      for (const slot of SLOTS) {
        let newDay = 0;
        for (let d = 1; d <= dayCount; d++) {
          if (d === target) continue;
          newDay += 1;
          g[key(slot, newDay)] = p[key(slot, d)];
        }
      }
      return g;
    });
    setDayCount(dayCount - 1);
  }

  async function save() {
    setSaving(true);
    setError(null);
    const cells: DayCell[] = [];
    for (const slot of SLOTS) for (let d = 1; d <= dayCount; d++) {
      const c = grid[key(slot, d)];
      cells.push({ timeSlot: slot, dayNum: d, gcRoom: c.gcRoom, webRoom: c.webRoom, replayUrl: replay ? c.replayUrl : '' });
    }
    try {
      const daysRes = await fetch(`/api/funnels/${funnelId}/days`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cells }),
      });
      if (!daysRes.ok) {
        const body = await daysRes.json().catch(() => null);
        throw new Error(body?.error ?? `Не удалось сохранить комнаты (${daysRes.status})`);
      }
      // Persist replay flag on the funnel
      const flagRes = await fetch(`/api/funnels/${funnelId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ roomsReplayEnabled: replay }),
      });
      if (!flagRes.ok) {
        const body = await flagRes.json().catch(() => null);
        throw new Error(body?.error ?? `Не удалось сохранить настройку повтора (${flagRes.status})`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось сохранить');
    } finally { setSaving(false); }
  }

  const gtc = replay
    ? '22px minmax(0,1fr) minmax(0,1fr) minmax(0,0.8fr)'
    : '22px minmax(0,1fr) minmax(0,1fr)';

  return (
    <div className="mb-2.5 rounded-[10px] border border-[var(--line-soft)] bg-[var(--paper)] p-3.5">
      <div className="mb-2 flex items-center gap-2">
        <Tv size={17} className="text-[var(--orange)]" />
        <span className="text-[13px] font-medium">Вебинарные комнаты</span>
        <span className="ml-auto"><Switch checked={replay} onChange={setReplay} label="повтор" /></span>
      </div>

      <div className="flex gap-2.5">
        {SLOTS.map((slot) => (
          <div key={slot} className="min-w-0 flex-1">
            <div className="mb-1 text-[11px] font-medium text-[var(--muted)]">{labels[slot]}</div>
            <div className="grid items-center gap-x-1.5 gap-y-1" style={{ gridTemplateColumns: gtc }}>
              <span /><span className="text-[10px] text-[var(--faint)]">GC</span>
              <span className="text-[10px] text-[var(--faint)]">Web</span>
              {replay && <span className="text-[10px] text-[var(--faint)]">повтор</span>}
              {Array.from({ length: dayCount }, (_, idx) => idx + 1).map((day) => {
                const c = grid[key(slot, day)];
                return (
                  <FragmentRow key={day} day={day} cell={c} replay={replay}
                    canRemove={dayCount > 1}
                    onRemove={() => removeDay(day)}
                    onChange={(f, v) => set(slot, day, f, v)} />
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-2 flex items-center justify-between">
        <button type="button" onClick={addDay} disabled={dayCount >= MAX_DAYS}
          className="flex items-center gap-1 text-[12px] font-semibold text-[var(--orange)] disabled:opacity-40">
          <Plus size={13} /> добавить день
        </button>
        <div className="flex items-center gap-3">
          {error && <span role="alert" className="text-[11px] font-medium text-[#B42318]">{error}</span>}
          <button type="button" onClick={save} disabled={saving}
            className="rounded-[8px] bg-[var(--orange)] px-4 py-1.5 text-[12px] font-semibold text-white disabled:opacity-60">
            {saving ? 'Сохранение…' : 'Сохранить'}
          </button>
        </div>
      </div>
    </div>
  );
}

function FragmentRow({ day, cell, replay, canRemove, onRemove, onChange }: {
  day: number; cell: { gcRoom: string; webRoom: string; replayUrl: string };
  replay: boolean; canRemove: boolean; onRemove: () => void;
  onChange: (field: 'gcRoom' | 'webRoom' | 'replayUrl', value: string) => void;
}) {
  const inp = 'h-7 w-full min-w-0 rounded-[5px] border border-[var(--line-soft)] bg-white px-2 font-mono text-[12px] text-[var(--ink)]';
  return (
    <>
      <span className="group/day relative rounded-[4px] bg-[var(--chip)] py-[2px] text-center font-mono text-[10px] text-[var(--muted)]">
        {day}
        {canRemove && (
          <button
            type="button"
            onClick={onRemove}
            aria-label={`Удалить день ${day}`}
            title="Удалить день"
            className="absolute -right-1.5 -top-1.5 hidden h-3.5 w-3.5 items-center justify-center rounded-full bg-[#B42318] text-white shadow-sm group-hover/day:flex hover:bg-[#8f1c11]"
          >
            <X size={9} strokeWidth={3} />
          </button>
        )}
      </span>
      <UrlInput className={inp} value={cell.gcRoom} placeholder="gc…" onChange={(v) => onChange('gcRoom', v)} />
      <UrlInput className={inp} value={cell.webRoom} placeholder="web…" onChange={(v) => onChange('webRoom', v)} />
      {replay && <UrlInput className={inp} value={cell.replayUrl} placeholder="повтор…" onChange={(v) => onChange('replayUrl', v)} />}
    </>
  );
}
