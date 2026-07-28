import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { copyDbForTest } from './helpers/db';
import { runMigratePhase7 } from '../scripts/migrate-phase7';
import { SEED_FUNNEL_TYPES, DEFAULT_FUNNEL_TYPE } from '../src/lib/funnel-type';

let dir: string;
let dbPath: string;
let sqlite: Database.Database;
let funnelTagsCountBefore: number;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'phase7-'));
  dbPath = join(dir, 'test.db');
  copyDbForTest(join(__dirname, '../../ksamata_funnels.db'), dbPath);
  sqlite = new Database(dbPath);
  // Снято ДО миграции: сравнение COUNT(DISTINCT funnel_id) с числом воронок
  // не ловит регрессию — тег «АВ Автоворонка» уже стоит у всех воронок из
  // шаблона (computeTagSet), так что это совпадение верно и без фазы 7, и
  // осталось бы верным, даже если бы миграция ошибочно ДОБАВИЛА в funnel_tags
  // ещё одну строку тем же воронкам (DISTINCT её бы не заметил). Единственная
  // проверка, которая ловит и лишнюю запись, и удалённую — сырой COUNT(*)
  // до и после прогона.
  funnelTagsCountBefore = (sqlite.prepare('SELECT COUNT(*) AS n FROM funnel_tags').get() as { n: number }).n;
  runMigratePhase7(sqlite);
});

afterAll(() => {
  sqlite.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('Phase-7: справочник типов воронки', () => {
  it('заводит справочник с четырьмя маркерами', () => {
    const names = (sqlite.prepare('SELECT name FROM funnel_types ORDER BY name').all() as { name: string }[])
      .map((r) => r.name);
    expect(names.sort()).toEqual([...SEED_FUNNEL_TYPES].sort());
  });

  it('добавляет колонку funnels.funnel_type_id', () => {
    const cols = (sqlite.prepare('PRAGMA table_info(funnels)').all() as { name: string }[]).map((c) => c.name);
    expect(cols).toContain('funnel_type_id');
  });

  it('бэкфиллит всем воронкам «АВ Автоворонка»', () => {
    const row = sqlite.prepare(`
      SELECT COUNT(*) AS total,
             SUM(CASE WHEN t.name = ? THEN 1 ELSE 0 END) AS auto
        FROM funnels f LEFT JOIN funnel_types t ON t.id = f.funnel_type_id
    `).get(DEFAULT_FUNNEL_TYPE) as { total: number; auto: number };
    expect(row.total).toBeGreaterThan(0);
    expect(row.auto).toBe(row.total);
  });

  it('идемпотентна: повторный прогон ничего не ломает и не двоит', () => {
    runMigratePhase7(sqlite);
    const n = (sqlite.prepare('SELECT COUNT(*) AS n FROM funnel_types').get() as { n: number }).n;
    expect(n).toBe(SEED_FUNNEL_TYPES.length);
  });

  it('не трогает funnel_tags — маркер там уже стоит из шаблона', () => {
    // Косвенная проверка того же инварианта: маркер «АВ Автоворонка» уже
    // стоит у каждой воронки — это заслуга шаблона (computeTagSet), а не
    // фазы 7. Сама по себе эта проверка не ловит регрессию (см. комментарий
    // в beforeAll) — решающая проверка ниже, на сыром COUNT(*).
    const n = (sqlite.prepare(`
      SELECT COUNT(DISTINCT ft.funnel_id) AS n FROM funnel_tags ft
      JOIN tags t ON t.id = ft.tag_id WHERE t.name = ?
    `).get(DEFAULT_FUNNEL_TYPE) as { n: number }).n;
    const total = (sqlite.prepare('SELECT COUNT(*) AS n FROM funnels').get() as { n: number }).n;
    expect(n).toBe(total);
  });

  it('не пишет и не удаляет ни одной строки funnel_tags', () => {
    // Единственная проверка, которая реально ловит регрессию: если бы
    // миграция ошибочно ДОБАВИЛА (или удалила) строку в funnel_tags, сырой
    // COUNT(*) до/после разошёлся бы — в отличие от COUNT(DISTINCT funnel_id)
    // в тесте выше, который не меняется при дублирующей записи тем же воронкам.
    const funnelTagsCountAfter = (sqlite.prepare('SELECT COUNT(*) AS n FROM funnel_tags').get() as { n: number }).n;
    expect(funnelTagsCountAfter).toBe(funnelTagsCountBefore);
  });
});
