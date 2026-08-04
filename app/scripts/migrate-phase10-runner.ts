/**
 * Standalone-миграция Phase-10 для Docker-образа.
 * Собирается в migrate-phase10.cjs через esbuild в builder-стадии.
 * Вызывается из docker-entrypoint.sh как: node /app/migrate-phase10.cjs
 */
import Database from 'better-sqlite3';
import { resolveCliDbPath } from './cli-db-path';
import { runMigratePhase10 } from './migrate-phase10';

// Путь: FUNNELS_DB_PATH, иначе дефолт от расположения скрипта (см. cli-db-path.ts).
// Несуществующая база — отказ, а не тихий пропуск: стартовать на
// непромигрированной базе хуже, чем не стартовать вовсе.
const dbPath = resolveCliDbPath();

console.log(`[migrate-phase10] Running Phase-10 migration on: ${dbPath}`);
const sqlite = new Database(dbPath);
sqlite.pragma('journal_mode = WAL');
const result = runMigratePhase10(sqlite);
sqlite.close();
console.log(
  `[migrate-phase10] Done (адресов перенесено в блок: ${result.moved}; колонок очищено: ${result.cleared}).`
);
