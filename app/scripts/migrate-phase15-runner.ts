/**
 * Standalone-миграция Phase-15 для Docker-образа.
 * Собирается в migrate-phase15.cjs через esbuild в builder-стадии.
 * Вызывается из docker-entrypoint.sh как: node /app/migrate-phase15.cjs
 */
import Database from 'better-sqlite3';
import { resolveCliDbPath } from './cli-db-path';
import { runMigratePhase15 } from './migrate-phase15';

// Путь: FUNNELS_DB_PATH, иначе дефолт от расположения скрипта (см. cli-db-path.ts).
// Несуществующая база — отказ, а не тихий пропуск: стартовать на
// непромигрированной базе хуже, чем не стартовать вовсе.
const dbPath = resolveCliDbPath();

console.log(`[migrate-phase15] Running Phase-15 migration on: ${dbPath}`);
const sqlite = new Database(dbPath);
sqlite.pragma('journal_mode = WAL');
const result = runMigratePhase15(sqlite);
sqlite.close();
console.log(
  `[migrate-phase15] Done (шаблон: ${result.templateRows} переименовано` +
    `${result.templateRowsDropped ? `, ${result.templateRowsDropped} снято как дубль` : ''}; ` +
    `оверрайдов: ${result.overrideRows} переименовано` +
    `${result.overrideRowsDropped ? `, ${result.overrideRowsDropped} снято как дубль` : ''}; ` +
    `тег: ${result.tagRenamed ? 'переименован' : result.tagMerged ? 'слит с существующим' : 'нечего править'}; ` +
    `строк funnel_tags под новым написанием: ${result.funnelTagRows}).`
);
