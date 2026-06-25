import { describe, it, expect } from 'vitest';
import { BLOCK_KINDS, isBlockKind, getBlockDef } from '../src/lib/blocks';

describe('blocks catalog', () => {
  it('lists the 9 kinds in card order', () => {
    expect(BLOCK_KINDS.map((b) => b.kind)).toEqual([
      'landings', 'records', 'tariffs', 'applications', 'bonuses',
      'oto', 'processes', 'meditation', 'links',
    ]);
  });

  it('landings is single-field, common-only, default enabled', () => {
    const d = getBlockDef('landings');
    expect(d.fields).toBe(1);
    expect(d.modes).toEqual(['common']);
    expect(d.defaultEnabled).toBe(true);
  });

  it('processes and links are two-field', () => {
    expect(getBlockDef('processes').fields).toBe(2);
    expect(getBlockDef('links').fields).toBe(2);
  });

  it('records supports by_time and defaults disabled', () => {
    const d = getBlockDef('records');
    expect(d.modes).toEqual(['common', 'by_time']);
    expect(d.defaultEnabled).toBe(false);
  });

  it('isBlockKind validates membership', () => {
    expect(isBlockKind('tariffs')).toBe(true);
    expect(isBlockKind('rooms')).toBe(false);
    expect(isBlockKind('nope')).toBe(false);
  });

  it('getBlockDef throws on unknown kind', () => {
    expect(() => getBlockDef('rooms' as never)).toThrow();
  });
});
