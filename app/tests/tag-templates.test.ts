import { describe, it, expect, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import * as schema from '../src/db/schema';
import { runMigratePhase7 } from '../scripts/migrate-phase7';
import { PHASE5_DDL, PHASE5_TEMPLATE_SEED, seedTagTemplates } from '../scripts/migrate-phase5-data';
import { listTemplate, replaceTemplateScenario } from '../src/lib/tag-templates';

/**
 * Фикстура строит схему С НУЛЯ, а не копией живой ksamata_funnels.db.
 *
 * Этот файл проверяет сид шаблона (PHASE5_TEMPLATE_SEED) и поведение
 * listTemplate/replaceTemplateScenario — ни то ни другое не должно зависеть
 * от того, что сейчас лежит в живой базе. Копия живой БД тут в принципе не
 * годится: `seedTagTemplates` гейтится маркером в `schema_migrations`,
 * который в живой базе уже стоит, так что повторный вызов — no-op, и тест
 * молча проверял бы то, что осталось в файле после последней ручной правки
 * данных, а не код сида. Именно так эти два теста упали при задаче 9: живую
 * базу задача 7 законно поправила (маркер убран из шаблона, часть воронок
 * перетипирована), и тесты, утверждавшие конкретные строки шаблона,
 * рассинхронизировались — не с кодом, а с данными.
 *
 * `runMigratePhase7` требует существующую таблицу `funnels` (ALTER TABLE
 * ADD COLUMN) — этому файлу сами воронки не нужны, поэтому таблица здесь
 * пустой одноколоночный стаб, а не полная схема фаз 2–4.
 */
const dir = mkdtempSync(join(tmpdir(), 'tpl_'));
const dbPath = join(dir, 'test.db');
const sqlite = new Database(dbPath);
sqlite.pragma('foreign_keys = ON');
sqlite.exec(PHASE5_DDL);
seedTagTemplates(sqlite);
sqlite.exec('CREATE TABLE funnels (id INTEGER PRIMARY KEY)');
runMigratePhase7(sqlite);
const db = drizzle(sqlite, { schema });

afterAll(() => { sqlite.close(); rmSync(dir, { recursive: true, force: true }); });

/** Ожидаемый список для сценария — из константы сида, а не хардкод строкой. */
function seedNamesFor(scenario: string): string[] {
  return PHASE5_TEMPLATE_SEED
    .filter((r) => r.scenario === scenario)
    .sort((a, b) => a.position - b.position)
    .map((r) => r.name);
}

describe('tag-templates', () => {
  it('lists the seeded template grouped by scenario in order', () => {
    const t = listTemplate(db);
    expect(t.reg).toEqual(seedNamesFor('reg'));
    expect(t.time_15).toEqual(seedNamesFor('time_15'));
    expect(t.time_19).toEqual(seedNamesFor('time_19'));
    expect(t.messenger).toEqual(seedNamesFor('messenger'));
  });

  it('replaceTemplateScenario swaps the whole ordered list for one scenario', () => {
    replaceTemplateScenario(db, 'reg', ['новый-тег-1', 'новый-тег-2']);
    const t = listTemplate(db);
    expect(t.reg).toEqual(['новый-тег-1', 'новый-тег-2']);
    expect(t.messenger).toEqual(seedNamesFor('messenger')); // untouched
  });

  it('replace with empty list clears the scenario', () => {
    replaceTemplateScenario(db, 'time_15', []);
    expect(listTemplate(db).time_15).toEqual([]);
  });
});
