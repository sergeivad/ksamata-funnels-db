import { BLOCK_KINDS } from './blocks';

/**
 * Русские названия групп мониторинга.
 *
 * Виды блоков берём из BLOCK_KINDS, а не дублируем списком: на странице
 * мониторинга группа должна называться ровно так же, как блок в редакторе
 * воронки, иначе два списка неизбежно разъедутся.
 */
const BLOCK_TITLES = new Map<string, string>(BLOCK_KINDS.map((d) => [d.kind, d.title]));

/** Источники, которых нет среди видов блоков. */
const EXTRA_TITLES: Record<string, string> = {
  // Поле landing_url самой воронки, а не блок.
  funnel_landing_url: 'Лендинг воронки',
};

/** Неизвестный вид отдаёт сам себя: UI не должен ломаться на данных из будущего. */
export function sourceKindLabel(sourceKind: string): string {
  return BLOCK_TITLES.get(sourceKind) ?? EXTRA_TITLES[sourceKind] ?? sourceKind;
}
