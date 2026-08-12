/**
 * Standalone-миграция Phase-11 для Docker-образа.
 * Собирается в migrate-phase11.cjs через esbuild в builder-стадии.
 * Вызывается из docker-entrypoint.sh как: node /app/migrate-phase11.cjs
 */
import Database from 'better-sqlite3';
import { resolveCliDbPath } from './cli-db-path';
import { runMigratePhase11 } from './migrate-phase11';

// Путь: FUNNELS_DB_PATH, иначе дефолт от расположения скрипта (см. cli-db-path.ts).
// Несуществующая база — отказ, а не тихий пропуск: стартовать на
// непромигрированной базе хуже, чем не стартовать вовсе.
const dbPath = resolveCliDbPath();

console.log(`[migrate-phase11] Running Phase-11 migration on: ${dbPath}`);
const sqlite = new Database(dbPath);
sqlite.pragma('journal_mode = WAL');
const result = runMigratePhase11(sqlite);
sqlite.close();
console.log(
  `[migrate-phase11] Done (адресов перенесено в блок: ${result.moved}; воронок очищено: ${result.cleared}).`
);
