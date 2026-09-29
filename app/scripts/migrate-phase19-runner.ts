/**
 * Standalone-миграция Phase-19 для Docker-образа.
 * Собирается в migrate-phase19.cjs через esbuild в builder-стадии.
 * Вызывается из docker-entrypoint.sh как: node /app/migrate-phase19.cjs
 */
import Database from 'better-sqlite3';
import { resolveCliDbPath } from './cli-db-path';
import { runMigratePhase19 } from './migrate-phase19';

// Путь: FUNNELS_DB_PATH, иначе дефолт от расположения скрипта (см. cli-db-path.ts).
const dbPath = resolveCliDbPath();

console.log(`[migrate-phase19] Running Phase-19 migration on: ${dbPath}`);
const sqlite = new Database(dbPath);
sqlite.pragma('journal_mode = WAL');
const result = runMigratePhase19(sqlite);
sqlite.close();
console.log(`[migrate-phase19] Done (колонок заведено: ${result.columnsAdded}).`);
