import { describe, it, expect } from 'vitest';
import { scenarioViews, joinTagsForCopy } from '../src/lib/tag-scenarios';
import { SCENARIOS } from '../src/lib/ab-tags';

describe('scenarioViews', () => {
  it('у вебинарной воронки четыре строки в каноническом порядке', () => {
    const views = scenarioViews(true, '15:00', '19:00');
    expect(views.map((v) => v.scenario)).toEqual(SCENARIOS);
    expect(views.map((v) => v.label)).toEqual([
      'Регистрация', 'Оплата 15:00', 'Оплата 19:00', 'Мессенджер',
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
      'Регистрация', 'Оплата 15:00', 'Оплата 19:00', 'Мессенджер',
    ]);
  });

  it('у безвременной воронки одна строка оплаты — от time_19', () => {
    const views = scenarioViews(false, '15:00', '19:00');
    expect(views.map((v) => v.scenario)).toEqual(['reg', 'time_19', 'messenger']);
    expect(views.map((v) => v.label)).toEqual(['Регистрация', 'Оплата', 'Мессенджер']);
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
