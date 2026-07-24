/**
 * Phase-6: таблицы мониторинга доступности лендов. Идемпотентно.
 *
 *   cd app/
 *   FUNNELS_DB_PATH=../ksamata_funnels.db npx tsx scripts/migrate-phase6.ts
 */
import { PHASE6_DDL, PHASE6_TARGET_COLUMNS } from './migrate-phase6-data';
import { addColumnIfMissing } from './migrate-phase3-data';

export function runMigratePhase6(sqlite: import('better-sqlite3').Database): void {
  sqlite.pragma('foreign_keys = ON');
  sqlite.exec(PHASE6_DDL);
  // Таблица уже могла быть создана ранним вариантом Phase-6 — доливаем колонки.
  for (const col of PHASE6_TARGET_COLUMNS) {
    addColumnIfMissing(sqlite, 'monitor_targets', col.name, col.ddl);
  }
}

if (require.main === module) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Database = require('better-sqlite3');
  const dbPath = process.env.FUNNELS_DB_PATH ?? '../ksamata_funnels.db';
  const sqlite = new Database(dbPath);
  console.log(`Phase-6 schema migration on: ${dbPath}`);
  runMigratePhase6(sqlite);
  sqlite.close();
  console.log('Phase-6 schema migration done.');
}
