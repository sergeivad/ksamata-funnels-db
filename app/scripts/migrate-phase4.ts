/**
 * Phase-4 schema migration: funnels.rooms_enabled column + smart backfill.
 * Idempotent. Run AFTER Phase-3 (needs the funnels table as migrated).
 *
 * Run against the real DB:
 *   cd app/
 *   FUNNELS_DB_PATH=../ksamata_funnels.db npx tsx scripts/migrate-phase4.ts
 */

import { PHASE4_FUNNEL_COLUMNS, backfillRoomsEnabled } from './migrate-phase4-data';
import { addColumnIfMissing } from './migrate-phase3-data';

export function runMigratePhase4(sqlite: import('better-sqlite3').Database): void {
  sqlite.pragma('foreign_keys = ON');
  for (const col of PHASE4_FUNNEL_COLUMNS) {
    addColumnIfMissing(sqlite, 'funnels', col.name, col.ddl);
  }
  backfillRoomsEnabled(sqlite);
}

if (require.main === module) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Database = require('better-sqlite3');
  // Путь резолвится от расположения скрипта, а не от cwd (см. cli-db-path.ts).
  const { resolveCliDbPath } = require('./cli-db-path') as typeof import('./cli-db-path');
  const dbPath = resolveCliDbPath();
  const sqlite = new Database(dbPath);
  console.log(`Phase-4 schema migration on: ${dbPath}`);
  runMigratePhase4(sqlite);
  sqlite.close();
  console.log('Phase-4 schema migration done.');
}
