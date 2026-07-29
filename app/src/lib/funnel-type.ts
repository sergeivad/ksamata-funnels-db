/**
 * Пятая ось воронки — её тип. В GetCourse это один из взаимоисключающих
 * маркеров без двоеточия, поэтому в AXIS_PREFIXES ему места нет (см. ab-tags.ts).
 *
 * Значения живут в справочнике funnel_types и правятся через /refs: набор
 * маркеров задаёт GetCourse, и пятый может появиться без нашего участия.
 * Здесь — только то, что кодом действительно зашито: ключ справочника,
 * значение для бэкфилла и стартовый набор.
 */
export const FUNNEL_TYPE_KIND = 'funnel_types' as const;

/** Имя строки справочника = текст маркера дословно. */
export const DEFAULT_FUNNEL_TYPE = 'АВ Автоворонка';

export const SEED_FUNNEL_TYPES: readonly string[] = [
  DEFAULT_FUNNEL_TYPE,
  'АВ Прямые',
  'АВ Квиз',
  'АВ Квиз-Лайт',
];

export const FUNNEL_TYPE_LABEL = 'Тип воронки';
