'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Tv, Plus, X, Wand2, RotateCcw, Search } from 'lucide-react';
import Switch from './Switch';
import CopyChip from './CopyChip';
import type { DayCell } from '@/lib/funnel-days';
import { gcRoomUrl, roomSlugFromUrl, webRoomUrl } from '@/lib/room-urls';
import {
  SLOTS, appendDay, buildGrid, cellsFromGrid, commonReplayTime, fillRoomGrid, gridKey as key,
  liveInputValue, replayInputValue, replayOf, withFoundReplay, withLiveLink, withReplayLink,
  type ReplayN, type RoomCell as Cell, type RoomGrid as Grid,
} from '@/lib/rooms-grid';
import type { FindResult } from '@/lib/replay-finder';
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

/**
 * Итог поиска повторов для одной ячейки: `new` — вписан поиском (подсветка до
 * сохранения), `missing` — комнаты на Бизоне нет, `error` — не дождались
 * ответа. Отметка живёт до правки ячейки или до следующего поиска.
 */
type ReplayMark = 'new' | 'missing' | 'error';
const markKey = (slot: string, day: number, n: ReplayN) => `${slot}-${day}-${n}`;

export default function RoomsEditor({ funnelId, initialDays, enabled: enabledProp, replayEnabled, timeLabelA, timeLabelB, onDirtyChange }: Props) {
  const canEdit = useCanEdit();
  const initialDayCount = Math.max(3, ...initialDays.map((d) => d.dayNum), 0) || 3;
  const clampedInitialDayCount = Math.min(MAX_DAYS, initialDayCount);
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

  const [marks, setMarks] = useState<Record<string, ReplayMark>>({});
  const [finding, setFinding] = useState(false);
  const [findNote, setFindNote] = useState<string | null>(null);

  function setReplayLink(slot: string, day: number, n: ReplayN, value: string) {
    setGrid((p) => ({ ...p, [key(slot, day)]: withReplayLink(p[key(slot, day)], n, value) }));
    setMarks((m) => {
      if (!(markKey(slot, day, n) in m)) return m;
      const next = { ...m };
      delete next[markKey(slot, day, n)];
      return next;
    });
  }

  // «Найти повторы»: сервер строит кандидатов по правилу r/rr, проверяет их на
  // Бизоне и снимает время показа. Вписываются только найденные и только в
  // пустые поля; ячейку, которую человек успел поменять, пока шёл поиск, не
  // трогаем. Сохраняет человек.
  async function findReplays() {
    const cells = SLOTS.flatMap((slot) => Array.from({ length: dayCount }, (_, i) => {
      const c = grid[key(slot, i + 1)];
      return {
        timeSlot: slot, dayNum: i + 1, liveUrl: c.webRoom || c.gcRoom,
        replay1: replayInputValue(c, 1), replay2: replayInputValue(c, 2),
      };
    }));
    setFinding(true);
    setFindNote(null);
    setError(null);
    try {
      const res = await fetch(`/api/funnels/${funnelId}/replays/find`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cells }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Не удалось найти повторы (${res.status})`);
      }
      const { results } = (await res.json()) as { results: FindResult[] };
      const nextMarks: Record<string, ReplayMark> = {};
      let added = 0, missing = 0, failed = 0;
      // Считаем от свежей сетки (gridRef), а не из апдейтера setGrid: апдейтер
      // React вправе вызвать дважды, и счётчики сводки удвоились бы.
      {
        const g = { ...gridRef.current };
        for (const r of results) {
          const k = key(r.timeSlot, r.dayNum);
          const c = g[k];
          if (!c || !r.slug) continue;
          const cur = replayOf(c, r.n);
          const curSlug = roomSlugFromUrl(cur.web) ?? roomSlugFromUrl(cur.gc);
          const mk = markKey(r.timeSlot, r.dayNum, r.n);
          if (r.outcome === 'found') {
            if (!r.wasFilled && !cur.gc && !cur.web) {
              g[k] = withFoundReplay(c, r.n, r.slug, r.time);
              nextMarks[mk] = 'new';
              added++;
            } else if (r.wasFilled && curSlug === r.slug && r.time && cur.time !== r.time) {
              g[k] = withFoundReplay(c, r.n, r.slug, r.time);
            }
          } else if (r.outcome === 'missing') {
            // Кандидат, которого нет, — норма (у F21 нет повторов пятого дня);
            // считаем в сводке только уже вписанный повтор, которого нет.
            if (r.wasFilled) { nextMarks[mk] = 'missing'; missing++; }
          } else if (r.outcome === 'error') {
            nextMarks[mk] = 'error';
            failed++;
          }
        }
        setGrid(g);
      }
      const empty = results.filter((r) => !r.wasFilled && r.outcome === 'missing').length;
      setMarks(nextMarks);
      setFindNote([
        added > 0 ? `Найдено новых повторов: ${added}. Они подсвечены, проверьте и сохраните.` : 'Новых повторов не найдено.',
        empty > 0 ? `На Бизоне нет ещё ${empty}, эти поля остались пустыми.` : '',
        missing > 0 ? `Вписанных повторов, которых нет на Бизоне: ${missing}.` : '',
        failed > 0 ? `Не удалось проверить: ${failed}, попробуйте ещё раз.` : '',
      ].filter(Boolean).join(' '));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось найти повторы');
    } finally {
      setFinding(false);
    }
  }

  // Поле эфира одно: вставленное раскладывается в пару GC + Бизон сразу
  // (withLiveLink), поэтому выводить Бизон из GC на выходе из поля больше
  // незачем.
  function setLiveLink(slot: string, day: number, value: string) {
    setGrid((p) => ({ ...p, [key(slot, day)]: withLiveLink(p[key(slot, day)], value) }));
  }

  // Сетка, достроенная по уже заполненным ячейкам. Кнопка предлагается ровно
  // тогда, когда достройка что-то меняет — отдельной эвристики «есть ли что
  // заполнить» нет, иначе она разъедется с самой достройкой.
  const filled = useMemo(() => fillRoomGrid(grid, dayCount), [grid, dayCount]);
  const canFill =
    JSON.stringify(cellsFromGrid(filled, dayCount)) !== JSON.stringify(cellsFromGrid(grid, dayCount));

  // Новый день сразу достраивается по уже заполненным — правило то же, что у
  // «Заполнить остальные», и применяется только к добавленной паре ячеек
  // (см. appendDay). Сетка открывается на трёх днях, а пятидневных воронок
  // 53 из 62, так что этот клик делают почти всегда.
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
      // Подсветка «вписано поиском» значит «ещё не сохранено» — после
      // сохранения она врала бы. Отметки о мёртвых и непроверенных остаются.
      setMarks((m) => Object.fromEntries(Object.entries(m).filter(([, v]) => v !== 'new')));
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
          {canEdit && (
            <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
              <button type="button" onClick={findReplays} disabled={finding}
                title="Проверить на Бизоне, какие повторы у дней есть, и вписать найденные вместе со временем показа"
                className="flex items-center gap-1 rounded-[7px] border border-[#6B4FBB] bg-white px-2.5 py-1 text-[12px] font-semibold text-[#6B4FBB] disabled:opacity-60">
                <Search size={13} /> {finding ? 'Ищу на Бизоне…' : 'Найти повторы'}
              </button>
              {findNote && <span className="text-[11px] text-[var(--muted)]">{findNote}</span>}
            </div>
          )}
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
      <div className="mt-2 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button type="button" onClick={addDay} disabled={dayCount >= MAX_DAYS}
            className="flex items-center gap-1 text-[12px] font-semibold text-[var(--orange)] disabled:opacity-40">
            <Plus size={13} /> добавить день
          </button>
          {canFill && (
            <button type="button" onClick={() => setGrid(filled)}
              title="Достроить пустые ячейки эфиров по образцу заполненных: другой день, второе время"
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
  mark: (n: ReplayN) => ReplayMark | undefined;
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
  cell: Cell; n: ReplayN; canEdit: boolean; showTime: boolean; mark: ReplayMark | undefined;
  onChange: (value: string) => void;
}) {
  const value = replayInputValue(cell, n);
  const r = replayOf(cell, n);
  const slug = roomSlugFromUrl(r.web) ?? roomSlugFromUrl(r.gc);
  const ring = mark === 'new' ? ' outline outline-2 outline-[#B9A5EE]' : '';
  return (
    <div className="flex min-w-0 flex-col gap-1">
      {/* Обычное поле, не UrlInput: его значок копирования скопировал бы код
          комнаты, а нужна ссылка — ссылки копируют кнопки ниже. */}
      <input className={REPLAY_INPUT + ring} value={value} placeholder="ссылка или код" readOnly={!canEdit}
        title={r.web || r.gc || undefined} spellCheck={false}
        onChange={(e) => onChange(e.target.value)} />
      {(slug || (showTime && r.time) || mark === 'missing' || mark === 'error') && (
        <div className="flex flex-wrap items-center gap-1">
          {showTime && r.time && <TimeChip time={r.time} />}
          {slug && (
            <>
              <CopyChip label="GC" url={r.gc || gcRoomUrl(slug)} />
              <CopyChip label="Бизон" url={r.web || webRoomUrl(slug)} />
            </>
          )}
          {mark === 'missing' && <span className="text-[10px] font-medium text-[#B42318]">нет на Бизоне</span>}
          {mark === 'error' && <span className="text-[10px] font-medium text-[#B54708]">не проверено</span>}
        </div>
      )}
    </div>
  );
}

/**
 * Строка дня в сетке эфиров: номер дня (с крестиком удаления), одно поле с
 * кодом комнаты и кнопки копирования полных ссылок.
 */
function LiveRow({ day, cell, canEdit, canRemove, onRemove, onChange }: {
  day: number; cell: Cell;
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
      <input className={LIVE_INPUT} value={liveInputValue(cell)} placeholder="ссылка или код" readOnly={!canEdit}
        title={cell.webRoom || cell.gcRoom || undefined} spellCheck={false}
        onChange={(e) => onChange(e.target.value)} />
      <span className="flex gap-1">
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

const LIVE_INPUT = 'h-7 w-full min-w-0 rounded-[5px] border border-[var(--line-soft)] bg-white px-2 font-mono text-[12px] text-[var(--ink)]';
