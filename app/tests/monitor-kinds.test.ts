import { describe, it, expect } from 'vitest';
import { sourceKindLabel } from '../src/lib/monitor-kinds';
import { BLOCK_KINDS, getBlockDef } from '../src/lib/blocks';

describe('sourceKindLabel', () => {
  it('называет группу блока ровно так же, как она называется в редакторе воронки', () => {
    for (const def of BLOCK_KINDS) {
      expect(sourceKindLabel(def.kind)).toBe(getBlockDef(def.kind).title);
    }
  });

  it('знает про поле landing_url самой воронки — это не блок', () => {
    expect(sourceKindLabel('funnel_landing_url')).toBe('Лендинг воронки');
  });

  it('отдаёт неизвестный вид как есть, а не пустую строку', () => {
    expect(sourceKindLabel('something_new')).toBe('something_new');
  });
});
