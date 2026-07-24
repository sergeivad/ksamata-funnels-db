/**
 * HTTP-слой мониторинга. Каждая проверка идёт на свежей временной КОПИИ БД,
 * `@/db/client` подменяется drizzle-хендлом над копией (как в api-tag-templates-route.test.ts).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { runMigratePhase6 } from '../scripts/migrate-phase6';
import * as schema from '../src/db/schema';

const REAL_DB = path.resolve(process.cwd(), '..', 'ksamata_funnels.db');
let tmp: string;
let sqlite: Database.Database;
let db: ReturnType<typeof drizzle<typeof schema>>;

/* eslint-disable @typescript-eslint/consistent-type-imports */
let GET: typeof import('../src/app/api/monitoring/route').GET;
let PATCH_ONE: typeof import('../src/app/api/monitoring/targets/[id]/route').PATCH;
let PATCH_BULK: typeof import('../src/app/api/monitoring/targets/route').PATCH;
let GET_EVENTS: typeof import('../src/app/api/monitoring/events/route').GET;
/* eslint-enable @typescript-eslint/consistent-type-imports */

beforeEach(async () => {
  tmp = path.join(os.tmpdir(), `mapi-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  fs.copyFileSync(REAL_DB, tmp);
  sqlite = new Database(tmp);
  sqlite.pragma('foreign_keys = ON');
  runMigratePhase6(sqlite);
  db = drizzle(sqlite, { schema });
  vi.doMock('@/db/client', () => ({ db }));

  GET = (await import('../src/app/api/monitoring/route')).GET;
  PATCH_ONE = (await import('../src/app/api/monitoring/targets/[id]/route')).PATCH;
  PATCH_BULK = (await import('../src/app/api/monitoring/targets/route')).PATCH;
  GET_EVENTS = (await import('../src/app/api/monitoring/events/route')).GET;
});

afterEach(() => {
  vi.resetModules();
  sqlite.close();
  fs.rmSync(tmp, { force: true });
});

function jsonReq(method: string, body: unknown) {
  return new Request('http://test', { method, body: JSON.stringify(body) }) as never;
}
function rawReq(method: string, raw: string) {
  return new Request('http://test', { method, body: raw }) as never;
}
function urlReq(url: string) {
  return new Request(url) as never;
}
const params = (id: string) => ({ params: Promise.resolve({ id }) });

function seedTarget(url: string, sourceKind = 'landings', enabled = 1): number {
  const id = sqlite
    .prepare(`INSERT INTO monitor_targets (url, source_kind, enabled) VALUES (?, ?, ?)`)
    .run(url, sourceKind, enabled).lastInsertRowid as number;
  sqlite.prepare(`INSERT INTO monitor_state (target_id, status) VALUES (?, 'up')`).run(id);
  return id;
}

describe('GET /api/monitoring', () => {
  it('отдаёт сводку, виды источников и цели', async () => {
    seedTarget('https://a.ru/');
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.summary.enabled).toBe(1);
    expect(Array.isArray(body.targets)).toBe(true);
    expect(Array.isArray(body.sourceKinds)).toBe(true);
  });
});

describe('PATCH /api/monitoring/targets/[id]', () => {
  it('переключает одну цель', async () => {
    const id = seedTarget('https://a.ru/');
    const res = await PATCH_ONE(jsonReq('PATCH', { enabled: false }), params(String(id)));
    expect(res.status).toBe(200);
    const row = sqlite.prepare(`SELECT enabled FROM monitor_targets WHERE id = ?`).get(id) as {
      enabled: number;
    };
    expect(row.enabled).toBe(0);
  });

  it('отвечает 400 на нечисловой id', async () => {
    const res = await PATCH_ONE(jsonReq('PATCH', { enabled: true }), params('12abc'));
    expect(res.status).toBe(400);
  });

  it('отвечает 404 на несуществующую цель', async () => {
    const res = await PATCH_ONE(jsonReq('PATCH', { enabled: true }), params('999999'));
    expect(res.status).toBe(404);
  });

  it('отвечает 400 на битый JSON', async () => {
    const id = seedTarget('https://a.ru/');
    const res = await PATCH_ONE(rawReq('PATCH', '{bad'), params(String(id)));
    expect(res.status).toBe(400);
  });

  it('отвечает 400 на тело, не прошедшее валидацию', async () => {
    const id = seedTarget('https://a.ru/');
    const res = await PATCH_ONE(jsonReq('PATCH', { enabled: 'yes' }), params(String(id)));
    expect(res.status).toBe(400);
  });
});

describe('PATCH /api/monitoring/targets', () => {
  it('включает целую группу', async () => {
    seedTarget('https://g1.ru/', 'links', 0);
    seedTarget('https://g2.ru/', 'links', 0);

    const res = await PATCH_BULK(jsonReq('PATCH', { sourceKind: 'links', enabled: true }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.affected).toBe(2);
  });

  it('отвечает 400 на пустой sourceKind', async () => {
    const res = await PATCH_BULK(jsonReq('PATCH', { sourceKind: '', enabled: true }));
    expect(res.status).toBe(400);
  });
});

describe('GET /api/monitoring/events', () => {
  it('отдаёт историю с учётом limit', async () => {
    const id = seedTarget('https://a.ru/');
    for (let i = 0; i < 3; i += 1) {
      sqlite
        .prepare(`INSERT INTO monitor_events (target_id, from_status, to_status) VALUES (?, 'up', 'down')`)
        .run(id);
    }
    const res = await GET_EVENTS(urlReq('http://test/api/monitoring/events?limit=2'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.events).toHaveLength(2);
  });

  it('игнорирует мусорный limit и подменяет на значение по умолчанию', async () => {
    // Добавляем 5 событий. При limit=abc должен срработать fallback (DEFAULT_LIMIT=50),
    // который вернёт все 5, а не 0 или NaN. Если readNumber() был сломан,
    // вернул бы NaN, 0 или undefined — тест упадёт.
    const id = seedTarget('https://a.ru/');
    for (let i = 0; i < 5; i += 1) {
      sqlite
        .prepare(`INSERT INTO monitor_events (target_id, from_status, to_status) VALUES (?, 'up', 'down')`)
        .run(id);
    }
    const res = await GET_EVENTS(urlReq('http://test/api/monitoring/events?limit=abc'));
    expect(res.status).toBe(200);
    const body = await res.json();
    // Проверяем, что fallback сработал и вернулись все 5 событий,
    // а не 0 (если readNumber вернул NaN или 0).
    expect(body.events).toHaveLength(5);
  });

  it('обрабатывает отрицательные и нулевые limit', async () => {
    const id = seedTarget('https://a.ru/');
    for (let i = 0; i < 3; i += 1) {
      sqlite
        .prepare(`INSERT INTO monitor_events (target_id, from_status, to_status) VALUES (?, 'up', 'down')`)
        .run(id);
    }
    // limit=-5 не проходит паттерн ^\d+$, должен упасть на fallback (50).
    const res1 = await GET_EVENTS(urlReq('http://test/api/monitoring/events?limit=-5'));
    expect(res1.status).toBe(200);
    const body1 = await res1.json();
    expect(body1.events).toHaveLength(3); // все события вернулись

    // limit=0 проходит паттерн и зажимается на Math.min(0, 200) = 0.
    const res2 = await GET_EVENTS(urlReq('http://test/api/monitoring/events?limit=0'));
    expect(res2.status).toBe(200);
    const body2 = await res2.json();
    expect(body2.events).toHaveLength(0); // пустой массив
  });
});

describe('POST /api/monitoring/run', () => {
  it('отвечает 409, когда цикл уже идёт (pre-check)', async () => {
    // Флаг занятости живёт в модуле monitor-run — подменяем его целиком.
    // Тут isCycleRunning() вернёт true на строке 10, обработчик вернётся ещё до вызова runMonitorCycle.
    vi.doMock('@/lib/monitor-run', () => ({
      isCycleRunning: () => true,
      runMonitorCycle: async () => null,
    }));
    const { POST } = await import('../src/app/api/monitoring/run/route');
    const res = await POST();
    expect(res.status).toBe(409);
  });

  it('отвечает 409, когда цикл начался между проверкой и вызовом (race)', async () => {
    // Вторая ветка 409: isCycleRunning() вернёт false (pre-check пройдёт),
    // но runMonitorCycle вернёт null (цикл стартовал тем временем).
    // Это проверяет путь на строках 15-17 route.ts.
    vi.doMock('@/lib/monitor-run', () => ({
      isCycleRunning: () => false,
      runMonitorCycle: async () => null,
    }));
    const { POST } = await import('../src/app/api/monitoring/run/route');
    const res = await POST();
    expect(res.status).toBe(409);
  });
});
