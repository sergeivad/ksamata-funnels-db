/**
 * Phase-5 schema migration: tag_templates + funnel_tag_overrides + template seed.
 * Idempotent. Run AFTER Phase-3.
 *
 *   cd app/
 *   npx tsx scripts/migrate-phase5-runner.ts
 *
 * Запускается только через свой раннер — он единственная точка входа и в
 * Docker, и вручную. Своего CLI-блока у файла нет сознательно: esbuild
 * бандлит раннер вместе с этим файлом, и внутри бандла
 * `require.main === module` истинно, так что блок сработал бы на импорте
 * и миграция выполнялась бы дважды за старт контейнера.
 */
import { PHASE5_DDL, seedTagTemplates } from './migrate-phase5-data';

export function runMigratePhase5(sqlite: import('better-sqlite3').Database): void {
  sqlite.pragma('foreign_keys = ON');
  sqlite.exec(PHASE5_DDL);
  seedTagTemplates(sqlite);
}
