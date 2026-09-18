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
import { MONITORED_FUNNEL_STATUS } from './monitor-targets';
import { isFunnelStatus, type FunnelStatus } from './status';
import { compareByFrontCodeAsc } from './funnel-sort';
import { readTelegramConfig } from './monitor-notify';

/**
 * Кто держит цель — от этого зависит, считать ли её в группе.
 *
 *  - `active`   — URL лежит в данных активной воронки: обычная рабочая цель,
 *    всегда в знаменателе группы;
 *  - `inactive` — URL остался только у черновика или архива. Не мусор: вернут
 *    воронку в активные — оживёт сама. Но в знаменателе группы НЕ участвует
 *    (см. `getMonitorDashboard` — условие `usage === 'active' || t.enabled`),
 *    ровно как `orphan`, — если только его не включили вручную: тогда он всё
 *    равно в счёте, иначе включённых оказалось бы больше, чем всего;
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
  /**
   * Состояние телеграм-уведомлений. Стоит в сводке, а не только в переменных
   * окружения контейнера: ненастроенная рассылка молчит ровно так же, как
   * настроенная и спокойная, — и отличить одно от другого иначе нельзя.
   */
  telegram: { configured: boolean; chats: number };
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
 * Воронки по каждой цели — одним запросом, чтобы не плодить N+1. Без
 * `targetIds` тянет связи по всем целям (нужно дашборду). С `targetIds` —
 * только по переданным целям, иначе постраничная выдача событий тянула бы
 * связи всей таблицы ради нескольких строк.
 *
 * Несёт статус держателя (`status`) в каждой записи — с 18.09.2026 связь
 * заводится по всем статусам воронки разом (см. `collectTargets` в
 * `monitor-targets.ts`), и дашборду больше не нужен отдельный проход по
 * данным воронок, чтобы отличить активного держателя от черновика/архива:
 * это теперь видно прямо здесь, без второго запроса (`collectFunnelUrls`,
 * удалена вместе с этим обходным путём).
 *
 * Экспортирована, чтобы саму фильтрацию по `targetIds` можно было проверить
 * напрямую тестом — разница между «всё» (дашборд) и «только эта страница»
 * (список событий) и есть то, что стоит закрепить.
 */
export function funnelsByTarget(db: AnyDB, targetIds?: number[]): Map<number, MonitorInactiveFunnelRef[]> {
  // IN () без аргументов — известная ловушка SQL; на пустой странице просто
  // отдаём пустую карту, не строя запрос.
  if (targetIds && targetIds.length === 0) return new Map();

  const query = db
    .select({
      targetId: monitorTargetFunnels.targetId,
      funnelId: funnels.id,
      num: funnels.num,
      frontCode: funnels.frontCode,
      status: funnels.status,
    })
    .from(monitorTargetFunnels)
    .innerJoin(funnels, eq(funnels.id, monitorTargetFunnels.funnelId));

  const rows = (
    targetIds ? query.where(inArray(monitorTargetFunnels.targetId, targetIds)) : query
  )
    .orderBy(asc(funnels.num))
    .all() as { targetId: number; funnelId: number; num: number; frontCode: string | null; status: string }[];

  const map = new Map<number, MonitorInactiveFunnelRef[]>();
  for (const row of rows) {
    if (!isFunnelStatus(row.status)) continue;
    const list = map.get(row.targetId) ?? [];
    list.push({ id: row.funnelId, num: row.num, frontCode: row.frontCode ?? '', status: row.status });
    map.set(row.targetId, list);
  }
  // Порядок — по F, как в списке воронок; бескодовые в конец, чтобы чипы
  // читались как один ряд номеров, а не как два перемешанных.
  for (const list of map.values()) list.sort(compareByFrontCodeAsc);
  return map;
}

export function getMonitorDashboard(
  db: AnyDB,
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): {
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

  const targets: MonitorTargetView[] = rows.map((r) => {
    const linked = links.get(r.id) ?? [];
    // «Кто держит адрес» теперь знает и статус держателя, поэтому пересобирать
    // URL неактивных воронок больше не нужно — раньше это был обходной путь
    // ровно потому, что связи хранились только для активных.
    const activeFunnels = linked.filter((f) => f.status === MONITORED_FUNNEL_STATUS);
    const heldBy = linked.filter((f) => f.status !== MONITORED_FUNNEL_STATUS);
    const usage: MonitorTargetUsage =
      activeFunnels.length > 0 ? 'active' : heldBy.length > 0 ? 'inactive' : 'orphan';

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
      // eslint: деструктурированный `status` не используется — им и не нужно
      // пользоваться, задача ровно в том, чтобы его отбросить.
      funnels: activeFunnels.map(({ status: _status, ...ref }) => ref),
      usage,
      inactiveFunnels: heldBy,
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
    telegram: (() => {
      const config = readTelegramConfig(env);
      return { configured: config !== null, chats: config?.chatIds.length ?? 0 };
    })(),
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
    // Лента показывает только активных держателей — ровно как таблица целей
    // (см. `activeFunnels` в getMonitorDashboard выше). `funnelsByTarget` с
    // 18.09.2026 несёт держателей всех статусов, но до этой задачи связей у
    // архива/черновика не существовало вовсе, и лента молча показывала только
    // активных; без фильтра сюда тихо просочились бы архивные коды, а поле
    // `status`, которого нет в объявленном типе `MonitorFunnelRef`, утекло бы
    // наружу в ответ `GET /api/monitoring/events`.
    funnels: (links.get(r.targetId) ?? [])
      .filter((f) => f.status === MONITORED_FUNNEL_STATUS)
      .map(({ status: _status, ...ref }) => ref),
  }));
}
