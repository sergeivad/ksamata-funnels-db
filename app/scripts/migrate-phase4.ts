/**
 * Phase-4 schema migration: funnels.rooms_enabled column + smart backfill.
 * Idempotent. Run AFTER Phase-3 (needs the funnels table as migrated).
 *
 * Run against the real DB:
 *   cd app/
 *   npx tsx scripts/migrate-phase4-runner.ts
 *
 * Запускается только через свой раннер — он единственная точка входа и в
 * Docker, и вручную. Своего CLI-блока у файла нет сознательно: esbuild
 * бандлит раннер вместе с этим файлом, и внутри бандла
 * `require.main === module` истинно, так что блок сработал бы на импорте
 * и миграция выполнялась бы дважды за старт контейнера.
 */

import { PHASE4_FUNNEL_COLUMNS, backfillRoomsEnabled } from './migrate-phase4-data';
import { addColumnIfMissing } from './migrate-phase3-data';

export function runMigratePhase4(sqlite: import('better-sqlite3').Database): void {
  sqlite.pragma('foreign_keys = ON');
  for (const col of PHASE4_FUNNEL_COLUMNS) {
    addColumnIfMissing(sqlite, 'funnels', col.name, col.ddl);
  }
  backfillRoomsEnabled(sqlite);
}
