/**
 * Проверка одного URL. Сети здесь нет — fetch подменяется через opts.fetchImpl,
 * поэтому тесты детерминированы и не ходят на боевые ленды.
 */
import { describe, it, expect } from 'vitest';
import { checkUrl, type FetchLike } from '../src/lib/monitor-check';

/** Ответ-заглушка: у Response нет сеттера url, поэтому собираем совместимый объект. */
function fakeResponse(status: number, finalUrl: string): Response {
  return {
    status,
    url: finalUrl,
    body: null,
  } as unknown as Response;
}

/** Подменённый fetch с управляемой задержкой на подменённых же часах. */
function fakeFetch(
  response: Response | Error,
  elapsedMs = 0,
  clock?: { value: number }
): FetchLike {
  return async () => {
    if (clock) clock.value += elapsedMs;
    if (response instanceof Error) throw response;
    return response;
  };
}

function clockOpts(clock: { value: number }) {
  return { nowMs: () => clock.value };
}

describe('checkUrl', () => {
  it('считает 200 живым', async () => {
    const res = await checkUrl('https://a.ru/', {
      fetchImpl: fakeFetch(fakeResponse(200, 'https://a.ru/')),
    });
    expect(res.status).toBe('up');
    expect(res.httpStatus).toBe(200);
    expect(res.error).toBe('');
  });

  it('шлёт GET, а не HEAD — часть лендов отвечает на HEAD кодом 405', async () => {
    let seenMethod = '';
    const spy: FetchLike = async (_url, init) => {
      seenMethod = String(init.method);
      return fakeResponse(200, 'https://a.ru/');
    };
    await checkUrl('https://a.ru/', { fetchImpl: spy });
    expect(seenMethod).toBe('GET');
  });

  it('помечает медленный ответ как slow', async () => {
    const clock = { value: 0 };
    const res = await checkUrl('https://a.ru/', {
      fetchImpl: fakeFetch(fakeResponse(200, 'https://a.ru/'), 6000, clock),
      ...clockOpts(clock),
    });
    expect(res.status).toBe('slow');
    expect(res.latencyMs).toBe(6000);
  });

  it('оставляет up ответ на границе порога', async () => {
    const clock = { value: 0 };
    const res = await checkUrl('https://a.ru/', {
      fetchImpl: fakeFetch(fakeResponse(200, 'https://a.ru/'), 5000, clock),
      ...clockOpts(clock),
    });
    expect(res.status).toBe('up');
  });

  it('роняет 404 и 500 в down с кодом в тексте ошибки', async () => {
    for (const code of [404, 500]) {
      const res = await checkUrl('https://a.ru/', {
        fetchImpl: fakeFetch(fakeResponse(code, 'https://a.ru/')),
      });
      expect(res.status).toBe('down');
      expect(res.httpStatus).toBe(code);
      expect(res.error).toContain(String(code));
    }
  });

  it('роняет редирект на страницу с ошибкой', async () => {
    const res = await checkUrl('https://a.ru/', {
      fetchImpl: fakeFetch(fakeResponse(403, 'https://gc.ru/login')),
    });
    expect(res.status).toBe('down');
    expect(res.finalUrl).toBe('https://gc.ru/login');
  });

  it('запоминает финальный URL после редиректа', async () => {
    const res = await checkUrl('https://a.ru/', {
      fetchImpl: fakeFetch(fakeResponse(200, 'https://b.ru/new')),
    });
    expect(res.status).toBe('up');
    expect(res.finalUrl).toBe('https://b.ru/new');
  });

  it('превращает таймаут в down с понятным текстом', async () => {
    const timeout = new Error('timed out');
    timeout.name = 'TimeoutError';
    const res = await checkUrl('https://a.ru/', { fetchImpl: fakeFetch(timeout) });
    expect(res.status).toBe('down');
    expect(res.httpStatus).toBeNull();
    expect(res.error).toContain('Таймаут');
  });

  it('указывает в сообщении об ошибке фактический таймаут, не дефолт', async () => {
    const timeout = new Error('timed out');
    timeout.name = 'TimeoutError';
    // Вызваем с кастомным таймаутом 2 секунды вместо дефолтных 10
    const res = await checkUrl('https://a.ru/', {
      fetchImpl: fakeFetch(timeout),
      timeoutMs: 2000,
    });
    expect(res.status).toBe('down');
    expect(res.error).toBe('Таймаут 2 с');
  });

  it('расшифровывает нерезолвящийся домен', async () => {
    const dns = new Error('fetch failed');
    (dns as Error & { cause?: { code: string } }).cause = { code: 'ENOTFOUND' };
    const res = await checkUrl('https://nope.ru/', { fetchImpl: fakeFetch(dns) });
    expect(res.status).toBe('down');
    expect(res.error).toContain('ENOTFOUND');
  });

  it('просит не кешировать и представляется в User-Agent', async () => {
    let seenInit: RequestInit | undefined;
    const spy: FetchLike = async (_url, init) => {
      seenInit = init;
      return fakeResponse(200, 'https://a.ru/');
    };
    await checkUrl('https://a.ru/', { fetchImpl: spy });
    expect(seenInit?.redirect).toBe('follow');
    expect(seenInit?.cache).toBe('no-store');
    expect(String((seenInit?.headers as Record<string, string>)['User-Agent'])).toContain('Ksamata');
  });
});
