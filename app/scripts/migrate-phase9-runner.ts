/**
 * Standalone-миграция Phase-9 для Docker-образа.
 * Собирается в migrate-phase9.cjs через esbuild в builder-стадии.
 * Вызывается из docker-entrypoint.sh как: node /app/migrate-phase9.cjs
 */
import Database from 'better-sqlite3';
import { runMigratePhase9 } from './migrate-phase9';

const dbPath = process.env.FUNNELS_DB_PATH;
if (!dbPath) {
  console.error('[migrate-phase9] FUNNELS_DB_PATH is not set — skipping.');
  process.exit(0);
}

console.log(`[migrate-phase9] Running Phase-9 migration on: ${dbPath}`);
const sqlite = new Database(dbPath);
sqlite.pragma('journal_mode = WAL');
const result = runMigratePhase9(sqlite);
sqlite.close();
console.log(`[migrate-phase9] Done (целей переведено в «Лендинги»: ${result.retargeted}).`);
