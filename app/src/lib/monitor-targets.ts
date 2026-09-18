import { eq, sql, inArray, notInArray } from 'drizzle-orm';
import { type AnyDB } from '../db/client';
import {
  funnels,
  funnelBlocks,
  funnelBlockItems,
  funnelDays,
  monitorTargets,
  monitorTargetFunnels,
  monitorState,
  monitorSourceKindPrefs,
} from '../db/schema';
import { normalizeUrl } from './monitor-urls';

/**
 * Мониторим только страницы воронок в этом статусе. Черновики и архив не
 * проверяем: их падения — шум, из-за которого перестают смотреть на настоящие.
 */
export const MONITORED_FUNNEL_STATUS = 'active';

/**
 * Группа лендингов — единственная, которая проверяется, пока по ней не было
 * решения человека.
 *
 * Страница воронки хранится ровно в одном месте — в блоке «Лендинги». Раньше
 * мест было два (ещё колонка funnels.landing_url), и они давали два вида
 * источника: Phase-9 свела их в одну группу, Phase-10 — в одно хранилище.
 */
export const LANDING_SOURCE_KIND = 'landings';

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
 * Группы, которые проверяются, пока по ним не было решения человека.
 *
 * До 18.09.2026 здесь был один `landings`. Набор расширен до того, что видит
 * клиент и что стоит денег, плюс комнаты: молчание пилюли воронки иначе
 * означало бы «в проверяемом всё живо», а читалось бы как «всё живо».
 * Служебные `links` и `processes` остаются выключенными — их включают руками.
 */
export const DEFAULT_ENABLED_SOURCE_KINDS: ReadonlySet<string> = new Set([
  'landings',
  'tariffs',
  'applications',
  'upsell',
  'room_gc',
  'room_web',
  'room_replay',
]);

/**
 * Проверяется ли группа по умолчанию. Решение человека по группе, а если его
 * не было — дефолт из DEFAULT_ENABLED_SOURCE_KINDS.
 *
 * Именно эта функция и делает «новая ссылка наследует группу»: цель заводится
 * с дефолтом своей группы, а не с захардкоженным списком лендов.
 */
function groupDefault(prefs: Map<string, boolean>, sourceKind: string): 0 | 1 {
  const pref = prefs.get(sourceKind);
  if (pref !== undefined) return pref ? 1 : 0;
  return DEFAULT_ENABLED_SOURCE_KINDS.has(sourceKind) ? 1 : 0;
}

/**
 * Чем меньше ранг, тем «главнее» источник. Один и тот же URL может прийти из
 * нескольких мест — цель заводится одна, вид источника берётся у главного.
 */
function sourceRank(kind: string): number {
  return kind === LANDING_SOURCE_KIND ? 0 : 1;
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

  // Второй источник — сетка комнат. Комнаты живут не в блоках, а в funnel_days,
  // и до 18.09.2026 в мониторинг не попадали вовсе: у F101 из-за этого
  // несуществующие комнаты были невидимы.
  const rooms = db
    .select({
      funnelId: funnelDays.funnelId,
      gcRoom: funnelDays.gcRoom,
      webRoom: funnelDays.webRoom,
      replayUrl: funnelDays.replayUrl,
      roomsEnabled: funnels.roomsEnabled,
      replayEnabled: funnels.roomsReplayEnabled,
    })
    .from(funnelDays)
    .innerJoin(funnels, eq(funnels.id, funnelDays.funnelId))
    .where(inArray(funnels.status, [...statuses]))
    .all() as {
      funnelId: number;
      gcRoom: string | null;
      webRoom: string | null;
      replayUrl: string | null;
      roomsEnabled: number | null;
      replayEnabled: number | null;
    }[];

  const addRoom = (raw: string | null, kind: string, funnelId: number) => {
    const url = normalizeUrl(raw ?? '');
    if (url) add(url, kind, funnelId);
  };

  for (const row of rooms) {
    // rooms_enabled = 0 — решение человека «здесь нет эфиров». Его уже уважают
    // карточка, компактный вид и buildExportRows; мониторинг обязан читать
    // данные так же, иначе он видит то, чего для сервиса не существует.
    if (row.roomsEnabled === 1) {
      addRoom(row.gcRoom, 'room_gc', row.funnelId);
      addRoom(row.webRoom, 'room_web', row.funnelId);
    }
    if (row.replayEnabled === 1) {
      addRoom(row.replayUrl, 'room_replay', row.funnelId);
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
    const cols = {
      id: monitorTargets.id,
      manualOverride: monitorTargets.manualOverride,
      enabled: monitorTargets.enabled,
    };
    const stale = (
      liveUrls.length === 0
        ? tx.select(cols).from(monitorTargets).all()
        : tx
            .select(cols)
            .from(monitorTargets)
            .where(notInArray(monitorTargets.url, liveUrls))
            .all()
    ) as { id: number; manualOverride: number; enabled: number }[];

    if (stale.length > 0) {
      const ids = stale.map((s) => s.id);
      // Ручной тумблер неприкосновенен и здесь, ровно как в ветке выше. Иначе
      // цель, включённую человеком вопреки дефолту группы, гасило бы первым же
      // исчезновением URL, а override оставался бы стоять — и живая ветка потом
      // отказывалась бы пересчитать enabled обратно. Вернувшийся URL оставался
      // бы выключенным навсегда, то есть решение человека терялось молча.
      // Только те, кого этот прогон действительно гасит. Раньше сюда попадали
      // и давно погашенные: `retired` показывал «сколько всего осиротевших»
      // вместо «сколько списано сейчас», а `updatedAt` погашенных строк
      // затирался каждым синком — по нему нельзя было понять, когда цель
      // на самом деле выбыла.
      const mutable = stale
        .filter((s) => s.manualOverride === 0 && s.enabled === 1)
        .map((s) => s.id);
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
