/**
 * funnel-facets.ts — фильтр списка воронок по осям и порядок drill-down.
 *
 * Имя воронки — это и есть путь по четырём осям («БОО / Алексей / Яндекс /
 * Квиз»), то есть список четырёхмерный. Здесь живёт всё, что нужно, чтобы по
 * нему ходить: совпадение с набором фильтров, выбор следующей оси для
 * группировки и сама группировка. Чистые функции, без React и без БД.
 */

import type { AbAxes } from './ab-tags';

export type AxisKey = keyof AbAxes;

/**
 * Порядок drill-down: от самой крупной оси к самой мелкой. По нему же идут
 * кнопки группировки и пилюли фильтра, и расходиться им нельзя — человек
 * читает один и тот же ряд слева направо в трёх местах экрана.
 */
export const AXIS_ORDER: AxisKey[] = ['product', 'contractor', 'channel', 'direction'];

export const AXIS_LABEL: Record<AxisKey, string> = {
  product: 'Продукт',
  contractor: 'Подрядчик',
  channel: 'Канал',
  direction: 'Направление',
};

/** Подпись группы и пункта меню для воронки, у которой оси нет. */
export const NO_AXIS_VALUE = '— без осей';

/** Ось для группировки либо «без группировки». */
export type GroupBy = AxisKey | 'none';

/**
 * Набор фильтров: ось → значение. Пустая строка — законное значение
 * («воронки без продукта»), поэтому «фильтр стоит» определяется наличием
 * ключа, а не истинностью значения.
 */
export type AxisFilters = Partial<Record<AxisKey, string>>;

/** Шаг drill-down: новый набор фильтров и ось, по которой теперь группировать. */
export interface DrillStep {
  filters: AxisFilters;
  group: GroupBy;
}

/** То, по чему фильтруется строка списка. Полная строка шире — здесь только оси. */
export interface FacetedFunnel {
  axes: AbAxes;
}

export interface AxisOption {
  /** Значение оси как оно лежит в данных: '' у воронки без этой оси. */
  value: string;
  /** Что показать человеку: то же значение либо NO_AXIS_VALUE. */
  label: string;
  count: number;
}

export interface FunnelGroup<T> {
  value: string;
  label: string;
  funnels: T[];
}

export function isAxisKey(v: unknown): v is AxisKey {
  return typeof v === 'string' && (AXIS_ORDER as string[]).includes(v);
}

export function isGroupBy(v: unknown): v is GroupBy {
  return v === 'none' || isAxisKey(v);
}

export function hasAxisFilter(filters: AxisFilters, axis: AxisKey): boolean {
  return Object.prototype.hasOwnProperty.call(filters, axis);
}

/** Сколько осей сейчас под фильтром. */
export function activeAxes(filters: AxisFilters): AxisKey[] {
  return AXIS_ORDER.filter((axis) => hasAxisFilter(filters, axis));
}

/** Подпись значения оси: пустое значение показываем словами. */
export function axisValueLabel(value: string): string {
  return value === '' ? NO_AXIS_VALUE : value;
}

/** Проходит ли воронка весь набор фильтров: условия по разным осям перемножаются. */
export function matchesFilters(axes: AbAxes, filters: AxisFilters): boolean {
  return activeAxes(filters).every((axis) => axes[axis] === filters[axis]);
}

/**
 * Ось, по которой группировать после текущего набора фильтров: первая
 * свободная в порядке drill-down. Ось под фильтром пропускается — групп по
 * ней осталась бы ровно одна, и нажимать дальше было бы нечего.
 */
export function nextGroupAxis(filters: AxisFilters): GroupBy {
  return AXIS_ORDER.find((axis) => !hasAxisFilter(filters, axis)) ?? 'none';
}

/**
 * Клик по значению оси — заголовку группы или пункту меню.
 *
 * Повтор того же значения читается как отмена и уходит в `clearAxis`.
 *
 * Группировка переезжает на следующую свободную ось только тогда, когда
 * фильтруют ТУ САМУЮ ось, по которой сейчас идёт разбивка: только у неё после
 * фильтра остаётся ровно одна группа и нажимать дальше нечего. Фильтр по
 * любой другой оси вид не дёргает, а «без группировки» drill-down не
 * отменяет — это решение человека.
 */
export function drillInto(
  filters: AxisFilters,
  group: GroupBy,
  axis: AxisKey,
  value: string
): DrillStep {
  if (hasAxisFilter(filters, axis) && filters[axis] === value) {
    return clearAxis(filters, group, axis);
  }
  const next: AxisFilters = { ...filters, [axis]: value };
  return { filters: next, group: group === axis ? nextGroupAxis(next) : group };
}

/**
 * Снять фильтр с одной оси.
 *
 * Освободившаяся ось забирает группировку, только если она теперь первая
 * свободная: иначе снятие внутреннего фильтра перепрыгивало бы человека через
 * ось, на которой он стоял. «Без группировки» и здесь сохраняется.
 */
export function clearAxis(filters: AxisFilters, group: GroupBy, axis: AxisKey): DrillStep {
  const next: AxisFilters = { ...filters };
  delete next[axis];
  const restores = group !== 'none' && nextGroupAxis(next) === axis;
  return { filters: next, group: restores ? axis : group };
}

/**
 * Значения оси со счётчиками — содержимое меню пилюли.
 *
 * Остальные фильтры учитываются, а свой собственный — нет: иначе в открытом
 * меню осталась бы одна строка, та, что уже выбрана, и сменить значение оси
 * было бы нельзя, только снять.
 */
export function axisOptions<T extends FacetedFunnel>(
  items: T[],
  filters: AxisFilters,
  axis: AxisKey
): AxisOption[] {
  const others = activeAxes(filters).filter((a) => a !== axis);
  const counts = new Map<string, number>();
  for (const item of items) {
    if (!others.every((a) => item.axes[a] === filters[a])) continue;
    const value = item.axes[axis];
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return sortedAxisValues([...counts.keys()]).map((value) => ({
    value,
    label: axisValueLabel(value),
    count: counts.get(value) ?? 0,
  }));
}

/**
 * Разложить список по значениям одной оси. Порядок воронок внутри группы —
 * входной: список уже отсортирован по F-коду, и пересортировывать его здесь
 * значило бы держать правило сортировки в двух местах.
 */
export function buildGroups<T extends FacetedFunnel>(items: T[], axis: AxisKey): FunnelGroup<T>[] {
  const buckets = new Map<string, T[]>();
  for (const item of items) {
    const value = item.axes[axis];
    const bucket = buckets.get(value);
    if (bucket) bucket.push(item);
    else buckets.set(value, [item]);
  }
  return sortedAxisValues([...buckets.keys()]).map((value) => ({
    value,
    label: axisValueLabel(value),
    funnels: buckets.get(value) ?? [],
  }));
}

/** По алфавиту, но воронки без оси — всегда последними: это не имя, а его отсутствие. */
function sortedAxisValues(values: string[]): string[] {
  return values.sort((a, b) => {
    if (a === '') return 1;
    if (b === '') return -1;
    return a.localeCompare(b, 'ru');
  });
}
