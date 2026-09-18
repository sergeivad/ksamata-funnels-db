import { BLOCK_KINDS } from './blocks';

/**
 * Виды комнат. Три, а не один: это три разных хоста и три разные причины
 * падения, и только у room_web нужна проверка по содержимому. Слитая группа
 * не выключалась бы по частям.
 */
export const ROOM_SOURCE_KINDS = ['room_gc', 'room_web', 'room_replay'] as const;
export type RoomSourceKind = (typeof ROOM_SOURCE_KINDS)[number];

const ROOM_TITLES: Record<RoomSourceKind, string> = {
  room_gc: 'Комнаты ГК',
  room_web: 'Комнаты Web',
  room_replay: 'Повторы',
};

/**
 * Реестр видов источника: блоки ∪ комнаты. Раньше он выводился из одних только
 * BLOCK_KINDS — «каждая проверяемая страница приходит из блока»; с комнатами
 * это перестало быть правдой.
 */
const TITLES = new Map<string, string>([
  ...BLOCK_KINDS.map((d) => [d.kind, d.title] as [string, string]),
  ...ROOM_SOURCE_KINDS.map((k) => [k, ROOM_TITLES[k]] as [string, string]),
]);

/** Неизвестный вид отдаёт сам себя: UI не должен ломаться на данных из будущего. */
export function sourceKindLabel(sourceKind: string): string {
  return TITLES.get(sourceKind) ?? sourceKind;
}

/**
 * Виды источников, которые вообще могут появиться у цели.
 *
 * Блоки ∪ комнаты. Отдельный вид `funnel_landing_url` (колонка landing_url) был
 * до Phase-9 — она свела его с «Лендингами» в одну группу, Phase-10 убрала и
 * саму колонку как место хранения.
 *
 * Читать неизвестный вид (sourceKindLabel) — нормально, а вот записывать по
 * нему решение человека нельзя: monitor_source_kind_prefs хранится вечно и
 * ничем не подчищается, так что опечатка в `sourceKind` оседала бы в базе
 * навсегда как предпочтение для группы, которой не существует.
 */
export function isKnownSourceKind(sourceKind: string): boolean {
  return TITLES.has(sourceKind);
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
