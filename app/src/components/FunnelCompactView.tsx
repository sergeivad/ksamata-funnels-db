'use client';

import { useRef, useState } from 'react';
import * as Icons from 'lucide-react';
import { Copy, Check } from 'lucide-react';
import type { FunnelDetail } from '@/lib/funnels';
import type { DayCell } from '@/lib/funnel-days';
import type { BlockState } from '@/lib/funnel-blocks';
import { getBlockDef } from '@/lib/blocks';
import { groupDaysByDay, visibleBlocks, isOpenableUrl } from '@/lib/funnel-compact';
import StatusPill from './StatusPill';

interface Props {
  funnel: FunnelDetail;
  initialDays: DayCell[];
  landings: BlockState;
  rest: BlockState[];
}

/**
 * Dense, read-only "Просмотр" rendering of the whole funnel card — identity,
 * webinar rooms, and every enabled block with at least one link — meant to
 * fit on a single screen for users coming from spreadsheet-style workflows.
 * Pulls exclusively from the initial server-fetched props: it never reflects
 * unsaved edits made in the "Редактирование" sections (see FunnelSections).
 */
export default function FunnelCompactView({ funnel, initialDays, landings, rest }: Props) {
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

      {/* Rooms */}
      {dayGroups.length > 0 && (
        <div className="mb-3">
          <div className="mb-1.5 grid grid-cols-[28px_1fr_1fr] gap-x-3 text-[10px] uppercase tracking-wide text-[var(--faint)]">
            <span />
            <span>{funnel.timeLabelA}</span>
            <span>{funnel.timeLabelB}</span>
          </div>
          <div className="flex flex-col divide-y divide-[var(--line-soft)]">
            {dayGroups.map((g) => (
              <div key={g.dayNum} className="grid grid-cols-[28px_1fr_1fr] gap-x-3 py-1">
                <span className="self-start rounded-[4px] bg-[var(--chip)] py-[2px] text-center font-mono text-[10px] text-[var(--muted)]">
                  {g.dayNum}
                </span>
                <RoomSlotCell slot={g.slots['15']} replayEnabled={funnel.roomsReplayEnabled} />
                <RoomSlotCell slot={g.slots['19']} replayEnabled={funnel.roomsReplayEnabled} />
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
        <div className="text-[11px] text-[var(--faint)]">Нет заполненных комнат или блоков</div>
      )}
    </div>
  );
}

function RoomSlotCell({ slot, replayEnabled }: { slot?: { gcRoom: string; webRoom: string; replayUrl: string }; replayEnabled: boolean }) {
  if (!slot) return <span />;
  return (
    <div className="flex min-w-0 flex-col">
      {slot.gcRoom.trim() !== '' && <CopyableUrlRow label="GC" url={slot.gcRoom} />}
      {slot.webRoom.trim() !== '' && <CopyableUrlRow label="Web" url={slot.webRoom} />}
      {replayEnabled && slot.replayUrl.trim() !== '' && <CopyableUrlRow label="Повтор" url={slot.replayUrl} />}
    </div>
  );
}

function CompactBlock({ block, timeLabelA, timeLabelB }: { block: BlockState; timeLabelA: string; timeLabelB: string }) {
  const def = getBlockDef(block.kind);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Icon = (Icons as any)[def.icon] ?? Icons.Link;

  const rows = block.items.filter((it) => it.url.trim() !== '');

  return (
    <div className="mb-3 break-inside-avoid-column rounded-[10px] border border-[var(--line-soft)] bg-[var(--paper)] p-2.5">
      <div className="mb-1.5 flex items-center gap-1.5">
        <Icon size={14} className="text-[var(--orange)]" />
        <span className="text-[12px] font-medium text-[var(--ink)]">{def.title}</span>
      </div>
      {block.mode === 'common' ? (
        <div className="flex flex-col">
          {rows.map((it, i) => (
            <CopyableUrlRow key={i} label={def.fields === 2 ? it.label : undefined} url={it.url} />
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
                    <CopyableUrlRow key={i} label={def.fields === 2 ? it.label : undefined} url={it.url} />
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

function CopyableUrlRow({ label, url }: { label?: string; url: string }) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const trimmed = url.trim();
  const openable = isOpenableUrl(trimmed);

  async function copy() {
    if (!trimmed) return;
    try {
      await navigator.clipboard.writeText(trimmed);
    } catch {
      return; // clipboard unavailable (insecure context) — no confirmation
    }
    if (timerRef.current) clearTimeout(timerRef.current);
    setCopied(true);
    timerRef.current = setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="flex h-6 min-w-0 items-center gap-1.5 border-b border-[var(--line-soft)] last:border-b-0">
      {label !== undefined && (
        <span
          className={`w-[70px] shrink-0 truncate text-[10px] ${label.trim() === '' ? 'text-[var(--faint)]' : 'text-[var(--muted)]'}`}
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
          className="min-w-0 flex-1 truncate font-mono text-[11px] text-[var(--ink)] hover:underline"
        >
          {trimmed}
        </a>
      ) : (
        <span title={trimmed} className="min-w-0 flex-1 truncate font-mono text-[11px] text-[var(--muted)]">
          {trimmed}
        </span>
      )}
      <button
        type="button"
        onClick={copy}
        aria-label={copied ? 'Скопировано' : 'Копировать ссылку'}
        title={copied ? 'Скопировано' : 'Копировать ссылку'}
        className={`flex shrink-0 items-center justify-center transition ${
          copied ? 'text-[#087443]' : 'text-[var(--faint)] hover:text-[var(--ink)]'
        }`}
      >
        {copied ? <Check size={13} /> : <Copy size={13} />}
      </button>
    </div>
  );
}
