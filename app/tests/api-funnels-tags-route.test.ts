/**
 * HTTP-layer test for PATCH /api/funnels/[id]/tags — per-funnel tag overrides.
 *
 * ISOLATION: fresh temp COPY of the DB per test file, with `@/db/client` mocked
 * to a drizzle handle over that copy (same pattern as api-funnels-route.test.ts).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { runMigratePhase3 } from '../scripts/migrate-phase3';
import { runMigrateMessengerTagType } from '../scripts/migrate-messenger-tagtype';
import { runMigratePhase5 } from '../scripts/migrate-phase5';
import { runMigratePhase7 } from '../scripts/migrate-phase7';
import * as schema from '../src/db/schema';
import { replaceOverrides } from '../src/lib/tag-overrides';
import { copyDbForTest } from './helpers/db';

const REAL_DB = path.resolve(process.cwd(), '..', 'ksamata_funnels.db');
let tmp: string;
let sqlite: Database.Database;
let existingId: number;
let db: ReturnType<typeof drizzle<typeof schema>>;

/* eslint-disable @typescript-eslint/consistent-type-imports */
let PATCH: typeof import('../src/app/api/funnels/[id]/tags/route').PATCH;
/* eslint-enable @typescript-eslint/consistent-type-imports */

beforeEach(async () => {
  tmp = path.join(os.tmpdir(), `frtags-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  copyDbForTest(REAL_DB, tmp);
  sqlite = new Database(tmp);
  sqlite.pragma('foreign_keys = ON');
  runMigratePhase3(sqlite);
  runMigrateMessengerTagType(sqlite);
  runMigratePhase5(sqlite);
  runMigratePhase7(sqlite);
  const rows = sqlite.prepare('SELECT id FROM funnels ORDER BY num LIMIT 1').all() as { id: number }[];
  existingId = rows[0].id;
  db = drizzle(sqlite, { schema });
  vi.doMock('@/db/client', () => ({ db }));

  const route = await import('../src/app/api/funnels/[id]/tags/route');
  PATCH = route.PATCH;
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
const params = (id: string | number) => ({ params: Promise.resolve({ id: String(id) }) });

describe('PATCH /api/funnels/[id]/tags', () => {
  it('adds a custom tag and removes a default, reflected in tagSets', async () => {
    // 'АВ Автоворонка' больше не годится для этой проверки: после фазы 7 у
    // существующей воронки (existingId) есть настоящий funnel_type_id = «АВ
    // Автоворонка», и computeTagSet трактует имя типа как identity-тег —
    // такой remove гасится (см. ab-tags.ts). 'АВ Этап: Регистрация' — обычный
    // шаблонный дефолт без этого статуса, ровно то, что тест проверяет.
    const res = await PATCH(
      jsonReq('PATCH', { reg: { add: ['промо-тест'], remove: ['АВ Этап: Регистрация'] } }),
      params(existingId)
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    const names = body.tagSets.reg.tags.map((t: { name: string }) => t.name);
    expect(names).toContain('промо-тест');
    expect(names).not.toContain('АВ Этап: Регистрация');
    expect(body.tagSets.reg.suppressed).toContain('АВ Этап: Регистрация');
  });

  it('keeps overrides of scenarios the patch does not mention', async () => {
    await PATCH(jsonReq('PATCH', { time_15: { add: ['держим'], remove: [] } }), params(existingId));

    const res = await PATCH(jsonReq('PATCH', { reg: { add: ['новый'], remove: [] } }), params(existingId));

    expect(res.status).toBe(200);
    const body = await res.json();
    const time15 = body.tagSets.time_15.tags.map((t: { name: string }) => t.name);
    expect(time15).toContain('держим');
  });

  it('clears a scenario when the patch mentions it with empty lists', async () => {
    await PATCH(jsonReq('PATCH', { time_15: { add: ['временный'], remove: [] } }), params(existingId));

    const res = await PATCH(jsonReq('PATCH', { time_15: { add: [], remove: [] } }), params(existingId));

    expect(res.status).toBe(200);
    const body = await res.json();
    const time15 = body.tagSets.time_15.tags.map((t: { name: string }) => t.name);
    expect(time15).not.toContain('временный');
  });

  it('одно имя разом в add и remove → 400, а не 500', async () => {
    const res = await PATCH(
      jsonReq('PATCH', { reg: { add: ['спорный'], remove: ['спорный'] } }),
      params(existingId)
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 for a non-numeric id', async () => {
    const res = await PATCH(jsonReq('PATCH', {}), params('abc'));
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid JSON', async () => {
    const res = await PATCH(rawReq('PATCH', '{bad'), params(existingId));
    expect(res.status).toBe(400);
  });

  it('returns 400 for a body that fails validation (unknown scenario key)', async () => {
    const res = await PATCH(jsonReq('PATCH', { bogus: { add: [], remove: [] } }), params(existingId));
    expect(res.status).toBe(400);
  });

  it('404 for a missing funnel', async () => {
    const res = await PATCH(jsonReq('PATCH', {}), params(99999999));
    expect(res.status).toBe(404);
  });

  it('маркер типа воронки нельзя добавить через add-оверрайд', async () => {
    // 'АВ Квиз' — имя из справочника funnel_types (SEED_FUNNEL_TYPES),
    // засеянного runMigratePhase7 выше. Без запрета запрос отвечал бы 200 и
    // клал строку в funnel_tag_overrides, которая никогда ни на что не влияет
    // (identity-слой computeTagSet её гасит) — молчаливый холостой ход, а не
    // порча данных, но пользователь никогда не узнал бы, что тег не применился.
    const res = await PATCH(
      jsonReq('PATCH', { reg: { add: ['АВ Квиз'], remove: [] } }),
      params(existingId),
    );
    expect(res.status).toBe(400);

    const rows = sqlite
      .prepare(
        `SELECT 1 FROM funnel_tag_overrides WHERE funnel_id = ? AND tag_type = 'reg' AND name = 'АВ Квиз'`,
      )
      .all(existingId);
    expect(rows).toEqual([]);
  });

  it('старая строка с маркером в непереданном сценарии не должна ронять посторонний PATCH', async () => {
    // Находка рецензии (round 2): маршрут мёржит патч со старыми данными для
    // сценариев, которых нет в теле запроса (см. route.ts:36-39,
    // `patch[s] = parsed.data[s] ?? current[s]`). Значит applyTagOverrides
    // видит ПОЛНУЮ карту всех четырёх сценариев, включая нетронутый. Если бы
    // проверка маркера смотрела на неё целиком (а не на разницу с уже
    // сохранённым), воронка со старой строкой маркера в add — эндпоинт до
    // барьера отвечал 200 и клал такую строку, либо duplicateFunnel →
    // copyFunnelChildren пишет funnel_tag_overrides напрямую, минуя оба
    // барьера — начала бы получать 400 на любой PATCH, который эту строку
    // даже не упоминает. Кладём такую строку НАПРЯМУЮ через replaceOverrides
    // (в обход барьера, как если бы она осталась от старых данных), затем
    // шлём PATCH, трогающий только time_15: не должен видеть reg вовсе.
    replaceOverrides(db, existingId, {
      reg: { add: ['АВ Квиз'], remove: [] },
      time_15: { add: [], remove: [] },
      time_19: { add: [], remove: [] },
      messenger: { add: [], remove: [] },
    });

    const res = await PATCH(
      jsonReq('PATCH', { time_15: { add: ['держим-time15'], remove: [] } }),
      params(existingId),
    );
    expect(res.status).toBe(200);

    const body = await res.json();
    const time15 = body.tagSets.time_15.tags.map((t: { name: string }) => t.name);
    expect(time15).toContain('держим-time15');
  });
});
