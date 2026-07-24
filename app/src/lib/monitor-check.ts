/**
 * Проверка доступности одного URL. Про БД ничего не знает — это делает
 * функцию тестируемой подменой fetch и переиспользуемой из любого места.
 */

export const CHECK_TIMEOUT_MS = 10_000;
export const SLOW_THRESHOLD_MS = 5_000;
export const MONITOR_USER_AGENT = 'KsamataFunnelsMonitor/1.0';

export interface CheckResult {
  status: 'up' | 'slow' | 'down';
  httpStatus: number | null;
  finalUrl: string;
  latencyMs: number;
  error: string;
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/** Сигнатура проверяльщика — цикл принимает её, чтобы тесты обходились без сети. */
export type CheckFn = (url: string) => Promise<CheckResult>;

export interface CheckOptions {
  timeoutMs?: number;
  slowMs?: number;
  fetchImpl?: FetchLike;
  nowMs?: () => number;
}

/** Человекочитаемая расшифровка сетевой ошибки — она попадёт прямо в дашборд. */
function describeFetchError(err: unknown, timeoutMs?: number): string {
  if (!(err instanceof Error)) return 'Неизвестная ошибка';
  if (err.name === 'TimeoutError') {
    // Используем переданный таймаут, если есть; иначе фиксированный по умолчанию
    const actualTimeoutSec = (timeoutMs ?? CHECK_TIMEOUT_MS) / 1000;
    return `Таймаут ${actualTimeoutSec} с`;
  }
  if (err.name === 'AbortError') return 'Запрос прерван';
  const code = (err as Error & { cause?: { code?: string } }).cause?.code;
  if (code === 'ENOTFOUND') return 'Домен не резолвится (ENOTFOUND)';
  if (code === 'ECONNREFUSED') return 'Соединение отклонено (ECONNREFUSED)';
  if (code === 'CERT_HAS_EXPIRED') return 'Истёк SSL-сертификат';
  if (code) return `Сетевая ошибка (${code})`;
  return err.message.slice(0, 200);
}

export async function checkUrl(url: string, opts: CheckOptions = {}): Promise<CheckResult> {
  const timeoutMs = opts.timeoutMs ?? CHECK_TIMEOUT_MS;
  const slowMs = opts.slowMs ?? SLOW_THRESHOLD_MS;
  const doFetch = opts.fetchImpl ?? ((u, init) => fetch(u, init));
  const now = opts.nowMs ?? (() => Date.now());

  const started = now();
  try {
    const res = await doFetch(url, {
      method: 'GET',
      redirect: 'follow',
      cache: 'no-store',
      headers: { 'User-Agent': MONITOR_USER_AGENT },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const latencyMs = now() - started;

    // Тело не нужно: рвём поток, чтобы не тянуть мегабайты HTML на каждый цикл.
    try {
      await res.body?.cancel();
    } catch {
      // поток уже закрыт — не наша забота
    }

    if (res.status === 200) {
      return {
        status: latencyMs > slowMs ? 'slow' : 'up',
        httpStatus: 200,
        finalUrl: res.url,
        latencyMs,
        error: '',
      };
    }

    return {
      status: 'down',
      httpStatus: res.status,
      finalUrl: res.url,
      latencyMs,
      error: `HTTP ${res.status}`,
    };
  } catch (err: unknown) {
    return {
      status: 'down',
      httpStatus: null,
      finalUrl: '',
      latencyMs: now() - started,
      error: describeFetchError(err, timeoutMs),
    };
  }
}
