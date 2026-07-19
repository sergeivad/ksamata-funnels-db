import { describe, test, expect } from 'vitest';
import {
  isFunnelStatus,
  isStatusFilter,
  matchesStatusFilter,
  STATUS_META,
  STATUS_ACTION_LABELS,
  FUNNEL_STATUS_VALUES,
} from '../src/lib/status';

describe('isFunnelStatus', () => {
  test('accepts the three statuses', () => {
    expect(isFunnelStatus('active')).toBe(true);
    expect(isFunnelStatus('draft')).toBe(true);
    expect(isFunnelStatus('archive')).toBe(true);
  });
  test('rejects unknown / non-string', () => {
    expect(isFunnelStatus('foo')).toBe(false);
    expect(isFunnelStatus(undefined)).toBe(false);
    expect(isFunnelStatus(3)).toBe(false);
  });
});

describe('matchesStatusFilter', () => {
  test('"all" shows active and draft but hides archive', () => {
    expect(matchesStatusFilter('active', 'all')).toBe(true);
    expect(matchesStatusFilter('draft', 'all')).toBe(true);
    expect(matchesStatusFilter('archive', 'all')).toBe(false);
  });
  test('specific filter matches only that status', () => {
    expect(matchesStatusFilter('archive', 'archive')).toBe(true);
    expect(matchesStatusFilter('active', 'archive')).toBe(false);
    expect(matchesStatusFilter('draft', 'draft')).toBe(true);
  });
});

describe('isStatusFilter', () => {
  test('accepts all + three statuses, rejects junk', () => {
    expect(isStatusFilter('all')).toBe(true);
    expect(isStatusFilter('archive')).toBe(true);
    expect(isStatusFilter('nope')).toBe(false);
  });
});

describe('STATUS_META / STATUS_ACTION_LABELS', () => {
  test('every status has a non-empty label and a bg- className', () => {
    for (const s of FUNNEL_STATUS_VALUES) {
      expect(STATUS_META[s].label.length).toBeGreaterThan(0);
      expect(STATUS_META[s].className).toContain('bg-');
      expect(STATUS_ACTION_LABELS[s].length).toBeGreaterThan(0);
    }
  });
  test('archive copy is correct', () => {
    expect(STATUS_META.archive.label).toBe('Архив');
    expect(STATUS_ACTION_LABELS.archive).toBe('В архив');
  });
});
