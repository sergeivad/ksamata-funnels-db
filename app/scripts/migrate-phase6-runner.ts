/**
 * Standalone-миграция Phase-6 для Docker-образа.
 * Собирается в migrate-phase6.cjs через esbuild в builder-стадии:
 *   npx esbuild scripts/migrate-phase6-runner.ts \
 *     --bundle --platform=node --external:better-sqlite3 --outfile=migrate-phase6.cjs
 * Вызывается из docker-entrypoint.sh как: node /app/migrate-phase6.cjs
 */

import Database from 'better-sqlite3';
import { runMigratePhase6 } from './migrate-phase6';

const dbPath = process.env.FUNNELS_DB_PATH;
if (!dbPath) {
  console.error('[migrate-phase6] FUNNELS_DB_PATH is not set — skipping.');
  process.exit(0);
}

console.log(`[migrate-phase6] Running Phase-6 migration on: ${dbPath}`);
const sqlite = new Database(dbPath);
sqlite.pragma('journal_mode = WAL');
runMigratePhase6(sqlite);
sqlite.close();
console.log('[migrate-phase6] Done (monitoring tables).');
