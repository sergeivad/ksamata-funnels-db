import { describe, it, expect } from 'vitest';
import { flattenToCommon, restoreByTime } from '../src/lib/block-fill';
import type { BlockItem } from '../src/lib/funnel-blocks';

const byTimeItems: BlockItem[] = [
  { slot: '15', label: 'Ленд 15', url: 'https://x.ru/15' },
  { slot: '19', label: 'Ленд 19', url: 'https://x.ru/19' },
];

describe('flattenToCommon', () => {
  it('nulls every slot, keeping labels and urls', () => {
    expect(flattenToCommon(byTimeItems)).toEqual([
      { slot: null, label: 'Ленд 15', url: 'https://x.ru/15' },
      { slot: null, label: 'Ленд 19', url: 'https://x.ru/19' },
    ]);
  });

  it('does not mutate the input', () => {
    const input = byTimeItems.map((it) => ({ ...it }));
    flattenToCommon(input);
    expect(input).toEqual(byTimeItems);
  });
});

describe('restoreByTime', () => {
  it('restores the stashed 15/19 split when common items were not edited', () => {
    const common = flattenToCommon(byTimeItems);
    expect(restoreByTime(common, byTimeItems)).toEqual(byTimeItems);
  });

  it('falls back to slot 15 when common items were edited after flattening', () => {
    const edited = [
      { slot: null, label: 'Ленд 15', url: 'https://x.ru/15-edited' },
      { slot: null, label: 'Ленд 19', url: 'https://x.ru/19' },
    ];
    expect(restoreByTime(edited, byTimeItems)).toEqual([
      { slot: '15', label: 'Ленд 15', url: 'https://x.ru/15-edited' },
      { slot: '15', label: 'Ленд 19', url: 'https://x.ru/19' },
    ]);
  });

  it('falls back to slot 15 when there is no stash', () => {
    const common: BlockItem[] = [{ slot: null, label: '', url: 'https://x.ru/a' }];
    expect(restoreByTime(common, null)).toEqual([
      { slot: '15', label: '', url: 'https://x.ru/a' },
    ]);
  });

  it('keeps existing slots when falling back (defensive)', () => {
    const mixed: BlockItem[] = [
      { slot: '19', label: '', url: 'https://x.ru/b' },
      { slot: null, label: '', url: 'https://x.ru/c' },
    ];
    expect(restoreByTime(mixed, null)).toEqual([
      { slot: '19', label: '', url: 'https://x.ru/b' },
      { slot: '15', label: '', url: 'https://x.ru/c' },
    ]);
  });
});
