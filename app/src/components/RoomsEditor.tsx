'use client';

import { useState } from 'react';
import { Tv, Plus } from 'lucide-react';
import Switch from './Switch';
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

  async function save() {
    setSaving(true);
    const cells: DayCell[] = [];
    for (const slot of SLOTS) for (let d = 1; d <= dayCount; d++) {
      const c = grid[key(slot, d)];
      cells.push({ timeSlot: slot, dayNum: d, gcRoom: c.gcRoom, webRoom: c.webRoom, replayUrl: replay ? c.replayUrl : '' });
    }
    try {
      await fetch(`/api/funnels/${funnelId}/days`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cells }),
      });
      // Persist replay flag on the funnel
      await fetch(`/api/funnels/${funnelId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ roomsReplayEnabled: replay }),
      });
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
        <button type="button" onClick={save} disabled={saving}
          className="rounded-[8px] bg-[var(--orange)] px-4 py-1.5 text-[12px] font-semibold text-white disabled:opacity-60">
          {saving ? 'Сохранение…' : 'Сохранить'}
        </button>
      </div>
    </div>
  );
}

function FragmentRow({ day, cell, replay, onChange }: {
  day: number; cell: { gcRoom: string; webRoom: string; replayUrl: string };
  replay: boolean; onChange: (field: 'gcRoom' | 'webRoom' | 'replayUrl', value: string) => void;
}) {
  const inp = 'h-7 w-full min-w-0 rounded-[5px] border border-[var(--line-soft)] bg-white px-2 font-mono text-[12px] text-[var(--ink)]';
  return (
    <>
      <span className="rounded-[4px] bg-[var(--chip)] py-[2px] text-center font-mono text-[10px] text-[var(--muted)]">{day}</span>
      <input className={inp} value={cell.gcRoom} placeholder="gc…" onChange={(e) => onChange('gcRoom', e.target.value)} />
      <input className={inp} value={cell.webRoom} placeholder="web…" onChange={(e) => onChange('webRoom', e.target.value)} />
      {replay && <input className={inp} value={cell.replayUrl} placeholder="повтор…" onChange={(e) => onChange('replayUrl', e.target.value)} />}
    </>
  );
}
