/**
 * Телеграм-уведомления о падении страниц: отбор переходов, текст сообщения,
 * отправка. Сети нет — отправщик подменяется, конфиг приходит явным объектом.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { runMigratePhase6 } from '../scripts/migrate-phase6';
import * as schema from '../src/db/schema';
import { clearMonitoringState } from './helpers/monitoring';
import { copyDbForTest } from './helpers/db';
import {
  splitTransitions,
  buildDigest,
  readTelegramConfig,
  sendTelegram,
  notifyMonitorEvents,
  type NotifyEvent,
} from '../src/lib/monitor-notify';

function ev(partial: Partial<NotifyEvent>): NotifyEvent {
  return {
    url: 'https://a.ru/',
    fromStatus: 'unknown',
    toStatus: 'up',
    error: '',
    frontCodes: [],
    ...partial,
  };
}

describe('splitTransitions', () => {
  it('считает падением любой переход в down', () => {
    const rows = [
      ev({ fromStatus: 'up', toStatus: 'down' }),
      ev({ fromStatus: 'unknown', toStatus: 'down' }),
      ev({ fromStatus: 'slow', toStatus: 'down' }),
    ];

    const { down, recovered } = splitTransitions(rows);

    expect(down).toHaveLength(3);
    expect(recovered).toHaveLength(0);
  });

  it('считает восстановлением выход из down — в том числе в slow', () => {
    const rows = [
      ev({ fromStatus: 'down', toStatus: 'up' }),
      ev({ fromStatus: 'down', toStatus: 'slow' }),
    ];

    const { down, recovered } = splitTransitions(rows);

    expect(recovered).toHaveLength(2);
    expect(down).toHaveLength(0);
  });

  it('молчит про первую проверку и про мигание между up и slow', () => {
    const rows = [
      ev({ fromStatus: 'unknown', toStatus: 'up' }),
      ev({ fromStatus: 'unknown', toStatus: 'slow' }),
      ev({ fromStatus: 'up', toStatus: 'slow' }),
      ev({ fromStatus: 'slow', toStatus: 'up' }),
    ];

    const { down, recovered } = splitTransitions(rows);

    expect(down).toHaveLength(0);
    expect(recovered).toHaveLength(0);
  });
});

describe('buildDigest', () => {
  it('молчит, когда сообщать нечего', () => {
    expect(buildDigest([], [])).toBeNull();
  });

  it('показывает адрес, коды воронок и причину — и считает строки в заголовке', () => {
    const text = buildDigest(
      [
        ev({ url: 'https://t.ksamata.ru/dbo1', fromStatus: 'up', toStatus: 'down', error: 'HTTP 502', frontCodes: ['f34', 'f35'] }),
        ev({ url: 'https://gc.ksamata.ru/x', fromStatus: 'up', toStatus: 'down', error: 'Таймаут', frontCodes: [] }),
      ],
      [ev({ url: 'https://a.ru/', fromStatus: 'down', toStatus: 'up', frontCodes: ['f12'] })],
    );

    expect(text).toContain('Упало (2)');
    expect(text).toContain('https://t.ksamata.ru/dbo1 — f34, f35 — HTTP 502');
    expect(text).toContain('https://gc.ksamata.ru/x — Таймаут');
    expect(text).toContain('Поднялось (1)');
    expect(text).toContain('https://a.ru/ — f12');
  });

  it('режет длинный список, но в заголовке оставляет полное число', () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      ev({ url: `https://a.ru/${i}`, fromStatus: 'up', toStatus: 'down', error: 'HTTP 502' }),
    );

    const text = buildDigest(many, []) ?? '';

    expect(text).toContain('Упало (20)');
    expect(text).toContain('https://a.ru/14');
    expect(text).not.toContain('https://a.ru/15');
    expect(text).toContain('…и ещё 5');
  });

  it('не превышает лимит сообщения Telegram даже на очень длинных адресах', () => {
    // В живой базе лежит настоящая ссылка-сегмент GetCourse длиной 2019 знаков —
    // двух таких хватает, чтобы сводка не ушла вовсе.
    const long = 'https://ksamata.ru/' + 'x'.repeat(2000);
    const many = Array.from({ length: 15 }, () =>
      ev({ url: long, fromStatus: 'up', toStatus: 'down', error: 'HTTP 502' }),
    );

    const text = buildDigest(many, []) ?? '';

    expect(text.length).toBeLessThanOrEqual(4096);
    expect(text).toContain('список обрезан');
  });

  it('дописывает ссылку на дашборд, когда известен адрес сервиса', () => {
    const text = buildDigest(
      [ev({ fromStatus: 'up', toStatus: 'down', error: 'HTTP 502' })],
      [],
      'https://funnels.ksamata.ru',
    );

    expect(text).toContain('https://funnels.ksamata.ru/monitoring');
  });

  it('оставляет ссылку на дашборд даже у обрезанной сводки', () => {
    const long = 'https://ksamata.ru/' + 'x'.repeat(2000);
    const many = Array.from({ length: 15 }, () =>
      ev({ url: long, fromStatus: 'up', toStatus: 'down', error: 'HTTP 502' }),
    );

    const text = buildDigest(many, [], 'https://funnels.ksamata.ru') ?? '';

    expect(text).toContain('https://funnels.ksamata.ru/monitoring');
    expect(text.length).toBeLessThanOrEqual(4096);
  });
});

describe('readTelegramConfig', () => {
  it('без токена или без чатов уведомления выключены', () => {
    expect(readTelegramConfig({})).toBeNull();
    expect(readTelegramConfig({ MONITOR_TELEGRAM_BOT_TOKEN: '123:AA' })).toBeNull();
    expect(readTelegramConfig({ MONITOR_TELEGRAM_CHAT_IDS: '42' })).toBeNull();
  });

  it('разбирает список чатов и адрес сервиса', () => {
    const config = readTelegramConfig({
      MONITOR_TELEGRAM_BOT_TOKEN: '123:AA',
      MONITOR_TELEGRAM_CHAT_IDS: ' 42 , -100777 ,, ',
      PUBLIC_BASE_URL: 'https://funnels.ksamata.ru/',
    });

    expect(config).toEqual({
      token: '123:AA',
      chatIds: ['42', '-100777'],
      baseUrl: 'https://funnels.ksamata.ru/',
    });
  });
});

const config = { token: '123:AA', chatIds: ['42', '-100777'], baseUrl: '' };

describe('sendTelegram', () => {
  it('шлёт текст в каждый чат через Bot API', async () => {
    const calls: { url: string; body: unknown }[] = [];
    const fakeFetch = async (url: string, init?: { body?: string }) => {
      calls.push({ url, body: JSON.parse(init?.body ?? '{}') });
      return { ok: true, status: 200, text: async () => '' };
    };

    const sent = await sendTelegram(config, 'упало', fakeFetch);

    expect(sent).toBe(2);
    expect(calls[0].url).toBe('https://api.telegram.org/bot123:AA/sendMessage');
    expect(calls[0].body).toMatchObject({
      chat_id: '42',
      text: 'упало',
      disable_web_page_preview: true,
    });
    expect(calls[1].body).toMatchObject({ chat_id: '-100777' });
  });

  it('не бросает и продолжает рассылку, если один чат отказал', async () => {
    // Отказ логируется — в выводе тестов этот шум не нужен.
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const seen: string[] = [];
    const fakeFetch = async (_url: string, init?: { body?: string }) => {
      const chat = JSON.parse(init?.body ?? '{}').chat_id as string;
      seen.push(chat);
      if (chat === '42') throw new Error('сеть отвалилась');
      return { ok: true, status: 200, text: async () => '' };
    };

    const sent = await sendTelegram(config, 'упало', fakeFetch);

    expect(seen).toEqual(['42', '-100777']);
    expect(sent).toBe(1);
    log.mockRestore();
  });

  it('не считает успехом ответ Telegram с ошибкой', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fakeFetch = async () => ({ ok: false, status: 400, text: async () => 'chat not found' });

    const sent = await sendTelegram(config, 'упало', fakeFetch);

    expect(sent).toBe(0);
    log.mockRestore();
  });
});

describe('notifyMonitorEvents', () => {
  const REAL_DB = path.resolve(process.cwd(), '..', 'ksamata_funnels.db');
  let tmp: string;
  let sqlite: Database.Database;
  let db: ReturnType<typeof drizzle<typeof schema>>;

  const env = {
    MONITOR_TELEGRAM_BOT_TOKEN: '123:AA',
    MONITOR_TELEGRAM_CHAT_IDS: '42',
  };

  /** Собирает тексты, ушедшие в Bot API. */
  function recorder() {
    const texts: string[] = [];
    const fakeFetch = async (_url: string, init?: { body?: string }) => {
      texts.push(JSON.parse(init?.body ?? '{}').text as string);
      return { ok: true, status: 200, text: async () => '' };
    };
    return { fakeFetch, texts };
  }

  function seedTarget(url: string, enabled: 0 | 1 = 1): number {
    return sqlite
      .prepare(`INSERT INTO monitor_targets (url, source_kind, enabled) VALUES (?, 'landings', ?)`)
      .run(url, enabled).lastInsertRowid as number;
  }

  function seedEvent(targetId: number, from: string, to: string, error = ''): void {
    sqlite
      .prepare(
        `INSERT INTO monitor_events (target_id, from_status, to_status, error) VALUES (?, ?, ?, ?)`,
      )
      .run(targetId, from, to, error);
  }

  function maxEventId(): number {
    return (sqlite.prepare(`SELECT COALESCE(MAX(id), 0) AS m FROM monitor_events`).get() as {
      m: number;
    }).m;
  }

  beforeEach(() => {
    tmp = path.join(os.tmpdir(), `mn-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
    copyDbForTest(REAL_DB, tmp);
    sqlite = new Database(tmp);
    sqlite.pragma('foreign_keys = ON');
    runMigratePhase6(sqlite);
    clearMonitoringState(sqlite);
    db = drizzle(sqlite, { schema });
  });

  afterEach(() => {
    sqlite.close();
    fs.rmSync(tmp, { force: true });
  });

  it('шлёт одну сводку с адресом и кодом воронки, которая держит страницу', async () => {
    const funnel = sqlite
      .prepare(`SELECT id, front_code FROM funnels WHERE front_code <> '' ORDER BY id LIMIT 1`)
      .get() as { id: number; front_code: string };
    const target = seedTarget('https://t.ksamata.ru/dbo1');
    sqlite
      .prepare(`INSERT INTO monitor_target_funnels (target_id, funnel_id) VALUES (?, ?)`)
      .run(target, funnel.id);
    const since = maxEventId();
    seedEvent(target, 'up', 'down', 'HTTP 502');

    const { fakeFetch, texts } = recorder();
    await notifyMonitorEvents(db, since, { env, fetchImpl: fakeFetch });

    expect(texts).toHaveLength(1);
    expect(texts[0]).toContain('https://t.ksamata.ru/dbo1');
    expect(texts[0]).toContain(funnel.front_code);
    expect(texts[0]).toContain('HTTP 502');
  });

  it('молчит, когда цели только что завели и они поднялись', async () => {
    const since = maxEventId();
    for (let i = 0; i < 5; i += 1) seedEvent(seedTarget(`https://a.ru/${i}`), 'unknown', 'up');

    const { fakeFetch, texts } = recorder();
    const result = await notifyMonitorEvents(db, since, { env, fetchImpl: fakeFetch });

    expect(texts).toEqual([]);
    expect(result).toBeNull();
  });

  it('не шлёт ничего, пока бот не настроен', async () => {
    const since = maxEventId();
    seedEvent(seedTarget('https://a.ru/'), 'up', 'down', 'HTTP 502');

    const { fakeFetch, texts } = recorder();
    const result = await notifyMonitorEvents(db, since, { env: {}, fetchImpl: fakeFetch });

    expect(texts).toEqual([]);
    expect(result).toBeNull();
  });

  it('берёт только события, появившиеся после отсечки', async () => {
    const old = seedTarget('https://old.ru/');
    seedEvent(old, 'up', 'down', 'HTTP 500');
    const since = maxEventId();
    const fresh = seedTarget('https://fresh.ru/');
    seedEvent(fresh, 'up', 'down', 'HTTP 502');

    const { fakeFetch, texts } = recorder();
    await notifyMonitorEvents(db, since, { env, fetchImpl: fakeFetch });

    expect(texts[0]).toContain('https://fresh.ru/');
    expect(texts[0]).not.toContain('https://old.ru/');
  });

  // Фильтр по enabled нужен ручной проверке воронки (задача 5, правило
  // сужено задачей 6 — selectFunnelCheckTargets в monitor-targets.ts): та
  // берёт не «все цели подряд», а enabled=1 ИЛИ цели с включённым дефолтом
  // их группы — но у черновика это по-прежнему выключенные цели групп вроде
  // landings, и первая такая проверка даёт десятки переходов unknown → down
  // — не падения, а ненастроенные страницы. Фоновый цикл проверяет только
  // включённые цели и без фильтра, поэтому его события фильтр не задевает
  // (см. тесты выше — все используют enabled=1 по умолчанию и остаются
  // зелёными без правок).
  it('шлёт событие включённой цели', async () => {
    const since = maxEventId();
    const target = seedTarget('https://on.ru/', 1);
    seedEvent(target, 'up', 'down', 'HTTP 502');

    const { fakeFetch, texts } = recorder();
    const result = await notifyMonitorEvents(db, since, { env, fetchImpl: fakeFetch });

    expect(texts).toHaveLength(1);
    expect(texts[0]).toContain('https://on.ru/');
    expect(result?.down).toBe(1);
  });

  it('молчит про событие выключенной цели', async () => {
    const since = maxEventId();
    const target = seedTarget('https://off.ru/', 0);
    seedEvent(target, 'up', 'down', 'HTTP 502');

    const { fakeFetch, texts } = recorder();
    const result = await notifyMonitorEvents(db, since, { env, fetchImpl: fakeFetch });

    expect(texts).toEqual([]);
    expect(result).toBeNull();
  });
});
