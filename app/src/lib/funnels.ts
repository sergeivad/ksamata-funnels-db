/**
 * Pure helper functions for funnel CRUD operations.
 *
 * IMPORTANT: Each function takes an injected `db` handle as its first argument.
 * This enables test isolation — tests inject a drizzle handle over a temp copy
 * of the DB; route handlers inject the real singleton `db` from client.ts.
 * This module NEVER imports the singleton `db` from client.ts.
 */

import { eq, sql, and } from 'drizzle-orm';
import { ConflictError, ValidationError } from './errors';
import { type AnyDB, type DB } from '../db/client';
import {
  funnels,
  funnelTags,
  funnelTagOverrides,
  funnelDays,
  funnelBlocks,
  funnelBlockItems,
  salebotConfigs,
  tags,
  funnelTypes,
  type Funnel,
} from '../db/schema';
import {
  type AbAxes,
  type TagSets,
  type Scenario,
  type OverrideMap,
  type ScenarioOverride,
  type FunnelTypeContext,
  SCENARIOS,
  computeTagSet,
  tagNamesToAxes,
} from './ab-tags';
import { listTemplate, assertNotFunnelTypeMarker } from './tag-templates';
import { listOverrides, replaceOverrides } from './tag-overrides';
import {
  createRef,
  listRefs,
  getRefByName,
  setFunnelTypeHasTime as setRefHasTime,
} from './refs';
import { FUNNEL_TYPE_KIND } from './funnel-type';
import { nextFrontCode, normalizeFrontCode } from './front-code';
import { type FunnelCreate, type FunnelUpdate } from './validation';

// ─── Public return shapes ─────────────────────────────────────────────────────

export function funnelName(axes: AbAxes): string {
  return `${axes.product} / ${axes.contractor} / ${axes.channel} / ${axes.direction}`;
}

export type FunnelListItem = {
  id: number;
  num: number;
  frontCode: string;
  status: string;
  productName: string;
  name: string;
  axes: AbAxes;
  // Пятая ось: null означает «тип не выбран», а не «неизвестно» — маркер
  // просто не выпускается в теги (см. FunnelTypeContext в ab-tags.ts).
  funnelType: string | null;
};

export type FunnelDetail = FunnelListItem & {
  sourceId: number;
  productId: number;
  contractorId: number;
  variant: string;
  startDate: string;
  blockName: string;
  comment: string;
  timeLabelA: string;
  timeLabelB: string;
  roomsReplayEnabled: boolean;
  roomsEnabled: boolean;
  /**
   * Есть ли у типа этой воронки эфиры по времени (funnel_types.has_time).
   * Карточка по нему решает, показывать ли переключатель 15:00/19:00 в оплате:
   * у безвременной воронки оба сценария одинаковы, и две вкладки означали бы
   * выбор, которого нет. Тип не выбран — true, см. getFunnelTypeContext.
   */
  typeHasTime: boolean;
  tagSets: TagSets;
};

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Fetch the reg-type tag names for a funnel and reconstruct AbAxes.
 */
function getAxesForFunnel(db: AnyDB, funnelId: number): AbAxes {
  const rows = db
    .select({ name: tags.name })
    .from(funnelTags)
    .innerJoin(tags, eq(funnelTags.tagId, tags.id))
    .where(and(eq(funnelTags.funnelId, funnelId), eq(funnelTags.tagType, 'reg')))
    .all();

  return tagNamesToAxes((rows as { name: string }[]).map((r) => r.name));
}

/**
 * Контекст пятой оси для воронки: её маркер и полный список известных.
 * Читается из справочника, а не из зашитого списка — значения расширяемы.
 */
export function getFunnelTypeContext(db: AnyDB, funnelId: number): FunnelTypeContext {
  const known = (db.select({ name: funnelTypes.name }).from(funnelTypes).all() as { name: string }[])
    .map((r) => r.name);

  const row = db
    .select({ name: funnelTypes.name, hasTime: funnelTypes.hasTime })
    .from(funnels)
    .leftJoin(funnelTypes, eq(funnelTypes.id, funnels.funnelTypeId))
    .where(eq(funnels.id, funnelId))
    .get() as { name: string | null; hasTime: number | null } | undefined;

  // Тип не выбран (leftJoin не нашёл строку) — время остаётся: это «не решили»,
  // а не «времени нет». Снимает его только явный ноль в справочнике.
  return { name: row?.name ?? null, known, hasTime: row?.hasTime !== 0 };
}

/**
 * Тип разрешается ТОЛЬКО среди существующих значений. createRef здесь был бы
 * get-or-create, и опечатка в API завела бы пятый маркер, который тут же уехал
 * бы в теги и в аудит. Новые значения заводятся через /refs осознанно.
 */
function resolveFunnelTypeId(tx: AnyDB, name: string): number {
  const row = getRefByName(tx, FUNNEL_TYPE_KIND, name);
  if (!row) {
    throw new ValidationError(
      `Неизвестный тип воронки «${name}». Заведите его в справочнике типов, если он появился в GetCourse.`,
    );
  }
  return row.id;
}

/**
 * Rebuild a funnel's materialized tags in `funnel_tags` from the three layers:
 * global template + axis tags + per-funnel overrides (see computeTagSet).
 * Wipes ALL funnel_tags for the funnel and rewrites — the effective set is
 * self-contained. Axes MUST be passed by the caller, read BEFORE any rewrite
 * (channel/direction live only in these tags).
 * Must be called INSIDE a transaction.
 */
function materializeFunnelTags(db: AnyDB, funnelId: number, axes: AbAxes): void {
  const template = listTemplate(db);
  const overrides = listOverrides(db, funnelId);
  const sets: TagSets = computeTagSet(template, axes, overrides, getFunnelTypeContext(db, funnelId));

  db.delete(funnelTags).where(eq(funnelTags.funnelId, funnelId)).run();

  for (const scenario of SCENARIOS) {
    sets[scenario].tags.forEach((chip, position) => {
      const tagRow = createRef(db, 'tags', chip.name);
      db.insert(funnelTags)
        .values({ funnelId, tagId: tagRow.id, tagType: scenario as Scenario, position })
        .onConflictDoNothing()
        .run();
    });
  }
}

/**
 * `num` is allocated as MAX(num)+1. Within one Node process that read→insert is
 * atomic (better-sqlite3 is synchronous), but across processes sharing the DB
 * file two allocations can collide on the UNIQUE constraint. Retry a few times
 * on that specific conflict so the loser recomputes MAX+1 instead of failing.
 */
function isNumConflict(err: unknown): boolean {
  return err instanceof Error
    && err.message.includes('UNIQUE constraint failed: funnels.num');
}

/**
 * Там, где `num` задаёт человек, ретрай бессмыслен — номер нужен именно этот.
 * Но проверка «свободен ли номер» идёт до транзакции, и другой писатель того же
 * файла БД (python-тулза, второй инстанс) успевает занять его в промежутке.
 * Тогда наружу летела сырая ошибка SQLite, и роут отдавал 500 вместо 409.
 */
function asNumConflict<T>(num: number, fn: () => T): T {
  try {
    return fn();
  } catch (err) {
    if (isNumConflict(err)) throw new ConflictError(`Funnel with num=${num} already exists`);
    throw err;
  }
}

/**
 * Тот же расклад для F-кода: уникальный индекс на `front_code` появился
 * в Phase-7, до него дубликат кода проходил молча.
 */
function isFrontCodeConflict(err: unknown): boolean {
  return err instanceof Error
    && err.message.includes('UNIQUE constraint failed: funnels.front_code');
}

function asFrontCodeConflict<T>(code: string, fn: () => T): T {
  try {
    return fn();
  } catch (err) {
    if (isFrontCodeConflict(err)) throw new ConflictError(`Код ${code} уже занят другой воронкой`);
    throw err;
  }
}

/**
 * Ретраим и на num, и на F-код: черновик подбирает оба номера сам (MAX+1), и
 * оба одинаково уязвимы к гонке между чтением максимума и вставкой, если тот же
 * файл БД пишет второй инстанс. Проигравшему нужно пересчитать максимум, а не
 * упасть — конкретный номер здесь никто не заказывал.
 */
function withAllocRetry<T>(fn: () => T, attempts = 5): T {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return fn();
    } catch (err) {
      if (!isNumConflict(err) && !isFrontCodeConflict(err)) throw err;
      lastErr = err;
    }
  }
  throw lastErr;
}

/**
 * Занят ли код другой воронкой. Пустой код не конфликтует ни с чем: «кода нет»
 * — законное состояние, и таких воронок в живой базе десяток.
 */
function findFrontCodeOwner(db: AnyDB, code: string, excludeId?: number): number | null {
  if (code === '') return null;
  const rows = db
    .select({ id: funnels.id })
    .from(funnels)
    .where(eq(funnels.frontCode, code))
    .all() as { id: number }[];
  const owner = rows.find((r) => r.id !== excludeId);
  return owner ? owner.id : null;
}

/** Следующий свободный F-код — считаем от максимума кодов, не от `num`. */
function allocateFrontCode(db: AnyDB): string {
  const rows = db.select({ frontCode: funnels.frontCode }).from(funnels).all() as {
    frontCode: string | null;
  }[];
  return nextFrontCode(rows.map((r) => r.frontCode ?? ''));
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * GET /api/funnels — list all funnels with axes derived from reg tags.
 */
export function listFunnels(db: DB): FunnelListItem[] {
  const rows = db
    .select({
      id: funnels.id,
      num: funnels.num,
      frontCode: funnels.frontCode,
      status: funnels.status,
      productName: funnels.productName,
      funnelType: funnelTypes.name, // NULL, если тип не выбран
    })
    .from(funnels)
    .leftJoin(funnelTypes, eq(funnelTypes.id, funnels.funnelTypeId))
    .all();

  return rows.map((f) => {
    const axes = getAxesForFunnel(db, f.id);
    return {
      id: f.id,
      num: f.num,
      frontCode: f.frontCode ?? '',
      status: f.status ?? 'active',
      productName: f.productName,
      funnelType: f.funnelType ?? null,
      name: funnelName(axes),
      axes,
    };
  });
}

/**
 * GET /api/funnels/[id] — single funnel with axes; null if not found.
 */
export function getFunnel(db: DB, id: number): FunnelDetail | null {
  const row = db.select().from(funnels).where(eq(funnels.id, id)).get();
  if (!row) return null;

  const axes = getAxesForFunnel(db, row.id);
  const template = listTemplate(db);
  const overrides = listOverrides(db, row.id);
  const typeCtx = getFunnelTypeContext(db, row.id);
  const tagSets = computeTagSet(template, axes, overrides, typeCtx);
  return {
    id:           row.id,
    num:          row.num,
    frontCode:    row.frontCode    ?? '',
    status:       row.status       ?? 'active',
    productName:  row.productName,
    funnelType:   typeCtx.name,
    name:         funnelName(axes),
    sourceId:     row.sourceId,
    productId:    row.productId,
    contractorId: row.contractorId,
    variant:      row.variant      ?? '',
    startDate:    row.startDate    ?? '',
    blockName:    row.blockName    ?? '',
    comment:      row.comment      ?? '',
    timeLabelA:   row.timeLabelA   ?? '15:00',
    timeLabelB:   row.timeLabelB   ?? '19:00',
    roomsReplayEnabled: (row.roomsReplayEnabled ?? 0) === 1,
    roomsEnabled: (row.roomsEnabled ?? 1) === 1,
    typeHasTime: typeCtx.hasTime !== false,
    tagSets,
    axes,
  };
}

/**
 * Воронка по F-коду — то, чем адрес карточки отличается от API.
 *
 * Пустой код не ищется НИКОГДА: `front_code` у бескодовых воронок хранится
 * пустой строкой, и запрос по '' вернул бы первую попавшуюся из них.
 * Уникальность непустого кода держит частичный индекс Phase 7.
 *
 * Тело читается через `getFunnel`, а не собирается заново: материализация
 * тегов и осей должна жить в одном месте.
 */
export function getFunnelByFrontCode(db: DB, code: string): FunnelDetail | null {
  const normalized = normalizeFrontCode(code);
  if (normalized === '') return null;
  const row = db
    .select({ id: funnels.id })
    .from(funnels)
    .where(eq(funnels.frontCode, normalized))
    .get();
  return row ? getFunnel(db, row.id) : null;
}

/**
 * POST /api/funnels — create a new funnel.
 * Throws an error with message containing "409" if num already exists.
 */
export function createFunnel(db: DB, data: FunnelCreate): FunnelListItem {
  // Check uniqueness of num before entering transaction
  const existing = db.select({ id: funnels.id }).from(funnels).where(eq(funnels.num, data.num)).get();
  if (existing) {
    throw new ConflictError(`Funnel with num=${data.num} already exists`);
  }

  // F-код — то, чем воронка называется во внешних материалах, поэтому дубль
  // здесь хуже дубля num: две «f70» неразличимы для человека.
  const frontCode = normalizeFrontCode(data.frontCode);
  const codeOwner = findFrontCodeOwner(db, frontCode);
  if (codeOwner !== null) {
    throw new ConflictError(`Код ${frontCode} уже занят воронкой #${codeOwner}`);
  }

  const axes: AbAxes = {
    product: data.product,
    contractor: data.contractor,
    channel: data.channel,
    direction: data.direction,
  };

  let createdFunnel: FunnelListItem;

  asNumConflict(data.num, () => asFrontCodeConflict(frontCode, () => db.transaction((tx) => {
    // Get-or-create foreign key refs
    const productRow    = createRef(tx, 'products',    data.product);
    const contractorRow = createRef(tx, 'contractors', data.contractor);
    const srcName = data.sourceName?.trim() || `${data.channel} ${data.contractor}`;
    const sourceRow     = createRef(tx, 'sources',     srcName);

    // Insert funnel row
    const inserted = tx
      .insert(funnels)
      .values({
        num:                data.num,
        frontCode,
        status:             data.status,
        productName:        data.productName,
        variant:            data.variant,
        startDate:          data.startDate,
        blockName:          data.blockName,
        productId:          productRow.id,
        contractorId:       contractorRow.id,
        sourceId:           sourceRow.id,
        comment:            data.comment            ?? '',
        timeLabelA:         data.timeLabelA         ?? '15:00',
        timeLabelB:         data.timeLabelB         ?? '19:00',
        roomsReplayEnabled: data.roomsReplayEnabled ? 1 : 0,
        roomsEnabled:       data.roomsEnabled === false ? 0 : 1,
        funnelTypeId:       data.funnelType ? resolveFunnelTypeId(tx, data.funnelType) : null,
      })
      .returning()
      .get() as Funnel;

    // Materialize AV tags
    materializeFunnelTags(tx, inserted.id, axes);

    const typeName = inserted.funnelTypeId
      ? (tx.select({ name: funnelTypes.name }).from(funnelTypes)
           .where(eq(funnelTypes.id, inserted.funnelTypeId)).get() as { name: string }).name
      : null;

    createdFunnel = {
      id:          inserted.id,
      num:         inserted.num,
      frontCode:   inserted.frontCode ?? '',
      status:      inserted.status ?? 'active',
      productName: inserted.productName,
      funnelType:  typeName,
      name:        funnelName(axes),
      axes,
    };
  })));

  return createdFunnel!;
}

/**
 * POST /api/funnels/draft — create a blank draft funnel and return it.
 *
 * The draft gets the next free `num`, status='draft', and EMPTY axes.
 *
 * F-код подставляется как подсказка — следующий свободный по КОДАМ (см.
 * front-code.ts), а не `f${num}`. Это две разные последовательности: раньше
 * черновик при max(num)=75 и max(F)=79 получил бы f76, а следующий за ним —
 * уже занятый f77.
 *
 * Axes shown on the card come from AV reg-tags (see getAxesForFunnel), so a
 * draft is created with NO AV tags → all four axes read back empty and the
 * card shows blank selects. The NOT NULL product/contractor/source FK columns
 * are satisfied with the first existing ref of each table purely as a
 * placeholder — those columns are not displayed anywhere on the card and get
 * overwritten the moment the user saves identity (updateFunnel). No new refs or
 * tags are created, so nothing pollutes the reference/tag tables.
 */
export function createDraftFunnel(db: DB): FunnelListItem {
  const emptyAxes: AbAxes = { product: '', contractor: '', channel: '', direction: '' };

  const firstId = (kind: string): number | undefined => listRefs(db, kind)[0]?.id;
  const productId    = firstId('products');
  const contractorId = firstId('contractors');
  const sourceId     = firstId('sources');
  if (productId === undefined || contractorId === undefined || sourceId === undefined) {
    throw new Error('Cannot create draft: reference tables (products/contractors/sources) are empty');
  }

  const inserted = withAllocRetry(() => {
    const maxRow = db
      .select({ maxNum: sql<number>`COALESCE(MAX(${funnels.num}), 0)` })
      .from(funnels)
      .get();
    const num = (maxRow?.maxNum ?? 0) + 1;

    return db
      .insert(funnels)
      .values({
        num,
        frontCode:    allocateFrontCode(db),
        status:       'draft',
        productName:  '',
        variant:      '',
        startDate:    '',
        blockName:    '',
        productId,
        contractorId,
        sourceId,
        comment:      '',
        timeLabelA:   '15:00',
        timeLabelB:   '19:00',
        roomsReplayEnabled: 0,
        roomsEnabled: 1,
      })
      .returning()
      .get() as Funnel;
  });

  return {
    id:          inserted.id,
    num:         inserted.num,
    frontCode:   inserted.frontCode ?? '',
    status:      inserted.status ?? 'draft',
    productName: inserted.productName,
    // Черновик заводится без типа намеренно — так же, как и без осей
    // (см. комментарий выше): решение о типе принимается при заполнении.
    funnelType:  null,
    name:        funnelName(emptyAxes),
    axes:        emptyAxes,
  };
}

/**
 * PATCH /api/funnels/[id] — update scalar fields and/or re-sync axes.
 * Returns null if funnel not found.
 * When axes are re-synced, funnel_tags is fully re-materialized from the
 * layer model (template + axes + overrides, see materializeFunnelTags) —
 * per-funnel custom tags survive only via the override 'add' layer, not as
 * raw funnel_tags rows.
 */
export function updateFunnel(db: DB, id: number, data: FunnelUpdate): FunnelListItem | null {
  const existing = db.select().from(funnels).where(eq(funnels.id, id)).get();
  if (!existing) return null;

  // Reject a num change that collides with another funnel BEFORE hitting the
  // raw UNIQUE constraint, so the route can surface a clean 409 (mirrors createFunnel).
  if (data.num !== undefined && data.num !== existing.num) {
    const clash = db
      .select({ id: funnels.id })
      .from(funnels)
      .where(eq(funnels.num, data.num))
      .get();
    if (clash) {
      throw new ConflictError(`Funnel with num=${data.num} already exists`);
    }
  }

  // То же для F-кода: правка в поле «Код» — единственный способ поставить
  // воронке настоящий код ЛИК, и промахнуться в чужой номер тут проще всего.
  // Собственный код воронки не считается конфликтом (excludeId), иначе
  // повторное сохранение той же формы падало бы в 409.
  const frontCode = data.frontCode === undefined ? undefined : normalizeFrontCode(data.frontCode);
  if (frontCode !== undefined && frontCode !== existing.frontCode) {
    const codeOwner = findFrontCodeOwner(db, frontCode, id);
    if (codeOwner !== null) {
      throw new ConflictError(`Код ${frontCode} уже занят воронкой #${codeOwner}`);
    }
  }

  let result: FunnelListItem | null = null;

  asNumConflict(data.num ?? existing.num, () => asFrontCodeConflict(frontCode ?? existing.frontCode ?? '', () => db.transaction((tx) => {
    // Build scalar update payload (exclude axes fields)
    const scalarUpdate: Partial<typeof funnels.$inferInsert> = {};

    if (data.num          !== undefined) scalarUpdate.num          = data.num;
    if (frontCode         !== undefined) scalarUpdate.frontCode    = frontCode;
    if (data.status       !== undefined) scalarUpdate.status       = data.status;
    if (data.productName  !== undefined) scalarUpdate.productName  = data.productName;
    if (data.variant      !== undefined) scalarUpdate.variant      = data.variant;
    if (data.startDate    !== undefined) scalarUpdate.startDate    = data.startDate;
    if (data.blockName    !== undefined) scalarUpdate.blockName    = data.blockName;
    if (data.comment            !== undefined) scalarUpdate.comment            = data.comment;
    if (data.timeLabelA         !== undefined) scalarUpdate.timeLabelA         = data.timeLabelA;
    if (data.timeLabelB         !== undefined) scalarUpdate.timeLabelB         = data.timeLabelB;
    if (data.roomsReplayEnabled !== undefined) scalarUpdate.roomsReplayEnabled = data.roomsReplayEnabled ? 1 : 0;
    if (data.roomsEnabled       !== undefined) scalarUpdate.roomsEnabled       = data.roomsEnabled ? 1 : 0;
    if (data.funnelType !== undefined) {
      scalarUpdate.funnelTypeId = data.funnelType ? resolveFunnelTypeId(tx, data.funnelType) : null;
    }

    // If product/contractor/source names change, update FKs too
    if (data.product !== undefined) {
      const productRow = createRef(tx, 'products', data.product);
      scalarUpdate.productId = productRow.id;
    }
    if (data.contractor !== undefined) {
      const contractorRow = createRef(tx, 'contractors', data.contractor);
      scalarUpdate.contractorId = contractorRow.id;
    }
    // Re-derive source only when:
    //   (a) sourceName is explicitly provided (non-empty) → use it as-is, OR
    //   (b) channel or contractor VALUE actually changed from the current stored value.
    // If the form sends the same channel/contractor as already stored, leave source_id untouched.
    if (data.sourceName?.trim()) {
      // (a) Explicit sourceName wins unconditionally
      const sourceRow = createRef(tx, 'sources', data.sourceName.trim());
      scalarUpdate.sourceId = sourceRow.id;
    } else if (data.channel !== undefined || data.contractor !== undefined) {
      // (b) Axes were sent — only re-derive if the VALUE actually changed
      const currentAxes = getAxesForFunnel(tx, id);
      const effectiveChannel    = data.channel    ?? currentAxes.channel;
      const effectiveContractor = data.contractor ?? currentAxes.contractor;
      const channelChanged    = effectiveChannel    !== currentAxes.channel;
      const contractorChanged = effectiveContractor !== currentAxes.contractor;
      if (channelChanged || contractorChanged) {
        const derivedName = `${effectiveChannel} ${effectiveContractor}`;
        const sourceRow = createRef(tx, 'sources', derivedName);
        scalarUpdate.sourceId = sourceRow.id;
      }
      // else: same values as before → do NOT touch source_id
    }

    if (Object.keys(scalarUpdate).length > 0) {
      scalarUpdate.updatedAt = new Date().toISOString().replace('T', ' ').slice(0, 19);
      tx.update(funnels).set(scalarUpdate).where(eq(funnels.id, id)).run();
    }

    // Re-sync AV tags if any axis was provided.
    // Тип воронки входит сюда наравне с осями: он тоже слой идентичности,
    // и PATCH с одним лишь типом обязан пересчитать теги. Без этого правка
    // типа молча меняла бы только колонку.
    const hasAxes = data.product !== undefined || data.contractor !== undefined
      || data.channel !== undefined || data.direction !== undefined
      || data.funnelType !== undefined;

    if (hasAxes) {
      const currentAxes = getAxesForFunnel(tx, id);
      const axes: AbAxes = {
        product:    data.product    ?? currentAxes.product,
        contractor: data.contractor ?? currentAxes.contractor,
        channel:    data.channel    ?? currentAxes.channel,
        direction:  data.direction  ?? currentAxes.direction,
      };
      materializeFunnelTags(tx, id, axes);
    }

    const finalRow = tx.select().from(funnels).where(eq(funnels.id, id)).get()!;
    const finalAxes = getAxesForFunnel(tx, id);
    const finalTypeName = finalRow.funnelTypeId
      ? (tx.select({ name: funnelTypes.name }).from(funnelTypes)
           .where(eq(funnelTypes.id, finalRow.funnelTypeId)).get() as { name: string } | undefined)?.name ?? null
      : null;
    result = {
      id:          finalRow.id,
      num:         finalRow.num,
      frontCode:   finalRow.frontCode ?? '',
      status:      finalRow.status ?? 'active',
      productName: finalRow.productName,
      funnelType:  finalTypeName,
      name:        funnelName(finalAxes),
      axes:        finalAxes,
    };
  })));

  return result;
}

/**
 * Re-generate the AV tag sets for a funnel from its CURRENT axes (derived from
 * existing reg tags), without touching any scalar columns or reference tables.
 *
 * Used by backfills to roll new tag-generation rules (extra common tags, new
 * scenario sets like `messenger`) onto existing funnels. Unlike updateFunnel it
 * never calls createRef, so empty axes can't spawn blank "" reference rows.
 * Returns false if the funnel does not exist.
 */
export function resyncFunnelAvTags(db: DB, id: number): boolean {
  const existing = db.select({ id: funnels.id }).from(funnels).where(eq(funnels.id, id)).get();
  if (!existing) return false;
  db.transaction((tx) => {
    const axes = getAxesForFunnel(tx, id);
    materializeFunnelTags(tx, id, axes);
  });
  return true;
}

function sameOverride(a: ScenarioOverride | undefined, b: ScenarioOverride | undefined): boolean {
  const norm = (o?: ScenarioOverride) => JSON.stringify([o?.add ?? [], o?.remove ?? []]);
  return norm(a) === norm(b);
}

/**
 * У воронки без эфиров по времени сценарий оплаты один: без тега времени
 * `time_15` и `time_19` дают один и тот же набор, и карточка показывает одну
 * вкладку «Оплата». Оверрайды при этом лежат в двух строках, и без выравнивания
 * они разъедутся — тег, добавленный на видимой вкладке, во второй не попадёт,
 * и два «одинаковых» сценария начнут отличаться в экспорте и в аудите.
 *
 * Главным считается изменившийся сценарий: карточка правит `time_19`, но вызов
 * API руками может прийти и с `time_15`, и молча выбросить его правку хуже, чем
 * принять. Изменились оба — берём `time_19`, потому что именно его правит
 * интерфейс.
 */
function mirrorPaymentOverrides(patch: OverrideMap, current: OverrideMap): OverrideMap {
  const changed19 = !sameOverride(patch.time_19, current.time_19);
  const changed15 = !sameOverride(patch.time_15, current.time_15);
  if (!changed19 && !changed15) return patch;
  const winner = changed19 ? patch.time_19 : patch.time_15;
  return { ...patch, time_15: winner, time_19: winner };
}

/**
 * Replace a funnel's tag overrides and re-materialize its funnel_tags.
 * Axes are read from current reg tags FIRST (channel/direction live there),
 * then tags are rewritten. Returns the updated FunnelDetail, or null if absent.
 */
export function applyTagOverrides(db: DB, id: number, patch: OverrideMap): FunnelDetail | null {
  const existing = db.select({ id: funnels.id }).from(funnels).where(eq(funnels.id, id)).get();
  if (!existing) return null;
  db.transaction((tx) => {
    // Только add: имя маркера в remove безвредно и гасится движком
    // (identity-тег неудаляем, см. computeTagSet) — незачем лениво отвергать
    // то, что и так ничего не делает. add — другое дело: без этой проверки
    // запрос молча ложится строкой в funnel_tag_overrides и никогда ни на что
    // не влияет (см. assertNotFunnelTypeMarker в tag-templates.ts).
    //
    // Проверяем не сам patch, а РАЗНИЦУ с уже сохранённым (`current`).
    // Маршрут мёржит патч со старыми данными для сценариев, которых нет в
    // теле запроса (см. route.ts: `patch[s] = parsed.data[s] ?? current[s]`),
    // так что patch здесь — это ПОЛНАЯ карта всех четырёх сценариев, а не
    // только присланные. Если проверять её целиком, воронка со старой строкой
    // маркера в add (эндпоинт до этого барьера отвечал 200 и клал такую
    // строку; либо duplicateFunnel → copyFunnelChildren пишет
    // funnel_tag_overrides напрямую, минуя оба барьера) начнёт получать 400
    // на любой частичный PATCH, который эту строку даже не трогает — вызывающий
    // прислал совсем другой сценарий и не может понять, за что отказ. Сравнение
    // с `current` устраняет это естественно: для сценария, которого нет в
    // теле запроса, patch[s].add совпадает с current[s].add ровно потому, что
    // он был взят оттуда же — новых имён ноль, отказа не будет.
    //
    // Оговорка: это держится, только пока route.ts переносит current[s].add
    // В patch[s].add БЕЗ нормализации (как сейчас — прямое присваивание). Если
    // кто-то добавит trim/сортировку/дедуп массива перед сравнением или перед
    // мёржем, `alreadyStored.has(name)` перестанет находить совпадение для
    // формально того же имени в другом виде — и отказ вернётся молча, для
    // PATCH, который старую строку маркера даже не трогал. Это ровно тот
    // регресс, что уже ловился в этой ветке (см. историю коммитов
    // «не ронять посторонний PATCH из-за старой строки маркера»).
    const current = listOverrides(tx, id);
    for (const scenario of SCENARIOS) {
      const alreadyStored = new Set(current[scenario]?.add ?? []);
      const newNames = (patch[scenario]?.add ?? []).filter((name) => !alreadyStored.has(name));
      assertNotFunnelTypeMarker(tx, newNames);
    }
    const axes = getAxesForFunnel(tx, id);
    const effective = getFunnelTypeContext(tx, id).hasTime === false
      ? mirrorPaymentOverrides(patch, current)
      : patch;
    replaceOverrides(tx, id, effective);
    materializeFunnelTags(tx, id, axes);
  });
  return getFunnel(db, id);
}

/**
 * Re-materialize every funnel's tags. Used after a global template change so
 * new defaults propagate everywhere; per-funnel overrides are preserved
 * (they are read fresh inside materializeFunnelTags). Cheap at this DB's scale.
 */
export function resyncAllFunnels(db: DB): void {
  const rows = db.select({ id: funnels.id }).from(funnels).all() as { id: number }[];
  db.transaction((tx) => {
    for (const { id } of rows) {
      const axes = getAxesForFunnel(tx, id);
      // Ни одной оси — это пустой черновик (createDraftFunnel заводит воронку
      // БЕЗ АВ-тегов намеренно, карточка показывает пустые селекты).
      // Материализовать ему шаблон значит поставить содержимое черновика в
      // зависимость от того, правил ли кто-то глобальный шаблон между его
      // созданием и заполнением. Осей нет — выводить теги не из чего.
      if (!axes.product && !axes.contractor && !axes.channel && !axes.direction) continue;
      materializeFunnelTags(tx, id, axes);
    }
  });
}

/**
 * Переключить признак «есть эфиры по времени» у типа воронки и тут же
 * пересобрать теги всех воронок этого типа. Возвращает число затронутых
 * воронок, либо null, если типа с таким id нет.
 *
 * Ресинк здесь не удобство, а обязательная часть операции: `funnel_tags` —
 * материализованный результат, и без пересборки набор отставал бы от
 * справочника до ближайшего сохранения каждой воронки поодиночке. Человек
 * снял галку, а теги времени остались висеть — ровно та тихая рассинхронизация,
 * от которой существует весь слой материализации.
 *
 * Пустые черновики пропускаются по тому же правилу, что и в resyncAllFunnels.
 */
export function setFunnelTypeHasTime(db: DB, typeId: number, hasTime: boolean): number | null {
  let affected: number | null = null;
  db.transaction((tx) => {
    if (!setRefHasTime(tx, typeId, hasTime)) return;
    const rows = db
      .select({ id: funnels.id })
      .from(funnels)
      .where(eq(funnels.funnelTypeId, typeId))
      .all() as { id: number }[];
    affected = 0;
    for (const { id } of rows) {
      const axes = getAxesForFunnel(tx, id);
      if (!axes.product && !axes.contractor && !axes.channel && !axes.direction) continue;
      materializeFunnelTags(tx, id, axes);
      affected += 1;
    }
  });
  return affected;
}

/**
 * DELETE /api/funnels/[id] — removes funnel (funnelTags cascade via FK).
 * Returns true on success, false if not found.
 */
export function deleteFunnel(db: DB, id: number): boolean {
  const existing = db.select({ id: funnels.id }).from(funnels).where(eq(funnels.id, id)).get();
  if (!existing) return false;

  db.delete(funnels).where(eq(funnels.id, id)).run();
  return true;
}

/**
 * Deep-copy every child row of `srcId` onto `dstId` (days, blocks + block items),
 * preserving order and per-slot data. Must run inside a transaction.
 */
function copyFunnelChildren(tx: AnyDB, srcId: number, dstId: number): void {
  // funnel_days — copy all data columns, swap funnelId, drop the PK.
  const days = tx.select().from(funnelDays).where(eq(funnelDays.funnelId, srcId)).all();
  for (const d of days) {
    const { id: _id, funnelId: _fid, ...rest } = d;
    tx.insert(funnelDays).values({ ...rest, funnelId: dstId }).run();
  }

  // funnel_blocks + funnel_block_items — copy each block then its items.
  const blocks = tx.select().from(funnelBlocks).where(eq(funnelBlocks.funnelId, srcId)).all();
  for (const b of blocks) {
    const newBlock = tx
      .insert(funnelBlocks)
      .values({ funnelId: dstId, kind: b.kind, enabled: b.enabled, mode: b.mode })
      .returning()
      .get();
    const items = tx.select().from(funnelBlockItems).where(eq(funnelBlockItems.blockId, b.id)).all();
    for (const it of items) {
      tx.insert(funnelBlockItems).values({
        blockId:  newBlock.id,
        slot:     it.slot,
        label:    it.label,
        url:      it.url,
        position: it.position,
      }).run();
    }
  }

  // salebot_configs — per-slot condition/calculator. Part of the funnel's
  // content, so a faithful duplicate must carry it over.
  const configs = tx.select().from(salebotConfigs).where(eq(salebotConfigs.funnelId, srcId)).all();
  for (const c of configs) {
    const { id: _id, funnelId: _fid, ...rest } = c;
    tx.insert(salebotConfigs).values({ ...rest, funnelId: dstId }).run();
  }

  // Copy per-funnel tag overrides so a duplicate keeps the source's custom
  // additions and removed defaults (AV tags themselves are re-materialized
  // from the copied axes by the caller).
  const overrideRows = tx
    .select({
      tagType: funnelTagOverrides.tagType,
      name: funnelTagOverrides.name,
      op: funnelTagOverrides.op,
      position: funnelTagOverrides.position,
    })
    .from(funnelTagOverrides)
    .where(eq(funnelTagOverrides.funnelId, srcId))
    .all() as { tagType: 'reg' | 'time_15' | 'time_19' | 'messenger'; name: string; op: 'add' | 'remove'; position: number }[];
  for (const o of overrideRows) {
    tx.insert(funnelTagOverrides)
      .values({ funnelId: dstId, tagType: o.tagType, name: o.name, op: o.op, position: o.position })
      .onConflictDoNothing()
      .run();
  }
}

/**
 * POST /api/funnels/[id]/duplicate — copy with num=max(num)+1, a freshly
 * allocated frontCode (same rule as createDraftFunnel — next free above the
 * current max, never derived from num), status='draft'. Copies all editable
 * scalar fields and every child row. Returns null if source not found.
 */
export function duplicateFunnel(db: DB, id: number): FunnelListItem | null {
  const source = db.select().from(funnels).where(eq(funnels.id, id)).get();
  if (!source) return null;

  const sourceAxes = getAxesForFunnel(db, id);

  const duplicated = withAllocRetry(() => db.transaction((tx) => {
    // Get max num
    const maxResult = tx
      .select({ maxNum: sql<number>`MAX(${funnels.num})` })
      .from(funnels)
      .get();
    const newNum = (maxResult?.maxNum ?? 0) + 1;
    const newFrontCode = allocateFrontCode(tx);

    // Insert copy — carry over ALL editable scalar fields (incl. Phase-3),
    // resetting identity fields (num/frontCode/status) for the new draft: num
    // and frontCode are freshly allocated, never copied from the source.
    const inserted = tx
      .insert(funnels)
      .values({
        num:                newNum,
        frontCode:          newFrontCode,
        status:             'draft',
        productName:        source.productName,
        variant:            source.variant,
        startDate:          source.startDate ?? '',
        blockName:          source.blockName ?? '',
        productId:          source.productId,
        contractorId:       source.contractorId,
        sourceId:           source.sourceId,
        comment:            source.comment ?? '',
        timeLabelA:         source.timeLabelA ?? '15:00',
        timeLabelB:         source.timeLabelB ?? '19:00',
        roomsReplayEnabled: source.roomsReplayEnabled ?? 0,
        roomsEnabled:       (source.roomsEnabled ?? 1) ? 1 : 0,
        // Пятая ось — тот же слой идентичности, что и остальные оси выше:
        // дубликат обязан унаследовать тип, иначе «faithful copy» перестаёт
        // быть таковой и маркер тихо теряется на копии.
        funnelTypeId:       source.funnelTypeId ?? null,
      })
      .returning()
      .get() as Funnel;

    // Deep-copy child rows so a duplicate is a faithful copy, not an empty draft.
    // Must run BEFORE materialize so the copied overrides are applied.
    copyFunnelChildren(tx, id, inserted.id);

    // Materialize AV tags from source axes (reads the just-copied overrides
    // AND the just-inserted funnelTypeId via getFunnelTypeContext).
    materializeFunnelTags(tx, inserted.id, sourceAxes);

    const typeName = inserted.funnelTypeId
      ? (tx.select({ name: funnelTypes.name }).from(funnelTypes)
           .where(eq(funnelTypes.id, inserted.funnelTypeId)).get() as { name: string } | undefined)?.name ?? null
      : null;

    return {
      id:          inserted.id,
      num:         inserted.num,
      frontCode:   inserted.frontCode ?? '',
      status:      'draft',
      productName: inserted.productName,
      funnelType:  typeName,
      name:        funnelName(sourceAxes),
      axes:        sourceAxes,
    };
  }));

  return duplicated;
}
