/**
 * Порядок и подписи сценариев тегов — в одном месте на все экраны.
 *
 * Сценариев пять (`reg`, `time_15`, `time_19`, `messenger`, `predspisok`), но
 * человеку они показываются по-разному: в редакторе это четыре вкладки с
 * отдельным переключателем времени внутри «Оплаты», в просмотре — плоский
 * список строк.
 * Общее у них — сами подписи и порядок, и разъезжаться им нельзя: «Оплата
 * 15:00» на одном экране и «Оплата (15)» на другом читаются как разные вещи.
 *
 * У воронки без эфиров по времени сценарии оплаты дают один и тот же набор
 * (см. computeTagSet), поэтому в списке остаётся одна строка «Оплата» — от
 * `time_19`. Выбор именно его, а не `time_15`, произволен ровно настолько,
 * насколько наборы совпадают; важно, что он совпадает с тем, который правит
 * карточка (см. mirrorPaymentOverrides в funnels.ts).
 *
 * Подпись предсписка — «Предсписок», через «с», и с 01.09.2026 так же пишется
 * сам тег («АВ Этап: Предсписок»). Совпали они не потому, что подпись
 * подогнали под тег: подпись называет шаг воронки по-человечески, а тег
 * повторяет живой GetCourse дословно — и до августа 2026 GetCourse писал этап
 * с опечаткой, без «с», которую приходилось повторять. Опечатку он исправил,
 * тег переехал следом (PREDPISOK_STAGE в tools/audit/normalize.py,
 * PHASE14_STAGE_TAG в app/scripts/migrate-phase14-data.ts). Правило прежнее:
 * написание тега решает реестр предложений, а не мы.
 */
import type { Scenario, ScenarioOverride } from './ab-tags';

export type ScenarioView = { scenario: Scenario; label: string };

/**
 * Строки для показа набора тегов целиком.
 * `timeLabelA`/`timeLabelB` — подписи слотов воронки («15:00»/«19:00»).
 */
export function scenarioViews(
  hasTime: boolean,
  timeLabelA: string,
  timeLabelB: string,
  hasPredspisok: boolean = true,
): ScenarioView[] {
  const payment: ScenarioView[] = hasTime
    ? [
        { scenario: 'time_15', label: `Оплата ${timeLabelA || '15:00'}` },
        { scenario: 'time_19', label: `Оплата ${timeLabelB || '19:00'}` },
      ]
    : [{ scenario: 'time_19', label: 'Оплата' }];

  // Два признака независимы: эфиры решают, одна строка оплаты или две, а
  // предсписок — есть ли у воронки пятая строка вовсе (Phase 16). Умолчание
  // `true` повторяет довод hasTime: отсутствие контекста не снимает строку.
  return [
    { scenario: 'reg', label: 'Регистрация' },
    ...payment,
    { scenario: 'messenger', label: 'Мессенджер' },
    ...(hasPredspisok ? [{ scenario: 'predspisok' as const, label: 'Предсписок' }] : []),
  ];
}

/** Как теги склеиваются в буфер обмена по кнопке «Копировать все». */
export function joinTagsForCopy(names: string[]): string {
  return names.join('; ');
}

/**
 * Что редактор карточки отправляет в PATCH /api/funnels/[id]/tags.
 *
 * Роут частичный: сценарий, которого в теле НЕТ, сохраняет уже записанные
 * оверрайды, а названный с пустыми списками — очищается (см. route.ts). Отсюда
 * правило: у воронки со снятым предспиской сценарий из тела убирается.
 *
 * Иначе выходит тихая потеря. Редактор сидит свою рабочую копию оверрайдов из
 * ВЫЧИСЛЕННОГО набора (`seedOverrides` в FunnelIdentity), а у снятой воронки
 * он пуст по построению — `computeTagSet` не строит сценария вовсе. Значит в
 * теле оказался бы `predspisok: { add: [], remove: [] }`, и сохранение тегов с
 * любой другой вкладки стирало бы сохранённые оверрайды предсписка. Поднятая
 * обратно галка вернула бы набор уже без них — ровно вопреки обещанию «снял и
 * вернул — всё на месте».
 */
export function tagPatchBody(
  overrides: Record<Scenario, ScenarioOverride>,
  hasPredspisok: boolean,
): Partial<Record<Scenario, ScenarioOverride>> {
  if (hasPredspisok) return overrides;
  const { predspisok: _dropped, ...rest } = overrides;
  return rest;
}
