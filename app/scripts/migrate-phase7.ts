/**
 * Phase-7: справочник типов воронки + FK у funnels. Идемпотентно.
 *
 *   cd app/
 *   FUNNELS_DB_PATH=../ksamata_funnels.db npx tsx scripts/migrate-phase7.ts
 *
 * Бэкфилл ставит всем воронкам «АВ Автоворонка» — это не решение о типе,
 * а сохранение того, что база утверждает и без пятой оси: маркер стоит
 * у каждой воронки из шаблона tag_templates. funnel_tags при этом
 * не меняется ни на строку, меняется только источник маркера.
 */
import { PHASE7_DDL, PHASE7_FUNNEL_COLUMN } from './migrate-phase7-data';
import { addColumnIfMissing } from './migrate-phase3-data';
import { SEED_FUNNEL_TYPES, DEFAULT_FUNNEL_TYPE } from '../src/lib/funnel-type';

export function runMigratePhase7(sqlite: import('better-sqlite3').Database): void {
  sqlite.pragma('foreign_keys = ON');
  sqlite.exec(PHASE7_DDL);
  addColumnIfMissing(sqlite, 'funnels', PHASE7_FUNNEL_COLUMN.name, PHASE7_FUNNEL_COLUMN.ddl);

  const insert = sqlite.prepare('INSERT OR IGNORE INTO funnel_types (name) VALUES (?)');
  for (const name of SEED_FUNNEL_TYPES) insert.run(name);

  // Бэкфилл только там, где тип ещё не проставлен: повторный прогон
  // не должен затирать уже принятые решения о типе.
  sqlite.prepare(`
    UPDATE funnels
       SET funnel_type_id = (SELECT id FROM funnel_types WHERE name = ?)
     WHERE funnel_type_id IS NULL
  `).run(DEFAULT_FUNNEL_TYPE);
}

if (require.main === module) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Database = require('better-sqlite3');
  const { resolveCliDbPath } = require('./cli-db-path') as typeof import('./cli-db-path');
  const dbPath = resolveCliDbPath();
  const sqlite = new Database(dbPath);
  console.log(`Phase-7 schema migration on: ${dbPath}`);
  runMigratePhase7(sqlite);
  sqlite.close();
  console.log('Phase-7 schema migration done.');
}
