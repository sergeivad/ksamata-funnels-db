/**
 * Standalone-миграция Phase-7 для Docker-образа.
 * Собирается в migrate-phase7.cjs через esbuild в builder-стадии.
 * Вызывается из docker-entrypoint.sh как: node /app/migrate-phase7.cjs
 */
import Database from 'better-sqlite3';
import { runMigratePhase7 } from './migrate-phase7';

const dbPath = process.env.FUNNELS_DB_PATH;
if (!dbPath) {
  console.error('[migrate-phase7] FUNNELS_DB_PATH is not set — skipping.');
  process.exit(0);
}

console.log(`[migrate-phase7] Running Phase-7 migration on: ${dbPath}`);
const sqlite = new Database(dbPath);
sqlite.pragma('journal_mode = WAL');
runMigratePhase7(sqlite);
sqlite.close();
console.log('[migrate-phase7] Done (funnel types).');
