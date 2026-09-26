import { describe, it, expect } from 'vitest';
import { leakPillState } from '../src/lib/leak-pill';

describe('пилюля ЛИК в списке', () => {
  it('заведённая воронка — «ЛИК» в любом статусе', () => {
    for (const status of ['active', 'draft', 'archive']) {
      expect(leakPillState({ inLeak: true, status, blank: false })).toBe('in');
    }
  });

  it('незаведённая активная или черновик с осями — «нет в ЛИК»', () => {
    expect(leakPillState({ inLeak: false, status: 'active', blank: false })).toBe('missing');
    expect(leakPillState({ inLeak: false, status: 'draft', blank: false })).toBe('missing');
  });

  it('пустой черновик и архив пилюли не получают', () => {
    expect(leakPillState({ inLeak: false, status: 'draft', blank: true })).toBeNull();
    expect(leakPillState({ inLeak: false, status: 'archive', blank: false })).toBeNull();
  });
});
