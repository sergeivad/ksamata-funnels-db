/**
 * Standalone Phase-4 migration for the Docker runner image.
 * Compiled to migrate-phase4.cjs via esbuild in the builder stage:
 *   npx esbuild scripts/migrate-phase4-runner.ts \
 *     --bundle --platform=node --external:better-sqlite3 --outfile=migrate-phase4.cjs
 * Invoked by docker-entrypoint.sh as: node /app/migrate-phase4.cjs
 */

import Database from 'better-sqlite3';
import { resolveCliDbPath } from './cli-db-path';
import { runMigratePhase4 } from './migrate-phase4';

// Путь: FUNNELS_DB_PATH, иначе дефолт от расположения скрипта (см. cli-db-path.ts).
// Несуществующая база — отказ, а не тихий пропуск: стартовать на
// непромигрированной базе хуже, чем не стартовать вовсе.
const dbPath = resolveCliDbPath();

console.log(`[migrate-phase4] Running Phase-4 migration on: ${dbPath}`);
const sqlite = new Database(dbPath);
sqlite.pragma('journal_mode = WAL');
runMigratePhase4(sqlite);
sqlite.close();
console.log('[migrate-phase4] Done.');
