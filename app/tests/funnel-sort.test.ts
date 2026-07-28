import { describe, it, expect } from 'vitest';
import { frontCodeNum, compareByFrontCodeDesc } from '../src/lib/funnel-sort';

function codes(items: { num: number; frontCode: string }[]): string[] {
  return [...items].sort(compareByFrontCodeDesc).map((f) => f.frontCode || `—${f.num}`);
}

describe('frontCodeNum', () => {
  it('извлекает номер из f-кода', () => {
    expect(frontCodeNum('f7')).toBe(7);
    expect(frontCodeNum('f70')).toBe(70);
    expect(frontCodeNum(' f12 ')).toBe(12);
  });

  it('пустой или неразбираемый код — null', () => {
    expect(frontCodeNum('')).toBeNull();
    expect(frontCodeNum('   ')).toBeNull();
    expect(frontCodeNum('f')).toBeNull();
    expect(frontCodeNum('сайт')).toBeNull();
    expect(frontCodeNum('f12b')).toBeNull();
  });
});

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
