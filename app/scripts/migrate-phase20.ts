/**
 * Phase-20: «чего не хватает в ЛИК» (funnels.leak_todo). Идемпотентно.
 *
 *   cd app/
 *   npx tsx scripts/migrate-phase20-runner.ts
 *
 * Запускается только через свой раннер — CLI-блока у файла нет сознательно
 * (см. шапку migrate-phase16.ts и tests/migration-runners.test.ts).
 *
 * Зачем. Воронку иногда заводят в ЛИК заранее, для планирования, и набор
 * правил получается неполным: нет предложения регистрации в GetCourse, нет
 * вебинарных комнат. Галка «есть в ЛИК» (Phase 18) такую воронку не отличает
 * от готовой, и недоделка теряется. Фаза заводит свободное текстовое поле, по
 * нему список рисует пилюлю «ЛИК · доделать».
 *
 * Только колонка, без бэкфилла: заранее заведённых неполных воронок сервис
 * не знает, их называет человек.
 */
import { addColumnIfMissing } from './migrate-phase3-data';
import { PHASE20_COLUMN } from './migrate-phase20-data';

export interface Phase20Result {
  /** 1, если колонку завёл этот прогон; 0 — она уже была. */
  columnsAdded: number;
}

function hasColumn(sqlite: import('better-sqlite3').Database): boolean {
  return (sqlite.prepare(`PRAGMA table_info(funnels)`).all() as { name: string }[])
    .some((r) => r.name === PHASE20_COLUMN.name);
}

export function runMigratePhase20(sqlite: import('better-sqlite3').Database): Phase20Result {
  const existed = hasColumn(sqlite);
  sqlite.transaction(() => {
    addColumnIfMissing(sqlite, 'funnels', PHASE20_COLUMN.name, PHASE20_COLUMN.ddl);
  })();
  return { columnsAdded: existed ? 0 : 1 };
}
