'use client';

import { MONITOR_STATUS_META, isMonitorStatus, formatAgo } from '@/lib/monitor-status';
import type { MonitorEventView } from '@/lib/monitor-view';

interface Props {
  events: MonitorEventView[];
}

function label(status: string): string {
  return isMonitorStatus(status) ? MONITOR_STATUS_META[status].label.toLowerCase() : status;
}

export default function MonitorEvents({ events }: Props) {
  return (
    <section className="rounded-[10px] border border-[var(--line-soft)] bg-[var(--card)] px-4 py-3">
      <h2 className="text-[13px] font-semibold text-[var(--ink)]">Последние события</h2>
      {events.length === 0 ? (
        <p className="mt-2 text-[12px] text-[var(--muted)]">
          Смен статуса пока не было — либо ещё не проверяли, либо всё стабильно.
        </p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {events.map((e) => (
            <li key={e.id} className="text-[12px] text-[var(--muted)]">
              <span className="text-[var(--faint)]">
                {e.funnels.map((f) => `№${f.num}`).join(', ') || '—'}
              </span>{' '}
              <span className="text-[var(--ink)]">{e.url}</span>: {label(e.fromStatus)} →{' '}
              {label(e.toStatus)}
              {e.error !== '' && ` (${e.error})`}, {formatAgo(e.at)}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
