import { describe, it, expect } from 'vitest';
import { funnels, funnelBlocks, funnelBlockItems } from '../src/db/schema';

describe('schema additions', () => {
  it('funnels has new columns', () => {
    const cols = Object.keys(funnels);
    expect(cols).toContain('comment');
    expect(cols).toContain('timeLabelA');
    expect(cols).toContain('timeLabelB');
    expect(cols).toContain('roomsReplayEnabled');
  });

  it('funnel_blocks table exists with kind/enabled/mode', () => {
    const cols = Object.keys(funnelBlocks);
    expect(cols).toEqual(expect.arrayContaining(['id', 'funnelId', 'kind', 'enabled', 'mode']));
  });

  it('funnel_block_items table exists with slot/label/url/position', () => {
    const cols = Object.keys(funnelBlockItems);
    expect(cols).toEqual(expect.arrayContaining(['id', 'blockId', 'slot', 'label', 'url', 'position']));
  });
});
