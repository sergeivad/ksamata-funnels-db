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

/**
 * Виды источников, которые вообще могут появиться у цели.
 *
 * Читать неизвестный вид (sourceKindLabel) — нормально, а вот записывать по
 * нему решение человека нельзя: monitor_source_kind_prefs хранится вечно и
 * ничем не подчищается, так что опечатка в `sourceKind` оседала бы в базе
 * навсегда как предпочтение для группы, которой не существует.
 */
export function isKnownSourceKind(sourceKind: string): boolean {
  return BLOCK_TITLES.has(sourceKind) || sourceKind in EXTRA_TITLES;
}

/**
 * Как читается чип группы на дашборде.
 *
 * `on` и `partial` подсвечиваются одинаково — оранжевым: с одного взгляда важно
 * понять, проверяется группа или нет, а сколько именно целей включено, говорит
 * само число на чипе («Лендинги · 41 из 45»). Раньше частично включённая группа
 * отличалась от выключенной только цветом текста и терялась среди нулевых.
 *
 * `partial` всё равно нужен отдельным состоянием: у него свой заголовок при
 * наведении и `aria-pressed="mixed"` вместо `false` — клик по такой группе
 * включает её целиком, а не выключает.
 */
export type SourceKindTone = 'on' | 'partial' | 'off';

export function sourceKindTone(enabled: number, total: number): SourceKindTone {
  if (enabled <= 0) return 'off';
  // Пустая группа не бывает включённой; enabled > total — только при рассинхроне,
  // и это тоже «включено всё», а не отдельное состояние.
  if (enabled >= total) return 'on';
  return 'partial';
}
