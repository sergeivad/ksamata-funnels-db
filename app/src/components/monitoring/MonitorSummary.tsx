'use client';

import { RefreshCw } from 'lucide-react';
import { formatAgo } from '@/lib/monitor-status';
import type { MonitorSummaryView } from '@/lib/monitor-view';

interface Props {
  summary: MonitorSummaryView;
  running: boolean;
  onRun: () => void;
}

const CELLS: { key: 'enabled' | 'up' | 'slow' | 'down'; label: string; className: string }[] = [
  { key: 'enabled', label: 'Проверяем', className: 'text-[var(--ink)]' },
  { key: 'up', label: 'Работает', className: 'text-[#087443]' },
  { key: 'slow', label: 'Медленно', className: 'text-[#8A6100]' },
  { key: 'down', label: 'Упало', className: 'text-[#A32020]' },
];

export default function MonitorSummary({ summary, running, onRun }: Props) {
  return (
    <div className="flex flex-wrap items-center gap-4 rounded-[10px] border border-[var(--line-soft)] bg-[var(--card)] px-4 py-3">
      {CELLS.map((cell) => (
        <div key={cell.key} className="min-w-[72px]">
          <div className={`text-[20px] font-semibold leading-none ${cell.className}`}>
            {summary[cell.key]}
          </div>
          <div className="mt-1 text-[11px] text-[var(--muted)]">{cell.label}</div>
        </div>
      ))}

      <div className="ml-auto flex items-center gap-3">
        <span className="text-[11px] text-[var(--muted)]">
          Проверка: {formatAgo(summary.lastCheckedAt)}
        </span>
        <button
          type="button"
          onClick={onRun}
          disabled={running}
          className="inline-flex items-center gap-1.5 rounded-[8px] bg-[var(--orange)] px-3 py-2 text-[13px] font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
        >
          <RefreshCw size={14} className={running ? 'animate-spin' : undefined} />
          {running ? 'Проверяем…' : 'Проверить сейчас'}
        </button>
      </div>
    </div>
  );
}
