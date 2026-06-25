/**
 * Standalone Phase-3 migration for the Docker runner image.
 * Compiled to migrate-phase3.cjs via esbuild in the builder stage:
 *   npx esbuild scripts/migrate-phase3-runner.ts \
 *     --bundle --platform=node --external:better-sqlite3 --outfile=migrate-phase3.cjs
 * Invoked by docker-entrypoint.sh as: node /app/migrate-phase3.cjs
 */

import Database from 'better-sqlite3';
import { runMigratePhase3 } from './migrate-phase3';
import { migrateFunnelData } from './migrate-funnel-data';

const dbPath = process.env.FUNNELS_DB_PATH;
if (!dbPath) {
  console.error('[migrate-phase3] FUNNELS_DB_PATH is not set — skipping.');
  process.exit(0);
}

console.log(`[migrate-phase3] Running Phase-3 migration on: ${dbPath}`);
const sqlite = new Database(dbPath);
sqlite.pragma('journal_mode = WAL');
runMigratePhase3(sqlite);
migrateFunnelData(sqlite);
sqlite.close();
console.log('[migrate-phase3] Done (schema + data).');
