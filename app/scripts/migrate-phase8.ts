/**
 * Phase-8: справочник типов воронки + FK у funnels. Идемпотентно.
 *
 *   cd app/
 *   npx tsx scripts/migrate-phase8-runner.ts
 *
 * Запускается только через свой раннер — он единственная точка входа и в
 * Docker, и вручную. Своего CLI-блока у файла нет сознательно: esbuild
 * бандлит раннер вместе с этим файлом, и внутри бандла
 * `require.main === module` истинно, так что блок сработал бы на импорте
 * и миграция выполнялась бы дважды за старт контейнера.
 *
 * Бэкфилл ставит всем воронкам «АВ Автоворонка» — это не решение о типе,
 * а сохранение того, что база утверждает и без пятой оси: маркер стоит
 * у каждой воронки из шаблона tag_templates. funnel_tags при этом
 * не меняется ни на строку, меняется только источник маркера.
 */
import { PHASE8_DDL, PHASE8_FUNNEL_COLUMN } from './migrate-phase8-data';
import { addColumnIfMissing } from './migrate-phase3-data';
import { SEED_FUNNEL_TYPES, DEFAULT_FUNNEL_TYPE } from '../src/lib/funnel-type';

export function runMigratePhase8(sqlite: import('better-sqlite3').Database): void {
  sqlite.pragma('foreign_keys = ON');
  sqlite.exec(PHASE8_DDL);
  addColumnIfMissing(sqlite, 'funnels', PHASE8_FUNNEL_COLUMN.name, PHASE8_FUNNEL_COLUMN.ddl);

  const insert = sqlite.prepare('INSERT OR IGNORE INTO funnel_types (name) VALUES (?)');
  for (const name of SEED_FUNNEL_TYPES) insert.run(name);

  // Бэкфилл только там, где тип ещё не проставлен: повторный прогон
  // не должен затирать уже принятые решения о типе.
  sqlite.prepare(`
    UPDATE funnels
       SET funnel_type_id = (SELECT id FROM funnel_types WHERE name = ?)
     WHERE funnel_type_id IS NULL
  `).run(DEFAULT_FUNNEL_TYPE);
}
