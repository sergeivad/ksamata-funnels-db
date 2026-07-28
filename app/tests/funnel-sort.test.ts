import { describe, it, expect } from 'vitest';
import { compareByFrontCodeAsc, compareByFrontCodeDesc } from '../src/lib/funnel-sort';

function codes(items: { num: number; frontCode: string }[]): string[] {
  return [...items].sort(compareByFrontCodeDesc).map((f) => f.frontCode || `—${f.num}`);
}

// frontCodeNum переехал в lib/front-code.ts — его тесты там же.

describe('compareByFrontCodeDesc', () => {
  it('сортирует по номеру F по убыванию, а не как строки', () => {
    // Лексикографически 'f9' > 'f70' > 'f12' — числовой порядок должен победить.
    expect(codes([
      { num: 1, frontCode: 'f9' },
      { num: 2, frontCode: 'f70' },
      { num: 3, frontCode: 'f12' },
    ])).toEqual(['f70', 'f12', 'f9']);
  });

  it('воронки без кода уходят в конец', () => {
    expect(codes([
      { num: 10, frontCode: '' },
      { num: 11, frontCode: 'f11' },
      { num: 14, frontCode: '' },
      { num: 50, frontCode: 'f51' },
    ])).toEqual(['f51', 'f11', '—14', '—10']);
  });

  it('среди бескодовых — по num по убыванию', () => {
    expect(codes([
      { num: 17, frontCode: '' },
      { num: 29, frontCode: '' },
      { num: 4, frontCode: '' },
    ])).toEqual(['—29', '—17', '—4']);
  });

  it('при одинаковом коде тай-брейк по num по убыванию', () => {
    const sorted = [
      { num: 3, frontCode: 'f36' },
      { num: 8, frontCode: 'f36' },
    ].sort(compareByFrontCodeDesc);
    expect(sorted.map((f) => f.num)).toEqual([8, 3]);
  });

  it('порядок не зависит от исходного (сортировка тотальная)', () => {
    const items = [
      { num: 5, frontCode: 'f50' },
      { num: 4, frontCode: '' },
      { num: 1, frontCode: 'f37' },
      { num: 10, frontCode: '' },
      { num: 6, frontCode: 'f6' },
    ];
    const forward = codes(items);
    const backward = codes([...items].reverse());
    expect(forward).toEqual(backward);
    expect(forward).toEqual(['f50', 'f37', 'f6', '—10', '—4']);
  });
});

describe('compareByFrontCodeAsc', () => {
  const asc = (items: { num: number; frontCode: string }[]): string[] =>
    [...items].sort(compareByFrontCodeAsc).map((f) => f.frontCode || `—${f.num}`);

  it('сортирует по номеру F по возрастанию, а не как строки', () => {
    expect(asc([
      { num: 1, frontCode: 'f9' },
      { num: 2, frontCode: 'f70' },
      { num: 3, frontCode: 'f12' },
    ])).toEqual(['f9', 'f12', 'f70']);
  });

  it('бескодовые в конце — это не зеркало Desc', () => {
    // Наивное `-compareByFrontCodeDesc(a,b)` вынесло бы их вперёд.
    expect(asc([
      { num: 10, frontCode: '' },
      { num: 11, frontCode: 'f11' },
      { num: 50, frontCode: 'f51' },
    ])).toEqual(['f11', 'f51', '—10']);
  });
});
