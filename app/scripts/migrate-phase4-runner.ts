/**
 * Standalone Phase-4 migration for the Docker runner image.
 * Compiled to migrate-phase4.cjs via esbuild in the builder stage:
 *   npx esbuild scripts/migrate-phase4-runner.ts \
 *     --bundle --platform=node --external:better-sqlite3 --outfile=migrate-phase4.cjs
 * Invoked by docker-entrypoint.sh as: node /app/migrate-phase4.cjs
 */

import Database from 'better-sqlite3';
import { runMigratePhase4 } from './migrate-phase4';

const dbPath = process.env.FUNNELS_DB_PATH;
if (!dbPath) {
  console.error('[migrate-phase4] FUNNELS_DB_PATH is not set — skipping.');
  process.exit(0);
}

console.log(`[migrate-phase4] Running Phase-4 migration on: ${dbPath}`);
const sqlite = new Database(dbPath);
sqlite.pragma('journal_mode = WAL');
runMigratePhase4(sqlite);
sqlite.close();
console.log('[migrate-phase4] Done.');
