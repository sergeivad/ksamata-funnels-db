import { eq, asc } from 'drizzle-orm';
import { type AnyDB } from '../db/client';
import {
  products,
  contractors,
  sources,
  tags,
  channels,
  directions,
  funnels,
  funnelTags,
  productDurations,
  funnelTypes,
} from '../db/schema';
import { AXIS_PREFIXES, isAxisTag, type AbAxes, type Scenario } from './ab-tags';
import { FUNNEL_TYPE_KIND } from './funnel-type';

// Explicit whitelist — never interpolate `kind` into SQL
const TABLE_MAP = {
  products,
  contractors,
  sources,
  tags,
  channels,
  directions,
  funnel_types: funnelTypes,
} as const;

export type RefKind = keyof typeof TABLE_MAP;

export const VALID_KINDS = Object.keys(TABLE_MAP) as RefKind[];

export function isValidKind(kind: string): kind is RefKind {
  return VALID_KINDS.includes(kind as RefKind);
}

/**
 * Справочники, которые нельзя править через API руками. `tags` смешивает
 * пользовательские теги с системными «АВ …», из которых выводятся оси воронок;
 * ими управляет движок шаблонов и оверрайдов, а не человек через справочник.
 *
 * Правило одно на все методы: раньше `PATCH`/`DELETE` были закрыты, а `POST`
 * нет — созданный тег оставался в базе навсегда, потому что удалить его через
 * API было нечем. Читается как «этот справочник только на чтение».
 */
export const IMMUTABLE_KINDS: readonly string[] = ['tags'];

export function isImmutableKind(kind: string): boolean {
  return IMMUTABLE_KINDS.includes(kind);
}

/** Один текст отказа на все методы — чтобы формулировки не разъезжались. */
export const IMMUTABLE_KIND_MESSAGE =
  'Справочник тегов нельзя изменять: АВ-теги управляются автоматически';

function resolveTable(kind: string) {
  if (!VALID_KINDS.includes(kind as RefKind)) {
    throw new Error(
      `Invalid kind "${kind}". Must be one of: ${VALID_KINDS.join(', ')}.`
    );
  }
  return TABLE_MAP[kind as RefKind];
}

// Виды справочников, значение которых дублируется тегом воронки.
// У четырёх осей тег — «АВ <Ось>: <значение>»; у типа воронки маркер
// двоеточия не имеет, и тег равен самому значению (см. funnel-type.ts).
// `sources` и `tags` зеркала не имеют: первый — обычный FK, второй сам
// и есть таблица тегов.
const AXIS_KIND_TO_AXIS: Partial<Record<RefKind, keyof AbAxes>> = {
  products: 'product',
  contractors: 'contractor',
  channels: 'channel',
  directions: 'direction',
};

export function refTagNameFor(kind: RefKind, value: string): string | null {
  if (kind === FUNNEL_TYPE_KIND) return value;
  const axis = AXIS_KIND_TO_AXIS[kind];
  return axis ? `${AXIS_PREFIXES[axis]}${value}` : null;
}

/**
 * Барьер финальной рецензии (пункт 1): значение funnel_types не может выглядеть
 * как осевой тег ("АВ Продукт: …" и т.п.). `refTagNameFor(FUNNEL_TYPE_KIND, value)`
 * возвращает value ДОСЛОВНО — без двоеточия и обёртки, в отличие от четырёх осей,
 * — поэтому такое имя материализуется КАК ОСЕВОЙ тег и при ближайшем
 * `computeTagSet` перепишет чужую ось (`getAxesForFunnel` читает оси из тегов)
 * у каждой воронки этого типа. Опечатка вида «АВ Продукт: ПОДДЕЛКА», заведённая
 * через `/refs`, воспроизводимо превращала `ЖИВО / НИМБ / Яндекс / РСЯ` в
 * `ПОДДЕЛКА / НИМБ / Яндекс / РСЯ`.
 *
 * Экспортирована (а не спрятана внутри createRef/renameRef), чтобы её можно
 * было проверить юнит-тестом отдельно от конкретного механизма отказа.
 */
export function isReservedFunnelTypeName(kind: string, name: string): boolean {
  return kind === FUNNEL_TYPE_KIND && isAxisTag(name);
}

export const FUNNEL_TYPE_AXIS_CONFLICT_MESSAGE =
  'Имя типа воронки не может выглядеть как осевой тег ("АВ Продукт: …" и т.п.) — такое имя перепишет чужую ось';

/**
 * Выбрасывается createRef, когда вызывающий пытается завести значение
 * funnel_types, совпадающее по форме с осевым тегом. createRef в остальном
 * не имеет истории отказов (get-or-create не может «не найти» валидное имя),
 * так что исключение — минимальное по объёму изменение; ловится маршрутом
 * /api/refs и превращается в 400, а не в общий 500 (см. internalError в http.ts).
 */
export class FunnelTypeAxisConflictError extends Error {
  constructor(name: string) {
    super(`Значение "${name}" типа воронки выглядит как осевой тег`);
    this.name = 'FunnelTypeAxisConflictError';
  }
}

export type RefRow = { id: number; name: string };

/**
 * Строка справочника типов воронки. `hasTime` есть только у этого вида —
 * остальные справочники своих свойств не имеют, и общий RefRow не должен
 * обрастать полем, которое у шести видов из семи всегда undefined.
 */
export type FunnelTypeRefRow = RefRow & { hasTime: boolean };

/** Return all rows for a reference table, ordered by name. */
export function listRefs(db: AnyDB, kind: string): RefRow[] {
  const table = resolveTable(kind);
  if (kind === FUNNEL_TYPE_KIND) {
    return (
      db
        .select({ id: funnelTypes.id, name: funnelTypes.name, hasTime: funnelTypes.hasTime })
        .from(funnelTypes)
        .orderBy(asc(funnelTypes.name))
        .all() as { id: number; name: string; hasTime: number }[]
    ).map((r) => ({ id: r.id, name: r.name, hasTime: r.hasTime !== 0 }) satisfies FunnelTypeRefRow);
  }
  return db
    .select({ id: table.id, name: table.name })
    .from(table)
    .orderBy(asc(table.name))
    .all() as RefRow[];
}

/**
 * Переключить у типа воронки признак «есть эфиры по времени».
 * Возвращает false, если строки нет.
 *
 * Только запись флага — БЕЗ пересборки тегов воронок этого типа: ресинк живёт
 * в funnels.ts (setFunnelTypeHasTime), потому что материализация тянет за собой
 * половину доменной логики, а refs.ts обязан оставаться листом, который
 * funnels.ts импортирует, а не наоборот.
 */
export function setFunnelTypeHasTime(db: AnyDB, id: number, hasTime: boolean): boolean {
  const existing = db
    .select({ id: funnelTypes.id })
    .from(funnelTypes)
    .where(eq(funnelTypes.id, id))
    .get() as { id: number } | undefined;
  if (!existing) return false;
  db.update(funnelTypes).set({ hasTime: hasTime ? 1 : 0 }).where(eq(funnelTypes.id, id)).run();
  return true;
}

/**
 * Get-or-create a row in a reference table by name.
 * Returns the existing row if found, inserts and returns the new row otherwise.
 */
export function createRef(db: AnyDB, kind: string, name: string): RefRow {
  if (isReservedFunnelTypeName(kind, name)) {
    throw new FunnelTypeAxisConflictError(name);
  }

  const table = resolveTable(kind);

  // Try to find existing row
  const existing = db
    .select({ id: table.id, name: table.name })
    .from(table)
    .where(eq(table.name, name))
    .get() as RefRow | undefined;

  if (existing) {
    return existing;
  }

  // Insert and return
  const inserted = db
    .insert(table)
    .values({ name })
    .returning({ id: table.id, name: table.name })
    .get() as RefRow;

  return inserted;
}

/** Fetch a single row by id, or undefined if it doesn't exist. */
export function getRefById(db: AnyDB, kind: string, id: number): RefRow | undefined {
  const table = resolveTable(kind);
  return db
    .select({ id: table.id, name: table.name })
    .from(table)
    .where(eq(table.id, id))
    .get() as RefRow | undefined;
}

/** Fetch a single row by exact name, or undefined if it doesn't exist. */
export function getRefByName(db: AnyDB, kind: string, name: string): RefRow | undefined {
  const table = resolveTable(kind);
  return db
    .select({ id: table.id, name: table.name })
    .from(table)
    .where(eq(table.name, name))
    .get() as RefRow | undefined;
}

/**
 * Direct FK usage on the `funnels` row itself. Only products/contractors/
 * sources/funnel_types are stored as FK columns — channels/directions/tags
 * have no FK column and are only ever referenced through funnel_tags.
 */
function directFkFunnelIds(db: AnyDB, kind: RefKind, id: number): number[] {
  const column =
    kind === 'products' ? funnels.productId
    : kind === 'contractors' ? funnels.contractorId
    : kind === 'sources' ? funnels.sourceId
    : kind === FUNNEL_TYPE_KIND ? funnels.funnelTypeId
    : undefined;
  if (!column) return [];
  return (
    db
      .select({ funnelId: funnels.id })
      .from(funnels)
      .where(eq(column, id))
      .all() as { funnelId: number }[]
  ).map((r) => r.funnelId);
}

/** All funnel ids that carry a funnel_tags row pointing at this tag id. */
function funnelIdsForTagId(db: AnyDB, tagId: number): number[] {
  return (
    db
      .select({ funnelId: funnelTags.funnelId })
      .from(funnelTags)
      .where(eq(funnelTags.tagId, tagId))
      .all() as { funnelId: number }[]
  ).map((r) => r.funnelId);
}

/**
 * Look up the mirrored tag row for a products/contractors/channels/
 * directions/funnel_types ref value, if it has ever been synced onto a
 * funnel. Returns undefined for kinds with no tag mirror (sources, tags)
 * or if the tag was never created.
 */
function findAxisTagRow(db: AnyDB, kind: RefKind, value: string): RefRow | undefined {
  const tagName = refTagNameFor(kind, value);
  if (!tagName) return undefined;
  return getRefByName(db, 'tags', tagName);
}

export type RefUsage = { count: number; funnelIds: number[] };

/**
 * Number of DISTINCT funnels that reference this ref row — via a direct FK
 * column (products/contractors/sources/funnel_types), via funnel_tags
 * directly (tags), and/or via the mirrored tag (products/contractors/
 * channels/directions → "АВ <Axis>: <value>"; funnel_types → само значение,
 * см. refTagNameFor). funnel_types так считается вдвойне — и через
 * funnels.funnel_type_id, и через одноимённый тег: `materializeFunnelTags`
 * (funnels.ts) кладёт маркер в слой идентичности наравне с осями и зовёт
 * `createRef(db, 'tags', …)` для него так же, как для четырёх осей, так что
 * зеркальный тег заводится РЕАЛЬНО, на первом же сохранении воронки с этим
 * типом — не «если когда-нибудь появится». В живой базе он уже есть:
 * `АВ Квиз`, `АВ Прямые`. Union of every source, deduplicated by funnel id.
 */
export function getRefUsage(db: AnyDB, kind: RefKind, row: RefRow): RefUsage {
  const ids = new Set<number>();

  for (const fid of directFkFunnelIds(db, kind, row.id)) ids.add(fid);

  if (kind === 'tags') {
    for (const fid of funnelIdsForTagId(db, row.id)) ids.add(fid);
  } else {
    const axisTag = findAxisTagRow(db, kind, row.name);
    if (axisTag) {
      for (const fid of funnelIdsForTagId(db, axisTag.id)) ids.add(fid);
    }
  }

  return { count: ids.size, funnelIds: [...ids] };
}

/**
 * Rename the tag `oldName` → `newName` inside `tags`, merging into an
 * existing `newName` tag row if one already exists (repointing every
 * funnel_tags row from the old tag id to the existing one, then dropping the
 * now-orphaned old tag). No-op if `oldName` doesn't exist as a tag — the axis
 * value may simply never have been synced onto any funnel yet.
 * Must be called INSIDE a transaction.
 */
function renameOrMergeTag(db: AnyDB, oldName: string, newName: string): void {
  const oldTag = getRefByName(db, 'tags', oldName);
  if (!oldTag) return;

  const newTag = getRefByName(db, 'tags', newName);

  if (!newTag) {
    db.update(tags).set({ name: newName }).where(eq(tags.id, oldTag.id)).run();
    return;
  }
  if (newTag.id === oldTag.id) return;

  // Merge: repoint every funnel_tags row from oldTag onto the existing newTag,
  // then drop the old tag row (and any funnel_tags left pointing at it, which
  // would only happen if a funnel somehow already carried both — the
  // onConflictDoNothing + explicit cleanup below keeps this safe either way).
  const rows = db
    .select({
      funnelId: funnelTags.funnelId,
      tagType: funnelTags.tagType,
      position: funnelTags.position,
    })
    .from(funnelTags)
    .where(eq(funnelTags.tagId, oldTag.id))
    .all() as { funnelId: number; tagType: Scenario; position: number }[];

  for (const r of rows) {
    db.insert(funnelTags)
      .values({ funnelId: r.funnelId, tagId: newTag.id, tagType: r.tagType, position: r.position })
      .onConflictDoNothing()
      .run();
  }

  db.delete(funnelTags).where(eq(funnelTags.tagId, oldTag.id)).run();
  db.delete(tags).where(eq(tags.id, oldTag.id)).run();
}

export type RenameRefResult =
  | { ok: true; row: RefRow }
  | { ok: false; error: 'not_found' }
  | { ok: false; error: 'duplicate' }
  | { ok: false; error: 'axis_conflict' };

/**
 * Rename a reference value. Validates uniqueness within the same table.
 * For products/contractors/channels/directions, also renames (or merges) the
 * mirrored "АВ <Axis>: <value>" tag so every funnel referencing it — via
 * funnel_tags, for every scenario tag type (see SCENARIOS in ab-tags.ts) —
 * picks up the new text immediately. Funnel names are derived live from
 * these tags (see funnelName/getAxesForFunnel in lib/funnels.ts), so no
 * further per-funnel update is needed.
 *
 * Для funnel_types зеркальный тег равен самому значению — у маркера типа нет
 * двоеточия, поэтому переименование через AXIS_PREFIXES не годится (см.
 * refTagNameFor). Двоевластие с `tag_templates`, из-за которого переименование
 * «АВ Автоворонка» когда-то задевало бы и шаблонный тег, закрыто пятой осью:
 * маркеров в `tag_templates` теперь ноль (см. funnel-type.ts и
 * migrate-phase5-data.ts), так что переименовывать любое значение funnel_types
 * здесь безопасно.
 *
 * Отдельно отвергает переименование в имя, которое выглядит как осевой тег
 * (`isReservedFunnelTypeName` — см. её докстринг): без этого барьера
 * `newName = "АВ Продукт: X"` материализовался бы как осевой тег и переписал
 * бы чужую ось у каждой воронки этого типа.
 */
export function renameRef(db: AnyDB, kind: RefKind, id: number, newName: string): RenameRefResult {
  const table = resolveTable(kind);
  const existing = getRefById(db, kind, id);
  if (!existing) return { ok: false, error: 'not_found' };

  if (existing.name === newName) {
    return { ok: true, row: existing };
  }

  if (isReservedFunnelTypeName(kind, newName)) {
    return { ok: false, error: 'axis_conflict' };
  }

  const dup = getRefByName(db, kind, newName);
  if (dup && dup.id !== id) {
    return { ok: false, error: 'duplicate' };
  }

  let result: RefRow = { id, name: newName };
  db.transaction((tx) => {
    tx.update(table).set({ name: newName }).where(eq(table.id, id)).run();

    const oldTag = refTagNameFor(kind, existing.name);
    const newTag = refTagNameFor(kind, newName);
    if (oldTag && newTag) renameOrMergeTag(tx, oldTag, newTag);

    result = { id, name: newName };
  });

  return { ok: true, row: result };
}

export type DeleteRefResult =
  | { ok: true }
  | { ok: false; error: 'not_found' }
  | { ok: false; error: 'in_use'; usedBy: number }
  | { ok: false; error: 'has_durations'; rows: number };

/**
 * Delete a reference value. Refuses if any funnel still uses it (via FK
 * column and/or the mirrored AV tag) and reports how many funnels do.
 * On success, also drops the now-orphaned mirrored AV tag row (if any) —
 * safe because usedBy===0 guarantees no funnel_tags row points at it.
 */
export function deleteRef(db: AnyDB, kind: RefKind, id: number): DeleteRefResult {
  const table = resolveTable(kind);
  const existing = getRefById(db, kind, id);
  if (!existing) return { ok: false, error: 'not_found' };

  const usage = getRefUsage(db, kind, existing);
  if (usage.count > 0) {
    return { ok: false, error: 'in_use', usedBy: usage.count };
  }

  // products has a second FK inbound: product_durations. Without this guard
  // the DELETE would hit the FK constraint and surface as a 500.
  if (kind === 'products') {
    const durationRows = db
      .select({ id: productDurations.id })
      .from(productDurations)
      .where(eq(productDurations.productId, id))
      .all();
    if (durationRows.length > 0) {
      return { ok: false, error: 'has_durations', rows: durationRows.length };
    }
  }

  db.transaction((tx) => {
    tx.delete(table).where(eq(table.id, id)).run();

    // findAxisTagRow уже само возвращает undefined для видов без зеркального
    // тега (sources, tags) — отдельная проверка через AXIS_KIND_TO_AXIS здесь
    // не нужна и до funnel_types её не доводили бы неверно.
    const axisTag = findAxisTagRow(tx, kind, existing.name);
    if (axisTag) {
      tx.delete(funnelTags).where(eq(funnelTags.tagId, axisTag.id)).run();
      tx.delete(tags).where(eq(tags.id, axisTag.id)).run();
    }
  });

  return { ok: true };
}
