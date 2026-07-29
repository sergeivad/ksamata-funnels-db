/**
 * Standalone-миграция Phase-8 для Docker-образа.
 * Собирается в migrate-phase8.cjs через esbuild в builder-стадии.
 * Вызывается из docker-entrypoint.sh как: node /app/migrate-phase8.cjs
 */
import Database from 'better-sqlite3';
import { runMigratePhase8 } from './migrate-phase8';

const dbPath = process.env.FUNNELS_DB_PATH;
if (!dbPath) {
  console.error('[migrate-phase8] FUNNELS_DB_PATH is not set — skipping.');
  process.exit(0);
}

console.log(`[migrate-phase8] Running Phase-8 migration on: ${dbPath}`);
const sqlite = new Database(dbPath);
sqlite.pragma('journal_mode = WAL');
runMigratePhase8(sqlite);
sqlite.close();
console.log('[migrate-phase8] Done (funnel types).');
