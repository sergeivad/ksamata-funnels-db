import { describe, it, expect } from 'vitest';
import { leakPillState } from '../src/lib/leak-pill';

describe('пилюля ЛИК в списке', () => {
  it('заведённая воронка — «ЛИК» в любом статусе', () => {
    for (const status of ['active', 'draft', 'archive']) {
      expect(leakPillState({ inLeak: true, leakTodo: '', status, blank: false })).toBe('in');
    }
  });

  it('незаведённая активная или черновик с осями — «нет в ЛИК»', () => {
    expect(leakPillState({ inLeak: false, leakTodo: '', status: 'active', blank: false })).toBe('missing');
    expect(leakPillState({ inLeak: false, leakTodo: '', status: 'draft', blank: false })).toBe('missing');
  });

  it('пустой черновик и архив пилюли не получают', () => {
    expect(leakPillState({ inLeak: false, leakTodo: '', status: 'draft', blank: true })).toBeNull();
    expect(leakPillState({ inLeak: false, leakTodo: '', status: 'archive', blank: false })).toBeNull();
  });

  it('заведённая с непустым «чего не хватает» — «доделать» в любом статусе', () => {
    for (const status of ['active', 'draft', 'archive']) {
      expect(leakPillState({ inLeak: true, leakTodo: 'комнаты', status, blank: false })).toBe('incomplete');
    }
  });

  it('пробелы вместо текста недоделкой не считаются', () => {
    expect(leakPillState({ inLeak: true, leakTodo: '   ', status: 'active', blank: false })).toBe('in');
  });

  it('недоделка без галки «есть в ЛИК» ничего не меняет', () => {
    expect(leakPillState({ inLeak: false, leakTodo: 'комнаты', status: 'active', blank: false })).toBe('missing');
    expect(leakPillState({ inLeak: false, leakTodo: 'комнаты', status: 'archive', blank: false })).toBeNull();
  });
});
