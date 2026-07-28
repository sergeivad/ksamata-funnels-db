// Порядок воронок в списке на главной. Сортируем по номеру фронта (F), а не по
// num: F — это то, чем воронка называется во внешних материалах, num остаётся
// внутренним ключом. Сравнение числовое: как строки 'f9' встало бы выше 'f70'.
//
// Воронки без кода (в живой базе их десяток) уходят в конец: у них нет F, по
// которому их можно поставить в ряд, и подмешивать их в середину значило бы
// прятать их между осмысленными номерами.

export interface FunnelSortable {
  num: number;
  frontCode: string;
}

/** Номер из кода фронта: 'f70' → 70. Пустой/непонятный код → null. */
export function frontCodeNum(frontCode: string): number | null {
  const m = /^f(\d+)$/.exec(frontCode.trim());
  return m ? Number(m[1]) : null;
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
