/**
 * Канарейка: одна и та же страница-пустышка, по которой видно, жив ли признак.
 * Сети тут нет — проверяльщик подменяется.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { canaryVerdict, CANARY_URL } from '../src/lib/monitor-content';
import { getCanaryState, resetCanaryCache, CANARY_TTL_MS } from '../src/lib/monitor-canary';
import type { CheckResult } from '../src/lib/monitor-check';

const result = (p: Partial<CheckResult>): CheckResult => ({
  status: 'up', httpStatus: 200, finalUrl: CANARY_URL, latencyMs: 10, error: '', ...p,
});

beforeEach(() => resetCanaryCache());

describe('вердикт канарейки', () => {
  it('признак сработал — «действует»', () => {
    expect(canaryVerdict(result({ status: 'down', error: 'Веб-комната не найдена' }))).toBe('ok');
  });

  it('200 без признака — «не действует»', () => {
    expect(canaryVerdict(result({ status: 'up', error: '' }))).toBe('broken');
  });

  it('сетевой сбой не выдаётся за целый признак', () => {
    expect(canaryVerdict(result({ status: 'down', httpStatus: null, error: 'Таймаут 10 с' })))
      .toBe('unknown');
  });

  it('пятисотка — тоже «не удалось проверить»', () => {
    expect(canaryVerdict(result({ status: 'down', httpStatus: 503, error: 'HTTP 503' })))
      .toBe('unknown');
  });
});

describe('кэш канарейки', () => {
  it('второй вызов подряд в сеть не идёт', async () => {
    let calls = 0;
    const check = async () => { calls += 1; return result({ status: 'down', error: 'Веб-комната не найдена' }); };
    const now = () => 1_000_000;
    expect((await getCanaryState({ check, nowMs: now })).verdict).toBe('ok');
    expect((await getCanaryState({ check, nowMs: now })).verdict).toBe('ok');
    expect(calls).toBe(1);
  });

  it('после истечения срока идёт заново', async () => {
    let calls = 0;
    const check = async () => { calls += 1; return result({ status: 'down', error: 'Веб-комната не найдена' }); };
    await getCanaryState({ check, nowMs: () => 1_000_000 });
    await getCanaryState({ check, nowMs: () => 1_000_000 + CANARY_TTL_MS + 1 });
    expect(calls).toBe(2);
  });
});
