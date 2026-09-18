/**
 * monitor-canary.ts — жив ли признак «комнаты нет».
 *
 * Считает ЧТЕНИЕ, а не цикл. Флаг из цикла соврал бы: цикл живёт в рантайме
 * инструментации, страница рендерится в Node, общего globalThis у них нет —
 * ровно та причина, по которой monitor-view не показывает ошибки отправки в
 * Telegram. Заводить таблицу ради одного булева значения тоже незачем.
 *
 * Кэш обязателен: пока идёт цикл, страница мониторинга опрашивает роут раз в
 * две секунды, и без кэша канарейка била бы по Bizon с той же частотой.
 */
import { checkUrl, type CheckFn } from './monitor-check';
import { CANARY_URL, canaryVerdict, type CanaryVerdict } from './monitor-content';

export const CANARY_TTL_MS = 10 * 60 * 1000;

export interface CanaryView {
  verdict: CanaryVerdict;
  checkedAt: string;
}

interface CanaryCache {
  value: CanaryView;
  expiresAt: number;
}

declare global {
  // eslint-disable-next-line no-var
  var __ksamataMonitorCanary: CanaryCache | undefined;
}

export async function getCanaryState(
  opts: { check?: CheckFn; nowMs?: () => number } = {},
): Promise<CanaryView> {
  const now = opts.nowMs ?? (() => Date.now());
  const cached = globalThis.__ksamataMonitorCanary;
  if (cached && cached.expiresAt > now()) return cached.value;

  const check = opts.check ?? ((url: string) => checkUrl(url));
  const result = await check(CANARY_URL);
  const value: CanaryView = {
    verdict: canaryVerdict(result),
    checkedAt: new Date(now()).toISOString(),
  };
  globalThis.__ksamataMonitorCanary = { value, expiresAt: now() + CANARY_TTL_MS };
  return value;
}

/** Только для тестов: кэш переживает файл теста, иначе кейсы влияют друг на друга. */
export function resetCanaryCache(): void {
  globalThis.__ksamataMonitorCanary = undefined;
}
