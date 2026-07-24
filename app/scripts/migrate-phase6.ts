/**
 * Phase-6: таблицы мониторинга доступности лендов. Идемпотентно.
 *
 *   cd app/
 *   FUNNELS_DB_PATH=../ksamata_funnels.db npx tsx scripts/migrate-phase6.ts
 */
import { PHASE6_DDL } from './migrate-phase6-data';

export function runMigratePhase6(sqlite: import('better-sqlite3').Database): void {
  sqlite.pragma('foreign_keys = ON');
  sqlite.exec(PHASE6_DDL);
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
