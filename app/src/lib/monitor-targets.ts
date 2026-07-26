import { eq, sql, inArray, notInArray } from 'drizzle-orm';
import { type AnyDB } from '../db/client';
import {
  funnels,
  funnelBlocks,
  funnelBlockItems,
  monitorTargets,
  monitorTargetFunnels,
  monitorState,
  monitorSourceKindPrefs,
} from '../db/schema';
import { normalizeUrl, splitUrlField } from './monitor-urls';

/**
 * Мониторим только страницы воронок в этом статусе. Черновики и архив не
 * проверяем: их падения — шум, из-за которого перестают смотреть на настоящие.
 */
export const MONITORED_FUNNEL_STATUS = 'active';

/** Виды источников, которые проверяются, пока по группе не было решения человека. */
export const LANDING_SOURCE_KINDS = ['landings', 'funnel_landing_url'] as const;

const LANDING_SET = new Set<string>(LANDING_SOURCE_KINDS);

/**
 * Решения по группам, снятые одним запросом: синк спрашивает дефолт для каждой
 * цели, и ходить в базу на каждую из ~600 было бы расточительно.
 */
function loadGroupPrefs(db: AnyDB): Map<string, boolean> {
  const rows = db
    .select({ sourceKind: monitorSourceKindPrefs.sourceKind, enabled: monitorSourceKindPrefs.enabled })
    .from(monitorSourceKindPrefs)
    .all() as { sourceKind: string; enabled: number }[];
  return new Map(rows.map((r) => [r.sourceKind, r.enabled === 1]));
}

/**
 * Проверяется ли группа по умолчанию. Решение человека по группе, а если его
 * не было — прежнее правило: ленды да, остальное нет.
 *
 * Именно эта функция и делает «новая ссылка наследует группу»: цель заводится
 * с дефолтом своей группы, а не с захардкоженным списком лендов.
 */
function groupDefault(prefs: Map<string, boolean>, sourceKind: string): 0 | 1 {
  const pref = prefs.get(sourceKind);
  if (pref !== undefined) return pref ? 1 : 0;
  return LANDING_SET.has(sourceKind) ? 1 : 0;
}

/**
 * Чем меньше ранг, тем «главнее» источник. Один и тот же URL может прийти из
 * нескольких мест — цель заводится одна, вид источника берётся у главного.
 */
function sourceRank(kind: string): number {
  if (kind === 'landings') return 0;
  if (kind === 'funnel_landing_url') return 1;
  return 2;
}

interface Collected {
  url: string;
  sourceKind: string;
  funnelIds: Set<number>;
}

/**
 * Собирает URL из данных воронок. По умолчанию — только из **активных**: именно
 * этот набор синк держит под проверкой. Параметр `statuses` нужен дашборду,
 * чтобы тем же способом собрать URL неактивных воронок (см. collectFunnelUrls).
 *
 * Черновик ещё не запущен, архив уже отработал: их страницы могут лежать на
 * законных основаниях, и падения по ним — шум, из-за которого перестают
 * смотреть на настоящие. URL, оставшийся только за неактивными воронками,
 * попадает в общий авто-ретайрмент: гаснет, отвязывается от воронок, но
 * сохраняет историю инцидентов и оживает сам, когда воронку вернут в активные.
 *
 * URL, который делят активная и архивная воронки, остаётся под проверкой, но
 * в связях (и в чипах «Воронки») числится только за активной.
 */
function collectTargets(
  db: AnyDB,
  statuses: readonly string[] = [MONITORED_FUNNEL_STATUS],
): Map<string, Collected> {
  const out = new Map<string, Collected>();

  const add = (url: string, sourceKind: string, funnelId: number) => {
    const existing = out.get(url);
    if (!existing) {
      out.set(url, { url, sourceKind, funnelIds: new Set([funnelId]) });
      return;
    }
    existing.funnelIds.add(funnelId);
    if (sourceRank(sourceKind) < sourceRank(existing.sourceKind)) {
      existing.sourceKind = sourceKind;
    }
  };

  const items = db
    .select({
      url: funnelBlockItems.url,
      kind: funnelBlocks.kind,
      funnelId: funnelBlocks.funnelId,
    })
    .from(funnelBlockItems)
    .innerJoin(funnelBlocks, eq(funnelBlocks.id, funnelBlockItems.blockId))
    .innerJoin(funnels, eq(funnels.id, funnelBlocks.funnelId))
    .where(inArray(funnels.status, [...statuses]))
    .all() as { url: string; kind: string; funnelId: number }[];

  for (const row of items) {
    const url = normalizeUrl(row.url);
    if (url) add(url, row.kind, row.funnelId);
  }

  const funnelRows = db
    .select({ id: funnels.id, landingUrl: funnels.landingUrl })
    .from(funnels)
    .where(inArray(funnels.status, [...statuses]))
    .all() as { id: number; landingUrl: string | null }[];

  for (const row of funnelRows) {
    for (const url of splitUrlField(row.landingUrl)) {
      add(url, 'funnel_landing_url', row.id);
    }
  }

  return out;
}

/**
 * URL, которые держат воронки перечисленных статусов: url → id воронок.
 *
 * Нужна дашборду, чтобы отличить два вида погашенных целей: URL, который ещё
 * лежит в блоке неактивной воронки (архив/черновик — вернут в активные, и цель
 * оживёт), от осиротевшего, который не держит уже никто. Нормализация та же, что
 * у синка, — иначе два места считали бы «тот же URL» по-разному.
 */
export function collectFunnelUrls(db: AnyDB, statuses: readonly string[]): Map<string, number[]> {
  const out = new Map<string, number[]>();
  if (statuses.length === 0) return out;
  for (const item of collectTargets(db, statuses).values()) {
    out.set(item.url, [...item.funnelIds]);
  }
  return out;
}

/**
 * Приводит monitor_targets в соответствие с данными воронок.
 * Инварианты:
 *  - новая цель получает enabled по дефолту своей группы — поэтому ссылка,
 *    добавленная в блок уже включённой группы, начинает проверяться сама;
 *  - у существующей цели с manual_override=1 enabled НЕ трогается —
 *    ручной тумблер переживает синк;
 *  - у существующей цели с manual_override=0 enabled пересчитывается из дефолта
 *    группы: ленд, пропавший из данных на один синк и вернувшийся, снова
 *    включается, а не остаётся навсегда погашённым;
 *  - исчезнувший URL не удаляется: гасится и отвязывается от воронок,
 *    чтобы не потерять историю инцидентов.
 */
export function syncMonitorTargets(db: AnyDB): { total: number; created: number; retired: number } {
  const collected = collectTargets(db);
  const prefs = loadGroupPrefs(db);
  let created = 0;
  let retired = 0;

  db.transaction((tx) => {
    for (const item of collected.values()) {
      const existing = tx
        .select({ id: monitorTargets.id, manualOverride: monitorTargets.manualOverride })
        .from(monitorTargets)
        .where(eq(monitorTargets.url, item.url))
        .get() as { id: number; manualOverride: number } | undefined;

      let targetId: number;
      if (existing) {
        tx.update(monitorTargets)
          .set({
            sourceKind: item.sourceKind,
            // Ручной тумблер (manual_override=1) неприкосновенен. Без него
            // enabled — производная от дефолта группы, поэтому пересчитываем:
            // иначе цель, погашенная авто-ретайрментом, уже никогда не ожила бы.
            ...(existing.manualOverride === 1
              ? {}
              : { enabled: groupDefault(prefs, item.sourceKind) }),
            updatedAt: sql`(datetime('now'))`,
          })
          .where(eq(monitorTargets.id, existing.id))
          .run();
        targetId = existing.id;
      } else {
        const inserted = tx
          .insert(monitorTargets)
          .values({
            url: item.url,
            sourceKind: item.sourceKind,
            enabled: groupDefault(prefs, item.sourceKind),
          })
          .returning({ id: monitorTargets.id })
          .get() as { id: number };
        targetId = inserted.id;
        created += 1;
      }

      // Строка состояния должна существовать всегда — дашборд показывает
      // «не проверялось», а не пустоту.
      tx.insert(monitorState).values({ targetId, status: 'unknown' }).onConflictDoNothing().run();

      tx.delete(monitorTargetFunnels).where(eq(monitorTargetFunnels.targetId, targetId)).run();
      for (const funnelId of item.funnelIds) {
        tx.insert(monitorTargetFunnels).values({ targetId, funnelId }).onConflictDoNothing().run();
      }
    }

    const liveUrls = [...collected.keys()];
    const cols = { id: monitorTargets.id, manualOverride: monitorTargets.manualOverride };
    const stale = (
      liveUrls.length === 0
        ? tx.select(cols).from(monitorTargets).all()
        : tx
            .select(cols)
            .from(monitorTargets)
            .where(notInArray(monitorTargets.url, liveUrls))
            .all()
    ) as { id: number; manualOverride: number }[];

    if (stale.length > 0) {
      const ids = stale.map((s) => s.id);
      // Ручной тумблер неприкосновенен и здесь, ровно как в ветке выше. Иначе
      // цель, включённую человеком вопреки дефолту группы, гасило бы первым же
      // исчезновением URL, а override оставался бы стоять — и живая ветка потом
      // отказывалась бы пересчитать enabled обратно. Вернувшийся URL оставался
      // бы выключенным навсегда, то есть решение человека терялось молча.
      const mutable = stale.filter((s) => s.manualOverride === 0).map((s) => s.id);
      if (mutable.length > 0) {
        tx.update(monitorTargets)
          .set({ enabled: 0, updatedAt: sql`(datetime('now'))` })
          .where(inArray(monitorTargets.id, mutable))
          .run();
      }
      // Связи с воронками снимаем у всех осиротевших целей: их действительно
      // больше никто не использует, независимо от тумблера.
      tx.delete(monitorTargetFunnels).where(inArray(monitorTargetFunnels.targetId, ids)).run();
      retired = mutable.length;
    }
  });

  return { total: collected.size, created, retired };
}

/** enabled по умолчанию для вида источника — то же правило, что и в синке. */
function defaultEnabled(db: AnyDB, sourceKind: string): 0 | 1 {
  return groupDefault(loadGroupPrefs(db), sourceKind);
}

/**
 * Переключает одну цель вручную. Возвращает false, если цели нет.
 *
 * manual_override ставится, только если запрошенное состояние отличается от
 * дефолта группы — иначе «включить ленды обратно» намертво пришпиливало бы их
 * (override никогда не снимался автоматически), и авто-оживление вернувшегося
 * URL переставало бы работать навсегда. Смысл override после этого читается
 * однозначно: «эта цель отличается от своей группы».
 */
export function setTargetEnabled(db: AnyDB, targetId: number, enabled: boolean): boolean {
  const existing = db
    .select({ id: monitorTargets.id, sourceKind: monitorTargets.sourceKind })
    .from(monitorTargets)
    .where(eq(monitorTargets.id, targetId))
    .get() as { id: number; sourceKind: string } | undefined;
  if (!existing) return false;

  const enabledValue = enabled ? 1 : 0;
  const manualOverride = enabledValue === defaultEnabled(db, existing.sourceKind) ? 0 : 1;

  db.update(monitorTargets)
    .set({ enabled: enabledValue, manualOverride, updatedAt: sql`(datetime('now'))` })
    .where(eq(monitorTargets.id, targetId))
    .run();
  return true;
}

/**
 * Переключает целую группу по виду источника. Возвращает число затронутых целей.
 *
 * Клик по группе меняет её дефолт, а не помечает каждую цель по отдельности:
 * решение хранится в monitor_source_kind_prefs, и ссылка, добавленная в блок
 * этой группы завтра, заводится синком уже с нужным enabled. Раньше правились
 * только существующие цели, и новые приходили выключенными.
 *
 * manual_override у всей группы снимается: групповое решение перебивает
 * точечные тумблеры внутри неё, иначе «включить группу» оставляло бы дыры из
 * целей, выключенных когда-то поштучно, и объяснить их было бы нечем.
 */
export function setSourceKindEnabled(db: AnyDB, sourceKind: string, enabled: boolean): number {
  const rows = db
    .select({ id: monitorTargets.id })
    .from(monitorTargets)
    .where(eq(monitorTargets.sourceKind, sourceKind))
    .all() as { id: number }[];

  const enabledValue = enabled ? 1 : 0;

  db.transaction((tx) => {
    // Предпочтение пишем всегда, даже если целей этого вида сейчас нет: группа
    // могла временно опустеть, а решение по ней должно пережить это.
    tx.insert(monitorSourceKindPrefs)
      .values({ sourceKind, enabled: enabledValue })
      .onConflictDoUpdate({
        target: monitorSourceKindPrefs.sourceKind,
        set: { enabled: enabledValue, updatedAt: sql`(datetime('now'))` },
      })
      .run();

    if (rows.length > 0) {
      tx.update(monitorTargets)
        .set({ enabled: enabledValue, manualOverride: 0, updatedAt: sql`(datetime('now'))` })
        .where(eq(monitorTargets.sourceKind, sourceKind))
        .run();
    }
  });

  return rows.length;
}
