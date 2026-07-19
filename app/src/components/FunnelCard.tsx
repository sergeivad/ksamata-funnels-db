'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ChevronRight, Copy, MoreVertical, Trash2 } from 'lucide-react';
import CodeChip from './CodeChip';
import StatusPill from './StatusPill';
import { FUNNEL_STATUSES, STATUS_ACTION_LABELS, type FunnelStatus } from '@/lib/status';

interface Funnel {
  id: number;
  frontCode: string;
  status: FunnelStatus;
  title: string;
}

interface FunnelCardProps {
  funnel: Funnel;
  onSetStatus: (status: FunnelStatus) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

export default function FunnelCard({
  funnel,
  onSetStatus,
  onDuplicate,
  onDelete,
}: FunnelCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const href = `/funnels/${funnel.id}`;
  const containerClass =
    'grid grid-cols-[minmax(0,1fr)_80px_auto_22px] items-center gap-3 rounded-[8px] border px-3 py-2.5 text-left transition max-[760px]:grid-cols-[minmax(0,1fr)_auto] border-[var(--color-border-soft)] bg-[rgba(255,255,255,0.38)] hover:bg-white';

  const actionBtnClass =
    'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] border bg-white transition border-[var(--color-border-soft)] text-[#111111] hover:border-[#111111]';

  return (
    <div className={containerClass}>
      {/* Left: code chip (click copies) + title link — real <a>, so
          Cmd/middle-click opens the funnel in a new tab */}
      <div className="flex min-w-0 items-center gap-2">
        <CodeChip code={funnel.frontCode} />
        <Link
          href={href}
          className="min-w-0 flex-1 truncate text-[13px] font-semibold hover:underline"
        >
          {funnel.title}
        </Link>
      </div>

      {/* Status pill — wrapped so the span sizes to its text instead of
          stretching to fill the grid column (which left a big empty gap). */}
      <div className="min-w-0">
        <StatusPill status={funnel.status} />
      </div>

      {/* Action buttons */}
      <div className="flex items-center justify-end gap-1">
        {/* Status menu */}
        <div className="relative">
          <button
            type="button"
            className={actionBtnClass}
            onClick={() => setMenuOpen((o) => !o)}
            aria-label="Изменить статус"
            title="Изменить статус"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
          >
            <MoreVertical className="h-4 w-4" />
          </button>
          {menuOpen && (
            <>
              {/* Full-screen backdrop closes the menu on outside click */}
              <button
                type="button"
                aria-hidden
                tabIndex={-1}
                className="fixed inset-0 z-10 cursor-default"
                onClick={() => setMenuOpen(false)}
              />
              <div
                role="menu"
                className="absolute right-0 top-9 z-20 min-w-[160px] overflow-hidden rounded-[8px] border border-[var(--color-border-soft)] bg-white py-1 shadow-lg"
              >
                {FUNNEL_STATUSES.map((s) => (
                  <button
                    key={s}
                    type="button"
                    role="menuitem"
                    disabled={funnel.status === s}
                    onClick={() => {
                      setMenuOpen(false);
                      onSetStatus(s);
                    }}
                    className="flex w-full items-center px-3 py-1.5 text-left text-[12px] text-[#111111] transition hover:bg-[#F5F3EE] disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent"
                  >
                    {STATUS_ACTION_LABELS[s]}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Duplicate */}
        <button
          type="button"
          className={actionBtnClass}
          onClick={onDuplicate}
          aria-label="Дублировать"
          title="Дублировать"
        >
          <Copy className="h-4 w-4" />
        </button>

        {/* Delete */}
        <button
          type="button"
          className={[
            actionBtnClass,
            'border-[#F3B8AD] text-[#B42318] hover:bg-[#FFF4F1]',
          ].join(' ')}
          onClick={onDelete}
          aria-label="Удалить"
          title="Удалить"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      {/* Trailing chevron */}
      <Link
        href={href}
        className="max-[760px]:hidden flex h-5 w-5 items-center justify-center text-[var(--color-text-secondary)]"
        aria-label="Открыть"
        tabIndex={-1}
      >
        <ChevronRight className="h-4 w-4" />
      </Link>
    </div>
  );
}
