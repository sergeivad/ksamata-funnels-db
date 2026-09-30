/**
 * Standalone-миграция Phase-20 для Docker-образа.
 * Собирается в migrate-phase20.cjs через esbuild в builder-стадии.
 * Вызывается из docker-entrypoint.sh как: node /app/migrate-phase20.cjs
 */
import Database from 'better-sqlite3';
import { resolveCliDbPath } from './cli-db-path';
import { runMigratePhase20 } from './migrate-phase20';

// Путь: FUNNELS_DB_PATH, иначе дефолт от расположения скрипта (см. cli-db-path.ts).
const dbPath = resolveCliDbPath();

console.log(`[migrate-phase20] Running Phase-20 migration on: ${dbPath}`);
const sqlite = new Database(dbPath);
sqlite.pragma('journal_mode = WAL');
const result = runMigratePhase20(sqlite);
sqlite.close();
console.log(`[migrate-phase20] Done (колонок заведено: ${result.columnsAdded}).`);
