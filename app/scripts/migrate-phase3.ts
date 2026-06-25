/**
 * Phase-3 schema migration: new funnels columns + funnel_blocks /
 * funnel_block_items tables. Idempotent. Data migration lives in
 * migrate-funnel-data.ts (called separately after this).
 *
 * Run against the real DB:
 *   cd app/
 *   FUNNELS_DB_PATH=../ksamata_funnels.db npx tsx scripts/migrate-phase3.ts
 */

import { PHASE3_DDL, PHASE3_FUNNEL_COLUMNS, addColumnIfMissing } from './migrate-phase3-data';

export function runMigratePhase3(sqlite: import('better-sqlite3').Database): void {
  sqlite.pragma('foreign_keys = ON');
  for (const col of PHASE3_FUNNEL_COLUMNS) {
    addColumnIfMissing(sqlite, 'funnels', col.name, col.ddl);
  }
  sqlite.exec(PHASE3_DDL);
}

if (require.main === module) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Database = require('better-sqlite3');
  const dbPath = process.env.FUNNELS_DB_PATH ?? '../ksamata_funnels.db';
  const sqlite = new Database(dbPath);
  console.log(`Phase-3 schema migration on: ${dbPath}`);
  runMigratePhase3(sqlite);
  sqlite.close();
  console.log('Phase-3 schema migration done.');
}
