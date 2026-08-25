/**
 * Standalone-миграция Phase-14 для Docker-образа.
 * Собирается в migrate-phase14.cjs через esbuild в builder-стадии.
 * Вызывается из docker-entrypoint.sh как: node /app/migrate-phase14.cjs
 */
import Database from 'better-sqlite3';
import { resolveCliDbPath } from './cli-db-path';
import { runMigratePhase14 } from './migrate-phase14';

// Путь: FUNNELS_DB_PATH, иначе дефолт от расположения скрипта (см. cli-db-path.ts).
// Несуществующая база — отказ, а не тихий пропуск: стартовать на
// непромигрированной базе хуже, чем не стартовать вовсе.
const dbPath = resolveCliDbPath();

console.log(`[migrate-phase14] Running Phase-14 migration on: ${dbPath}`);
const sqlite = new Database(dbPath);
sqlite.pragma('journal_mode = WAL');
const result = runMigratePhase14(sqlite);
sqlite.close();
console.log(
  `[migrate-phase14] Done (таблиц перестроено: ${result.tablesRebuilt.length}` +
    `${result.tablesRebuilt.length ? ` [${result.tablesRebuilt.join(', ')}]` : ''}; ` +
    `строка шаблона засеяна: ${result.templateSeeded ? 'да' : 'нет'}; ` +
    `строк funnel_tags: ${result.tagRows}; воронок пропущено: ${result.funnelsSkipped}).`
);
