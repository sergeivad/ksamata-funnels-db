/**
 * Phase-3 schema migration: new funnels columns + funnel_blocks /
 * funnel_block_items tables. Idempotent. Data migration lives in
 * migrate-funnel-data.ts (called separately after this).
 *
 * Run against the real DB:
 *   cd app/
 *   npx tsx scripts/migrate-phase3-runner.ts
 *
 * Запускается только через свой раннер — он единственная точка входа и в
 * Docker, и вручную. Своего CLI-блока у файла нет сознательно: esbuild
 * бандлит раннер вместе с этим файлом, и внутри бандла
 * `require.main === module` истинно, так что блок сработал бы на импорте
 * и миграция выполнялась бы дважды за старт контейнера.
 */

import { PHASE3_DDL, PHASE3_FUNNEL_COLUMNS, addColumnIfMissing } from './migrate-phase3-data';

export function runMigratePhase3(sqlite: import('better-sqlite3').Database): void {
  sqlite.pragma('foreign_keys = ON');
  for (const col of PHASE3_FUNNEL_COLUMNS) {
    addColumnIfMissing(sqlite, 'funnels', col.name, col.ddl);
  }
  sqlite.exec(PHASE3_DDL);
}
