import { describe, it, expect } from 'vitest';
import { scenarioViews, joinTagsForCopy, tagPatchBody } from '../src/lib/tag-scenarios';
import { SCENARIOS } from '../src/lib/ab-tags';

describe('scenarioViews', () => {
  it('у вебинарной воронки строки идут в каноническом порядке', () => {
    const views = scenarioViews(true, '15:00', '19:00');
    expect(views.map((v) => v.scenario)).toEqual(SCENARIOS);
    expect(views.map((v) => v.label)).toEqual([
      'Регистрация', 'Оплата 15:00', 'Оплата 19:00', 'Мессенджер', 'Предсписок',
    ]);
  });

  it('подписи слотов берутся из воронки, а не из констант', () => {
    const views = scenarioViews(true, '11:00', '20:30');
    expect(views.map((v) => v.label)).toContain('Оплата 11:00');
    expect(views.map((v) => v.label)).toContain('Оплата 20:30');
  });

  it('пустая подпись слота подменяется умолчанием, а не оставляет «Оплата »', () => {
    const views = scenarioViews(true, '', '');
    expect(views.map((v) => v.label)).toEqual([
      'Регистрация', 'Оплата 15:00', 'Оплата 19:00', 'Мессенджер', 'Предсписок',
    ]);
  });

  it('у безвременной воронки одна строка оплаты — от time_19', () => {
    const views = scenarioViews(false, '15:00', '19:00');
    expect(views.map((v) => v.scenario)).toEqual(['reg', 'time_19', 'messenger', 'predspisok']);
    expect(views.map((v) => v.label)).toEqual(['Регистрация', 'Оплата', 'Мессенджер', 'Предсписок']);
  });

  it('у воронки без предсписка строки предсписка нет вовсе', () => {
    const views = scenarioViews(true, '15:00', '19:00', false);
    expect(views.map((v) => v.scenario)).toEqual(['reg', 'time_15', 'time_19', 'messenger']);
    expect(views.map((v) => v.label)).not.toContain('Предсписок');
  });

  it('признак предсписка не зависит от эфиров — у безвременной он снимается так же', () => {
    const views = scenarioViews(false, '15:00', '19:00', false);
    expect(views.map((v) => v.scenario)).toEqual(['reg', 'time_19', 'messenger']);
  });

  it('умолчание — предсписок есть: старые вызовы без признака не меняются', () => {
    expect(scenarioViews(true, '15:00', '19:00').map((v) => v.scenario)).toEqual(SCENARIOS);
    expect(scenarioViews(false, '15:00', '19:00').map((v) => v.scenario))
      .toEqual(['reg', 'time_19', 'messenger', 'predspisok']);
  });
});


describe('joinTagsForCopy', () => {
  it('склеивает через «; » — так теги вставляются в GetCourse', () => {
    expect(joinTagsForCopy(['а', 'б'])).toBe('а; б');
  });
  it('пустой набор даёт пустую строку, а не разделитель', () => {
    expect(joinTagsForCopy([])).toBe('');
  });
});

/**
 * Тело PATCH /api/funnels/[id]/tags — частичное: сценарий, которого в теле нет,
 * сохраняет уже записанные оверрайды (см. route.ts). Значит у воронки со снятым
 * предспиской сценарий надо ИЗ ТЕЛА УБРАТЬ: карточка сидит редактор из
 * вычисленного набора, а он пуст, и отправка `{add:[],remove:[]}` затёрла бы
 * сохранённые оверрайды — молча, при сохранении тегов с любой другой вкладки.
 */
describe('tagPatchBody', () => {
  const ov = {
    reg: { add: ['рег'], remove: [] },
    time_15: { add: [], remove: [] },
    time_19: { add: [], remove: [] },
    messenger: { add: [], remove: [] },
    predspisok: { add: [], remove: [] },
  };

  it('у воронки с предпиской отправляются все пять сценариев', () => {
    expect(Object.keys(tagPatchBody(ov, true)).sort()).toEqual(
      ['messenger', 'predspisok', 'reg', 'time_15', 'time_19'],
    );
  });

  it('у воронки без предсписка сценарий не отправляется вовсе', () => {
    const body = tagPatchBody(ov, false);
    expect('predspisok' in body).toBe(false);
    expect(Object.keys(body).sort()).toEqual(['messenger', 'reg', 'time_15', 'time_19']);
  });

  it('остальные сценарии не искажаются', () => {
    expect(tagPatchBody(ov, false).reg).toEqual({ add: ['рег'], remove: [] });
  });
});
