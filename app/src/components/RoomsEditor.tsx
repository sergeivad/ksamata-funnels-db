'use client';

import { useEffect, useRef, useState } from 'react';
import { Tv, Plus, X, Wand2, RotateCcw } from 'lucide-react';
import Switch from './Switch';
import CopyChip from './CopyChip';
import type { DayCell } from '@/lib/funnel-days';
import { gcRoomUrl, roomSlugFromUrl, webRoomUrl } from '@/lib/room-urls';
import {
  MAX_DAYS, SLOTS, appendDay, applyRoomCheck, buildGrid, cellsFromGrid, commonReplayTime, gridKey as key,
  initialDayCount, liveInputValue, liveMarkKey, replayInputValue, replayMarkKey as markKey, replayOf,
  roomCheckSummary, withLiveLink, withReplayLink,
  type CheckMark, type ReplayN, type RoomCell as Cell, type RoomGrid as Grid,
} from '@/lib/rooms-grid';
import type { RoomCheckResult } from '@/lib/room-check';
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

type SavedSnapshot = { enabled: boolean; replay: boolean; cells: DayCell[] };


export default function RoomsEditor({ funnelId, initialDays, enabled: enabledProp, replayEnabled, timeLabelA, timeLabelB, onDirtyChange }: Props) {
  const canEdit = useCanEdit();
  const clampedInitialDayCount = initialDayCount(initialDays);
  const [dayCount, setDayCount] = useState(clampedInitialDayCount);
  const [enabled, setEnabled] = useState(enabledProp);
  const [replay, setReplay] = useState(replayEnabled);
  const [grid, setGrid] = useState<Grid>(() => buildGrid(initialDays, clampedInitialDayCount));
  const gridRef = useRef(grid);
  gridRef.current = grid;
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

  // Пометки «Заполнить и проверить» (CheckMark): живут до правки ячейки,
  // следующей проверки или удаления дня.
  const [marks, setMarks] = useState<Record<string, CheckMark>>({});
  const [checking, setChecking] = useState(false);
  const [checkNote, setCheckNote] = useState<string | null>(null);

  function dropMark(mk: string) {
    setMarks((m) => {
      if (!(mk in m)) return m;
      const next = { ...m };
      delete next[mk];
      return next;
    });
  }

  function setReplayLink(slot: string, day: number, n: ReplayN, value: string) {
    setGrid((p) => ({ ...p, [key(slot, day)]: withReplayLink(p[key(slot, day)], n, value) }));
    dropMark(markKey(slot, day, n));
  }

  // Кнопка есть, когда есть от чего строить: хотя бы одна комната эфира.
  const hasLiveRoom = SLOTS.some((slot) => Array.from({ length: dayCount }, (_, i) => grid[key(slot, i + 1)])
    .some((c) => (roomSlugFromUrl(c.webRoom) ?? roomSlugFromUrl(c.gcRoom)) !== null));

  // «Заполнить и проверить»: сервер достраивает пустые эфиры по правилам
  // room-urls.ts, проверяет на Бизоне и эфиры, и (при включённом «повторе»)
  // кандидатов в повторы. Вписывается только найденное и только в пустые
  // поля (applyRoomCheck). Сохраняет человек.
  async function checkRooms() {
    const withReplays = replay;
    setChecking(true);
    setCheckNote(null);
    setError(null);
    try {
      const res = await fetch(`/api/funnels/${funnelId}/rooms/check`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cells: cellsFromGrid(grid, dayCount), replays: withReplays }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Не удалось проверить комнаты (${res.status})`);
      }
      const result = (await res.json()) as RoomCheckResult;
      // От свежей сетки (gridRef), а не из апдейтера setGrid: апдейтер React
      // вправе вызвать дважды, и счётчики сводки удвоились бы.
      const applied = applyRoomCheck(gridRef.current, result);
      setGrid(applied.grid);
      setMarks(applied.marks);
      setCheckNote(roomCheckSummary(applied.counts, withReplays));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось проверить комнаты');
    } finally {
      setChecking(false);
    }
  }

  // Поле эфира одно: вставленное раскладывается в пару GC + Бизон сразу
  // (withLiveLink), поэтому выводить Бизон из GC на выходе из поля больше
  // незачем.
  function setLiveLink(slot: string, day: number, value: string) {
    setGrid((p) => ({ ...p, [key(slot, day)]: withLiveLink(p[key(slot, day)], value) }));
    dropMark(liveMarkKey(slot, day));
  }

  // Новый день добавляется пустым: вписывать можно только комнаты, которые
  // есть на Бизоне, а проверяет их «Заполнить и проверить» (см. appendDay).
  function addDay() {
    if (dayCount >= MAX_DAYS) return;
    setGrid((p) => appendDay(p, dayCount));
    setDayCount(dayCount + 1);
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
    // Отметки поиска привязаны к номеру дня, а дни перенумеровались.
    setMarks({});
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
    // The «повтор» toggle only hides the replay section — replay fields are
    // always part of the payload, so turning it off never erases stored links.
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
      // Подсветка «вписано кнопкой» значит «ещё не сохранено» — после
      // сохранения она врала бы. Отметки о мёртвых и непроверенных остаются.
      setMarks((m) => Object.fromEntries(Object.entries(m).filter(([, v]) => v.kind !== 'new')));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось сохранить');
    } finally { setSaving(false); }
  }

  const gtc = '22px minmax(0,1fr) minmax(0,1fr)';

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

      {/* Two slot columns side by side; stacked on narrow screens. Одно поле
          на комнату, кнопки копирования GC / Бизон — в той же строке, чтобы
          сетка эфиров не стала выше прежней. */}
      <div className="flex flex-col gap-4 sm:flex-row sm:gap-2.5">
        {SLOTS.map((slot) => (
          <div key={slot} className="min-w-0 flex-1">
            <div className="mb-1 text-[11px] font-medium text-[var(--muted)]">{labels[slot]}</div>
            <div className="grid items-center gap-x-1.5 gap-y-1" style={{ gridTemplateColumns: '22px minmax(0,1fr) auto' }}>
              {Array.from({ length: dayCount }, (_, idx) => idx + 1).map((day) => (
                <LiveRow key={day} day={day} cell={grid[key(slot, day)]} canEdit={canEdit}
                  mark={marks[liveMarkKey(slot, day)]}
                  canRemove={canEdit && dayCount > 1}
                  onRemove={() => removeDay(day)}
                  onChange={(v) => setLiveLink(slot, day, v)} />
              ))}
            </div>
          </div>
        ))}
      </div>

      {replay && (
        <div className="mt-4">
          <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold text-[#6B4FBB]">
            <RotateCcw size={13} />
            Повторы
            <span className="h-px flex-1 bg-[#DDD2F7]" />
          </div>
          <div className="flex flex-col gap-4 sm:flex-row sm:gap-2.5">
            {SLOTS.map((slot) => (
              <div key={slot} className="min-w-0 flex-1">
                <div className="mb-1 text-[11px] font-medium text-[var(--muted)]">эфир {labels[slot]}</div>
                <div className="grid items-start gap-x-1.5 gap-y-2" style={{ gridTemplateColumns: gtc }}>
                  <span />
                  {([1, 2] as const).map((n) => {
                    const t = commonReplayTime(grid, slot, n, dayCount);
                    return (
                      <span key={n} className="flex items-center gap-1 text-[10px] text-[#6B4FBB]">
                        Повтор {n}
                        {t && <TimeChip time={t} />}
                      </span>
                    );
                  })}
                  {Array.from({ length: dayCount }, (_, idx) => idx + 1).map((day) => (
                    <ReplayRow key={day} day={day} cell={grid[key(slot, day)]} canEdit={canEdit}
                      showTime={(n) => commonReplayTime(grid, slot, n, dayCount) === null}
                      mark={(n) => marks[markKey(slot, day, n)]}
                      onChange={(n, v) => setReplayLink(slot, day, n, v)} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {canEdit && (
      <>
      {checkNote && (
        <div role="status" className="mt-2 rounded-[6px] bg-[var(--card)] px-2 py-1.5 text-[11px] text-[var(--muted)]">{checkNote}</div>
      )}
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-4">
          <button type="button" onClick={addDay} disabled={dayCount >= MAX_DAYS}
            className="flex items-center gap-1 text-[12px] font-semibold text-[var(--orange)] disabled:opacity-40">
            <Plus size={13} /> добавить день
          </button>
          <button type="button" onClick={checkRooms} disabled={checking || !hasLiveRoom}
            title={hasLiveRoom
              ? `Достроить пустые дни и второе время по введённой комнате, проверить все комнаты на Бизоне${replay ? ' и найти повторы' : ''}. Вписываются только существующие комнаты и только в пустые поля.`
              : 'Сначала впишите хотя бы одну комнату эфира'}
            className="flex items-center gap-1 rounded-[7px] border border-[var(--orange)] bg-white px-2.5 py-1 text-[12px] font-semibold text-[var(--orange)] disabled:opacity-50">
            <Wand2 size={13} /> {checking ? 'Проверяю на Бизоне…' : 'Заполнить и проверить'}
          </button>
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
      </>
      )}
    </div>
  );
}

function TimeChip({ time }: { time: string }) {
  return (
    <span className="rounded-[4px] border border-[#DDD2F7] bg-[#F3EEFF] px-1 py-px font-mono text-[10px] font-semibold text-[#6B4FBB]">
      {time}
    </span>
  );
}

const REPLAY_INPUT = 'h-7 w-full min-w-0 rounded-[5px] border border-[#DDD2F7] bg-[#F7F3FF] px-2 font-mono text-[12px] text-[var(--ink)]';

/** Строка дня в сетке повторов: номер дня и два повтора. */
function ReplayRow({ day, cell, canEdit, showTime, mark, onChange }: {
  day: number; cell: Cell; canEdit: boolean;
  showTime: (n: ReplayN) => boolean;
  mark: (n: ReplayN) => CheckMark | undefined;
  onChange: (n: ReplayN, value: string) => void;
}) {
  return (
    <>
      <span className="mt-[5px] rounded-[4px] bg-[var(--chip)] py-[2px] text-center font-mono text-[10px] text-[var(--muted)]">{day}</span>
      {([1, 2] as const).map((n) => (
        <ReplayField key={n} cell={cell} n={n} canEdit={canEdit} showTime={showTime(n)} mark={mark(n)}
          onChange={(v) => onChange(n, v)} />
      ))}
    </>
  );
}

/**
 * Одно поле на повтор: сюда вставляют любой из трёх адресов комнаты, а
 * сохраняются GC и Бизон (withReplayLink). Под полем — копирование GC и Бизон: в
 * рассылке нужен то один, то другой.
 */
function ReplayField({ cell, n, canEdit, showTime, mark, onChange }: {
  cell: Cell; n: ReplayN; canEdit: boolean; showTime: boolean; mark: CheckMark | undefined;
  onChange: (value: string) => void;
}) {
  const value = replayInputValue(cell, n);
  const r = replayOf(cell, n);
  const slug = roomSlugFromUrl(r.web) ?? roomSlugFromUrl(r.gc);
  const ring = mark?.kind === 'new' ? ' outline outline-2 outline-[#B9A5EE]' : '';
  return (
    <div className="flex min-w-0 flex-col gap-1">
      {/* Обычное поле, не UrlInput: его значок копирования скопировал бы код
          комнаты, а нужна ссылка — ссылки копируют кнопки ниже. */}
      <input className={REPLAY_INPUT + ring} value={value} placeholder="ссылка или код" readOnly={!canEdit}
        title={r.web || r.gc || undefined} spellCheck={false}
        onChange={(e) => onChange(e.target.value)} />
      {(slug || (showTime && r.time) || mark?.kind === 'missing' || mark?.kind === 'error') && (
        <div className="flex flex-wrap items-center gap-1">
          {showTime && r.time && <TimeChip time={r.time} />}
          {slug && (
            <>
              <CopyChip label="GC" url={r.gc || gcRoomUrl(slug)} />
              <CopyChip label="Бизон" url={r.web || webRoomUrl(slug)} />
            </>
          )}
          <MarkNote mark={mark} />
        </div>
      )}
    </div>
  );
}

/**
 * Строка дня в сетке эфиров: номер дня (с крестиком удаления), одно поле с
 * кодом комнаты и кнопки копирования полных ссылок.
 */
function LiveRow({ day, cell, canEdit, mark, canRemove, onRemove, onChange }: {
  day: number; cell: Cell; mark: CheckMark | undefined;
  canEdit: boolean; canRemove: boolean; onRemove: () => void;
  onChange: (value: string) => void;
}) {
  const slug = roomSlugFromUrl(cell.webRoom) ?? roomSlugFromUrl(cell.gcRoom);
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
      {/* Обычное поле, не UrlInput — по доводу ReplayField: в поле код, а
          ссылки копируют кнопки рядом. */}
      {/* Подпись итога проверки — внутри поля у правого края, а не в колонке
          кнопок: там она расширяла колонку, и поля одного эфира становились
          уже полей другого. */}
      <div className="relative min-w-0">
        <input className={LIVE_INPUT + (mark && mark.kind !== 'new' ? ' pr-[92px]' : '') + (mark?.kind === 'new' ? ' outline outline-2 outline-[#F7B58A]' : mark?.kind === 'missing' ? ' !border-[#F2B8B5] !bg-[#FFF6F5]' : '')}
          value={liveInputValue(cell)} placeholder={mark && mark.kind !== 'new' ? '' : 'ссылка или код'} readOnly={!canEdit}
          title={cell.webRoom || cell.gcRoom || undefined} spellCheck={false}
          onChange={(e) => onChange(e.target.value)} />
        {mark && mark.kind !== 'new' && (
          <span className="absolute right-2 top-1/2 -translate-y-1/2"><MarkNote mark={mark} /></span>
        )}
      </div>
      <span className="flex items-center gap-1">
        {slug && (
          <>
            <CopyChip label="GC" url={cell.gcRoom || gcRoomUrl(slug)} />
            <CopyChip label="Бизон" url={cell.webRoom || webRoomUrl(slug)} />
          </>
        )}
      </span>
    </>
  );
}

/**
 * Подпись итога проверки у ячейки. Код проверенной комнаты — во всплывающей
 * подсказке: у пустого поля («нет на Бизоне», серое) только так видно, что
 * именно искали.
 */
function MarkNote({ mark }: { mark: CheckMark | undefined }) {
  if (!mark || mark.kind === 'new') return null;
  if (mark.kind === 'missing') {
    return <span title={`Бизон: «Веб-комната не найдена» (${mark.slug})`} className="whitespace-nowrap text-[10px] font-medium text-[#B42318]">нет на Бизоне</span>;
  }
  if (mark.kind === 'absent') {
    return <span title={`Искали по правилу: ${mark.slug} — такой комнаты нет`} className="whitespace-nowrap text-[10px] text-[var(--faint)]">нет на Бизоне</span>;
  }
  return <span title={`${mark.slug}: Бизон не ответил, попробуйте ещё раз`} className="whitespace-nowrap text-[10px] font-medium text-[#B54708]">не проверено</span>;
}

const LIVE_INPUT = 'h-7 w-full min-w-0 rounded-[5px] border border-[var(--line-soft)] bg-white px-2 font-mono text-[12px] text-[var(--ink)]';
