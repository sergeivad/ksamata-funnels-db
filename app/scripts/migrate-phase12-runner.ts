/**
 * Standalone-миграция Phase-12 для Docker-образа.
 * Собирается в migrate-phase12.cjs через esbuild в builder-стадии.
 * Вызывается из docker-entrypoint.sh как: node /app/migrate-phase12.cjs
 */
import Database from 'better-sqlite3';
import { resolveCliDbPath } from './cli-db-path';
import { runMigratePhase12 } from './migrate-phase12';

// Путь: FUNNELS_DB_PATH, иначе дефолт от расположения скрипта (см. cli-db-path.ts).
// Несуществующая база — отказ, а не тихий пропуск: стартовать на
// непромигрированной базе хуже, чем не стартовать вовсе.
const dbPath = resolveCliDbPath();

console.log(`[migrate-phase12] Running Phase-12 migration on: ${dbPath}`);
const sqlite = new Database(dbPath);
sqlite.pragma('journal_mode = WAL');
const result = runMigratePhase12(sqlite);
sqlite.close();
console.log(
  `[migrate-phase12] Done (типов помечено без времени: ${result.typesMarked}; снято тегов времени: ${result.tagRowsRemoved}).`
);
