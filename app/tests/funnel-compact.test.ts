import { describe, test, expect } from 'vitest';
import { groupDaysByDay, blockHasContent, visibleBlocks, blockHasLabels, isOpenableUrl } from '../src/lib/funnel-compact';
import type { DayCell } from '../src/lib/funnel-days';
import type { BlockState } from '../src/lib/funnel-blocks';

describe('groupDaysByDay', () => {
  test('groups cells by dayNum and sorts ascending', () => {
    const days: DayCell[] = [
      { timeSlot: '19', dayNum: 2, gcRoom: 'gc2', webRoom: '', replayUrl: '' },
      { timeSlot: '15', dayNum: 1, gcRoom: 'gc1', webRoom: 'web1', replayUrl: '' },
    ];
    const groups = groupDaysByDay(days);
    expect(groups.map((g) => g.dayNum)).toEqual([1, 2]);
    expect(groups[0].slots['15']).toEqual({ gcRoom: 'gc1', webRoom: 'web1', replayUrl: '' });
    expect(groups[1].slots['15']).toBeUndefined();
    expect(groups[1].slots['19']).toEqual({ gcRoom: 'gc2', webRoom: '', replayUrl: '' });
  });

  test('drops cells where every field is empty', () => {
    const days: DayCell[] = [
      { timeSlot: '15', dayNum: 1, gcRoom: '', webRoom: '', replayUrl: '' },
      { timeSlot: '19', dayNum: 1, gcRoom: 'gc', webRoom: '', replayUrl: '' },
    ];
    const groups = groupDaysByDay(days);
    expect(groups).toHaveLength(1);
    expect(groups[0].slots['15']).toBeUndefined();
    expect(groups[0].slots['19']).toBeDefined();
  });

  test('empty input yields no groups', () => {
    expect(groupDaysByDay([])).toEqual([]);
  });
});

describe('blockHasContent / visibleBlocks', () => {
  const base: Omit<BlockState, 'items'> = { kind: 'landings', enabled: true, mode: 'common' };

  test('blockHasContent is false when every url is blank', () => {
    expect(blockHasContent([{ slot: null, label: '', url: '' }, { slot: null, label: '', url: '  ' }])).toBe(false);
  });

  test('blockHasContent is true when at least one url is non-empty', () => {
    expect(blockHasContent([{ slot: null, label: '', url: '' }, { slot: null, label: '', url: 'https://x.test' }])).toBe(true);
  });

  test('visibleBlocks filters out disabled blocks and blocks with no urls', () => {
    const blocks: BlockState[] = [
      { ...base, kind: 'landings', enabled: true, items: [{ slot: null, label: '', url: 'https://a.test' }] },
      { ...base, kind: 'records', enabled: false, items: [{ slot: null, label: '', url: 'https://b.test' }] },
      { ...base, kind: 'tariffs', enabled: true, items: [{ slot: null, label: '', url: '' }] },
    ];
    const visible = visibleBlocks(blocks);
    expect(visible.map((b) => b.kind)).toEqual(['landings']);
  });
});

describe('blockHasLabels', () => {
  test('false when no item has a label', () => {
    expect(blockHasLabels([
      { slot: null, label: '', url: 'https://a.test' },
      { slot: null, label: '  ', url: 'https://b.test' },
    ])).toBe(false);
  });

  test('true when a filled row carries a label', () => {
    expect(blockHasLabels([
      { slot: null, label: '', url: 'https://a.test' },
      { slot: null, label: 'Дашборд продаж', url: 'https://b.test' },
    ])).toBe(true);
  });

  test('ignores labels on rows with empty urls', () => {
    expect(blockHasLabels([{ slot: null, label: 'черновик', url: '' }])).toBe(false);
  });
});

describe('isOpenableUrl', () => {
  test('accepts http(s) urls, trimming whitespace', () => {
    expect(isOpenableUrl('https://example.com')).toBe(true);
    expect(isOpenableUrl('  http://example.com  ')).toBe(true);
  });

  test('rejects non-http(s) values', () => {
    expect(isOpenableUrl('not-a-url')).toBe(false);
    expect(isOpenableUrl('')).toBe(false);
    expect(isOpenableUrl('ftp://example.com')).toBe(false);
  });
});
