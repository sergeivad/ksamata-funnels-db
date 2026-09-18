'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useCanEdit } from './AuthProvider';
import { formatAgo, MAX_POLL_FAILURES, POLL_INTERVAL_MS } from '@/lib/monitor-status';
import type { FunnelHealth, FunnelProblem } from '@/lib/funnel-health';

interface Props {
  funnelId: number;
}

interface Payload {
  health: FunnelHealth;
  problems: FunnelProblem[];
  checking: boolean;
}

/**
 * Отображаемая длина адреса в разборе. В живой базе лежит адрес на 2019
 * знаков — без границы один такой пункт растягивался на пол-экрана простынёй
 * и топил под собой настоящую находку (мёртвую комнату, ревью шага 9). Само
 * значение не меняем — усечение только визуальное, полный адрес остаётся в
 * `title`.
 */
const URL_DISPLAY_MAX = 120;

function truncateUrl(url: string): string {
  return url.length > URL_DISPLAY_MAX ? `${url.slice(0, URL_DISPLAY_MAX)}…` : url;
}

/**
 * Почему не удалось запустить проверку — человеческим текстом.
 *
 * Молчащая кнопка — дефект: 409 (занято) и 401 (сессия кончилась) выглядят
 * одинаково — «нажал, ничего не произошло», — а делать надо разное.
 * `checkingFunnelId` в теле 409 отличает «эту воронку уже проверяют» от
 * «занято другой»: в первом случае ошибки нет вовсе, надо просто начать
 * опрос, во втором — подождать чужую проверку.
 */
function runFailureMessage(status: number): string {
  if (status === 409) return 'Идёт проверка другой воронки — попробуйте через минуту.';
  if (status === 401 || status === 403) return 'Сессия закончилась — войдите заново.';
  return `Не удалось запустить проверку (HTTP ${status}).`;
}

export default function FunnelHealthSection({ funnelId }: Props) {
  const canEdit = useCanEdit();
  const [data, setData] = useState<Payload | null>(null);
  const [polling, setPolling] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const load = useCallback(async (): Promise<Payload | null> => {
    try {
      const res = await fetch(`/api/monitoring/funnels/${funnelId}`);
      if (!res.ok) return null;
      const payload: Payload = await res.json();
      if (!mountedRef.current) return null;
      setData(payload);
      return payload;
    } catch {
      return null;
    }
  }, [funnelId]);

  useEffect(() => {
    mountedRef.current = true;
    if (canEdit) void load();
    return () => { mountedRef.current = false; };
  }, [canEdit, load]);

  useEffect(() => {
    if (!polling) return;
    let failures = 0;
    const timer = setInterval(() => {
      void (async () => {
        const fresh = await load();
        if (!fresh) {
          failures += 1;
          if (failures >= MAX_POLL_FAILURES) setPolling(false);
          return;
        }
        failures = 0;
        if (!fresh.checking) setPolling(false);
      })();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [polling, load]);

  async function run() {
    setRunError(null);
    let res: Response;
    try {
      res = await fetch(`/api/monitoring/funnels/${funnelId}/run`, { method: 'POST' });
    } catch {
      setRunError('Сервер не ответил — проверьте соединение.');
      return;
    }

    if (res.ok) {
      setPolling(true);
      return;
    }

    // 409 по ЭТОЙ же воронке — не отказ: проверка идёт, показывать нечего,
    // кроме прогресса. Тело разбираем мягко: отказ мог прийти и не от нашего
    // обработчика (прокси, перезапуск), и JSON в нём не гарантирован.
    if (res.status === 409) {
      const body = (await res.json().catch(() => null)) as { checkingFunnelId?: number } | null;
      if (body?.checkingFunnelId === funnelId) {
        setPolling(true);
        return;
      }
    }
    setRunError(runFailureMessage(res.status));
  }

  // Анониму секции нет вовсе, а не readOnly: роут ответит ему 401, и пустая
  // секция выглядела бы поломкой.
  if (!canEdit || !data) return null;

  const { health, problems, checking } = data;
  const outOfScope = health.total - health.enabled;

  return (
    <section id="health" className="mt-4 scroll-mt-4">
      <div className="mb-2 flex flex-wrap items-center gap-3">
        <h2 className="text-[14px] font-semibold">Проверка ссылок</h2>
        <span className="text-[11px] text-[var(--color-text-secondary)]">
          Проверено: {formatAgo(health.lastCheckedAt)}
        </span>
        <button
          type="button"
          onClick={() => void run()}
          disabled={checking || polling}
          className="ml-auto inline-flex items-center gap-1.5 rounded-[8px] border border-[var(--color-border-soft)] bg-white px-3 py-1.5 text-[12px] transition hover:border-[#111111] disabled:opacity-60"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${checking || polling ? 'animate-spin' : ''}`} />
          {checking || polling ? 'Проверяем…' : 'Проверить сейчас'}
        </button>
      </div>

      {runError && (
        <p className="mb-2 text-[12px] text-[#B42318]" role="status">
          {runError}
        </p>
      )}

      {problems.length === 0 ? (
        <p className="text-[12px] text-[var(--color-text-secondary)]">
          Все проверенные адреса отвечают.
        </p>
      ) : (
        <ul className="grid gap-1.5">
          {problems.map((p) => (
            <li
              key={p.url}
              className="rounded-[8px] border border-[var(--color-border-soft)] bg-white px-3 py-2"
            >
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="text-[12px] font-semibold text-[#A32020]">
                  {p.error || 'Не проверялось'}
                </span>
                <span className="text-[11px] text-[var(--color-text-secondary)]">{p.origin}</span>
                {!p.enabled && (
                  <span className="rounded bg-[#E8E4DA] px-1.5 py-0.5 text-[10px] text-[#5E5A52]">
                    вне постоянной проверки
                  </span>
                )}
              </div>
              <div
                className="mt-0.5 break-all text-[11px] text-[var(--color-text-secondary)]"
                title={p.url}
              >
                {truncateUrl(p.url)}
              </div>
              {p.since && (
                <div className="mt-0.5 text-[11px] text-[var(--color-text-secondary)]">
                  В этом состоянии: {formatAgo(p.since)}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {outOfScope > 0 && (
        // Без этой строки молчание секции у воронки с выключенными «Ссылками»
        // читалось бы как «всё живо».
        <p className="mt-2 text-[11px] text-[var(--color-text-secondary)]">
          {outOfScope} адресов из {health.total} вне постоянной проверки —{' '}
          <a href="/monitoring" className="underline hover:no-underline">
            группы на странице мониторинга
          </a>
          .
        </p>
      )}
    </section>
  );
}
