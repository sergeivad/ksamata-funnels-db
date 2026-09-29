/**
 * Phase-19: второй повтор вебинарной комнаты. Идемпотентно.
 *
 *   cd app/
 *   npx tsx scripts/migrate-phase19-runner.ts
 *
 * Запускается только через свой раннер — CLI-блока у файла нет сознательно
 * (см. шапку migrate-phase16.ts и tests/migration-runners.test.ts).
 *
 * Зачем. С сентября 2026 у каждого дня эфира по два повтора (замер по Бизону
 * 29.09: у эфира 15:00 — в 19:00 и в 9:00, у 19:00 — в 9:00 и в 12:00), и у
 * каждого повтора, как у эфира, два адреса: страница ГетКурса и комната Web.
 * Первый повтор уже лежал в `replay_url` (GC) и `web_replay` (Web, писал только
 * Python-импорт, приложение его не видело). Фаза заводит место под второй
 * повтор и под время обоих.
 *
 * Только колонки, без переноса данных: `web_replay` уже заполнен там, где
 * повтор был, а второго повтора в базе нет нигде.
 */
import { addColumnIfMissing } from './migrate-phase3-data';
import { PHASE19_COLUMNS } from './migrate-phase19-data';

export interface Phase19Result {
  /** Сколько колонок фаза завела в этот прогон (0 — всё уже было). */
  columnsAdded: number;
}

function columnNames(sqlite: import('better-sqlite3').Database): Set<string> {
  return new Set(
    (sqlite.prepare(`PRAGMA table_info(funnel_days)`).all() as { name: string }[]).map((r) => r.name),
  );
}

export function runMigratePhase19(sqlite: import('better-sqlite3').Database): Phase19Result {
  const before = columnNames(sqlite);
  sqlite.transaction(() => {
    for (const col of PHASE19_COLUMNS) addColumnIfMissing(sqlite, 'funnel_days', col.name, col.ddl);
  })();
  return { columnsAdded: PHASE19_COLUMNS.filter((c) => !before.has(c.name)).length };
}
