/**
 * Standalone-миграция Phase-18 для Docker-образа.
 * Собирается в migrate-phase18.cjs через esbuild в builder-стадии.
 * Вызывается из docker-entrypoint.sh как: node /app/migrate-phase18.cjs
 */
import Database from 'better-sqlite3';
import { resolveCliDbPath } from './cli-db-path';
import { runMigratePhase18 } from './migrate-phase18';

// Путь: FUNNELS_DB_PATH, иначе дефолт от расположения скрипта (см. cli-db-path.ts).
const dbPath = resolveCliDbPath();

console.log(`[migrate-phase18] Running Phase-18 migration on: ${dbPath}`);
const sqlite = new Database(dbPath);
sqlite.pragma('journal_mode = WAL');
const result = runMigratePhase18(sqlite);
sqlite.close();
console.log(`[migrate-phase18] Done (воронок, заведённых в ЛИК, помечено: ${result.funnelsMarked}).`);
