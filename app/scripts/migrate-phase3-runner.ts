/**
 * Standalone Phase-3 migration for the Docker runner image.
 * Compiled to migrate-phase3.cjs via esbuild in the builder stage:
 *   npx esbuild scripts/migrate-phase3-runner.ts \
 *     --bundle --platform=node --external:better-sqlite3 --outfile=migrate-phase3.cjs
 * Invoked by docker-entrypoint.sh as: node /app/migrate-phase3.cjs
 */

import Database from 'better-sqlite3';
import { resolveCliDbPath } from './cli-db-path';
import { runMigratePhase3 } from './migrate-phase3';
import { migrateFunnelData } from './migrate-funnel-data';

// Путь: FUNNELS_DB_PATH, иначе дефолт от расположения скрипта (см. cli-db-path.ts).
// Несуществующая база — отказ, а не тихий пропуск: стартовать на
// непромигрированной базе хуже, чем не стартовать вовсе.
const dbPath = resolveCliDbPath();

console.log(`[migrate-phase3] Running Phase-3 migration on: ${dbPath}`);
const sqlite = new Database(dbPath);
sqlite.pragma('journal_mode = WAL');
runMigratePhase3(sqlite);
migrateFunnelData(sqlite);
sqlite.close();
console.log('[migrate-phase3] Done (schema + data).');
