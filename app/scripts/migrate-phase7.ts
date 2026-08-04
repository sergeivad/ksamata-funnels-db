/**
 * Phase-7: F-код воронки становится уникальным. Идемпотентно.
 *
 *   cd app/
 *   npx tsx scripts/migrate-phase7-runner.ts
 *
 * Запускается только через свой раннер — он единственная точка входа и в
 * Docker, и вручную. Своего CLI-блока у файла нет сознательно: esbuild
 * бандлит раннер вместе с этим файлом, и внутри бандла
 * `require.main === module` истинно, так что блок сработал бы на импорте
 * и миграция выполнялась бы дважды за старт контейнера.
 *
 * До Phase-7 у `front_code` не было ни уникального индекса, ни проверки в API,
 * а черновик получал код как `f${num}` — из чужой последовательности. При
 * max(num)=75 и max(F)=79 следующие два черновика получили бы f76 и уже занятый
 * f77, и дубль прошёл бы молча. Код — то, чем воронка называется во внешних
 * материалах, поэтому две «f77» неразличимы для человека.
 */
import { PHASE7_DDL, PHASE7_NORMALIZE } from './migrate-phase7-data';

export interface Phase7Result {
  /** Коды, приведённые к нижнему регистру / без пробелов. */
  normalized: number;
  /** Воронки, у которых код обнулён как дубликат: id → освобождённый код. */
  clearedDuplicates: { id: number; code: string }[];
}

export function runMigratePhase7(sqlite: import('better-sqlite3').Database): Phase7Result {
  sqlite.pragma('foreign_keys = ON');

  const normalized = sqlite.prepare(PHASE7_NORMALIZE).run().changes;

  // Дубликаты, если они уже успели завестись, надо развести ДО индекса: иначе
  // CREATE UNIQUE INDEX падает, а он идёт из docker-entrypoint.sh под `set -e`
  // — то есть контейнер не поднимется вообще.
  //
  // Разводим в пользу меньшего id: старшая воронка получила код раньше и
  // почти наверняка законно (из ЛИК), дубликат — это уже промах автовыдачи.
  // У промахнувшейся код обнуляется, а не переписывается на следующий
  // свободный: пустой код — законное состояние («ещё не знаем номер в ЛИК»),
  // а выдуманный завтра столкнётся с настоящим — ровно так вышло с f64–f72.
  const dupes = sqlite
    .prepare(
      `SELECT id, front_code AS code FROM funnels
        WHERE front_code IS NOT NULL AND front_code <> ''
          AND id <> (SELECT MIN(f2.id) FROM funnels f2 WHERE f2.front_code = funnels.front_code)
        ORDER BY id`
    )
    .all() as { id: number; code: string }[];

  if (dupes.length > 0) {
    const clear = sqlite.prepare(`UPDATE funnels SET front_code = '' WHERE id = ?`);
    const clearAll = sqlite.transaction((rows: { id: number }[]) => {
      for (const row of rows) clear.run(row.id);
    });
    clearAll(dupes);
  }

  sqlite.exec(PHASE7_DDL);

  return { normalized, clearedDuplicates: dupes };
}
