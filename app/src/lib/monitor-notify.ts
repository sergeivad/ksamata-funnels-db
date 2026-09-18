/**
 * Уведомления о падении страниц в Telegram.
 *
 * Источник поводов — `monitor_events`: туда цикл пишет строку ТОЛЬКО на смену
 * статуса, то есть таблица уже является журналом «упало/поднялось». Цикл
 * запоминает `MAX(id)` перед стартом и отдаёт сюда всё, что появилось после;
 * сравнение по id, а не по времени — в таблице UTC-строки SQLite, а у цикла
 * ISO с миллисекундами, и сравнение времён здесь было бы источником ошибок.
 */

import { eq, gt, and, asc, inArray } from 'drizzle-orm';
import { type AnyDB } from '../db/client';
import { funnels, monitorEvents, monitorTargets, monitorTargetFunnels } from '../db/schema';
import { funnelRefLabel } from './front-code';
import { compareByFrontCodeAsc } from './funnel-sort';

/** Событие смены статуса, обогащённое кодами воронок, которые держат URL. */
export interface NotifyEvent {
  url: string;
  fromStatus: string;
  toStatus: string;
  /** Готовая человеческая причина из проверки: «HTTP 502», «Таймаут». */
  error: string;
  frontCodes: string[];
}

/**
 * Раскладываем переходы на два повода.
 *
 * «Упало» — любой переход В `down`. «Поднялось» — переход ИЗ `down`.
 * Всё остальное молчит, и это не экономия: первая же проверка новой цели даёт
 * `unknown → up`, а таких на свежей базе шесть сотен.
 */
export function splitTransitions(rows: NotifyEvent[]): {
  down: NotifyEvent[];
  recovered: NotifyEvent[];
} {
  const down: NotifyEvent[] = [];
  const recovered: NotifyEvent[] = [];
  for (const row of rows) {
    if (row.toStatus === 'down') down.push(row);
    else if (row.fromStatus === 'down') recovered.push(row);
  }
  return { down, recovered };
}

/** Строка одной страницы: адрес, чьи это страницы, и причина, если она есть. */
function line(event: NotifyEvent): string {
  const parts = [event.url];
  if (event.frontCodes.length > 0) parts.push(event.frontCodes.join(', '));
  if (event.error) parts.push(event.error);
  return `• ${parts.join(' — ')}`;
}

/**
 * Сколько страниц перечисляем в разделе. Обрыв сети на сервере роняет разом все
 * ~600 целей, а в сообщении Telegram 4096 знаков — без границы сводка не
 * доедет вовсе. Число в заголовке при этом всегда полное: «упало 3» и «упало
 * 600» требуют разных действий, и обрезка не вправе это скрывать.
 */
export const MAX_LINES_PER_SECTION = 15;

function section(title: string, events: NotifyEvent[]): string[] {
  if (events.length === 0) return [];
  const shown = events.slice(0, MAX_LINES_PER_SECTION);
  const rest = events.length - shown.length;
  const lines = [`${title} (${events.length})`, ...shown.map(line)];
  if (rest > 0) lines.push(`…и ещё ${rest}`);
  return lines;
}

/**
 * Предел длины сводки. Лимит Telegram — 4096 знаков, и превышение отбивается
 * целиком: сообщение не приходит вообще. Запас оставлен под ссылку на дашборд,
 * которая дописывается уже после обрезки. Одних лимитов на число строк мало:
 * в живой базе лежит адрес длиной 2019 знаков.
 */
export const MAX_MESSAGE_CHARS = 3900;

const TRUNCATED_MARK = '\n…список обрезан';

/** Собирает текст сводки. `null` — сообщать нечего, отправлять не надо. */
export function buildDigest(
  down: NotifyEvent[],
  recovered: NotifyEvent[],
  baseUrl = '',
): string | null {
  if (down.length === 0 && recovered.length === 0) return null;

  const blocks: string[] = [];
  const fallen = section('🔴 Упало', down);
  if (fallen.length > 0) blocks.push(fallen.join('\n'));
  const back = section('🟢 Поднялось', recovered);
  if (back.length > 0) blocks.push(back.join('\n'));

  const body = blocks.join('\n\n');
  const text =
    body.length <= MAX_MESSAGE_CHARS
      ? body
      : body.slice(0, MAX_MESSAGE_CHARS - TRUNCATED_MARK.length) + TRUNCATED_MARK;

  // Ссылку дописываем ПОСЛЕ обрезки: она короткая и нужна именно в тот момент,
  // когда список не поместился и разбираться всё равно идти в дашборд.
  const link = baseUrl ? `\n\nДашборд: ${baseUrl.replace(/\/+$/, '')}/monitoring` : '';
  return text + link;
}

export interface TelegramConfig {
  token: string;
  chatIds: string[];
  baseUrl: string;
}

/**
 * Настройка живёт в окружении, как и всё остальное в мониторинге.
 * Нет токена или нет ни одного чата — уведомления просто выключены: локальная
 * разработка и тесты не должны ничего никуда отправлять по умолчанию.
 */
export function readTelegramConfig(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
): TelegramConfig | null {
  const token = (env.MONITOR_TELEGRAM_BOT_TOKEN ?? '').trim();
  const chatIds = (env.MONITOR_TELEGRAM_CHAT_IDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  if (!token || chatIds.length === 0) return null;

  return { token, chatIds, baseUrl: (env.PUBLIC_BASE_URL ?? '').trim() };
}

/**
 * Минимум от `fetch`, который нужен отправке. Узкий тип, чтобы в тестах
 * подменялся простой функцией, а в проде подставлялся глобальный `fetch`
 * (Node 20 в образе — зависимости не нужны).
 */
export type FetchLike = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

/** Сколько ждём Bot API. Висящий Telegram не должен держать цикл проверок. */
export const SEND_TIMEOUT_MS = 10_000;

/**
 * Рассылка текста по всем чатам. Возвращает число успешных отправок.
 *
 * Последовательно и без исключений наружу: уведомление о проверках не вправе
 * ронять сами проверки, а отказ одного чата (бота выгнали из группы) не должен
 * лишать сообщения остальных. Текст уходит без `parse_mode` — в адресах
 * сплошь `_`, `(` и `[`, и любая разметка требовала бы экранирования, ошибка
 * в котором отбивает сообщение целиком.
 */
export async function sendTelegram(
  config: TelegramConfig,
  text: string,
  fetchImpl: FetchLike = fetch,
): Promise<number> {
  const url = `https://api.telegram.org/bot${config.token}/sendMessage`;
  let sent = 0;

  for (const chatId of config.chatIds) {
    try {
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      });
      if (res.ok) {
        sent += 1;
      } else {
        // Токен и тело ответа в лог не кладём: в ответе Telegram эхом идёт
        // отправленный текст, а в URL — токен.
        console.error(`[monitor] Telegram отказал чату ${chatId}: HTTP ${res.status}`);
      }
    } catch (err) {
      console.error(`[monitor] не удалось отправить в чат ${chatId}`, err);
    }
  }

  return sent;
}

/** Коды воронок по каждой цели — одним запросом, чтобы не плодить N+1. */
function codesByTarget(db: AnyDB, targetIds: number[]): Map<number, string[]> {
  const map = new Map<number, string[]>();
  if (targetIds.length === 0) return map;

  const rows = (db
    .select({
      targetId: monitorTargetFunnels.targetId,
      id: funnels.id,
      num: funnels.num,
      frontCode: funnels.frontCode,
    })
    .from(monitorTargetFunnels)
    .innerJoin(funnels, eq(funnels.id, monitorTargetFunnels.funnelId))
    .where(inArray(monitorTargetFunnels.targetId, targetIds))
    .all()) as { targetId: number; id: number; num: number; frontCode: string }[];

  const grouped = new Map<number, typeof rows>();
  for (const row of rows) {
    const list = grouped.get(row.targetId);
    if (list) list.push(row);
    else grouped.set(row.targetId, [row]);
  }

  for (const [targetId, list] of grouped) {
    list.sort(compareByFrontCodeAsc);
    map.set(
      targetId,
      list.map((f) => funnelRefLabel(f)),
    );
  }
  return map;
}

export interface NotifyResult {
  down: number;
  recovered: number;
  /** В скольких чатов сводка реально ушла. */
  sent: number;
}

export interface NotifyOptions {
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  fetchImpl?: FetchLike;
}

/**
 * Сводка по событиям, появившимся после `sinceEventId`.
 *
 * `null` — отправлять было нечего или уведомления не настроены; это не ошибка.
 */
export async function notifyMonitorEvents(
  db: AnyDB,
  sinceEventId: number,
  opts: NotifyOptions = {},
): Promise<NotifyResult | null> {
  const rows = (db
    .select({
      targetId: monitorEvents.targetId,
      url: monitorTargets.url,
      fromStatus: monitorEvents.fromStatus,
      toStatus: monitorEvents.toStatus,
      error: monitorEvents.error,
    })
    .from(monitorEvents)
    .innerJoin(monitorTargets, eq(monitorTargets.id, monitorEvents.targetId))
    // enabled=1 — не «фоновый цикл проверяет только включённое» (это и так
    // верно само по себе, здесь ничего не меняет), а фильтр для ручной
    // проверки: она обходит ВСЕ цели воронки, включая выключенные, и первая
    // проверка черновика даёт десятки переходов unknown → down — не падения,
    // а ненастроенные страницы. Уведомляем ровно о том, о чём сообщил бы
    // фоновый цикл, — не больше.
    .where(and(gt(monitorEvents.id, sinceEventId), eq(monitorTargets.enabled, 1)))
    .orderBy(asc(monitorEvents.id))
    .all()) as {
    targetId: number;
    url: string;
    fromStatus: string;
    toStatus: string;
    error: string;
  }[];

  if (rows.length === 0) return null;

  const codes = codesByTarget(db, [...new Set(rows.map((r) => r.targetId))]);
  const events: NotifyEvent[] = rows.map((r) => ({
    url: r.url,
    fromStatus: r.fromStatus,
    toStatus: r.toStatus,
    error: r.error,
    frontCodes: codes.get(r.targetId) ?? [],
  }));

  const { down, recovered } = splitTransitions(events);
  const config = readTelegramConfig(opts.env ?? process.env);
  if (!config) return null;

  const text = buildDigest(down, recovered, config.baseUrl);
  if (text === null) return null;

  const sent = await sendTelegram(config, text, opts.fetchImpl);
  return { down: down.length, recovered: recovered.length, sent };
}
