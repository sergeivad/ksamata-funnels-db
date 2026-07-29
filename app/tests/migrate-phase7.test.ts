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

  it('бэкфиллит только воронки без типа, не трогая уже проставленный', () => {
    // НЕ утверждаем "всем воронкам стоит АВ Автоворонка" — после того как
    // задача 7 применила пятую ось к живой базе (60/11/1 по трём маркерам),
    // это утверждение стало вопросом ДАННЫХ, а не поведения кода, и ломается
    // при каждой легитимной правке типов. Настоящее правило бэкфилла —
    // `WHERE funnel_type_id IS NULL` в migrate-phase7.ts — проверяем прямой
    // мутацией входа, не полагаясь на то, сколько воронок сейчас типизировано
    // в живой ksamata_funnels.db. Транзакция откатывается в конце, чтобы не
    // задеть соседние тесты этого файла.
    sqlite.exec('BEGIN');
    try {
      const ids = (sqlite.prepare('SELECT id FROM funnels ORDER BY id LIMIT 2').all() as { id: number }[])
        .map((r) => r.id);
      expect(ids.length).toBe(2);
      const [resetId, keepId] = ids;
      const quizTypeId = (sqlite.prepare('SELECT id FROM funnel_types WHERE name = ?').get('АВ Квиз') as { id: number }).id;

      sqlite.prepare('UPDATE funnels SET funnel_type_id = NULL WHERE id = ?').run(resetId);
      sqlite.prepare('UPDATE funnels SET funnel_type_id = ? WHERE id = ?').run(quizTypeId, keepId);

      runMigratePhase7(sqlite);

      const rows = sqlite.prepare(`
        SELECT f.id AS id, t.name AS name FROM funnels f
        LEFT JOIN funnel_types t ON t.id = f.funnel_type_id
        WHERE f.id IN (?, ?)
      `).all(resetId, keepId) as { id: number; name: string | null }[];
      const byId = new Map(rows.map((r) => [r.id, r.name]));

      expect(byId.get(resetId)).toBe(DEFAULT_FUNNEL_TYPE); // NULL → бэкфилл дефолтом
      expect(byId.get(keepId)).toBe('АВ Квиз'); // уже стоял тип — миграция его не трогает
    } finally {
      sqlite.exec('ROLLBACK');
    }
  });

  it('идемпотентна: повторный прогон ничего не ломает и не двоит', () => {
    runMigratePhase7(sqlite);
    const n = (sqlite.prepare('SELECT COUNT(*) AS n FROM funnel_types').get() as { n: number }).n;
    expect(n).toBe(SEED_FUNNEL_TYPES.length);
  });

  it('не пишет и не удаляет ни одной строки funnel_tags', () => {
    // Фаза 7 не должна трогать funnel_tags вовсе — маркер материализуется
    // движком тегов (computeTagSet) из funnel_type_id, а не самой миграцией.
    // Раньше здесь рядом стоял косвенный тест «маркер уже стоит у каждой
    // воронки» (COUNT(DISTINCT funnel_id) по тегу «АВ Автоворонка» == общему
    // числу воронок) — он был снят: после того как задача 7 проставила
    // реальные типы 12 воронкам, инвариант «у каждой воронки именно этот
    // тег» стал попросту неверен по данным, а как проверка регрессии он был
    // избыточен и слабее сырого COUNT(*) ниже — дублирующая запись тем же
    // воронкам не изменила бы DISTINCT-счётчик, но изменила бы этот.
    const funnelTagsCountAfter = (sqlite.prepare('SELECT COUNT(*) AS n FROM funnel_tags').get() as { n: number }).n;
    expect(funnelTagsCountAfter).toBe(funnelTagsCountBefore);
  });
});
