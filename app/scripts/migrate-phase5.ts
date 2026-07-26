/**
 * Phase-5 schema migration: tag_templates + funnel_tag_overrides + template seed.
 * Idempotent. Run AFTER Phase-3.
 *
 *   cd app/
 *   FUNNELS_DB_PATH=../ksamata_funnels.db npx tsx scripts/migrate-phase5.ts
 */
import { PHASE5_DDL, seedTagTemplates } from './migrate-phase5-data';

export function runMigratePhase5(sqlite: import('better-sqlite3').Database): void {
  sqlite.pragma('foreign_keys = ON');
  sqlite.exec(PHASE5_DDL);
  seedTagTemplates(sqlite);
}

if (require.main === module) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Database = require('better-sqlite3');
  // Путь резолвится от расположения скрипта, а не от cwd (см. cli-db-path.ts).
  const { resolveCliDbPath } = require('./cli-db-path') as typeof import('./cli-db-path');
  const dbPath = resolveCliDbPath();
  const sqlite = new Database(dbPath);
  console.log(`Phase-5 schema migration on: ${dbPath}`);
  runMigratePhase5(sqlite);
  sqlite.close();
  console.log('Phase-5 schema migration done.');
}
