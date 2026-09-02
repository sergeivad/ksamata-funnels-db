/**
 * Standalone-миграция Phase-16 для Docker-образа.
 * Собирается в migrate-phase16.cjs через esbuild в builder-стадии.
 * Вызывается из docker-entrypoint.sh как: node /app/migrate-phase16.cjs
 */
import Database from 'better-sqlite3';
import { resolveCliDbPath } from './cli-db-path';
import { runMigratePhase16 } from './migrate-phase16';

// Путь: FUNNELS_DB_PATH, иначе дефолт от расположения скрипта (см. cli-db-path.ts).
// Несуществующая база — отказ, а не тихий пропуск: стартовать на
// непромигрированной базе хуже, чем не стартовать вовсе.
const dbPath = resolveCliDbPath();

console.log(`[migrate-phase16] Running Phase-16 migration on: ${dbPath}`);
const sqlite = new Database(dbPath);
sqlite.pragma('journal_mode = WAL');
const result = runMigratePhase16(sqlite);
sqlite.close();
console.log(
  `[migrate-phase16] Done (воронок без предсписка помечено: ${result.funnelsCleared}; ` +
    `строк funnel_tags снято: ${result.tagRowsRemoved}).`
);
