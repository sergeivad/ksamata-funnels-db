/**
 * Phase-6: таблицы мониторинга доступности лендов. Идемпотентно.
 *
 *   cd app/
 *   npx tsx scripts/migrate-phase6-runner.ts
 *
 * Запускается только через свой раннер — он единственная точка входа и в
 * Docker, и вручную. Своего CLI-блока у файла нет сознательно: esbuild
 * бандлит раннер вместе с этим файлом, и внутри бандла
 * `require.main === module` истинно, так что блок сработал бы на импорте
 * и миграция выполнялась бы дважды за старт контейнера.
 */
import { PHASE6_DDL, PHASE6_TARGET_COLUMNS } from './migrate-phase6-data';
import { addColumnIfMissing } from './migrate-phase3-data';

export function runMigratePhase6(sqlite: import('better-sqlite3').Database): void {
  sqlite.pragma('foreign_keys = ON');
  sqlite.exec(PHASE6_DDL);
  // Таблица уже могла быть создана ранним вариантом Phase-6 — доливаем колонки.
  for (const col of PHASE6_TARGET_COLUMNS) {
    addColumnIfMissing(sqlite, 'monitor_targets', col.name, col.ddl);
  }
}
