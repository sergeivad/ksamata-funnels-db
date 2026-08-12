import type { StatusFilter } from './status';
import { matchesStatusFilter } from './status';

/** То, по чему список ищет воронку. Полная строка списка шире — здесь только поля поиска. */
export interface SearchableFunnel {
  name: string;
  frontCode: string;
  status: string;
}

/** Есть ли вообще запрос: пробелы поиском не считаются. */
export function isSearching(query: string): boolean {
  return query.trim() !== '';
}

/**
 * Ищем по имени и F-коду — и только по ним. Раньше в стог клали ещё `f${num}`
 * и сам num, а num с F не связан (совпадают у 16 воронок из 72): запрос «f70»
 * находил и настоящую f70, и воронку с num=70, у которой на карточке написано
 * f74. Подстрочный поиск по коду сохраняет и «f5», и «5».
 */
export function matchesSearch(f: SearchableFunnel, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [f.name, f.frontCode].join(' ').toLowerCase().includes(q);
}

/**
 * Видна ли воронка в списке при текущей вкладке и строке поиска: условия
 * перемножаются, вкладка всегда честна.
 *
 * Поиск при этом всё равно идёт по всем воронкам — но не потому, что здесь
 * игнорируется вкладка, а потому, что список сам встаёт на «Все» при первом
 * нажатии в поле (`handleSearchChange` на главной). Раньше это решала именно
 * эта функция, и вкладка врала: стояла «Активные», а в выдаче лежал архив.
 * Смысл поиска — «найди мне вот эту воронку», а не «отфильтруй то, что и так
 * на экране»; но раздел, который человек выбрал уже поверх запроса, — его
 * решение, и отменять его нельзя.
 */
export function isFunnelVisible(
  f: SearchableFunnel,
  statusFilter: StatusFilter,
  query: string
): boolean {
  return matchesStatusFilter(f.status, statusFilter) && matchesSearch(f, query);
}
