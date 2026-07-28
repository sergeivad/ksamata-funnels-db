// Порядок воронок в списке на главной. Сортируем по номеру фронта (F), а не по
// num: F — это то, чем воронка называется во внешних материалах, num остаётся
// внутренним ключом. Сравнение числовое: как строки 'f9' встало бы выше 'f70'.
//
// Воронки без кода (в живой базе их десяток) уходят в конец: у них нет F, по
// которому их можно поставить в ряд, и подмешивать их в середину значило бы
// прятать их между осмысленными номерами.

import { frontCodeNum } from './front-code';

export interface FunnelSortable {
  num: number;
  frontCode: string;
}

/**
 * Компаратор Array#sort: F по убыванию, бескодовые в конце (между собой — по
 * num по убыванию, в ту же сторону, что и основной порядок).
 */
export function compareByFrontCodeDesc(a: FunnelSortable, b: FunnelSortable): number {
  const fa = frontCodeNum(a.frontCode);
  const fb = frontCodeNum(b.frontCode);

  if (fa === null && fb === null) return b.num - a.num;
  if (fa === null) return 1;
  if (fb === null) return -1;
  if (fa !== fb) return fb - fa;
  return b.num - a.num;
}

/**
 * То же по возрастанию — для рядов чипов в мониторинге, где номера читаются
 * слева направо. Бескодовые и здесь в конце: «в конец» — свойство отсутствия
 * кода, а не направления сортировки, поэтому это не зеркало Desc.
 */
export function compareByFrontCodeAsc(a: FunnelSortable, b: FunnelSortable): number {
  const fa = frontCodeNum(a.frontCode);
  const fb = frontCodeNum(b.frontCode);

  if (fa === null && fb === null) return a.num - b.num;
  if (fa === null) return 1;
  if (fb === null) return -1;
  if (fa !== fb) return fa - fb;
  return a.num - b.num;
}
