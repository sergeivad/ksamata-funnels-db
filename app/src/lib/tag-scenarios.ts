/**
 * Порядок и подписи сценариев тегов — в одном месте на все экраны.
 *
 * Сценариев четыре (`reg`, `time_15`, `time_19`, `messenger`), но человеку они
 * показываются по-разному: в редакторе это три вкладки с отдельным
 * переключателем времени внутри «Оплаты», в просмотре — плоский список строк.
 * Общее у них — сами подписи и порядок, и разъезжаться им нельзя: «Оплата
 * 15:00» на одном экране и «Оплата (15)» на другом читаются как разные вещи.
 *
 * У воронки без эфиров по времени сценарии оплаты дают один и тот же набор
 * (см. computeTagSet), поэтому в списке остаётся одна строка «Оплата» — от
 * `time_19`. Выбор именно его, а не `time_15`, произволен ровно настолько,
 * насколько наборы совпадают; важно, что он совпадает с тем, который правит
 * карточка (см. mirrorPaymentOverrides в funnels.ts).
 */
import type { Scenario } from './ab-tags';

export type ScenarioView = { scenario: Scenario; label: string };

/**
 * Строки для показа набора тегов целиком.
 * `timeLabelA`/`timeLabelB` — подписи слотов воронки («15:00»/«19:00»).
 */
export function scenarioViews(
  hasTime: boolean,
  timeLabelA: string,
  timeLabelB: string,
): ScenarioView[] {
  if (!hasTime) {
    return [
      { scenario: 'reg', label: 'Регистрация' },
      { scenario: 'time_19', label: 'Оплата' },
      { scenario: 'messenger', label: 'Мессенджер' },
    ];
  }
  return [
    { scenario: 'reg', label: 'Регистрация' },
    { scenario: 'time_15', label: `Оплата ${timeLabelA || '15:00'}` },
    { scenario: 'time_19', label: `Оплата ${timeLabelB || '19:00'}` },
    { scenario: 'messenger', label: 'Мессенджер' },
  ];
}

/** Как теги склеиваются в буфер обмена по кнопке «Копировать все». */
export function joinTagsForCopy(names: string[]): string {
  return names.join('; ');
}
