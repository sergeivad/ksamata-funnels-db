import { describe, test, expect } from 'vitest';
import {
  isFunnelStatus,
  isStatusFilter,
  matchesStatusFilter,
  countLabel,
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

/**
 * Счётчик под списком воронок. Вкладка «Все» намеренно прячет архив
 * (`matchesStatusFilter`), но счётчик считал вид неотфильтрованным и писал
 * «51 всего» — то есть ровно в состоянии по умолчанию утверждал, что воронок
 * всего 51 при 72 в базе. Владелец на этом решил, что новые воронки не
 * доехали до прода, 2026-07-29.
 */
describe('countLabel', () => {
  test('на вкладке «Все» показывает «из», пока архив скрыт', () => {
    expect(countLabel(51, 72)).toBe('51 из 72');
  });

  test('без скрытых пишет «всего»', () => {
    expect(countLabel(72, 72)).toBe('72 всего');
  });

  // Ноль показанных — тоже честное «0 из N», иначе «0 всего» читается как
  // «воронок нет вообще», а не «ничего не нашлось».
  test('пустая выдача не выглядит как пустая база', () => {
    expect(countLabel(0, 72)).toBe('0 из 72');
  });

  test('пустая база остаётся «0 всего»', () => {
    expect(countLabel(0, 0)).toBe('0 всего');
  });
});
