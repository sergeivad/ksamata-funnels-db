/**
 * Проверка доступности одного URL. Про БД ничего не знает — это делает
 * функцию тестируемой подменой fetch и переиспользуемой из любого места.
 */

import { resolveRedirectTarget } from './monitor-urls';
import { isPrivateAddress, type LookupFn } from './monitor-dns';
import { resolveHostAddresses } from './monitor-resolver';

export const CHECK_TIMEOUT_MS = 10_000;
export const SLOW_THRESHOLD_MS = 5_000;
export const MONITOR_USER_AGENT = 'KsamataFunnelsMonitor/1.0';

/** Сколько шагов редиректа проходим, прежде чем считать цепочку сломанной. */
export const MAX_REDIRECTS = 5;

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

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
  lookupImpl?: LookupFn;
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
  // У fetch код лежит в cause, у резолвера (`dns.lookup`) — прямо на ошибке.
  const withCode = err as Error & { code?: string; cause?: { code?: string } };
  const code = withCode.cause?.code ?? withCode.code;
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
  const lookup = opts.lookupImpl ?? resolveHostAddresses;

  /**
   * `dns.lookup` не принимает AbortSignal, поэтому зависший резолвер держал бы
   * воркер цикла столько, сколько решит системный getaddrinfo. Даём ему тот же
   * бюджет, что и запросу: общий сигнал к этому моменту всё равно уже истечёт,
   * так что суммарно цель не займёт больше одного таймаута.
   */
  function lookupWithBudget(hostname: string): Promise<string[]> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        const err = new Error('DNS lookup timed out');
        err.name = 'TimeoutError';
        reject(err);
      }, timeoutMs);
    });
    return Promise.race([lookup(hostname), deadline]).finally(() => clearTimeout(timer));
  }

  const started = now();
  // Один сигнал на всю цепочку: иначе N редиректов растягивали бы проверку на
  // N таймаутов, и «десять секунд на цель» превращалось бы в минуту.
  const signal = AbortSignal.timeout(timeoutMs);

  try {
    let current = url;

    for (let hop = 0; ; hop++) {
      // Хост резолвится перед КАЖДЫМ соединением. `normalizeUrl` отсеивает
      // IP-литералы, но домен адресом не является: `10.0.0.5.nip.io` — обычное
      // имя с точками, а ведёт в приватную сеть. Проверять надо то, куда
      // соединение действительно уйдёт.
      const addresses = await lookupWithBudget(new URL(current).hostname);
      if (addresses.length === 0 || addresses.some(isPrivateAddress)) {
        // Ни адрес, ни факт «там что-то есть» наружу не отдаём: дашборд не
        // должен работать справочником по внутренней сети.
        return {
          status: 'down',
          httpStatus: null,
          finalUrl: '',
          latencyMs: now() - started,
          error: 'Адрес ведёт во внутреннюю сеть',
        };
      }

      const res = await doFetch(current, {
        method: 'GET',
        // Идём по редиректам сами: каждый следующий адрес обязан пройти тот же
        // допуск, что и цель при заведении. С redirect: 'follow' этот допуск
        // касался бы только первого адреса.
        redirect: 'manual',
        cache: 'no-store',
        headers: { 'User-Agent': MONITOR_USER_AGENT },
        signal,
      });
      const latencyMs = now() - started;

      // Тело не нужно: рвём поток, чтобы не тянуть мегабайты HTML на каждый цикл.
      try {
        await res.body?.cancel();
      } catch {
        // поток уже закрыт — не наша забота
      }

      const location = REDIRECT_STATUSES.has(res.status)
        ? res.headers?.get('location') ?? null
        : null;

      if (location !== null) {
        if (hop >= MAX_REDIRECTS) {
          return { status: 'down', httpStatus: res.status, finalUrl: current, latencyMs,
            error: `Больше ${MAX_REDIRECTS} редиректов` };
        }
        const next = resolveRedirectTarget(location, current);
        if (next === null) {
          // Адрес назначения намеренно не показываем: страница мониторинга
          // видна всем, кто видит админку, и не должна работать справочником
          // по внутренней сети.
          return { status: 'down', httpStatus: res.status, finalUrl: current, latencyMs,
            error: 'Редирект на недопустимый адрес' };
        }
        current = next;
        continue;
      }

      // Любой 2xx — страница отдалась. Раньше живым считался ровно 200, и
      // валидный 204 или 206 попадал в down как «упавший лендинг».
      // Редиректы сюда не доходят: они разобраны выше.
      if (res.status >= 200 && res.status < 300) {
        return {
          status: latencyMs > slowMs ? 'slow' : 'up',
          httpStatus: res.status,
          finalUrl: res.url || current,
          latencyMs,
          error: '',
        };
      }

      return {
        status: 'down',
        httpStatus: res.status,
        finalUrl: res.url || current,
        latencyMs,
        error: `HTTP ${res.status}`,
      };
    }
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
