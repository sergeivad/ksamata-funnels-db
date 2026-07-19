import { describe, test, expect } from 'vitest';
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
});

const template: TemplateMap = {
  reg: ['автоворонки', 'АВ Автоворонка', 'АВ Этап: Регистрация'],
  time_15: ['автоворонки', 'АВ Автоворонка', 'АВ Этап: Оплата', 'АВ Время: 15'],
  time_19: ['автоворонки', 'АВ Автоворонка', 'АВ Этап: Оплата', 'АВ Время: 19'],
  messenger: ['автоворонки', 'АВ Автоворонка', 'АВ Этап: Мессенджер'],
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
