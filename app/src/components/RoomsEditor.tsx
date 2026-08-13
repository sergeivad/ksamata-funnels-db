'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Tv, Plus, X, Wand2 } from 'lucide-react';
import Switch from './Switch';
import UrlInput from './UrlInput';
import type { DayCell } from '@/lib/funnel-days';
import { webRoomFromGc } from '@/lib/room-urls';
import { SLOTS, buildGrid, cellsFromGrid, fillRoomGrid, gridKey as key, type RoomCell as Cell, type RoomGrid as Grid } from '@/lib/rooms-grid';
import { useCanEdit } from './AuthProvider';

interface Props {
  funnelId: number;
  initialDays: DayCell[];
  enabled: boolean;
  replayEnabled: boolean;
  timeLabelA: string;
  timeLabelB: string;
  onDirtyChange?: (dirty: boolean) => void;
}

const MAX_DAYS = 5;

type SavedSnapshot = { enabled: boolean; replay: boolean; cells: DayCell[] };

export default function RoomsEditor({ funnelId, initialDays, enabled: enabledProp, replayEnabled, timeLabelA, timeLabelB, onDirtyChange }: Props) {
  const canEdit = useCanEdit();
  const initialDayCount = Math.max(3, ...initialDays.map((d) => d.dayNum), 0) || 3;
  const clampedInitialDayCount = Math.min(MAX_DAYS, initialDayCount);
  const [dayCount, setDayCount] = useState(clampedInitialDayCount);
  const [enabled, setEnabled] = useState(enabledProp);
  const [replay, setReplay] = useState(replayEnabled);
  const [grid, setGrid] = useState<Grid>(() => buildGrid(initialDays, clampedInitialDayCount));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const labels = { '15': timeLabelA, '19': timeLabelB } as const;

  // Snapshot of the last successfully persisted state, used to derive the
  // "unsaved changes" indicator by comparing it against the live grid.
  const [saved, setSaved] = useState<SavedSnapshot>(() => ({
    enabled: enabledProp,
    replay: replayEnabled,
    cells: cellsFromGrid(buildGrid(initialDays, clampedInitialDayCount), clampedInitialDayCount),
  }));

  const dirty =
    enabled !== saved.enabled ||
    replay !== saved.replay ||
    JSON.stringify(cellsFromGrid(grid, dayCount)) !== JSON.stringify(saved.cells);

  const onDirtyChangeRef = useRef(onDirtyChange);
  onDirtyChangeRef.current = onDirtyChange;
  useEffect(() => { onDirtyChangeRef.current?.(dirty); }, [dirty]);

  function set(slot: string, day: number, field: keyof Cell, value: string) {
    setGrid((p) => ({ ...p, [key(slot, day)]: { ...p[key(slot, day)], [field]: value } }));
  }

  // When the GC field is filled and Web left empty, derive Web from the GC
  // slug on blur (the slug is shared between the two platforms).
  function autofillWeb(slot: string, day: number) {
    setGrid((p) => {
      const c = p[key(slot, day)];
      if (c.webRoom.trim() !== '') return p;
      const web = webRoomFromGc(c.gcRoom);
      if (!web) return p;
      return { ...p, [key(slot, day)]: { ...c, webRoom: web } };
    });
  }

  // Сетка, достроенная по уже заполненным ячейкам. Кнопка предлагается ровно
  // тогда, когда достройка что-то меняет — отдельной эвристики «есть ли что
  // заполнить» нет, иначе она разъедется с самой достройкой.
  const filled = useMemo(() => fillRoomGrid(grid, dayCount, replay), [grid, dayCount, replay]);
  const canFill =
    JSON.stringify(cellsFromGrid(filled, dayCount)) !== JSON.stringify(cellsFromGrid(grid, dayCount));

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

  // Toggling the block on/off autosaves the flag immediately (like BlockEditor),
  // without PUTting days — disabling never erases stored rooms. The optimistic
  // flip is rolled back on failure so a rejected PATCH can't masquerade as saved.
  async function setEnabledPersist(v: boolean) {
    const prev = enabled;
    setEnabled(v);
    setError(null);
    try {
      const res = await fetch(`/api/funnels/${funnelId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ roomsEnabled: v }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Не удалось сохранить (${res.status})`);
      }
      setSaved((s) => ({ ...s, enabled: v }));
    } catch (e) {
      setEnabled(prev);
      setError(e instanceof Error ? e.message : 'Не удалось сохранить');
    }
  }

  async function save() {
    // Snapshot the values being submitted (not re-read after the await) so a
    // save started mid-edit doesn't wrongly mark newer edits as "saved".
    // The «повтор» toggle only hides the replay column — replayUrl is always
    // part of the payload, so turning it off never erases stored replay links.
    const submittedReplay = replay;
    const submittedEnabled = enabled;
    const cells = cellsFromGrid(grid, dayCount);
    setSaving(true);
    setError(null);
    try {
      const daysRes = await fetch(`/api/funnels/${funnelId}/days`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cells }),
      });
      if (!daysRes.ok) {
        const body = await daysRes.json().catch(() => null);
        throw new Error(body?.error ?? `Не удалось сохранить комнаты (${daysRes.status})`);
      }
      // Persist replay + enabled flags on the funnel
      const flagRes = await fetch(`/api/funnels/${funnelId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomsReplayEnabled: submittedReplay, roomsEnabled: submittedEnabled }),
      });
      if (!flagRes.ok) {
        const body = await flagRes.json().catch(() => null);
        throw new Error(body?.error ?? `Не удалось сохранить настройку повтора (${flagRes.status})`);
      }
      setSaved({ enabled: submittedEnabled, replay: submittedReplay, cells });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось сохранить');
    } finally { setSaving(false); }
  }

  const gtc = replay
    ? '22px minmax(0,1fr) minmax(0,1fr) minmax(0,0.8fr)'
    : '22px minmax(0,1fr) minmax(0,1fr)';

  if (!enabled) {
    return (
      <div className="mb-2.5 flex items-center gap-2 rounded-[10px] border border-[var(--line-soft)] bg-[var(--card)] px-3.5 py-2.5 opacity-60">
        <Tv size={16} className="text-[var(--faint)]" />
        <span className="text-[13px] font-medium text-[var(--muted)]">Вебинарные комнаты</span>
        <span className="ml-auto flex items-center gap-3">
          {error && <span role="alert" className="text-[11px] font-medium text-[#B42318]">{error}</span>}
          <Switch checked={false} onChange={(v) => setEnabledPersist(v)} disabled={!canEdit} />
        </span>
      </div>
    );
  }

  return (
    <div className="mb-2.5 rounded-[10px] border border-[var(--line-soft)] bg-[var(--paper)] p-3.5">
      <div className="mb-2 flex items-center gap-2">
        <Tv size={17} className="text-[var(--orange)]" />
        <span className="text-[13px] font-medium">Вебинарные комнаты</span>
        <span className="ml-auto flex items-center gap-3">
          <Switch checked={replay} onChange={setReplay} label="повтор" disabled={!canEdit} />
          <Switch checked={enabled} onChange={(v) => setEnabledPersist(v)} disabled={!canEdit} />
        </span>
      </div>

      {/* Two slot columns side by side; stacked on narrow screens where a
          half-width column leaves each URL input only ~55px. */}
      <div className="flex flex-col gap-4 sm:flex-row sm:gap-2.5">
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
                  <FragmentRow key={day} day={day} cell={c} replay={replay} canEdit={canEdit}
                    canRemove={canEdit && dayCount > 1}
                    onRemove={() => removeDay(day)}
                    onChange={(f, v) => set(slot, day, f, v)}
                    onGcBlur={() => autofillWeb(slot, day)} />
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {canEdit && (
      <div className="mt-2 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button type="button" onClick={addDay} disabled={dayCount >= MAX_DAYS}
            className="flex items-center gap-1 text-[12px] font-semibold text-[var(--orange)] disabled:opacity-40">
            <Plus size={13} /> добавить день
          </button>
          {canFill && (
            <button type="button" onClick={() => setGrid(filled)}
              title="Достроить пустые ячейки по образцу заполненных: другой день, второе время, Web из GC"
              className="flex items-center gap-1 text-[12px] font-semibold text-[var(--orange)]">
              <Wand2 size={13} /> Заполнить остальные
            </button>
          )}
        </div>
        <div className="flex items-center gap-3">
          {error && <span role="alert" className="text-[11px] font-medium text-[#B42318]">{error}</span>}
          {dirty && (
            <span className="inline-flex items-center gap-1 text-[10px] text-[var(--orange)]">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--orange)]" />
              есть несохранённые изменения
            </span>
          )}
          <button type="button" onClick={save} disabled={saving}
            className="rounded-[8px] bg-[var(--orange)] px-4 py-1.5 text-[12px] font-semibold text-white disabled:opacity-60">
            {saving ? 'Сохранение…' : 'Сохранить'}
          </button>
        </div>
      </div>
      )}
    </div>
  );
}

function FragmentRow({ day, cell, replay, canEdit, canRemove, onRemove, onChange, onGcBlur }: {
  day: number; cell: { gcRoom: string; webRoom: string; replayUrl: string };
  replay: boolean; canEdit: boolean; canRemove: boolean; onRemove: () => void;
  onChange: (field: 'gcRoom' | 'webRoom' | 'replayUrl', value: string) => void;
  onGcBlur: () => void;
}) {
  const inp = 'h-7 w-full min-w-0 rounded-[5px] border border-[var(--line-soft)] bg-white px-2 font-mono text-[12px] text-[var(--ink)]';
  // Autofill Web only when the GC value actually changed during this focus —
  // tabbing through an untouched GC field must not resurrect a Web link the
  // employee deliberately cleared.
  const gcOnFocus = useRef<string | null>(null);
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
            className="absolute -right-1.5 -top-1.5 hidden h-3.5 w-3.5 items-center justify-center rounded-full bg-[#B42318] text-white shadow-sm group-hover/day:flex hover:bg-[#8f1c11] [@media(hover:none)]:flex"
          >
            <X size={9} strokeWidth={3} />
          </button>
        )}
      </span>
      <UrlInput className={inp} value={cell.gcRoom} placeholder="gc…" readOnly={!canEdit} onChange={(v) => onChange('gcRoom', v)}
        onFocus={() => { gcOnFocus.current = cell.gcRoom; }}
        onBlur={() => {
          if (gcOnFocus.current !== cell.gcRoom) onGcBlur();
          gcOnFocus.current = null;
        }} />
      <UrlInput className={inp} value={cell.webRoom} placeholder="web…" readOnly={!canEdit} onChange={(v) => onChange('webRoom', v)} />
      {replay && <UrlInput className={inp} value={cell.replayUrl} placeholder="повтор…" readOnly={!canEdit} onChange={(v) => onChange('replayUrl', v)} />}
    </>
  );
}
