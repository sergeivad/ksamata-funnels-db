/**
 * Проверка одного URL. Сети здесь нет — fetch подменяется через opts.fetchImpl,
 * а резолвер через opts.lookupImpl, поэтому тесты детерминированы и не ходят
 * ни на боевые ленды, ни в DNS.
 */
import { describe, it, expect } from 'vitest';
import { checkUrl as checkUrlImpl, type FetchLike, type CheckOptions } from '../src/lib/monitor-check';
import type { LookupFn } from '../src/lib/monitor-dns';

/** Резолвер-заглушка: любой хост считается публичным. */
const publicLookup: LookupFn = async () => ['93.184.216.34'];

/**
 * Все проверки идут через обёртку: боевой `checkUrl` резолвит хост перед
 * соединением, и без подмены резолвера тесты полезли бы в настоящий DNS.
 */
function checkUrl(url: string, opts: CheckOptions = {}) {
  return checkUrlImpl(url, { lookupImpl: publicLookup, ...opts });
}

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

  it('считает живым любой 2xx, а не только ровно 200', async () => {
    for (const code of [201, 204, 226]) {
      const res = await checkUrl('https://a.ru/', {
        fetchImpl: fakeFetch(fakeResponse(code, 'https://a.ru/')),
      });
      expect(res.status).toBe('up');
      expect(res.httpStatus).toBe(code);
      expect(res.error).toBe('');
    }
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

  /** Ответ-редирект с заголовком Location — чекер обязан разбирать его сам. */
  function redirectTo(location: string, status = 302, from = 'https://a.ru/'): Response {
    return {
      status,
      url: from,
      body: null,
      headers: new Headers({ location }),
    } as unknown as Response;
  }

  /** fetch, отдающий заготовленные ответы по очереди и запоминающий, куда ходил. */
  function scriptedFetch(responses: Response[]): { fetchImpl: FetchLike; visited: string[] } {
    const visited: string[] = [];
    let i = 0;
    return {
      visited,
      fetchImpl: async (url) => {
        visited.push(url);
        return responses[Math.min(i++, responses.length - 1)];
      },
    };
  }

  it('идёт по редиректу на обычный домен и запоминает конечный адрес', async () => {
    const { fetchImpl, visited } = scriptedFetch([
      redirectTo('https://b.ru/new'),
      fakeResponse(200, 'https://b.ru/new'),
    ]);
    const res = await checkUrl('https://a.ru/', { fetchImpl });

    expect(res.status).toBe('up');
    expect(res.finalUrl).toBe('https://b.ru/new');
    expect(visited).toEqual(['https://a.ru/', 'https://b.ru/new']);
  });

  it('не идёт по редиректу на внутренний адрес', async () => {
    const { fetchImpl, visited } = scriptedFetch([
      redirectTo('http://169.254.169.254/latest/meta-data/'),
      fakeResponse(200, 'http://169.254.169.254/latest/meta-data/'),
    ]);
    const res = await checkUrl('https://a.ru/', { fetchImpl });

    expect(res.status).toBe('down');
    expect(visited).toEqual(['https://a.ru/']);
    // Ни адрес, ни код ответа внутреннего сервиса не должны утечь в дашборд.
    expect(res.finalUrl).not.toContain('169.254.169.254');
    expect(res.error).not.toContain('169.254.169.254');
  });

  it('не идёт по редиректу на нестандартный порт', async () => {
    const { fetchImpl, visited } = scriptedFetch([
      redirectTo('http://intranet.example.com:6379/'),
      fakeResponse(200, 'http://intranet.example.com:6379/'),
    ]);
    const res = await checkUrl('https://a.ru/', { fetchImpl });

    expect(res.status).toBe('down');
    expect(visited).toEqual(['https://a.ru/']);
  });

  it('обрывает бесконечную цепочку редиректов', async () => {
    let n = 0;
    const visited: string[] = [];
    const fetchImpl: FetchLike = async (url) => {
      visited.push(url);
      return redirectTo(`https://b.ru/hop${n++}`);
    };
    const res = await checkUrl('https://a.ru/', { fetchImpl });

    expect(res.status).toBe('down');
    expect(visited.length).toBeLessThanOrEqual(6);
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

  it('не соединяется с доменом, чья A-запись ведёт во внутреннюю сеть', async () => {
    // 10.0.0.5.nip.io и подобные: имя с точками проходит normalizeUrl, а
    // резолвится в приватную сеть. Отсев IP-литералов такое не ловит.
    const visited: string[] = [];
    const fetchImpl: FetchLike = async (url) => {
      visited.push(url);
      return fakeResponse(200, url);
    };
    const res = await checkUrl('http://10.0.0.5.nip.io/', {
      fetchImpl,
      lookupImpl: async () => ['10.0.0.5'],
    });

    expect(res.status).toBe('down');
    expect(visited).toEqual([]); // соединения не было вовсе
    expect(res.error).not.toContain('10.0.0.5');
    expect(res.finalUrl).not.toContain('10.0.0.5');
  });

  it('заворачивает хост, если хотя бы один из его адресов приватный', async () => {
    // Резолвер вернул два адреса; соединение может уйти на любой из них.
    const visited: string[] = [];
    const fetchImpl: FetchLike = async (url) => {
      visited.push(url);
      return fakeResponse(200, url);
    };
    const res = await checkUrl('https://a.ru/', {
      fetchImpl,
      lookupImpl: async () => ['93.184.216.34', '127.0.0.1'],
    });

    expect(res.status).toBe('down');
    expect(visited).toEqual([]);
  });

  it('проверяет адрес заново на каждом шаге редиректа', async () => {
    // Первый хост публичный, редирект уводит на домен с приватной A-записью.
    const { fetchImpl, visited } = scriptedFetch([
      redirectTo('https://internal.example.com/'),
      fakeResponse(200, 'https://internal.example.com/'),
    ]);
    const res = await checkUrl('https://a.ru/', {
      fetchImpl,
      lookupImpl: async (host) => (host === 'a.ru' ? ['93.184.216.34'] : ['10.1.2.3']),
    });

    expect(res.status).toBe('down');
    expect(visited).toEqual(['https://a.ru/']);
  });

  it('пускает на публичный адрес — проверка не глушит нормальные цели', async () => {
    const res = await checkUrl('https://a.ru/', {
      fetchImpl: fakeFetch(fakeResponse(200, 'https://a.ru/')),
      lookupImpl: async () => ['213.180.204.242'],
    });
    expect(res.status).toBe('up');
  });

  it('расшифровывает ошибку самого резолвера, а не только fetch', async () => {
    const dns = new Error('getaddrinfo ENOTFOUND nope.ru');
    (dns as Error & { code?: string }).code = 'ENOTFOUND';
    const res = await checkUrl('https://nope.ru/', {
      fetchImpl: fakeFetch(fakeResponse(200, 'https://nope.ru/')),
      lookupImpl: async () => {
        throw dns;
      },
    });
    expect(res.status).toBe('down');
    expect(res.error).toBe('Домен не резолвится (ENOTFOUND)');
  });

  it('не даёт зависшему резолверу держать проверку дольше таймаута', async () => {
    // dns.lookup не принимает AbortSignal, поэтому без своего бюджета
    // «десять секунд на цель» превращались бы в системный таймаут getaddrinfo.
    const res = await checkUrl('https://a.ru/', {
      timeoutMs: 20,
      fetchImpl: fakeFetch(fakeResponse(200, 'https://a.ru/')),
      lookupImpl: () => new Promise<string[]>(() => {}), // никогда не отвечает
    });
    expect(res.status).toBe('down');
    expect(res.error).toBe('Таймаут 0.02 с');
  });

  it('просит не кешировать и представляется в User-Agent', async () => {
    let seenInit: RequestInit | undefined;
    const spy: FetchLike = async (_url, init) => {
      seenInit = init;
      return fakeResponse(200, 'https://a.ru/');
    };
    await checkUrl('https://a.ru/', { fetchImpl: spy });
    // Не 'follow': по редиректам чекер идёт сам, проверяя каждый шаг (см. выше).
    expect(seenInit?.redirect).toBe('manual');
    expect(seenInit?.cache).toBe('no-store');
    expect(String((seenInit?.headers as Record<string, string>)['User-Agent'])).toContain('Ksamata');
  });
});
