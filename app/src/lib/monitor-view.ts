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
import { collectFunnelUrls, MONITORED_FUNNEL_STATUS } from './monitor-targets';
import { FUNNEL_STATUS_VALUES, isFunnelStatus, type FunnelStatus } from './status';
import { compareByFrontCodeAsc } from './funnel-sort';

/** Статусы воронки, страницы которых не проверяются (черновик, архив). */
const INACTIVE_FUNNEL_STATUSES: readonly FunnelStatus[] = FUNNEL_STATUS_VALUES.filter(
  (s) => s !== MONITORED_FUNNEL_STATUS,
);

/**
 * Кто держит цель — от этого зависит, считать ли её в группе.
 *
 *  - `active`   — URL лежит в данных активной воронки: обычная рабочая цель;
 *  - `inactive` — URL остался только у черновика или архива. Проверять нечего,
 *    но цель не мусор: вернут воронку в активные — оживёт сама, поэтому она
 *    остаётся в знаменателе группы с пометкой;
 *  - `orphan`   — URL не держит уже никто (ссылку заменили, опечатку
 *    исправили). Существует только как история инцидентов и в счёт группы не
 *    идёт — иначе «41 из 45» вечно намекало бы на четыре недоступные страницы.
 */
export type MonitorTargetUsage = 'active' | 'inactive' | 'orphan';

/**
 * Ссылка на воронку в дашборде. `num` остаётся для сортировки и как запасной
 * ярлык, но человеку показывается `frontCode`: на карточке воронки написан
 * именно он, и «№70» в таблице целей указывало на воронку с кодом f74.
 */
export interface MonitorFunnelRef {
  id: number;
  num: number;
  frontCode: string;
}

export interface MonitorTargetView {
  id: number;
  url: string;
  sourceKind: string;
  enabled: boolean;
  /** Тумблер отклонён от дефолта вида источника вручную — синк это не тронет. */
  manualOverride: boolean;
  status: MonitorStatus;
  httpStatus: number | null;
  finalUrl: string;
  error: string;
  latencyMs: number | null;
  checkedAt: string | null;
  since: string | null;
  consecutiveFailures: number;
  funnels: MonitorFunnelRef[];
  /** Кто держит URL — см. MonitorTargetUsage. */
  usage: MonitorTargetUsage;
  /** Заполнен только для `usage === 'inactive'`: чьи это страницы теперь. */
  inactiveFunnels: MonitorInactiveFunnelRef[];
}

export interface MonitorInactiveFunnelRef extends MonitorFunnelRef {
  status: FunnelStatus;
}

export interface MonitorSummaryView {
  /** Все строки monitor_targets, включая списанные: размер таблицы, а не «сколько страниц у нас есть». */
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
  /**
   * Страницы группы, которые вообще подлежат проверке, — то есть те, что лежат
   * в данных активных воронок. Ушла воронка в архив (или в черновик) — её
   * страницы из мониторинга просто исчезают, это и есть смысл архива; в
   * знаменателе им делать нечего, как и осиротевшим URL.
   */
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
      frontCode: funnels.frontCode,
    })
    .from(monitorTargetFunnels)
    .innerJoin(funnels, eq(funnels.id, monitorTargetFunnels.funnelId));

  const rows = (
    targetIds ? query.where(inArray(monitorTargetFunnels.targetId, targetIds)) : query
  )
    .orderBy(asc(funnels.num))
    .all() as { targetId: number; funnelId: number; num: number; frontCode: string | null }[];

  const map = new Map<number, MonitorFunnelRef[]>();
  for (const row of rows) {
    const list = map.get(row.targetId) ?? [];
    list.push({ id: row.funnelId, num: row.num, frontCode: row.frontCode ?? '' });
    map.set(row.targetId, list);
  }
  // Порядок — по F, как в списке воронок; бескодовые в конец, чтобы чипы
  // читались как один ряд номеров, а не как два перемешанных.
  for (const list of map.values()) list.sort(compareByFrontCodeAsc);
  return map;
}

/** Код и статус воронки по id — одним запросом, для пометок «в архиве»/«в черновике». */
function funnelRefsById(db: AnyDB): Map<number, MonitorInactiveFunnelRef> {
  const rows = db
    .select({ id: funnels.id, num: funnels.num, frontCode: funnels.frontCode, status: funnels.status })
    .from(funnels)
    .all() as { id: number; num: number; frontCode: string | null; status: string }[];

  const map = new Map<number, MonitorInactiveFunnelRef>();
  for (const row of rows) {
    if (!isFunnelStatus(row.status)) continue;
    map.set(row.id, { id: row.id, num: row.num, frontCode: row.frontCode ?? '', status: row.status });
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
      manualOverride: monitorTargets.manualOverride,
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
      manualOverride: number;
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
  // Погашенная цель бывает двух сортов, и различает их только сверка с данными
  // воронок: URL, который ещё держит черновик или архив, и URL, которого нет
  // уже нигде. Синк этого различия не хранит, поэтому считаем при чтении —
  // неактивных воронок мало, и запрос дешёвый.
  const inactiveUrls = collectFunnelUrls(db, INACTIVE_FUNNEL_STATUSES);
  const funnelRefs =
    inactiveUrls.size === 0 ? new Map<number, MonitorInactiveFunnelRef>() : funnelRefsById(db);

  const targets: MonitorTargetView[] = rows.map((r) => {
    const funnelLinks = links.get(r.id) ?? [];
    const heldBy = funnelLinks.length > 0 ? [] : (inactiveUrls.get(r.url) ?? []);
    const usage: MonitorTargetUsage =
      funnelLinks.length > 0 ? 'active' : heldBy.length > 0 ? 'inactive' : 'orphan';

    return {
      id: r.id,
      url: r.url,
      sourceKind: r.sourceKind,
      enabled: r.enabled === 1,
      manualOverride: r.manualOverride === 1,
      status: isMonitorStatus(r.status) ? r.status : 'unknown',
      httpStatus: r.httpStatus,
      finalUrl: r.finalUrl ?? '',
      error: r.error ?? '',
      latencyMs: r.latencyMs,
      checkedAt: r.checkedAt,
      since: r.since,
      consecutiveFailures: r.consecutiveFailures ?? 0,
      funnels: funnelLinks,
      usage,
      inactiveFunnels: heldBy
        .map((id) => funnelRefs.get(id))
        .filter((f): f is MonitorInactiveFunnelRef => f !== undefined)
        .sort(compareByFrontCodeAsc),
    };
  });

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
    // В группу идут страницы активных воронок. Плюс — включённые вручную, даже
    // если воронка уже неактивна: иначе такая цель попала бы в «Проверяем», но
    // не в знаменатель, и чип показал бы «5 из 4».
    if (t.usage === 'active' || t.enabled) {
      const kind = kinds.get(t.sourceKind) ?? { sourceKind: t.sourceKind, total: 0, enabled: 0 };
      kind.total += 1;
      if (t.enabled) kind.enabled += 1;
      kinds.set(t.sourceKind, kind);
    }

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
