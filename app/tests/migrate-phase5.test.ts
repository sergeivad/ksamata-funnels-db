import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { runMigratePhase5 } from '../scripts/migrate-phase5';
import { PHASE5_TEMPLATE_SEED } from '../scripts/migrate-phase5-data';
import { SEED_FUNNEL_TYPES } from '../src/lib/funnel-type';

describe('migrate-phase5', () => {
  it('creates both tables and seeds the template idempotently', () => {
    // Схема с нуля (:memory:), а не копия живой ksamata_funnels.db: этот
    // тест проверяет сид (PHASE5_TEMPLATE_SEED), а копия живой базы делает
    // seedTagTemplates() no-op (гейт по schema_migrations уже стоит на живом
    // файле), так что тест молча проверял бы унаследованные данные, а не
    // код. Именно так он и упал при задаче 9, когда задача 7 законно убрала
    // маркер типа воронки из живого tag_templates.
    const sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');

    runMigratePhase5(sqlite);
    runMigratePhase5(sqlite); // idempotent — second run must not throw or double-seed

    const tables = sqlite.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name IN ('tag_templates','funnel_tag_overrides')`
    ).all() as { name: string }[];
    expect(tables.map((t) => t.name).sort()).toEqual(['funnel_tag_overrides', 'tag_templates']);

    for (const scenario of ['reg', 'time_15', 'time_19', 'messenger'] as const) {
      const rows = sqlite.prepare(
        `SELECT name FROM tag_templates WHERE scenario=? ORDER BY position`
      ).all(scenario) as { name: string }[];
      const expected = PHASE5_TEMPLATE_SEED
        .filter((r) => r.scenario === scenario)
        .sort((a, b) => a.position - b.position)
        .map((r) => r.name);
      expect(rows.map((r) => r.name)).toEqual(expected);
    }

    const count = sqlite.prepare(`SELECT COUNT(*) AS c FROM tag_templates`).get() as { c: number };
    // Второй прогон не должен удвоить сид — сверяем с длиной константы, а не
    // с магическим числом, чтобы правка сида не требовала правки этого счёта.
    expect(count.c).toBe(PHASE5_TEMPLATE_SEED.length);

    sqlite.close();
  });

  // Пункт 3 финальной рецензии: тест выше сверяет сид с ТОЙ ЖЕ константой,
  // которую читает код сидирования — если кто-нибудь вернёт маркер типа
  // воронки в PHASE5_TEMPLATE_SEED, этот тест останется зелёным, потому что
  // ожидание пересчитается вместе с изменением. Стержень ветки — «маркера
  // в шаблоне нет» — здесь никем не проверяется. Этот тест сверяет сид
  // с НЕЗАВИСИМЫМ источником (SEED_FUNNEL_TYPES, funnel-type.ts), так что
  // возврат маркера в сид его красит.
  it('ни одно имя PHASE5_TEMPLATE_SEED не совпадает с маркером типа воронки', () => {
    const markerNames = new Set<string>(SEED_FUNNEL_TYPES);
    const offenders = PHASE5_TEMPLATE_SEED.filter((r) => markerNames.has(r.name));
    expect(offenders).toEqual([]);
  });
});
