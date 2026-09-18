/**
 * monitor-funnel-health.ts — состояние ссылок одной воронки. Только чтение.
 *
 * Считается при чтении, а не хранится: новых таблиц у фичи нет, а связка
 * monitor_target_funnels → monitor_targets → monitor_state и есть ответ.
 */
import { eq, inArray } from 'drizzle-orm';
import { type AnyDB } from '../db/client';
import {
  funnelBlockItems,
  funnelBlocks,
  funnelDays,
  monitorState,
  monitorTargetFunnels,
  monitorTargets,
} from '../db/schema';
import { isMonitorStatus, parseSqliteUtc, type MonitorStatus } from './monitor-status';
import { sourceKindLabel } from './monitor-kinds';
import { normalizeUrl } from './monitor-urls';

/**
 * Насколько старое падение ещё зажигает пилюлю.
 *
 * Отсечка и даёт тишину у архива: его страницы мертвы законно, это и значит
 * «архив». Активную воронку правило не задевает — её проверяют каждые 15 минут;
 * черновик после ручной проверки светится неделю.
 */
export const STALE_AFTER_DAYS = 7;

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

interface Row {
  funnelId: number;
  url: string;
  enabled: number;
  status: string | null;
  httpStatus: number | null;
  error: string | null;
  since: string | null;
  checkedAt: string | null;
}

function rowsFor(db: AnyDB, funnelIds?: number[]): Row[] {
  const base = db
    .select({
      funnelId: monitorTargetFunnels.funnelId,
      url: monitorTargets.url,
      enabled: monitorTargets.enabled,
      status: monitorState.status,
      httpStatus: monitorState.httpStatus,
      error: monitorState.error,
      since: monitorState.since,
      checkedAt: monitorState.checkedAt,
    })
    .from(monitorTargetFunnels)
    .innerJoin(monitorTargets, eq(monitorTargets.id, monitorTargetFunnels.targetId))
    .leftJoin(monitorState, eq(monitorState.targetId, monitorTargets.id));

  return (
    funnelIds ? base.where(inArray(monitorTargetFunnels.funnelId, funnelIds)) : base
  ).all() as Row[];
}

/** Свежее ли падение: старше отсечки — уже не новость. */
function isFreshDown(row: Row, staleBeforeMs: number): boolean {
  if (row.status !== 'down') return false;
  const checkedAt = parseSqliteUtc(row.checkedAt);
  return checkedAt !== null && checkedAt >= staleBeforeMs;
}

export function getFunnelHealth(
  db: AnyDB,
  funnelIds?: number[],
  nowMs: number = Date.now(),
): Map<number, FunnelHealth> {
  // IN () без аргументов — известная ловушка SQL; на пустом списке не строим запрос.
  if (funnelIds && funnelIds.length === 0) return new Map();

  const staleBefore = nowMs - STALE_AFTER_DAYS * 86_400_000;
  const out = new Map<number, FunnelHealth>();

  for (const row of rowsFor(db, funnelIds)) {
    const h =
      out.get(row.funnelId) ??
      { down: 0, unknown: 0, enabled: 0, total: 0, lastCheckedAt: null as string | null };

    h.total += 1;
    if (row.enabled === 1) h.enabled += 1;
    if (isFreshDown(row, staleBefore)) h.down += 1;
    // Непроверенная ВЫКЛЮЧЕННАЯ цель пробелом не считается: её никто и не
    // обещал проверять, иначе у каждого архива висела бы серая пилюля.
    if (row.enabled === 1 && (row.status === null || row.status === 'unknown')) h.unknown += 1;
    if (row.checkedAt && (!h.lastCheckedAt || row.checkedAt > h.lastCheckedAt)) {
      h.lastCheckedAt = row.checkedAt;
    }

    out.set(row.funnelId, h);
  }

  return out;
}

/**
 * Откуда у воронки взялся адрес: «Комнаты ГК · 15:00 · день 2», «Тарифы · Основной».
 *
 * Считается при чтении, а не колонкой в monitor_targets: один адрес может
 * принадлежать двум воронкам с разным происхождением, и колонка была бы
 * неверна по существу.
 */
export function collectFunnelOrigins(db: AnyDB, funnelId: number): Map<string, string> {
  const out = new Map<string, string>();

  const items = db
    .select({
      kind: funnelBlocks.kind,
      label: funnelBlockItems.label,
      slot: funnelBlockItems.slot,
      url: funnelBlockItems.url,
    })
    .from(funnelBlockItems)
    .innerJoin(funnelBlocks, eq(funnelBlocks.id, funnelBlockItems.blockId))
    .where(eq(funnelBlocks.funnelId, funnelId))
    .all() as { kind: string; label: string | null; slot: string | null; url: string }[];

  for (const item of items) {
    const url = normalizeUrl(item.url);
    if (!url || out.has(url)) continue;
    const parts = [sourceKindLabel(item.kind)];
    if (item.label?.trim()) parts.push(item.label.trim());
    if (item.slot) parts.push(`${item.slot}:00`);
    out.set(url, parts.join(' · '));
  }

  const days = db
    .select({
      slot: funnelDays.timeSlot,
      day: funnelDays.dayNum,
      gcRoom: funnelDays.gcRoom,
      webRoom: funnelDays.webRoom,
      replayUrl: funnelDays.replayUrl,
    })
    .from(funnelDays)
    .where(eq(funnelDays.funnelId, funnelId))
    .all() as {
      slot: string; day: number;
      gcRoom: string | null; webRoom: string | null; replayUrl: string | null;
    }[];

  for (const d of days) {
    const where = `${d.slot}:00 · день ${d.day}`;
    for (const [raw, kind] of [
      [d.gcRoom, 'room_gc'],
      [d.webRoom, 'room_web'],
      [d.replayUrl, 'room_replay'],
    ] as const) {
      const url = normalizeUrl(raw ?? '');
      if (url && !out.has(url)) out.set(url, `${sourceKindLabel(kind)} · ${where}`);
    }
  }

  return out;
}

/** Проблемные адреса воронки, «Упало» первыми, затем непроверенные. */
export function listFunnelProblems(
  db: AnyDB,
  funnelId: number,
  nowMs: number = Date.now(),
): FunnelProblem[] {
  const staleBefore = nowMs - STALE_AFTER_DAYS * 86_400_000;
  const origins = collectFunnelOrigins(db, funnelId);

  const problems: FunnelProblem[] = [];
  for (const row of rowsFor(db, [funnelId])) {
    const fresh = isFreshDown(row, staleBefore);
    const never = row.enabled === 1 && (row.status === null || row.status === 'unknown');
    if (!fresh && !never) continue;
    problems.push({
      url: row.url,
      origin: origins.get(row.url) ?? 'Источник не найден',
      status: isMonitorStatus(row.status) ? row.status : 'unknown',
      httpStatus: row.httpStatus,
      error: row.error ?? '',
      since: row.since,
      checkedAt: row.checkedAt,
      enabled: row.enabled === 1,
    });
  }

  return problems.sort((a, b) => {
    const byStatus = (a.status === 'down' ? 0 : 1) - (b.status === 'down' ? 0 : 1);
    return byStatus !== 0 ? byStatus : a.url.localeCompare(b.url);
  });
}
