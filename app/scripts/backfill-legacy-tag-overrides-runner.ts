/**
 * Standalone legacy tag-override backfill for the Docker runner image.
 * Compiled to backfill-legacy-tag-overrides.cjs via esbuild in the builder stage:
 *   npx esbuild scripts/backfill-legacy-tag-overrides-runner.ts \
 *     --bundle --platform=node --external:better-sqlite3 --outfile=backfill-legacy-tag-overrides.cjs
 * Invoked by docker-entrypoint.sh as: node /app/backfill-legacy-tag-overrides.cjs
 * Must run AFTER migrate-phase5.cjs (needs the seeded template).
 */

import Database from 'better-sqlite3';
import { resolveCliDbPath } from './cli-db-path';
import { backfillLegacyTagOverrides } from './backfill-legacy-tag-overrides';

// Путь: FUNNELS_DB_PATH, иначе дефолт от расположения скрипта (см. cli-db-path.ts).
// Несуществующая база — отказ, а не тихий пропуск: стартовать на
// непромигрированной базе хуже, чем не стартовать вовсе.
const dbPath = resolveCliDbPath();

console.log(`[backfill-legacy-tag-overrides] Running backfill on: ${dbPath}`);
const sqlite = new Database(dbPath);
sqlite.pragma('journal_mode = WAL');
backfillLegacyTagOverrides(sqlite);
sqlite.close();
console.log('[backfill-legacy-tag-overrides] Done.');
