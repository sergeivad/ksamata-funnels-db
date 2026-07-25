'use client';

import Link from 'next/link';
import { ExternalLink, CornerDownRight } from 'lucide-react';
import Switch from '@/components/Switch';
import MonitorStatusPill from './MonitorStatusPill';
import { formatAgo } from '@/lib/monitor-status';
import { sourceKindLabel } from '@/lib/monitor-kinds';
import { STATUS_META, type FunnelStatus } from '@/lib/status';

/**
 * Почему страница не проверяется — в падеже, которого нет у STATUS_META.label
 * («Архив» → «воронка в архиве»). Короткая форма для чипа берётся из самого
 * STATUS_META, чтобы подписи статусов не разъехались с остальным интерфейсом.
 */
const INACTIVE_HINT: Record<FunnelStatus, string> = {
  active: '',
  draft: 'воронка в черновике',
  archive: 'воронка в архиве',
};
import type { MonitorTargetView } from '@/lib/monitor-view';

interface Props {
  targets: MonitorTargetView[];
  onToggle: (id: number, enabled: boolean) => void;
}

export default function MonitorTable({ targets, onToggle }: Props) {
  if (targets.length === 0) {
    return (
      <div className="rounded-[10px] border border-[var(--line-soft)] bg-[var(--card)] px-4 py-8 text-center text-[13px] text-[var(--muted)]">
        Под фильтр ничего не подходит.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-[10px] border border-[var(--line-soft)] bg-[var(--card)]">
      <table className="w-full min-w-[760px] border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-[var(--line-soft)] text-left text-[11px] text-[var(--muted)]">
            <th className="px-3 py-2 font-medium">Статус</th>
            <th className="px-3 py-2 font-medium">Страница</th>
            <th className="px-3 py-2 font-medium">Код</th>
            <th className="px-3 py-2 font-medium">Ответ</th>
            <th className="px-3 py-2 font-medium">Держится с</th>
            <th className="px-3 py-2 font-medium">Воронки</th>
            <th className="px-3 py-2 font-medium">Вкл.</th>
          </tr>
        </thead>
        <tbody>
          {targets.map((t) => {
            const redirected = t.finalUrl !== '' && t.finalUrl !== t.url;
            return (
              <tr key={t.id} className="border-b border-[var(--line-soft)] last:border-0 align-top">
                <td className="px-3 py-2">
                  <MonitorStatusPill status={t.status} />
                  {t.consecutiveFailures > 1 && (
                    <div className="mt-1 text-[11px] text-[var(--muted)]">
                      подряд: {t.consecutiveFailures}
                    </div>
                  )}
                </td>
                <td className="px-3 py-2">
                  <a
                    href={t.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="inline-flex items-center gap-1 text-[var(--ink)] hover:underline"
                  >
                    {t.url}
                    <ExternalLink size={12} className="text-[var(--faint)]" />
                  </a>
                  {redirected && (
                    <div className="mt-0.5 flex items-center gap-1 text-[11px] text-[var(--muted)]">
                      <CornerDownRight size={11} />
                      {t.finalUrl}
                    </div>
                  )}
                  {t.error !== '' && (
                    <div className="mt-0.5 text-[11px] text-[#A32020]">{t.error}</div>
                  )}
                  <div className="mt-0.5 text-[11px] text-[var(--faint)]">
                    {sourceKindLabel(t.sourceKind)}
                    {t.manualOverride && ' · переключено вручную'}
                  </div>
                </td>
                <td className="px-3 py-2 text-[var(--muted)]">{t.httpStatus ?? '—'}</td>
                <td className="px-3 py-2 text-[var(--muted)]">
                  {t.latencyMs === null ? '—' : `${t.latencyMs} мс`}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-[var(--muted)]">
                  {formatAgo(t.since)}
                </td>
                <td className="px-3 py-2">
                  <span className="flex flex-wrap items-center gap-1">
                    {t.funnels.map((f) => (
                      <Link
                        key={f.id}
                        href={`/funnels/${f.id}`}
                        className="rounded-[5px] bg-[var(--chip)] px-1.5 py-0.5 text-[11px] text-[var(--muted)] hover:text-[var(--ink)]"
                      >
                        №{f.num}
                      </Link>
                    ))}
                    {/* Пустая колонка у погашенной цели ничего не объясняла: теперь
                        видно, держит ли URL неактивная воронка или уже никто. */}
                    {t.usage === 'inactive' &&
                      t.inactiveFunnels.map((f) => (
                        <Link
                          key={f.id}
                          href={`/funnels/${f.id}`}
                          title={`Страница не проверяется: ${INACTIVE_HINT[f.status]}. Вернут воронку в активные — проверка возобновится сама`}
                          className="rounded-[5px] bg-[var(--chip)] px-1.5 py-0.5 text-[11px] text-[var(--faint)] hover:text-[var(--ink)]"
                        >
                          №{f.num} · {STATUS_META[f.status].label.toLowerCase()}
                        </Link>
                      ))}
                    {t.usage === 'orphan' && (
                      <span
                        title="URL больше не встречается ни в одной воронке — цель осталась только ради истории инцидентов"
                        className="text-[11px] text-[var(--faint)]"
                      >
                        больше не используется
                      </span>
                    )}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <Switch checked={t.enabled} onChange={(v) => onToggle(t.id, v)} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
