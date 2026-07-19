'use client';

import * as Icons from 'lucide-react';
import { Copy, Check, AlertCircle } from 'lucide-react';
import { useCopyFlash } from '@/lib/clipboard';
import type { FunnelDetail } from '@/lib/funnels';
import type { DayCell } from '@/lib/funnel-days';
import type { BlockState } from '@/lib/funnel-blocks';
import { getBlockDef } from '@/lib/blocks';
import { groupDaysByDay, visibleBlocks, blockHasLabels, isOpenableUrl } from '@/lib/funnel-compact';
import StatusPill from './StatusPill';

interface Props {
  funnel: FunnelDetail;
  initialDays: DayCell[];
  landings: BlockState;
  rest: BlockState[];
  /** Switches the card to «Редактирование» — offered when there's nothing to view yet. */
  onSwitchToEdit?: () => void;
}

/**
 * Dense, read-only "Просмотр" rendering of the whole funnel card — identity,
 * webinar rooms, and every enabled block with at least one link — meant to
 * fit on a single screen for users coming from spreadsheet-style workflows.
 * Pulls exclusively from the initial server-fetched props: it never reflects
 * unsaved edits made in the "Редактирование" sections (see FunnelSections).
 */
export default function FunnelCompactView({ funnel, initialDays, landings, rest, onSwitchToEdit }: Props) {
  const dayGroups = groupDaysByDay(initialDays);
  const blocks = visibleBlocks([landings, ...rest]);
  const allEmpty = !funnel.axes.product && !funnel.axes.contractor && !funnel.axes.channel && !funnel.axes.direction;

  return (
    <div className="rounded-[14px] border border-[var(--line-soft)] bg-[var(--card)] p-4">
      {/* Identity */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="rounded-[6px] border border-[var(--line)] bg-[var(--chip)] px-1.5 py-[1px] font-mono text-[11px] text-[var(--muted)]">
          {funnel.frontCode || '—'}
        </span>
        <span className={`text-[13px] font-medium ${allEmpty ? 'text-[var(--faint)]' : 'text-[var(--ink)]'}`}>
          {allEmpty ? 'Новая воронка' : funnel.name}
        </span>
        <StatusPill status={funnel.status === 'active' ? 'active' : 'draft'} />
        {funnel.comment.trim() !== '' && (
          <span className="min-w-0 flex-1 truncate text-[11px] text-[var(--muted)]" title={funnel.comment}>
            — {funnel.comment}
          </span>
        )}
      </div>

      {/* Rooms. On narrow screens the two time slots stack vertically (each
          full-width, labelled inline); side-by-side columns from sm up. */}
      {dayGroups.length > 0 && (
        <div className="mb-3">
          <div className="mb-1.5 hidden grid-cols-[28px_1fr_1fr] gap-x-3 text-[10px] uppercase tracking-wide text-[var(--faint)] sm:grid">
            <span />
            <span>{funnel.timeLabelA}</span>
            <span>{funnel.timeLabelB}</span>
          </div>
          <div className="flex flex-col divide-y divide-[var(--line-soft)]">
            {dayGroups.map((g) => (
              <div key={g.dayNum} className="grid grid-cols-[28px_1fr] gap-x-3 py-1 sm:grid-cols-[28px_1fr_1fr]">
                <span className="self-start rounded-[4px] bg-[var(--chip)] py-[2px] text-center font-mono text-[10px] text-[var(--muted)]">
                  {g.dayNum}
                </span>
                <RoomSlotCell
                  slot={g.slots['15']}
                  replayEnabled={funnel.roomsReplayEnabled}
                  timeLabel={funnel.timeLabelA}
                />
                <RoomSlotCell
                  slot={g.slots['19']}
                  replayEnabled={funnel.roomsReplayEnabled}
                  timeLabel={funnel.timeLabelB}
                  className="col-start-2 sm:col-start-auto"
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Blocks */}
      {blocks.length > 0 && (
        <div className="columns-1 gap-3 lg:columns-2">
          {blocks.map((b) => (
            <CompactBlock key={b.kind} block={b} timeLabelA={funnel.timeLabelA} timeLabelB={funnel.timeLabelB} />
          ))}
        </div>
      )}

      {dayGroups.length === 0 && blocks.length === 0 && (
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-[var(--faint)]">
          Нет заполненных комнат или блоков
          {onSwitchToEdit && (
            <button
              type="button"
              onClick={onSwitchToEdit}
              className="rounded-[6px] border border-[var(--line)] bg-[var(--chip)] px-2 py-0.5 text-[11px] text-[var(--muted)] transition hover:text-[var(--ink)]"
            >
              Перейти к редактированию
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function RoomSlotCell({
  slot,
  replayEnabled,
  timeLabel,
  className = '',
}: {
  slot?: { gcRoom: string; webRoom: string; replayUrl: string };
  replayEnabled: boolean;
  timeLabel: string;
  className?: string;
}) {
  if (!slot) return <span className={className} />;
  return (
    <div className={`flex min-w-0 flex-col ${className}`}>
      {/* Inline time label for the stacked (mobile) layout; the column header
          covers it from sm up. */}
      <span className="text-[10px] uppercase tracking-wide text-[var(--faint)] sm:hidden">{timeLabel}</span>
      {slot.gcRoom.trim() !== '' && <CopyableUrlRow label="GC" url={slot.gcRoom} narrowLabel wrap />}
      {slot.webRoom.trim() !== '' && <CopyableUrlRow label="Web" url={slot.webRoom} narrowLabel wrap />}
      {replayEnabled && slot.replayUrl.trim() !== '' && <CopyableUrlRow label="Повтор" url={slot.replayUrl} narrowLabel wrap />}
    </div>
  );
}

function CompactBlock({ block, timeLabelA, timeLabelB }: { block: BlockState; timeLabelA: string; timeLabelB: string }) {
  const def = getBlockDef(block.kind);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Icon = (Icons as any)[def.icon] ?? Icons.Link;

  const rows = block.items.filter((it) => it.url.trim() !== '');
  // Show the label column only when the block actually uses labels — a column
  // of "—" placeholders (e.g. Процессы with bare URLs) just wastes width.
  const showLabels = def.fields === 2 && blockHasLabels(block.items);

  return (
    <div className="mb-3 break-inside-avoid-column rounded-[10px] border border-[var(--line-soft)] bg-[var(--paper)] p-2.5">
      <div className="mb-1.5 flex items-center gap-1.5">
        <Icon size={14} className="text-[var(--orange)]" />
        <span className="text-[12px] font-medium text-[var(--ink)]">{def.title}</span>
      </div>
      {block.mode === 'common' ? (
        <div className="flex flex-col">
          {rows.map((it, i) => (
            <CopyableUrlRow key={i} label={showLabels ? it.label : undefined} url={it.url} />
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {(['15', '19'] as const).map((slot) => {
            const slotRows = rows.filter((it) => it.slot === slot);
            if (slotRows.length === 0) return null;
            return (
              <div key={slot}>
                <div className="mb-0.5 text-[10px] font-medium text-[var(--muted)]">
                  {slot === '15' ? timeLabelA : timeLabelB}
                </div>
                <div className="flex flex-col">
                  {slotRows.map((it, i) => (
                    <CopyableUrlRow key={i} label={showLabels ? it.label : undefined} url={it.url} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * One link row. `wrap` shows the full URL across multiple lines instead of
 * truncating — used for rooms, where the distinguishing part is the URL tail
 * and truncation makes every row look identical.
 */
function CopyableUrlRow({ label, url, narrowLabel = false, wrap = false }: { label?: string; url: string; narrowLabel?: boolean; wrap?: boolean }) {
  const { status, copy } = useCopyFlash(1500);
  const trimmed = url.trim();
  const openable = isOpenableUrl(trimmed);
  // Display without the scheme (like browser address bars) — the interesting
  // part of a link is its tail. Copy and open still use the full URL.
  const display = trimmed.replace(/^https?:\/\//i, '');

  return (
    <div
      className={`flex min-w-0 gap-1.5 border-b border-[var(--line-soft)] last:border-b-0 ${
        wrap ? 'min-h-6 items-start py-1' : 'h-6 items-center'
      }`}
    >
      {label !== undefined && (
        <span
          className={`${narrowLabel ? 'w-[48px]' : 'w-[128px]'} shrink-0 truncate text-[10px] ${label.trim() === '' ? 'text-[var(--faint)]' : 'text-[var(--muted)]'}`}
          title={label || undefined}
        >
          {label.trim() || '—'}
        </span>
      )}
      {openable ? (
        <a
          href={trimmed}
          target="_blank"
          rel="noreferrer"
          title={trimmed}
          className={`min-w-0 flex-1 font-mono text-[11px] text-[var(--ink)] hover:underline ${wrap ? 'break-all' : 'truncate'}`}
        >
          {display}
        </a>
      ) : (
        <span title={trimmed} className={`min-w-0 flex-1 font-mono text-[11px] text-[var(--muted)] ${wrap ? 'break-all' : 'truncate'}`}>
          {display}
        </span>
      )}
      <button
        type="button"
        onClick={() => copy(trimmed)}
        aria-label={status === 'copied' ? 'Скопировано' : status === 'failed' ? 'Не удалось скопировать' : 'Копировать ссылку'}
        title={status === 'copied' ? 'Скопировано' : status === 'failed' ? 'Не удалось скопировать' : 'Копировать ссылку'}
        className={`flex shrink-0 items-center justify-center transition ${
          status === 'copied'
            ? 'text-[#087443]'
            : status === 'failed'
              ? 'text-[#B42318]'
              : 'text-[var(--faint)] hover:text-[var(--ink)]'
        }`}
      >
        {status === 'copied' ? <Check size={13} /> : status === 'failed' ? <AlertCircle size={13} /> : <Copy size={13} />}
      </button>
    </div>
  );
}
