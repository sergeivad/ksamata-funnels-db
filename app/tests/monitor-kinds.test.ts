import { describe, it, expect } from 'vitest';
import { sourceKindLabel, sourceKindTone, isKnownSourceKind, ROOM_SOURCE_KINDS } from '../src/lib/monitor-kinds';
import { BLOCK_KINDS, getBlockDef } from '../src/lib/blocks';

describe('sourceKindLabel', () => {
  it('называет группу блока ровно так же, как она называется в редакторе воронки', () => {
    for (const def of BLOCK_KINDS) {
      expect(sourceKindLabel(def.kind)).toBe(getBlockDef(def.kind).title);
    }
  });

  it('не знает отдельной группы для поля landing_url — она слита с «Лендингами»', () => {
    expect(sourceKindLabel('funnel_landing_url')).toBe('funnel_landing_url');
    expect(isKnownSourceKind('funnel_landing_url')).toBe(false);
  });

  it('отдаёт неизвестный вид как есть, а не пустую строку', () => {
    expect(sourceKindLabel('something_new')).toBe('something_new');
  });
});

describe('sourceKindTone', () => {
  it('вся группа включена — «on»', () => {
    expect(sourceKindTone(45, 45)).toBe('on');
  });

  it('включена часть — состояние своё, подсветка та же оранжевая', () => {
    // Настоящий случай: «Лендинги · 41 из 45» раньше читались как выключенные.
    expect(sourceKindTone(41, 45)).toBe('partial');
    expect(sourceKindTone(1, 154)).toBe('partial');
  });

  it('ни одной включённой цели — «off»', () => {
    expect(sourceKindTone(0, 154)).toBe('off');
  });

  it('пустая группа не бывает включённой', () => {
    expect(sourceKindTone(0, 0)).toBe('off');
  });

  it('рассинхрон (включено больше, чем всего) — это «on», а не отдельное состояние', () => {
    expect(sourceKindTone(3, 2)).toBe('on');
  });
});

describe('реестр видов источника', () => {
  it('знает комнаты наравне с блоками', () => {
    expect(isKnownSourceKind('landings')).toBe(true);
    expect(ROOM_SOURCE_KINDS.every(isKnownSourceKind)).toBe(true);
  });

  it('подписывает комнаты по-русски', () => {
    expect(sourceKindLabel('room_gc')).toBe('Комнаты ГК');
    expect(sourceKindLabel('room_web')).toBe('Комнаты Web');
    expect(sourceKindLabel('room_replay')).toBe('Повторы');
  });

  it('незнакомый вид отдаёт сам себя, а известным не считается', () => {
    expect(sourceKindLabel('room_zzz')).toBe('room_zzz');
    expect(isKnownSourceKind('room_zzz')).toBe(false);
  });
});
