'use client';

import Link from 'next/link';
import { ChevronRight, Copy, Pause, Play, Trash2 } from 'lucide-react';
import CodeChip from './CodeChip';
import StatusPill from './StatusPill';

interface Funnel {
  id: number;
  frontCode: string;
  status: 'active' | 'draft';
  title: string;
}

interface FunnelCardProps {
  funnel: Funnel;
  onActivateToggle: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

export default function FunnelCard({
  funnel,
  onActivateToggle,
  onDuplicate,
  onDelete,
}: FunnelCardProps) {
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
        {/* Activate / Deactivate */}
        <button
          type="button"
          className={actionBtnClass}
          onClick={onActivateToggle}
          aria-label={funnel.status === 'draft' ? 'Активировать' : 'Деактивировать'}
          title={funnel.status === 'draft' ? 'Активировать' : 'Деактивировать'}
        >
          {funnel.status === 'draft' ? (
            <Play className="h-4 w-4" />
          ) : (
            <Pause className="h-4 w-4" />
          )}
        </button>

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
