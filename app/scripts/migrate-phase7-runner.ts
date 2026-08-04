/**
 * Standalone-миграция Phase-7 для Docker-образа.
 * Собирается в migrate-phase7.cjs через esbuild в builder-стадии:
 *   npx esbuild scripts/migrate-phase7-runner.ts \
 *     --bundle --platform=node --external:better-sqlite3 --outfile=migrate-phase7.cjs
 * Вызывается из docker-entrypoint.sh как: node /app/migrate-phase7.cjs
 */

import Database from 'better-sqlite3';
import { resolveCliDbPath } from './cli-db-path';
import { runMigratePhase7 } from './migrate-phase7';

// Путь: FUNNELS_DB_PATH, иначе дефолт от расположения скрипта (см. cli-db-path.ts).
// Несуществующая база — отказ, а не тихий пропуск: стартовать на
// непромигрированной базе хуже, чем не стартовать вовсе.
const dbPath = resolveCliDbPath();

console.log(`[migrate-phase7] Running Phase-7 migration on: ${dbPath}`);
const sqlite = new Database(dbPath);
sqlite.pragma('journal_mode = WAL');
const result = runMigratePhase7(sqlite);
sqlite.close();
// Обнулённый дубликат — потеря видимого номера, поэтому он должен остаться
// в логе контейнера, а не только в базе.
for (const d of result.clearedDuplicates) {
  console.warn(`[migrate-phase7] funnel #${d.id}: duplicate code ${d.code} cleared — set the real LeakEngine code by hand`);
}
console.log(`[migrate-phase7] Done (unique front_code; normalized: ${result.normalized}).`);
