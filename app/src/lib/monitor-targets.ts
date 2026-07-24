import { eq, sql, inArray, notInArray } from 'drizzle-orm';
import { type AnyDB } from '../db/client';
import {
  funnels,
  funnelBlocks,
  funnelBlockItems,
  monitorTargets,
  monitorTargetFunnels,
  monitorState,
} from '../db/schema';
import { normalizeUrl, splitUrlField } from './monitor-urls';

/** Виды источников, которые включаются в мониторинг сразу при заведении цели. */
export const LANDING_SOURCE_KINDS = ['landings', 'funnel_landing_url'] as const;

const LANDING_SET = new Set<string>(LANDING_SOURCE_KINDS);

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

/** Собирает все пригодные для проверки URL из данных воронок. */
function collectTargets(db: AnyDB): Map<string, Collected> {
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
    .all() as { url: string; kind: string; funnelId: number }[];

  for (const row of items) {
    const url = normalizeUrl(row.url);
    if (url) add(url, row.kind, row.funnelId);
  }

  const funnelRows = db
    .select({ id: funnels.id, landingUrl: funnels.landingUrl })
    .from(funnels)
    .all() as { id: number; landingUrl: string | null }[];

  for (const row of funnelRows) {
    for (const url of splitUrlField(row.landingUrl)) {
      add(url, 'funnel_landing_url', row.id);
    }
  }

  return out;
}

/**
 * Приводит monitor_targets в соответствие с данными воронок.
 * Инварианты:
 *  - новая цель получает enabled=1 только для лендов;
 *  - у существующей цели с manual_override=1 enabled НЕ трогается —
 *    ручной тумблер переживает синк;
 *  - у существующей цели с manual_override=0 enabled пересчитывается из вида
 *    источника: ленд, пропавший из данных на один синк и вернувшийся, снова
 *    включается, а не остаётся навсегда погашённым;
 *  - исчезнувший URL не удаляется: гасится и отвязывается от воронок,
 *    чтобы не потерять историю инцидентов.
 */
export function syncMonitorTargets(db: AnyDB): { total: number; created: number; retired: number } {
  const collected = collectTargets(db);
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
            // enabled — производная от вида источника, поэтому пересчитываем:
            // иначе цель, погашенная авто-ретайрментом, уже никогда не ожила бы.
            ...(existing.manualOverride === 1
              ? {}
              : { enabled: LANDING_SET.has(item.sourceKind) ? 1 : 0 }),
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
            enabled: LANDING_SET.has(item.sourceKind) ? 1 : 0,
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
    const stale = (
      liveUrls.length === 0
        ? tx.select({ id: monitorTargets.id }).from(monitorTargets).all()
        : tx
            .select({ id: monitorTargets.id })
            .from(monitorTargets)
            .where(notInArray(monitorTargets.url, liveUrls))
            .all()
    ) as { id: number }[];

    if (stale.length > 0) {
      const ids = stale.map((s) => s.id);
      tx.update(monitorTargets)
        .set({ enabled: 0, updatedAt: sql`(datetime('now'))` })
        .where(inArray(monitorTargets.id, ids))
        .run();
      tx.delete(monitorTargetFunnels).where(inArray(monitorTargetFunnels.targetId, ids)).run();
      retired = ids.length;
    }
  });

  return { total: collected.size, created, retired };
}

/** enabled по умолчанию для вида источника — то же правило, что и в синке. */
function defaultEnabled(sourceKind: string): 0 | 1 {
  return LANDING_SET.has(sourceKind) ? 1 : 0;
}

/**
 * Переключает одну цель вручную. Возвращает false, если цели нет.
 *
 * manual_override ставится, только если запрошенное состояние отличается от
 * дефолта для вида источника — иначе «включить ленды обратно» намертво
 * пришпиливало бы их (override никогда не снимался автоматически), и
 * авто-оживление вернувшегося URL переставало бы работать навсегда.
 */
export function setTargetEnabled(db: AnyDB, targetId: number, enabled: boolean): boolean {
  const existing = db
    .select({ id: monitorTargets.id, sourceKind: monitorTargets.sourceKind })
    .from(monitorTargets)
    .where(eq(monitorTargets.id, targetId))
    .get() as { id: number; sourceKind: string } | undefined;
  if (!existing) return false;

  const enabledValue = enabled ? 1 : 0;
  const manualOverride = enabledValue === defaultEnabled(existing.sourceKind) ? 0 : 1;

  db.update(monitorTargets)
    .set({ enabled: enabledValue, manualOverride, updatedAt: sql`(datetime('now'))` })
    .where(eq(monitorTargets.id, targetId))
    .run();
  return true;
}

/**
 * Переключает целую группу по виду источника вручную. Возвращает число затронутых целей.
 *
 * Тот же принцип, что и в setTargetEnabled: override фиксируется только на
 * отклонение от дефолта вида источника, иначе групповой тумблер «ленды»
 * пришпиливал бы все ~40 лендов и отключал бы им авто-оживление насовсем.
 */
export function setSourceKindEnabled(db: AnyDB, sourceKind: string, enabled: boolean): number {
  const rows = db
    .select({ id: monitorTargets.id })
    .from(monitorTargets)
    .where(eq(monitorTargets.sourceKind, sourceKind))
    .all() as { id: number }[];
  if (rows.length === 0) return 0;

  const enabledValue = enabled ? 1 : 0;
  const manualOverride = enabledValue === defaultEnabled(sourceKind) ? 0 : 1;

  db.update(monitorTargets)
    .set({ enabled: enabledValue, manualOverride, updatedAt: sql`(datetime('now'))` })
    .where(eq(monitorTargets.sourceKind, sourceKind))
    .run();
  return rows.length;
}
