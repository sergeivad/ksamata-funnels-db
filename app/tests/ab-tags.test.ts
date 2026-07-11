import { describe, test, expect } from 'vitest';
import { axesToTagNames, tagNamesToAxes, type AbAxes } from '../src/lib/ab-tags';

const axes: AbAxes = { product: 'ТКМ', contractor: 'НИМБ', channel: 'Яндекс', direction: 'РСЯ' };

describe('axesToTagNames', () => {
  test('builds reg tags with all 4 axis tags and reg stage tag', () => {
    const r = axesToTagNames(axes);
    expect(r.reg).toContain('АВ Продукт: ТКМ');
    expect(r.reg).toContain('АВ Подрядчик: НИМБ');
    expect(r.reg).toContain('АВ Канал: Яндекс');
    expect(r.reg).toContain('АВ Направление: РСЯ');
    expect(r.reg).toContain('АВ Автоворонка');
    expect(r.reg).toContain('АВ Этап: Регистрация');
  });

  test('builds time19 tags with time19 tag and payment stage tag', () => {
    const r = axesToTagNames(axes);
    expect(r.time19).toContain('АВ Время: 19');
    expect(r.time19).toContain('АВ Этап: Оплата');
    expect(r.time19).toContain('АВ Автоворонка');
    expect(r.time19).toContain('АВ Продукт: ТКМ');
    expect(r.time19).toContain('АВ Подрядчик: НИМБ');
    expect(r.time19).toContain('АВ Канал: Яндекс');
    expect(r.time19).toContain('АВ Направление: РСЯ');
  });

  test('builds time15 tags with time15 tag and payment stage tag', () => {
    const r = axesToTagNames(axes);
    expect(r.time15).toContain('АВ Время: 15');
    expect(r.time15).toContain('АВ Этап: Оплата');
    expect(r.time15).toContain('АВ Автоворонка');
    expect(r.time15).toContain('АВ Продукт: ТКМ');
    expect(r.time15).toContain('АВ Подрядчик: НИМБ');
    expect(r.time15).toContain('АВ Канал: Яндекс');
    expect(r.time15).toContain('АВ Направление: РСЯ');
  });

  test('reg does not contain time tags, time slots do not contain reg stage tag', () => {
    const r = axesToTagNames(axes);
    expect(r.reg).not.toContain('АВ Время: 19');
    expect(r.reg).not.toContain('АВ Время: 15');
    expect(r.reg).not.toContain('АВ Этап: Оплата');
    expect(r.time19).not.toContain('АВ Этап: Регистрация');
    expect(r.time15).not.toContain('АВ Этап: Регистрация');
  });

  test('omits placeholder tags for empty axes (no "АВ Продукт: " pollution)', () => {
    const r = axesToTagNames({ product: '', contractor: '', channel: '', direction: 'РСЯ' });
    // Present axis is emitted…
    expect(r.reg).toContain('АВ Направление: РСЯ');
    // …empty axes produce NO tag (not even the bare prefix)
    expect(r.reg).not.toContain('АВ Продукт: ');
    expect(r.reg).not.toContain('АВ Подрядчик: ');
    expect(r.reg).not.toContain('АВ Канал: ');
    expect(r.reg.some((t) => t === 'АВ Продукт: ' || t.startsWith('АВ Продукт: '))).toBe(false);
  });

  test('whitespace-only axis is treated as empty', () => {
    const r = axesToTagNames({ product: '   ', contractor: 'НИМБ', channel: '', direction: '' });
    expect(r.reg).toContain('АВ Подрядчик: НИМБ');
    expect(r.reg.some((t) => t.startsWith('АВ Продукт:'))).toBe(false);
  });
});

describe('tagNamesToAxes', () => {
  test('is inverse of axesToTagNames (round-trip)', () => {
    expect(tagNamesToAxes(axesToTagNames(axes).reg)).toEqual(axes);
  });

  test('ignores non-axis tags', () => {
    const tags = [
      'АВ Продукт: ТКМ',
      'АВ Подрядчик: НИМБ',
      'АВ Канал: Яндекс',
      'АВ Направление: РСЯ',
      'АВ Автоворонка',
      'АВ Этап: Регистрация',
      'some-other-tag',
    ];
    expect(tagNamesToAxes(tags)).toEqual(axes);
  });

  test('missing axis returns empty string for that field', () => {
    const tags = ['АВ Продукт: ТКМ', 'АВ Канал: Яндекс'];
    expect(tagNamesToAxes(tags)).toEqual({
      product: 'ТКМ',
      contractor: '',
      channel: 'Яндекс',
      direction: '',
    });
  });

  test('empty array returns all empty strings', () => {
    expect(tagNamesToAxes([])).toEqual({
      product: '',
      contractor: '',
      channel: '',
      direction: '',
    });
  });
});
