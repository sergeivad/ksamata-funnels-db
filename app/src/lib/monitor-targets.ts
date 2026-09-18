import { and, eq, sql, inArray, notInArray } from 'drizzle-orm';
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
import { FUNNEL_STATUS_VALUES } from './status';

/**
 * Единственный статус, чьи страницы реально проверяются. Определяет
 * `hasActive` в `collectTargets` и, через него, `enabled` цели — а на
 * дашборде решает, попадёт ли связь в `usage: 'active'`.
 *
 * Черновик и архив тоже получают цель и связь (см. `collectTargets`) —
 * только выключенную: их падения были бы шумом, из-за которого перестают
 * смотреть на настоящие.
 */
export const MONITORED_FUNNEL_STATUS = 'active';

/**
 * Главный вид источника для sourceRank: если один и тот же адрес пришёл сразу
 * из блока «Лендинги» и откуда-то ещё (другого блока, комнаты), побеждает
 * `landings`. С 18.09.2026 это уже не единственная группа, включённая по
 * умолчанию, — тот набор задаёт DEFAULT_ENABLED_SOURCE_KINDS ниже.
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
  /** Держит ли адрес хотя бы одна активная воронка — от этого зависит enabled. */
  hasActive: boolean;
}

/**
 * Собирает URL из данных воронок — по умолчанию по **всем** статусам разом.
 * Связь (`monitor_target_funnels`, записываемая синком из результата этой
 * функции) хранит «кто держит адрес», любого статуса — а не только «кто его
 * проверяет». Второе решает `hasActive`: адрес, который держит хотя бы одна
 * активная воронка, проверяется; адрес одного черновика или архива — нет, но
 * цель и связь всё равно заводятся.
 *
 * Так устроено ради ручной проверки черновика (задача 5): раньше синк отвязывал
 * всё, чего нет у активных, и результат такой проверки гас бы на ближайшем
 * фоновом прогоне без единого объяснения — черновик просто исчезал из связей.
 * Теперь связь переживает синк, а видимость «проверяем ли» несёт `enabled`.
 *
 * URL, который делят активная и архивная воронки, остаётся под проверкой
 * (`hasActive = true`) и в связях числится за обеими — в отличие от прежнего
 * правила «в связях только активная», которое красиво выглядело в чипах, но
 * прятало от синка держателя, чей статус ещё может измениться.
 *
 * Параметр `statuses` — остаток прежнего API: раньше его переопределял
 * дашборд отдельным проходом (`collectFunnelUrls`, удалена), чтобы тем же
 * способом собрать URL неактивных воронок. Теперь дашборд читает статус
 * держателя прямо из связи через `funnelsByTarget`, второй проход не нужен, а
 * `collectTargets` не экспортируется и единственный вызов (из
 * `syncMonitorTargets`) всегда идёт с дефолтом — сегодня параметр ничем не
 * покрыт и существует только как задел на случай, если понадобится второй
 * вызов с другим набором статусов.
 */
function collectTargets(
  db: AnyDB,
  statuses: readonly string[] = FUNNEL_STATUS_VALUES,
): Map<string, Collected> {
  const out = new Map<string, Collected>();

  const add = (url: string, sourceKind: string, funnelId: number, isActive: boolean) => {
    const existing = out.get(url);
    if (!existing) {
      out.set(url, { url, sourceKind, funnelIds: new Set([funnelId]), hasActive: isActive });
      return;
    }
    existing.funnelIds.add(funnelId);
    if (isActive) existing.hasActive = true;
    if (sourceRank(sourceKind) < sourceRank(existing.sourceKind)) {
      existing.sourceKind = sourceKind;
    }
  };

  const items = db
    .select({
      url: funnelBlockItems.url,
      kind: funnelBlocks.kind,
      funnelId: funnelBlocks.funnelId,
      status: funnels.status,
    })
    .from(funnelBlockItems)
    .innerJoin(funnelBlocks, eq(funnelBlocks.id, funnelBlockItems.blockId))
    .innerJoin(funnels, eq(funnels.id, funnelBlocks.funnelId))
    .where(inArray(funnels.status, [...statuses]))
    .all() as { url: string; kind: string; funnelId: number; status: string }[];

  for (const row of items) {
    const url = normalizeUrl(row.url);
    if (url) add(url, row.kind, row.funnelId, row.status === MONITORED_FUNNEL_STATUS);
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
      status: funnels.status,
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
      status: string;
    }[];

  const addRoom = (raw: string | null, kind: string, funnelId: number, isActive: boolean) => {
    const url = normalizeUrl(raw ?? '');
    if (url) add(url, kind, funnelId, isActive);
  };

  for (const row of rooms) {
    const isActive = row.status === MONITORED_FUNNEL_STATUS;
    // rooms_enabled = 0 — решение человека «здесь нет эфиров». Его уже уважают
    // карточка, компактный вид и buildExportRows; мониторинг обязан читать
    // данные так же, иначе он видит то, чего для сервиса не существует.
    if (row.roomsEnabled === 1) {
      addRoom(row.gcRoom, 'room_gc', row.funnelId, isActive);
      addRoom(row.webRoom, 'room_web', row.funnelId, isActive);
    }
    if (row.replayEnabled === 1) {
      addRoom(row.replayUrl, 'room_replay', row.funnelId, isActive);
    }
  }

  return out;
}

/**
 * Приводит monitor_targets и monitor_target_funnels в соответствие с данными
 * воронок — по всем статусам разом (см. `collectTargets`). Инварианты:
 *  - связь (`monitor_target_funnels`) хранит «кто держит адрес» — воронку
 *    ЛЮБОГО статуса, а не только активную;
 *  - новая цель получает enabled по дефолту своей группы, но только если адрес
 *    держит хотя бы одна активная воронка (`item.hasActive`) — поэтому ссылка,
 *    добавленная в блок уже включённой группы, начинает проверяться сама, а
 *    адрес одного черновика или архива заводит цель и связь, но не проверяется;
 *  - у существующей цели с manual_override=1 enabled НЕ трогается —
 *    ручной тумблер переживает синк;
 *  - у существующей цели с manual_override=0 enabled пересчитывается из
 *    дефолта группы И `hasActive`: ленд, пропавший из данных на один синк и
 *    вернувшийся, снова включается, а не остаётся навсегда погашённым;
 *  - исчезнувший URL не удаляется: гасится и отвязывается от воронок — но
 *    только когда его не держит уже НИ ОДНА воронка ни одного статуса. Пока
 *    его держит хотя бы черновик или архив, он остаётся в связях (просто без
 *    enabled) — это и есть разница с прежним правилом «отвязываем всё, чего
 *    нет у активных», которое гасило бы результат ручной проверки черновика
 *    на первом же фоновом прогоне;
 *  - `updated_at` живой (не осиротевшей) цели не трогается, если синк не
 *    поменял у неё ни `source_kind`, ни фактический `enabled` — иначе штамп
 *    двигался бы каждым прогоном у каждой цели и переставал бы значить
 *    «когда цель последний раз реально менялась» (те же грабли, что уже
 *    чинили в ветке ретайрмента ниже).
 *
 * `retired` в возврате — не «сколько выбыло из активных», а «сколько
 * осиротело за ЭТОТ прогон» (потеряло последнего держателя любого статуса):
 * смысл возврата изменился вместе с `collectTargets`, хотя сама формула
 * (`mutable.length`) не менялась.
 */
export function syncMonitorTargets(db: AnyDB): { total: number; created: number; retired: number } {
  const collected = collectTargets(db);
  const prefs = loadGroupPrefs(db);
  let created = 0;
  let retired = 0;

  db.transaction((tx) => {
    for (const item of collected.values()) {
      // Правило «мониторим только активные» не отменено — оно переехало со
      // сбора на включение. Связь говорит «кто держит адрес», enabled —
      // «проверяем ли». Иначе ручная проверка черновика гасла бы на ближайшем
      // фоновом прогоне: синк отвязывал бы его цель.
      const wanted: 0 | 1 = item.hasActive ? groupDefault(prefs, item.sourceKind) : 0;

      const existing = tx
        .select({
          id: monitorTargets.id,
          manualOverride: monitorTargets.manualOverride,
          sourceKind: monitorTargets.sourceKind,
          enabled: monitorTargets.enabled,
        })
        .from(monitorTargets)
        .where(eq(monitorTargets.url, item.url))
        .get() as { id: number; manualOverride: number; sourceKind: string; enabled: number } | undefined;

      let targetId: number;
      if (existing) {
        // Ручной тумблер (manual_override=1) неприкосновенен. Без него
        // enabled — производная от дефолта группы и hasActive, поэтому
        // пересчитываем: иначе цель, погашенная авто-ретайрментом, уже
        // никогда не ожила бы.
        const nextEnabled = existing.manualOverride === 1 ? existing.enabled : wanted;
        // Пишем, только если что-то фактически меняется. Иначе штамп
        // `updated_at` двигался бы КАЖДЫМ синком у любой живой цели — ровно
        // те же грабли, что уже чинили в ветке ретайрмента ниже (комментарий
        // там же): затираемый штамп не даёт понять, когда цель на самом деле
        // в последний раз менялась.
        if (existing.sourceKind !== item.sourceKind || existing.enabled !== nextEnabled) {
          tx.update(monitorTargets)
            .set({
              sourceKind: item.sourceKind,
              ...(existing.manualOverride === 1 ? {} : { enabled: nextEnabled }),
              updatedAt: sql`(datetime('now'))`,
            })
            .where(eq(monitorTargets.id, existing.id))
            .run();
        }
        targetId = existing.id;
      } else {
        const inserted = tx
          .insert(monitorTargets)
          .values({
            url: item.url,
            sourceKind: item.sourceKind,
            enabled: wanted,
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

/**
 * Держит ли цель (по её id, через уже сохранённую связь) хотя бы одна
 * активная воронка — та же проверка, что `hasActive` в `collectTargets`, но
 * читается из `monitor_target_funnels`, а не пересчитывается по блокам.
 */
function targetHasActiveFunnel(db: AnyDB, targetId: number): boolean {
  const row = db
    .select({ funnelId: monitorTargetFunnels.funnelId })
    .from(monitorTargetFunnels)
    .innerJoin(funnels, eq(funnels.id, monitorTargetFunnels.funnelId))
    .where(and(eq(monitorTargetFunnels.targetId, targetId), eq(funnels.status, MONITORED_FUNNEL_STATUS)))
    .limit(1)
    .get();
  return row !== undefined;
}

/**
 * enabled по умолчанию для конкретной цели — то же правило, что и в синке:
 * дефолт группы И хотя бы одна активная воронка держит адрес (`hasActive`).
 *
 * Второе условие обязательно, не косметика: без него override у цели,
 * которую держит только черновик или архив, считался бы неверно — «включить»
 * совпало бы с голым дефолтом группы (обычно 1 у лендов), override не
 * ставился бы, и ближайший синк (у которого `hasActive = false` для этой
 * цели) тут же погасил бы её обратно, молча отменив решение человека.
 */
function defaultEnabled(db: AnyDB, sourceKind: string, targetId: number): 0 | 1 {
  const groupWants = groupDefault(loadGroupPrefs(db), sourceKind) === 1;
  return groupWants && targetHasActiveFunnel(db, targetId) ? 1 : 0;
}

/**
 * Переключает одну цель вручную. Возвращает false, если цели нет.
 *
 * manual_override ставится, только если запрошенное состояние отличается от
 * ЭФФЕКТИВНОГО дефолта — дефолта группы с поправкой на то, держит ли адрес
 * хотя бы одна активная воронка (см. `defaultEnabled`), а не от голого
 * дефолта группы. Иначе «включить ленды обратно» намертво пришпиливало бы их
 * (override никогда не снимался автоматически), и авто-оживление вернувшегося
 * URL переставало бы работать навсегда. Смысл override после этого читается
 * однозначно: «эта цель отличается от того, что ей положено по правилам».
 */
export function setTargetEnabled(db: AnyDB, targetId: number, enabled: boolean): boolean {
  const existing = db
    .select({ id: monitorTargets.id, sourceKind: monitorTargets.sourceKind })
    .from(monitorTargets)
    .where(eq(monitorTargets.id, targetId))
    .get() as { id: number; sourceKind: string } | undefined;
  if (!existing) return false;

  const enabledValue = enabled ? 1 : 0;
  const manualOverride = enabledValue === defaultEnabled(db, existing.sourceKind, targetId) ? 0 : 1;

  db.update(monitorTargets)
    .set({ enabled: enabledValue, manualOverride, updatedAt: sql`(datetime('now'))` })
    .where(eq(monitorTargets.id, targetId))
    .run();
  return true;
}

/**
 * Пересобирает цели и связи перед ручной проверкой воронки. Нужна: сценарий
 * «поправил адрес → нажал проверить» иначе проверял бы старый адрес и отвечал
 * бы неверно на прямо заданный вопрос.
 *
 * Синкает ВСЕ воронки, а не одну, и без параметра — сужать незачем: полный
 * синк на 1767 адресов занимает доли секунды на SQLite, а второе, более узкое
 * правило сбора «только эта воронка» рано или поздно разъехалось бы с общим
 * (`collectTargets` уже задаёт единственное правило для всех вызовов). Если
 * синк когда-нибудь подорожает, сузить его можно будет прямо здесь, не меняя
 * сигнатуру и вызывающий код — это и есть задел, который раньше держал
 * неиспользуемый параметр `funnelId`.
 */
export function syncTargetsForFunnelCheck(db: AnyDB): void {
  syncMonitorTargets(db);
}

export interface FunnelCheckTarget {
  id: number;
  url: string;
}

/**
 * Цели воронки, которые стоит проверить кнопкой «Проверить ссылки».
 *
 * Правило то же, что решает `enabled` в синке (`groupDefault` — предпочтение
 * человека по группе, а если его не было, `DEFAULT_ENABLED_SOURCE_KINDS`), но
 * применяется без оглядки на `hasActive`: `enabled = 1` ИЛИ дефолт группы
 * цели включён. Определение дефолта живёт только здесь и в `syncMonitorTargets`
 * (через общий `groupDefault`) — второго они не заводят.
 *
 * Различие принципиальное, и оно есть в данных. У черновика все цели
 * `enabled = 0` — не потому, что группа выключена, а потому, что ни одна
 * активная воронка адрес не держит (`hasActive` в синке); дефолт же его
 * группы (`landings`, `room_*`, `tariffs`, `applications`, `upsell`) остаётся
 * включённым, и ручная проверка обязана эти цели брать — иначе результат
 * «Проверить ссылки» на черновике был бы всегда пуст. У `links` и `processes`
 * цель выключена ПОТОМУ, что решение по группе — «не проверять»: это
 * служебные страницы (например админка GetCourse вида
 * `/pl/user/user/index?uc[segment_id]=…`), которые требуют сессии и без неё
 * отвечают 403 всегда. Замер на f37: без этого различия ручная проверка
 * красила воронку в «упало» на семь дней (`STALE_AFTER_DAYS`) по четырём
 * таким адресам, а настоящая находка — мёртвая комната — тонула под ними.
 * `enabled = 1` перебивает выключенный дефолт группы в обратную сторону:
 * человек включил цель руками вопреки дефолту (см. `setTargetEnabled`), и
 * это решение сильнее.
 */
export function selectFunnelCheckTargets(db: AnyDB, funnelId: number): FunnelCheckTarget[] {
  const prefs = loadGroupPrefs(db);

  const rows = db
    .select({
      id: monitorTargets.id,
      url: monitorTargets.url,
      sourceKind: monitorTargets.sourceKind,
      enabled: monitorTargets.enabled,
    })
    .from(monitorTargets)
    .innerJoin(monitorTargetFunnels, eq(monitorTargetFunnels.targetId, monitorTargets.id))
    .where(eq(monitorTargetFunnels.funnelId, funnelId))
    .all() as { id: number; url: string; sourceKind: string; enabled: number }[];

  return rows
    .filter((r) => r.enabled === 1 || groupDefault(prefs, r.sourceKind) === 1)
    .map((r) => ({ id: r.id, url: r.url }));
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
