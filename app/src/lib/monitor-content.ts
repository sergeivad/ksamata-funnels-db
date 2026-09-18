/**
 * monitor-content.ts — «ответ 200, но за ним пусто».
 *
 * Чистый модуль: ни сети, ни БД, ни node:*. Его тянет monitor-check, который
 * попадает в edge-граф сборки, — любой Node-импорт здесь уронит `npm run build`,
 * оставив tsc и тесты зелёными (см. app/next.config.ts).
 *
 * Замер 18.09.2026, на котором стоит правило:
 *   web.ksamatacenter.com/room/boo1-kvch   → 200, 27250 байт, свой заголовок
 *   web.ksamatacenter.com/room/tkm1-15-rb  → 200,  2388 байт, «Веб-комната не найдена»  (F101)
 *   web.ksamatacenter.com/room/zzz-nope    → 200,  2388 байт, то же самое              (контроль)
 * Страница комнаты F101 побайтово равна выдуманному слагу — по коду ответа они
 * неразличимы, различает их только <title>.
 */
import type { CheckResult } from './monitor-check';

export interface SoftMissingRule {
  re: RegExp;
  reason: string;
}

/**
 * Хост → признак. Матчим именно <title>, а не вхождение строки в тело: живая
 * комната может законно содержать эти слова в чате или в названии вебинара.
 */
export const SOFT_MISSING: Record<string, SoftMissingRule> = {
  'web.ksamatacenter.com': {
    re: /<title>\s*Веб-комната не найдена\s*<\/title>/i,
    reason: 'Веб-комната не найдена',
  },
};

/**
 * Сколько тела читаем. <title> лежит в <head>, а вся страница-пустышка — 2,4 КБ,
 * так что 8 КБ это запас втрое, а не экономия.
 */
export const SOFT_MISSING_MAX_BYTES = 8192;

export function hasSoftMissingRule(hostname: string): boolean {
  return Object.prototype.hasOwnProperty.call(SOFT_MISSING, hostname);
}

export function softMissingReason(hostname: string, head: string): string | null {
  const rule = SOFT_MISSING[hostname];
  if (!rule) return null;
  return rule.re.test(head) ? rule.reason : null;
}

// ── Канарейка ────────────────────────────────────────────────────────────────

export const CANARY_HOST = 'web.ksamatacenter.com';

/** Слаг, который не будет заведён никогда. */
export const CANARY_URL = `https://${CANARY_HOST}/room/ksamata-funnels-canary`;

export type CanaryVerdict = 'ok' | 'broken' | 'unknown';

/**
 * Состояний три, и третье не придирка: сетевой сбой тоже даёт `down`, и выдать
 * его за «признак цел» нельзя — иначе канарейка сама станет тихим нулём.
 */
export function canaryVerdict(result: CheckResult): CanaryVerdict {
  const rule = SOFT_MISSING[CANARY_HOST];
  if (rule && result.status === 'down' && result.error === rule.reason) return 'ok';
  if (result.httpStatus !== null && result.httpStatus >= 200 && result.httpStatus < 300) {
    return 'broken';
  }
  return 'unknown';
}
