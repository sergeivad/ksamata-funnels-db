'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Segmented from '@/components/Segmented';
import Toast from '@/components/Toast';
import MonitorSummary from '@/components/monitoring/MonitorSummary';
import MonitorTable from '@/components/monitoring/MonitorTable';
import MonitorEvents from '@/components/monitoring/MonitorEvents';
import { MONITOR_STATUS_META } from '@/lib/monitor-status';
import type {
  MonitorEventView,
  MonitorSourceKindView,
  MonitorSummaryView,
  MonitorTargetView,
} from '@/lib/monitor-view';

type StatusFilter = 'all' | 'down' | 'slow' | 'up';

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'Все' },
  { value: 'down', label: 'Упало' },
  { value: 'slow', label: 'Медленно' },
  { value: 'up', label: 'Работает' },
];

interface DashboardData {
  summary: MonitorSummaryView;
  sourceKinds: MonitorSourceKindView[];
  targets: MonitorTargetView[];
}

interface ToastState {
  message: string;
  variant: 'success' | 'error';
  key: number;
}

export default function MonitoringPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [events, setEvents] = useState<MonitorEventView[]>([]);
  const [loadFailed, setLoadFailed] = useState(false);
  const [running, setRunning] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [search, setSearch] = useState('');
  const [showDisabled, setShowDisabled] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);
  const toastKeyRef = useRef(0);

  const showToast = useCallback((message: string, variant: 'success' | 'error') => {
    toastKeyRef.current += 1;
    setToast({ message, variant, key: toastKeyRef.current });
  }, []);

  const load = useCallback(async () => {
    try {
      const [dashRes, eventsRes] = await Promise.all([
        fetch('/api/monitoring'),
        fetch('/api/monitoring/events?limit=25'),
      ]);
      if (!dashRes.ok || !eventsRes.ok) throw new Error('load failed');
      setData(await dashRes.json());
      setEvents((await eventsRes.json()).events);
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function runNow() {
    if (running) return;
    setRunning(true);
    try {
      const res = await fetch('/api/monitoring/run', { method: 'POST' });
      if (res.status === 409) {
        showToast('Проверка уже идёт', 'error');
        return;
      }
      if (!res.ok) throw new Error('run failed');
      await load();
      showToast('Проверка завершена', 'success');
    } catch {
      showToast('Не удалось запустить проверку', 'error');
    } finally {
      setRunning(false);
    }
  }

  async function toggleTarget(id: number, enabled: boolean) {
    try {
      const res = await fetch(`/api/monitoring/targets/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      if (!res.ok) throw new Error('toggle failed');
      await load();
    } catch {
      showToast('Не удалось переключить цель', 'error');
    }
  }

  async function toggleKind(sourceKind: string, enabled: boolean) {
    try {
      const res = await fetch('/api/monitoring/targets', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceKind, enabled }),
      });
      if (!res.ok) throw new Error('bulk failed');
      const body = await res.json();
      await load();
      showToast(
        enabled ? `Включено целей: ${body.affected}` : `Выключено целей: ${body.affected}`,
        'success'
      );
    } catch {
      showToast('Не удалось переключить группу', 'error');
    }
  }

  const visible = useMemo(() => {
    if (!data) return [];
    const query = search.trim().toLowerCase();
    return data.targets.filter((t) => {
      if (!showDisabled && !t.enabled) return false;
      if (statusFilter !== 'all' && t.status !== statusFilter) return false;
      if (query && !t.url.toLowerCase().includes(query)) return false;
      return true;
    });
  }, [data, search, showDisabled, statusFilter]);

  const disabledCount = data ? data.targets.filter((t) => !t.enabled).length : 0;

  return (
    <main className="mx-auto max-w-[1120px] px-4 py-6 sm:px-6">
      <h1 className="text-[18px] font-semibold text-[var(--ink)]">Мониторинг страниц</h1>
      <p className="mt-1 text-[12px] text-[var(--muted)]">
        Статус {MONITOR_STATUS_META.down.label.toLowerCase()} ставится, только если подряд
        провалились две попытки — моргание сети сюда не попадает.
      </p>

      {loadFailed && (
        <div className="mt-4 rounded-[10px] border border-[var(--line-soft)] bg-[var(--card)] px-4 py-6 text-center text-[13px] text-[#A32020]">
          Не удалось загрузить данные мониторинга.
        </div>
      )}

      {data && (
        <div className="mt-4 space-y-4">
          <MonitorSummary summary={data.summary} running={running} onRun={runNow} />

          <div className="flex flex-wrap items-center gap-2">
            {data.sourceKinds.map((k) => {
              const allOn = k.enabled === k.total;
              return (
                <button
                  key={k.sourceKind}
                  type="button"
                  onClick={() => void toggleKind(k.sourceKind, !allOn)}
                  className="rounded-[6px] bg-[var(--chip)] px-2 py-1 text-[11px] text-[var(--muted)] transition hover:text-[var(--ink)]"
                >
                  {k.sourceKind} · {k.total} · {allOn ? 'вкл' : `${k.enabled} вкл`}
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Segmented
              options={STATUS_OPTIONS}
              value={statusFilter}
              onChange={(v) => setStatusFilter(v as StatusFilter)}
            />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Поиск по URL"
              className="rounded-[7px] border border-[var(--line-soft)] bg-[var(--card)] px-2.5 py-1.5 text-[12px] text-[var(--ink)] outline-none"
            />
            <button
              type="button"
              onClick={() => setShowDisabled((v) => !v)}
              className="text-[12px] text-[var(--muted)] underline-offset-2 hover:underline"
            >
              {showDisabled ? 'Скрыть выключенные' : `Показать выключенные (${disabledCount})`}
            </button>
          </div>

          <MonitorTable targets={visible} onToggle={(id, enabled) => void toggleTarget(id, enabled)} />
          <MonitorEvents events={events} />
        </div>
      )}

      {toast && (
        <Toast
          key={toast.key}
          message={toast.message}
          variant={toast.variant}
          onClose={() => setToast(null)}
        />
      )}
    </main>
  );
}
