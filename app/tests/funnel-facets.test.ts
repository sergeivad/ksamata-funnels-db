import { describe, test, expect } from 'vitest';
import type { AbAxes } from '../src/lib/ab-tags';
import {
  AXIS_ORDER,
  NO_AXIS_VALUE,
  isGroupBy,
  hasAxisFilter,
  matchesFilters,
  nextGroupAxis,
  drillInto,
  clearAxis,
  axisOptions,
  buildGroups,
  type AxisFilters,
} from '../src/lib/funnel-facets';

function funnel(code: string, product: string, contractor: string, channel: string, direction: string) {
  const axes: AbAxes = { product, contractor, channel, direction };
  return { frontCode: code, axes };
}

// Снимок живой базы: этого хватает, чтобы проверить и пересечение осей,
// и счётчики. Значения настоящие — f22/f24/f91 действительно БОО Алексея.
const ITEMS = [
  funnel('f91', 'БОО', 'Алексей', 'Яндекс', 'Квиз'),
  funnel('f82', 'БОО', 'Внутренний', 'Перелив', 'С ДБО'),
  funnel('f24', 'БОО', 'Алексей', 'Яндекс', 'Ретаргет'),
  funnel('f22', 'БОО', 'Алексей', 'Яндекс', 'Реклама'),
  funnel('f11', 'ДБО', 'NR', 'ВК', 'In Stream'),
  funnel('f99', '', '', '', ''),
];

describe('isGroupBy', () => {
  test('принимает все четыре оси и «без группировки»', () => {
    for (const axis of AXIS_ORDER) expect(isGroupBy(axis)).toBe(true);
    expect(isGroupBy('none')).toBe(true);
  });

  /**
   * В localStorage под ключом `funnels.groupBy` у людей уже лежат значения
   * прежней пары кнопок. Перестать их принимать — значит молча сбросить
   * группировку у всех, кто её когда-то выбирал.
   */
  test('сохранённые значения прежней пары кнопок остаются валидными', () => {
    expect(isGroupBy('contractor')).toBe(true);
    expect(isGroupBy('product')).toBe(true);
  });

  test('мусор отвергает', () => {
    expect(isGroupBy('status')).toBe(false);
    expect(isGroupBy(null)).toBe(false);
  });
});

describe('hasAxisFilter', () => {
  /**
   * Пустая строка — законное значение фильтра («воронки без продукта»),
   * поэтому проверять надо наличие ключа, а не истинность значения.
   */
  test('фильтр по пустому значению считается поставленным', () => {
    expect(hasAxisFilter({ product: '' }, 'product')).toBe(true);
    expect(hasAxisFilter({}, 'product')).toBe(false);
  });
});

describe('matchesFilters', () => {
  test('пустой набор фильтров пропускает всё', () => {
    for (const item of ITEMS) expect(matchesFilters(item.axes, {})).toBe(true);
  });

  test('условия по разным осям перемножаются', () => {
    const filters: AxisFilters = { product: 'БОО', contractor: 'Алексей' };
    const passed = ITEMS.filter((f) => matchesFilters(f.axes, filters)).map((f) => f.frontCode);
    expect(passed).toEqual(['f91', 'f24', 'f22']);
  });

  test('фильтр по пустому значению находит воронку без этой оси', () => {
    const passed = ITEMS.filter((f) => matchesFilters(f.axes, { product: '' })).map((f) => f.frontCode);
    expect(passed).toEqual(['f99']);
  });
});

describe('nextGroupAxis', () => {
  test('без фильтров группировка начинается с продукта', () => {
    expect(nextGroupAxis({})).toBe('product');
  });

  /**
   * Суть drill-down: ось, по которой фильтр уже стоит, группировать
   * бессмысленно — групп осталась бы ровно одна и нажимать было бы нечего.
   */
  test('занятые фильтром оси пропускаются в фиксированном порядке', () => {
    expect(nextGroupAxis({ product: 'БОО' })).toBe('contractor');
    expect(nextGroupAxis({ product: 'БОО', contractor: 'Алексей' })).toBe('channel');
    expect(nextGroupAxis({ contractor: 'Алексей' })).toBe('product');
  });

  test('когда заняты все четыре оси — группировать нечего', () => {
    expect(
      nextGroupAxis({ product: 'БОО', contractor: 'Алексей', channel: 'Яндекс', direction: 'Квиз' })
    ).toBe('none');
  });
});

describe('drillInto', () => {
  test('ставит фильтр и переводит группировку на следующую свободную ось', () => {
    const step = drillInto({}, 'product', 'product', 'БОО');
    expect(step.filters).toEqual({ product: 'БОО' });
    expect(step.group).toBe('contractor');
  });

  test('второй шаг сужает выдачу, не теряя первый фильтр', () => {
    const first = drillInto({}, 'product', 'product', 'БОО');
    const second = drillInto(first.filters, first.group, 'contractor', 'Алексей');
    expect(second.filters).toEqual({ product: 'БОО', contractor: 'Алексей' });
    expect(second.group).toBe('channel');
  });

  /**
   * Группировка переходит только тогда, когда фильтруют ту самую ось, по
   * которой человек сейчас смотрит разбивку: только у неё после фильтра
   * остаётся ровно одна группа. Фильтр по любой другой оси вид не дёргает.
   */
  test('фильтр по чужой оси группировку не трогает', () => {
    const step = drillInto({}, 'contractor', 'product', 'БОО');
    expect(step.filters).toEqual({ product: 'БОО' });
    expect(step.group).toBe('contractor');
  });

  test('«без группировки» — решение человека, drill-down его не отменяет', () => {
    const step = drillInto({}, 'none', 'product', 'БОО');
    expect(step.group).toBe('none');
  });

  /**
   * Повтор того же значения читается как отмена: фильтр снимается, а
   * группировка возвращается на освободившуюся ось, иначе человек остался бы
   * смотреть на разбивку по оси, которую только что отпустил.
   */
  test('повтор того же значения снимает фильтр и возвращает группировку на эту ось', () => {
    const step = drillInto({ product: 'БОО' }, 'contractor', 'product', 'БОО');
    expect(step.filters).toEqual({});
    expect(step.group).toBe('product');
  });

  test('другое значение той же оси заменяет фильтр, а не добавляет второй', () => {
    const step = drillInto({ product: 'БОО' }, 'contractor', 'product', 'ДБО');
    expect(step.filters).toEqual({ product: 'ДБО' });
  });

  test('исходный набор фильтров не меняется', () => {
    const before: AxisFilters = { product: 'БОО' };
    drillInto(before, 'product', 'contractor', 'Алексей');
    expect(before).toEqual({ product: 'БОО' });
  });
});

describe('clearAxis', () => {
  test('снимает фильтр и возвращает группировку на освободившуюся ось', () => {
    const step = clearAxis({ product: 'БОО', contractor: 'Алексей' }, 'channel', 'contractor');
    expect(step.filters).toEqual({ product: 'БОО' });
    expect(step.group).toBe('contractor');
  });

  /**
   * Освободившаяся ось забирает группировку, только если она теперь первая
   * свободная, — иначе снятие внутреннего фильтра перепрыгивало бы человека
   * через ось, на которой он стоял.
   */
  test('группировка остаётся на месте, если свободна более крупная ось', () => {
    const step = clearAxis({ contractor: 'Алексей' }, 'product', 'contractor');
    expect(step.group).toBe('product');
  });

  test('«без группировки» сохраняется и при снятии фильтра', () => {
    expect(clearAxis({ product: 'БОО' }, 'none', 'product').group).toBe('none');
  });
});

describe('axisOptions', () => {
  test('значения идут по алфавиту и несут счётчик', () => {
    expect(axisOptions(ITEMS, {}, 'product')).toEqual([
      { value: 'БОО', label: 'БОО', count: 4 },
      { value: 'ДБО', label: 'ДБО', count: 1 },
      { value: '', label: NO_AXIS_VALUE, count: 1 },
    ]);
  });

  /**
   * Счётчики учитывают остальные фильтры, но НЕ свой собственный: иначе в
   * открытом меню осталась бы одна строка — та, что уже выбрана, — и сменить
   * значение оси было бы нельзя, только снять.
   */
  test('свой фильтр в подсчёте не участвует, чужие участвуют', () => {
    const filters: AxisFilters = { product: 'БОО', contractor: 'Алексей' };
    expect(axisOptions(ITEMS, filters, 'contractor')).toEqual([
      { value: 'Алексей', label: 'Алексей', count: 3 },
      { value: 'Внутренний', label: 'Внутренний', count: 1 },
    ]);
    expect(axisOptions(ITEMS, filters, 'product')).toEqual([
      { value: 'БОО', label: 'БОО', count: 3 },
    ]);
  });

  test('воронка без значения оси собирается в отдельный пункт в конце', () => {
    const options = axisOptions(ITEMS, {}, 'contractor');
    expect(options[options.length - 1]).toEqual({ value: '', label: NO_AXIS_VALUE, count: 1 });
  });
});

describe('buildGroups', () => {
  test('группы по алфавиту, пустое значение — в конце', () => {
    expect(buildGroups(ITEMS, 'product').map((g) => [g.label, g.funnels.length])).toEqual([
      ['БОО', 4],
      ['ДБО', 1],
      [NO_AXIS_VALUE, 1],
    ]);
  });

  /**
   * Порядок внутри группы задаёт вызывающая сторона (список уже отсортирован
   * по F-коду), поэтому группировка обязана его сохранять, а не пересортировывать.
   */
  test('порядок воронок внутри группы сохраняется', () => {
    const boo = buildGroups(ITEMS, 'product')[0];
    expect(boo.funnels.map((f) => f.frontCode)).toEqual(['f91', 'f82', 'f24', 'f22']);
  });

  test('группа несёт исходное значение оси, а не подпись', () => {
    const last = buildGroups(ITEMS, 'product').at(-1);
    expect(last?.value).toBe('');
    expect(last?.label).toBe(NO_AXIS_VALUE);
  });
});
