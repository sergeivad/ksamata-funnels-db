import { describe, it, expect } from 'vitest';
import { readSchedulerConfig, DEFAULT_INTERVAL_MINUTES } from '../src/lib/monitor-scheduler';

describe('readSchedulerConfig', () => {
  it('по умолчанию включён с интервалом 15 минут', () => {
    const cfg = readSchedulerConfig({});
    expect(cfg.enabled).toBe(true);
    expect(cfg.intervalMs).toBe(DEFAULT_INTERVAL_MINUTES * 60_000);
    expect(cfg.firstRunDelayMs).toBe(30_000);
  });

  it('выключается ровно строкой "false"', () => {
    expect(readSchedulerConfig({ MONITOR_ENABLED: 'false' }).enabled).toBe(false);
    expect(readSchedulerConfig({ MONITOR_ENABLED: 'FALSE' }).enabled).toBe(true);
    expect(readSchedulerConfig({ MONITOR_ENABLED: '0' }).enabled).toBe(true);
    expect(readSchedulerConfig({ MONITOR_ENABLED: 'true' }).enabled).toBe(true);
  });

  it('читает интервал из env', () => {
    expect(readSchedulerConfig({ MONITOR_INTERVAL_MINUTES: '5' }).intervalMs).toBe(5 * 60_000);
  });

  it('игнорирует мусорный и неположительный интервал', () => {
    for (const raw of ['abc', '0', '-3', '1.5', '']) {
      expect(readSchedulerConfig({ MONITOR_INTERVAL_MINUTES: raw }).intervalMs).toBe(
        DEFAULT_INTERVAL_MINUTES * 60_000
      );
    }
  });
});
