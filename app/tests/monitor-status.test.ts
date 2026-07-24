import { describe, it, expect } from 'vitest';
import {
  MONITOR_STATUS_VALUES,
  isMonitorStatus,
  MONITOR_STATUS_META,
  formatAgo,
} from '../src/lib/monitor-status';

describe('isMonitorStatus', () => {
  it('пропускает все допустимые значения', () => {
    for (const v of MONITOR_STATUS_VALUES) expect(isMonitorStatus(v)).toBe(true);
  });

  it('отбраковывает мусор', () => {
    expect(isMonitorStatus('broken')).toBe(false);
    expect(isMonitorStatus(null)).toBe(false);
    expect(isMonitorStatus(42)).toBe(false);
  });
});

describe('MONITOR_STATUS_META', () => {
  it('описывает каждый статус', () => {
    for (const v of MONITOR_STATUS_VALUES) {
      expect(MONITOR_STATUS_META[v].label.length).toBeGreaterThan(0);
      expect(MONITOR_STATUS_META[v].className.length).toBeGreaterThan(0);
    }
  });

  it('сортирует упавшие выше медленных, а рабочие — последними', () => {
    expect(MONITOR_STATUS_META.down.order).toBeLessThan(MONITOR_STATUS_META.slow.order);
    expect(MONITOR_STATUS_META.slow.order).toBeLessThan(MONITOR_STATUS_META.up.order);
  });
});

describe('formatAgo', () => {
  // Опорная точка: 2026-07-24 12:00:00 UTC. SQLite пишет время без зоны — трактуем как UTC.
  const now = Date.parse('2026-07-24T12:00:00Z');

  it('говорит «никогда» для пустого значения', () => {
    expect(formatAgo(null, now)).toBe('никогда');
  });

  it('показывает «только что» в пределах минуты', () => {
    expect(formatAgo('2026-07-24 11:59:30', now)).toBe('только что');
  });

  it('показывает минуты', () => {
    expect(formatAgo('2026-07-24 11:45:00', now)).toBe('15 мин назад');
  });

  it('показывает часы', () => {
    expect(formatAgo('2026-07-24 09:00:00', now)).toBe('3 ч назад');
  });

  it('показывает дни', () => {
    expect(formatAgo('2026-07-22 12:00:00', now)).toBe('2 дн назад');
  });
});
