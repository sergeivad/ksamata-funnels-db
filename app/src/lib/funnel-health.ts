/**
 * funnel-health.ts — чистый лист состояния ссылок воронки: типы и подписи.
 *
 * Отделён от `monitor-funnel-health.ts` не ради красоты. Список воронок
 * (`src/app/page.tsx`) — клиентский компонент, и импорт ЗНАЧЕНИЯ
 * (`funnelHealthTone`) из модуля, который тянет `drizzle-orm` и `db/schema`,
 * утаскивал их в клиентский бандл страницы `/`. Замер 18.09.2026 на
 * `npm run build`: чанк `82-*.js` весом 50 КБ, в нём `drizzle-orm` и
 * `SQLiteTable`, и `app-build-manifest.json` отдавал его странице `/` — то
 * есть каждому, включая анонима, которому мониторинг вообще не показывают.
 *
 * Отсюда правило: здесь не может быть ни одного импорта БД. Пара
 * `monitor-status.ts` (чистый) / `monitor-notify.ts` (с БД) в этом репозитории
 * устроена ровно так же.
 */
import { type MonitorStatus } from './monitor-status';

export interface FunnelHealth {
  down: number;
  unknown: number;
  enabled: number;
  total: number;
  lastCheckedAt: string | null;
}

export type FunnelHealthTone = 'down' | 'unknown' | 'ok';

export function funnelHealthTone(h: FunnelHealth): FunnelHealthTone {
  if (h.down > 0) return 'down';
  if (h.unknown > 0) return 'unknown';
  return 'ok';
}

/** Подпись пилюли. Пустая строка — пилюли нет. */
export function funnelHealthPillLabel(h: FunnelHealth): string {
  const tone = funnelHealthTone(h);
  if (tone === 'down') return `Проверить · ${h.down}`;
  if (tone === 'unknown') return 'Не проверялось';
  return '';
}

export interface FunnelProblem {
  url: string;
  origin: string;
  status: MonitorStatus;
  httpStatus: number | null;
  error: string;
  since: string | null;
  checkedAt: string | null;
  enabled: boolean;
}
