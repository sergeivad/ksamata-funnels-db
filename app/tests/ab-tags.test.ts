import { describe, test, it, expect } from 'vitest';
import {
  tagNamesToAxes,
  axisTagNames,
  isAxisTag,
  computeTagSet,
  SCENARIOS,
  type AbAxes,
  type TemplateMap,
  type OverrideMap,
} from '../src/lib/ab-tags';

const axes: AbAxes = { product: 'ТКМ', contractor: 'НИМБ', channel: 'Яндекс', direction: 'РСЯ' };

const emptyOverrides = (): OverrideMap => ({
  reg: { add: [], remove: [] },
  time_15: { add: [], remove: [] },
  time_19: { add: [], remove: [] },
  messenger: { add: [], remove: [] },
  predspisok: { add: [], remove: [] },
});

const template: TemplateMap = {
  reg: ['автоворонки', 'АВ Автоворонка', 'АВ Этап: Регистрация'],
  time_15: ['автоворонки', 'АВ Автоворонка', 'АВ Этап: Оплата', 'АВ Время: 15'],
  time_19: ['автоворонки', 'АВ Автоворонка', 'АВ Этап: Оплата', 'АВ Время: 19'],
  messenger: ['автоворонки', 'АВ Автоворонка', 'АВ Этап: Мессенджер'],
  predspisok: ['АВ Автоворонка', 'АВ Этап: Предписок'],
};

describe('axisTagNames', () => {
  test('emits one tag per non-empty axis', () => {
    expect(axisTagNames(axes)).toEqual([
      'АВ Продукт: ТКМ', 'АВ Подрядчик: НИМБ', 'АВ Канал: Яндекс', 'АВ Направление: РСЯ',
    ]);
  });
  test('omits empty axes', () => {
    expect(axisTagNames({ product: 'ТКМ', contractor: '', channel: '', direction: '' }))
      .toEqual(['АВ Продукт: ТКМ']);
  });
});

describe('isAxisTag', () => {
  test('true for axis-prefixed, false otherwise', () => {
    expect(isAxisTag('АВ Продукт: ТКМ')).toBe(true);
    expect(isAxisTag('автоворонки')).toBe(false);
    expect(isAxisTag('АВ Этап: Регистрация')).toBe(false);
  });
});

describe('computeTagSet', () => {
  test('reg = template then axis tags, all source-flagged', () => {
    const s = computeTagSet(template, axes, emptyOverrides());
    expect(s.reg.tags.map((t) => t.name)).toEqual([
      'автоворонки', 'АВ Автоворонка', 'АВ Этап: Регистрация',
      'АВ Продукт: ТКМ', 'АВ Подрядчик: НИМБ', 'АВ Канал: Яндекс', 'АВ Направление: РСЯ',
    ]);
    expect(s.reg.tags.find((t) => t.name === 'автоворонки')!.source).toBe('default');
    expect(s.reg.tags.find((t) => t.name === 'АВ Продукт: ТКМ')!.source).toBe('axis');
    expect(s.reg.suppressed).toEqual([]);
  });

  test('remove suppresses a default and lists it in suppressed', () => {
    const ov = emptyOverrides();
    ov.reg.remove = ['автоворонки'];
    const s = computeTagSet(template, axes, ov);
    expect(s.reg.tags.map((t) => t.name)).not.toContain('автоворонки');
    expect(s.reg.suppressed).toEqual(['автоворонки']);
  });

  test('add appends a custom tag at the end', () => {
    const ov = emptyOverrides();
    ov.reg.add = ['промо-январь'];
    const s = computeTagSet(template, axes, ov);
    const last = s.reg.tags[s.reg.tags.length - 1];
    expect(last).toEqual({ name: 'промо-январь', source: 'custom' });
  });

  test('remove of an axis tag is ignored (axes are non-suppressible)', () => {
    const ov = emptyOverrides();
    ov.reg.remove = ['АВ Продукт: ТКМ'];
    const s = computeTagSet(template, axes, ov);
    expect(s.reg.tags.map((t) => t.name)).toContain('АВ Продукт: ТКМ');
    expect(s.reg.suppressed).toEqual([]); // axis names never counted as suppressed
  });

  test('dedupes: an add equal to an existing default is not duplicated', () => {
    const ov = emptyOverrides();
    ov.reg.add = ['автоворонки'];
    const s = computeTagSet(template, axes, ov);
    expect(s.reg.tags.filter((t) => t.name === 'автоворонки')).toHaveLength(1);
  });

  test('covers all four scenarios', () => {
    const s = computeTagSet(template, axes, emptyOverrides());
    for (const sc of SCENARIOS) expect(s[sc].tags.length).toBeGreaterThan(0);
    expect(s.messenger.tags.map((t) => t.name)).toContain('АВ Этап: Мессенджер');
    expect(s.time_15.tags.map((t) => t.name)).toContain('АВ Время: 15');
  });

  test('an axis-prefixed template static is not emitted as a chip (axis layer only)', () => {
    const badTemplate: TemplateMap = {
      ...template,
      reg: [...template.reg, 'АВ Продукт: СЛУЧАЙНЫЙ'],
    };
    const s = computeTagSet(badTemplate, axes, emptyOverrides());
    // The real axis value still comes through once, from the axis layer.
    expect(s.reg.tags.filter((t) => t.name.startsWith('АВ Продукт: '))).toEqual([
      { name: 'АВ Продукт: ТКМ', source: 'axis' },
    ]);
    expect(s.reg.tags.map((t) => t.name)).not.toContain('АВ Продукт: СЛУЧАЙНЫЙ');
  });

  test('an add of an axis-prefixed name is dropped (axis layer still emits the real value)', () => {
    const ov = emptyOverrides();
    ov.reg.add = ['АВ Продукт: WRONG'];
    const s = computeTagSet(template, axes, ov);
    expect(s.reg.tags.map((t) => t.name)).not.toContain('АВ Продукт: WRONG');
    expect(s.reg.tags.find((t) => t.name === 'АВ Продукт: ТКМ')).toEqual({
      name: 'АВ Продукт: ТКМ',
      source: 'axis',
    });
  });
});

describe('tagNamesToAxes (unchanged)', () => {
  test('round-trips axis tags', () => {
    expect(tagNamesToAxes(['АВ Продукт: ТКМ', 'АВ Канал: Яндекс', 'автоворонки']))
      .toEqual({ product: 'ТКМ', contractor: '', channel: 'Яндекс', direction: '' });
  });
});

describe('пятая ось: маркер типа воронки', () => {
  const axes = { product: 'ЖИВО', contractor: 'НИМБ', channel: 'Яндекс', direction: 'РСЯ' };
  const empty = { reg: { add: [], remove: [] }, time_15: { add: [], remove: [] },
                  time_19: { add: [], remove: [] }, messenger: { add: [], remove: [] },
                  predspisok: { add: [], remove: [] } };
  const known = ['АВ Автоворонка', 'АВ Прямые', 'АВ Квиз', 'АВ Квиз-Лайт'];
  const tpl = { reg: [], time_15: [], time_19: [], messenger: [], predspisok: [] };

  it('кладёт маркер во все сценарии как axis', () => {
    const out = computeTagSet(tpl, axes, empty, { name: 'АВ Квиз', known });
    for (const s of SCENARIOS) {
      const chip = out[s].tags.find((t) => t.name === 'АВ Квиз');
      expect(chip, `сценарий ${s}`).toBeDefined();
      expect(chip!.source).toBe('axis');
    }
  });

  it('без типа маркера нет вовсе', () => {
    const out = computeTagSet(tpl, axes, empty, { name: null, known });
    expect(out.reg.tags.some((t) => known.includes(t.name))).toBe(false);
  });

  it('гасит чужой маркер, пришедший из шаблона', () => {
    const withAuto = { ...tpl, reg: ['АВ Автоворонка', 'допродажи'] };
    const out = computeTagSet(withAuto, axes, empty, { name: 'АВ Квиз', known });
    const names = out.reg.tags.map((t) => t.name);
    expect(names).toContain('АВ Квиз');
    expect(names).not.toContain('АВ Автоворонка');
    expect(names).toContain('допродажи');
  });

  it('гасит маркер, пришедший через add-оверрайд', () => {
    const ov = { ...empty, reg: { add: ['АВ Прямые'], remove: [] } };
    const out = computeTagSet(tpl, axes, ov, { name: 'АВ Квиз', known });
    expect(out.reg.tags.map((t) => t.name)).not.toContain('АВ Прямые');
  });

  it('свой маркер неудаляем через remove-оверрайд', () => {
    // Маркер должен реально лежать в staticTags сценария и быть целью remove —
    // иначе suppressed вычисляется от пустого массива и проверка ничего не ловит.
    const tplWithMarker = { ...tpl, reg: ['АВ Квиз'] };
    const ov = { ...empty, reg: { add: [], remove: ['АВ Квиз'] } };
    const out = computeTagSet(tplWithMarker, axes, ov, { name: 'АВ Квиз', known });
    expect(out.reg.tags.map((t) => t.name)).toContain('АВ Квиз');
    expect(out.reg.suppressed).not.toContain('АВ Квиз');
  });

  it('маркер уже в собственном шаблоне не даёт дубль с source default', () => {
    // Ровно сегодняшнее состояние базы: «АВ Автоворонка» зашит в шаблон всем
    // воронкам, и воронка типа «Автоворонка» встречает свой же маркер в
    // своём же шаблоне. Должен остаться один чип, и его source — 'axis'
    // (из безусловного пуша маркера), а не 'default' (из статического слоя).
    const tplWithMarker = { ...tpl, reg: ['АВ Квиз'] };
    const out = computeTagSet(tplWithMarker, axes, empty, { name: 'АВ Квиз', known });
    const chips = out.reg.tags.filter((t) => t.name === 'АВ Квиз');
    expect(chips).toHaveLength(1);
    expect(chips[0].source).toBe('axis');
  });
});

describe('время у типа без эфиров', () => {
  const empty: OverrideMap = { reg: { add: [], remove: [] }, time_15: { add: [], remove: [] },
    time_19: { add: [], remove: [] }, messenger: { add: [], remove: [] },
    predspisok: { add: [], remove: [] } };
  const known = ['АВ Автоворонка', 'АВ Прямые', 'АВ Квиз', 'АВ Квиз-Лайт'];
  const timeless = { name: 'АВ Прямые', known, hasTime: false };

  it('снимает тег времени из шаблона в обоих сценариях оплаты', () => {
    const out = computeTagSet(template, axes, empty, timeless);
    expect(out.time_15.tags.map((t) => t.name)).not.toContain('АВ Время: 15');
    expect(out.time_19.tags.map((t) => t.name)).not.toContain('АВ Время: 19');
    // Остальной шаблон на месте — гасится только время.
    expect(out.time_15.tags.map((t) => t.name)).toContain('АВ Этап: Оплата');
  });

  it('оба сценария оплаты становятся одинаковыми', () => {
    const out = computeTagSet(template, axes, empty, timeless);
    expect(out.time_15.tags.map((t) => t.name)).toEqual(out.time_19.tags.map((t) => t.name));
  });

  it('тег времени не показывается как скрытый дефолт — его нельзя вернуть', () => {
    const out = computeTagSet(template, axes, empty, timeless);
    expect(out.time_15.suppressed).not.toContain('АВ Время: 15');
    expect(out.time_19.suppressed).not.toContain('АВ Время: 19');
  });

  it('не даёт добавить время через add-оверрайд', () => {
    const ov = { ...empty, time_19: { add: ['АВ Время: 17'], remove: [] } };
    const out = computeTagSet(template, axes, ov, timeless);
    expect(out.time_19.tags.map((t) => t.name)).not.toContain('АВ Время: 17');
  });

  it('при hasTime = true время на месте', () => {
    const out = computeTagSet(template, axes, empty, { name: 'АВ Автоворонка', known, hasTime: true });
    expect(out.time_15.tags.map((t) => t.name)).toContain('АВ Время: 15');
    expect(out.time_19.tags.map((t) => t.name)).toContain('АВ Время: 19');
  });

  it('без указания типа время остаётся — «тип не выбран» это не «времени нет»', () => {
    const out = computeTagSet(template, axes, empty, { name: null, known });
    expect(out.time_15.tags.map((t) => t.name)).toContain('АВ Время: 15');
  });

  it('время без указания типа остаётся и при вызове вовсе без контекста', () => {
    const out = computeTagSet(template, axes, empty);
    expect(out.time_19.tags.map((t) => t.name)).toContain('АВ Время: 19');
  });
});
