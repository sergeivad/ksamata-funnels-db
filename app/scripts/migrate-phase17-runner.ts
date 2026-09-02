/**
 * Standalone-миграция Phase-17 для Docker-образа.
 * Собирается в migrate-phase17.cjs через esbuild в builder-стадии.
 * Вызывается из docker-entrypoint.sh как: node /app/migrate-phase17.cjs
 */
import Database from 'better-sqlite3';
import { resolveCliDbPath } from './cli-db-path';
import { runMigratePhase17 } from './migrate-phase17';

// Путь: FUNNELS_DB_PATH, иначе дефолт от расположения скрипта (см. cli-db-path.ts).
// Несуществующая база — отказ, а не тихий пропуск: стартовать на
// непромигрированной базе хуже, чем не стартовать вовсе.
const dbPath = resolveCliDbPath();

console.log(`[migrate-phase17] Running Phase-17 migration on: ${dbPath}`);
const sqlite = new Database(dbPath);
sqlite.pragma('journal_mode = WAL');
const result = runMigratePhase17(sqlite);
sqlite.close();

for (const fix of result.fixed) {
  console.log(`[migrate-phase17]   ${fix.label}: ${fix.axis} «${fix.from}» → «${fix.to}»`);
}
// Непустой список — расхождение тегов со справочником, а не работа фазы:
// значение оси есть в теге, а строки в /refs под него нет. Фаза такую
// строку не заводит сознательно (см. шапку migrate-phase17.ts), поэтому
// говорим об этом вслух, а не молчим.
for (const skip of result.unresolved) {
  console.warn(
    `[migrate-phase17]   ПРОПУЩЕНО ${skip.label}: ${skip.axis} «${skip.to}» — нет такого значения в справочнике`
  );
}
console.log(
  `[migrate-phase17] Done (починено воронок-осей: ${result.fixed.length}` +
    `${result.unresolved.length ? `; пропущено без строки справочника: ${result.unresolved.length}` : ''}).`
);
