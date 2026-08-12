import { describe, it, expect } from 'vitest';
import {
  frontCodeNum,
  funnelHref,
  funnelRefLabel,
  nextFrontCode,
  normalizeFrontCode,
  parseFunnelRef,
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

describe('parseFunnelRef', () => {
  it('F-код — канон адреса, регистр приводится', () => {
    expect(parseFunnelRef('f86')).toEqual({ kind: 'code', code: 'f86' });
    expect(parseFunnelRef('F86')).toEqual({ kind: 'code', code: 'f86' });
  });

  it('чистые цифры — это id, а не код', () => {
    expect(parseFunnelRef('83')).toEqual({ kind: 'id', id: 83 });
    // Ведущие нули законны как id: страница потом уведёт на канон.
    expect(parseFunnelRef('083')).toEqual({ kind: 'id', id: 83 });
  });

  it('f086 — код, а не id: в базе лежит f86, это другая строка', () => {
    expect(parseFunnelRef('f086')).toEqual({ kind: 'code', code: 'f086' });
  });

  it('всё непонятное — null, то есть 404', () => {
    for (const raw of ['', '   ', 'f', 'abc', 'f86x', 'x86', '8 6', '-1', '1.5']) {
      expect(parseFunnelRef(raw), raw).toBeNull();
    }
  });

  it('небезопасно большое число — null, иначе id уедет в Infinity', () => {
    expect(parseFunnelRef('9'.repeat(25))).toBeNull();
  });
});

describe('funnelHref', () => {
  it('с кодом — адрес по коду', () => {
    expect(funnelHref({ frontCode: 'f86', id: 83 })).toBe('/funnels/f86');
  });

  it('без кода — числовой адрес, как и подпись funnelRefLabel', () => {
    expect(funnelHref({ frontCode: '', id: 83 })).toBe('/funnels/83');
    expect(funnelRefLabel({ frontCode: '', id: 83 })).toBe('#83');
  });

  it('разбор собственного адреса возвращает то же самое — пара обратима', () => {
    for (const f of [{ frontCode: 'f86', id: 83 }, { frontCode: '', id: 83 }]) {
      const seg = funnelHref(f).replace('/funnels/', '');
      const parsed = parseFunnelRef(seg);
      expect(parsed, seg).not.toBeNull();
      expect(parsed!.kind === 'code' ? parsed!.code : String(parsed!.id))
        .toBe(f.frontCode || String(f.id));
    }
  });
});
