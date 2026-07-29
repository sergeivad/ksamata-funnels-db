import { describe, it, expect } from 'vitest';
import {
  frontCodeNum,
  funnelRefLabel,
  nextFrontCode,
  normalizeFrontCode,
} from '../src/lib/front-code';

describe('normalizeFrontCode', () => {
  it('приводит к канону: без пробелов, в нижнем регистре', () => {
    expect(normalizeFrontCode(' F80 ')).toBe('f80');
    expect(normalizeFrontCode('f80')).toBe('f80');
  });

  it('пустая строка остаётся пустой — «кода нет» законно', () => {
    expect(normalizeFrontCode('')).toBe('');
    expect(normalizeFrontCode('   ')).toBe('');
  });
});

describe('frontCodeNum', () => {
  it('извлекает номер из f-кода', () => {
    expect(frontCodeNum('f7')).toBe(7);
    expect(frontCodeNum('f70')).toBe(70);
    expect(frontCodeNum(' f12 ')).toBe(12);
    expect(frontCodeNum('F12')).toBe(12);
  });

  it('пустой или неразбираемый код — null', () => {
    expect(frontCodeNum('')).toBeNull();
    expect(frontCodeNum('   ')).toBeNull();
    expect(frontCodeNum('f')).toBeNull();
    expect(frontCodeNum('сайт')).toBeNull();
    expect(frontCodeNum('f12b')).toBeNull();
  });

  it('небезопасно большое число — тоже null', () => {
    // Иначе nextFrontCode унесло бы в 1e21, откуда кода уже не собрать.
    expect(frontCodeNum('f99999999999999999999')).toBeNull();
  });
});

describe('nextFrontCode', () => {
  it('на единицу выше максимума КОДОВ', () => {
    expect(nextFrontCode(['f6', 'f79', 'f53'])).toBe('f80');
  });

  it('дыры в нумерации не занимает — это чужие номера ЛИК', () => {
    // f10/f14/f17/f18/f20/f44/f49 в ЛИК не существуют, но выдать их нельзя:
    // ЛИК может назначить их в любой момент.
    expect(nextFrontCode(['f9', 'f11', 'f79'])).toBe('f80');
  });

  it('бескодовые и мусор игнорируются', () => {
    expect(nextFrontCode(['', '   ', 'сайт', 'f5'])).toBe('f6');
  });

  it('на пустой базе начинает с f1', () => {
    expect(nextFrontCode([])).toBe('f1');
    expect(nextFrontCode(['', ''])).toBe('f1');
  });

  it('регистр не создаёт вторую последовательность', () => {
    expect(nextFrontCode(['F79'])).toBe('f80');
  });
});

describe('funnelRefLabel', () => {
  it('код, когда он есть', () => {
    expect(funnelRefLabel({ frontCode: 'f70', id: 64 })).toBe('f70');
  });

  it('без кода — id из ссылки, а не num', () => {
    expect(funnelRefLabel({ frontCode: '', id: 4 })).toBe('#4');
  });
});
