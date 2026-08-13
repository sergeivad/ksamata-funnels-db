/**
 * Standalone-миграция Phase-13 для Docker-образа.
 * Собирается в migrate-phase13.cjs через esbuild в builder-стадии.
 * Вызывается из docker-entrypoint.sh как: node /app/migrate-phase13.cjs
 */
import Database from 'better-sqlite3';
import { resolveCliDbPath } from './cli-db-path';
import { runMigratePhase13 } from './migrate-phase13';

// Путь: FUNNELS_DB_PATH, иначе дефолт от расположения скрипта (см. cli-db-path.ts).
// Несуществующая база — отказ, а не тихий пропуск: стартовать на
// непромигрированной базе хуже, чем не стартовать вовсе.
const dbPath = resolveCliDbPath();

console.log(`[migrate-phase13] Running Phase-13 migration on: ${dbPath}`);
const sqlite = new Database(dbPath);
sqlite.pragma('journal_mode = WAL');
const result = runMigratePhase13(sqlite);
sqlite.close();
console.log(
  `[migrate-phase13] Done (блоков переименовано: ${result.blocks}; целей мониторинга: ${result.targets}; решений по группе: ${result.prefs}).`
);
if (result.collisions.length > 0) {
  // Не падаем: entrypoint под `set -e`, а слить два блока в один автоматически
  // нельзя. Старый блок остался на месте и виден в базе — разбирать руками.
  console.warn(
    `[migrate-phase13] У этих воронок блоки под обоими слагами сразу, старый оставлен как есть: ${result.collisions.join(', ')}`
  );
}
