import { eq, desc, asc, inArray } from 'drizzle-orm';
import { type AnyDB } from '../db/client';
import {
  funnels,
  monitorTargets,
  monitorTargetFunnels,
  monitorState,
  monitorEvents,
} from '../db/schema';
import { MONITOR_STATUS_META, isMonitorStatus, type MonitorStatus } from './monitor-status';
import { isCycleRunning } from './monitor-run';

export interface MonitorFunnelRef {
  id: number;
  num: number;
}

export interface MonitorTargetView {
  id: number;
  url: string;
  sourceKind: string;
  enabled: boolean;
  status: MonitorStatus;
  httpStatus: number | null;
  finalUrl: string;
  error: string;
  latencyMs: number | null;
  checkedAt: string | null;
  since: string | null;
  consecutiveFailures: number;
  funnels: MonitorFunnelRef[];
}

export interface MonitorSummaryView {
  total: number;
  enabled: number;
  up: number;
  slow: number;
  down: number;
  unknown: number;
  lastCheckedAt: string | null;
  running: boolean;
}

export interface MonitorSourceKindView {
  sourceKind: string;
  total: number;
  enabled: number;
}

export interface MonitorEventView {
  id: number;
  url: string;
  fromStatus: string;
  toStatus: string;
  httpStatus: number | null;
  error: string;
  at: string;
  funnels: MonitorFunnelRef[];
}

/**
 * Номера воронок по каждой цели — одним запросом, чтобы не плодить N+1.
 * Без `targetIds` тянет связи по всем целям (нужно дашборду). С `targetIds` —
 * только по переданным целям, иначе постраничная выдача событий тянула бы
 * связи всей таблицы ради нескольких строк.
 *
 * Экспортирована, чтобы саму фильтрацию по `targetIds` можно было проверить
 * напрямую тестом — разница между «всё» (дашборд) и «только эта страница»
 * (список событий) и есть то, что стоит закрепить.
 */
export function funnelsByTarget(db: AnyDB, targetIds?: number[]): Map<number, MonitorFunnelRef[]> {
  // IN () без аргументов — известная ловушка SQL; на пустой странице просто
  // отдаём пустую карту, не строя запрос.
  if (targetIds && targetIds.length === 0) return new Map();

  const query = db
    .select({
      targetId: monitorTargetFunnels.targetId,
      funnelId: funnels.id,
      num: funnels.num,
    })
    .from(monitorTargetFunnels)
    .innerJoin(funnels, eq(funnels.id, monitorTargetFunnels.funnelId));

  const rows = (
    targetIds ? query.where(inArray(monitorTargetFunnels.targetId, targetIds)) : query
  )
    .orderBy(asc(funnels.num))
    .all() as { targetId: number; funnelId: number; num: number }[];

  const map = new Map<number, MonitorFunnelRef[]>();
  for (const row of rows) {
    const list = map.get(row.targetId) ?? [];
    list.push({ id: row.funnelId, num: row.num });
    map.set(row.targetId, list);
  }
  return map;
}

export function getMonitorDashboard(db: AnyDB): {
  summary: MonitorSummaryView;
  sourceKinds: MonitorSourceKindView[];
  targets: MonitorTargetView[];
} {
  const rows = db
    .select({
      id: monitorTargets.id,
      url: monitorTargets.url,
      sourceKind: monitorTargets.sourceKind,
      enabled: monitorTargets.enabled,
      status: monitorState.status,
      httpStatus: monitorState.httpStatus,
      finalUrl: monitorState.finalUrl,
      error: monitorState.error,
      latencyMs: monitorState.latencyMs,
      checkedAt: monitorState.checkedAt,
      since: monitorState.since,
      consecutiveFailures: monitorState.consecutiveFailures,
    })
    .from(monitorTargets)
    .leftJoin(monitorState, eq(monitorState.targetId, monitorTargets.id))
    .all() as {
      id: number;
      url: string;
      sourceKind: string;
      enabled: number;
      status: string | null;
      httpStatus: number | null;
      finalUrl: string | null;
      error: string | null;
      latencyMs: number | null;
      checkedAt: string | null;
      since: string | null;
      consecutiveFailures: number | null;
    }[];

  const links = funnelsByTarget(db);

  const targets: MonitorTargetView[] = rows.map((r) => ({
    id: r.id,
    url: r.url,
    sourceKind: r.sourceKind,
    enabled: r.enabled === 1,
    status: isMonitorStatus(r.status) ? r.status : 'unknown',
    httpStatus: r.httpStatus,
    finalUrl: r.finalUrl ?? '',
    error: r.error ?? '',
    latencyMs: r.latencyMs,
    checkedAt: r.checkedAt,
    since: r.since,
    consecutiveFailures: r.consecutiveFailures ?? 0,
    funnels: links.get(r.id) ?? [],
  }));

  // Сначала то, что требует внимания; внутри статуса — по URL, чтобы порядок был стабильным.
  targets.sort((a, b) => {
    const byStatus = MONITOR_STATUS_META[a.status].order - MONITOR_STATUS_META[b.status].order;
    return byStatus !== 0 ? byStatus : a.url.localeCompare(b.url);
  });

  const summary: MonitorSummaryView = {
    total: targets.length,
    enabled: 0,
    up: 0,
    slow: 0,
    down: 0,
    unknown: 0,
    lastCheckedAt: null,
    running: isCycleRunning(),
  };

  const kinds = new Map<string, MonitorSourceKindView>();

  for (const t of targets) {
    const kind = kinds.get(t.sourceKind) ?? { sourceKind: t.sourceKind, total: 0, enabled: 0 };
    kind.total += 1;
    if (t.enabled) kind.enabled += 1;
    kinds.set(t.sourceKind, kind);

    if (!t.enabled) continue;
    summary.enabled += 1;
    summary[t.status] += 1;
    if (t.checkedAt && (!summary.lastCheckedAt || t.checkedAt > summary.lastCheckedAt)) {
      summary.lastCheckedAt = t.checkedAt;
    }
  }

  const sourceKinds = [...kinds.values()].sort((a, b) => b.total - a.total);

  return { summary, sourceKinds, targets };
}

export function listMonitorEvents(db: AnyDB, limit = 50, offset = 0): MonitorEventView[] {
  const rows = db
    .select({
      id: monitorEvents.id,
      targetId: monitorEvents.targetId,
      url: monitorTargets.url,
      fromStatus: monitorEvents.fromStatus,
      toStatus: monitorEvents.toStatus,
      httpStatus: monitorEvents.httpStatus,
      error: monitorEvents.error,
      at: monitorEvents.at,
    })
    .from(monitorEvents)
    .innerJoin(monitorTargets, eq(monitorTargets.id, monitorEvents.targetId))
    .orderBy(desc(monitorEvents.at), desc(monitorEvents.id))
    .limit(limit)
    .offset(offset)
    .all() as {
      id: number;
      targetId: number;
      url: string;
      fromStatus: string;
      toStatus: string;
      httpStatus: number | null;
      error: string;
      at: string;
    }[];

  // Ограничиваем связку целями этой страницы, а не всей таблицей.
  const targetIds = [...new Set(rows.map((r) => r.targetId))];
  const links = funnelsByTarget(db, targetIds);

  return rows.map((r) => ({
    id: r.id,
    url: r.url,
    fromStatus: r.fromStatus,
    toStatus: r.toStatus,
    httpStatus: r.httpStatus,
    error: r.error,
    at: r.at,
    funnels: links.get(r.targetId) ?? [],
  }));
}
