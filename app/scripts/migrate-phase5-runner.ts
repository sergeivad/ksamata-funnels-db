/**
 * Standalone Phase-5 migration for the Docker runner image.
 * Compiled to migrate-phase5.cjs via esbuild in the builder stage:
 *   npx esbuild scripts/migrate-phase5-runner.ts \
 *     --bundle --platform=node --external:better-sqlite3 --outfile=migrate-phase5.cjs
 * Invoked by docker-entrypoint.sh as: node /app/migrate-phase5.cjs
 */

import Database from 'better-sqlite3';
import { runMigratePhase5 } from './migrate-phase5';

const dbPath = process.env.FUNNELS_DB_PATH;
if (!dbPath) {
  console.error('[migrate-phase5] FUNNELS_DB_PATH is not set — skipping.');
  process.exit(0);
}

console.log(`[migrate-phase5] Running Phase-5 migration on: ${dbPath}`);
const sqlite = new Database(dbPath);
sqlite.pragma('journal_mode = WAL');
runMigratePhase5(sqlite);
sqlite.close();
console.log('[migrate-phase5] Done (schema + template seed).');
