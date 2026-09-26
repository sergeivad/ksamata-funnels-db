/**
 * Phase-18: признак «воронка заведена в ЛИК» (funnels.in_leak). Идемпотентно.
 *
 *   cd app/
 *   npx tsx scripts/migrate-phase18-runner.ts
 *
 * Запускается только через свой раннер — CLI-блока у файла нет сознательно
 * (см. шапку migrate-phase16.ts и tests/migration-runners.test.ts).
 *
 * Зачем. Список воронок показывал чип типа («Прямые»), который ничего не
 * сообщал, и не показывал того, что владельцу нужно: есть ли по воронке
 * аналитика, то есть заведена ли она в ЛИК. Сервер сверяться с ЛИК не может —
 * у ЛИК нет токена, реестр читается только из залогиненного браузера, — поэтому
 * признак ставит человек на карточке, а фаза один раз засевает его по снимку.
 *
 * Два шага:
 *  1. Колонка `in_leak`, если её ещё нет.
 *  2. Единицы по снимку реестра ЛИК — ТОЛЬКО в прогон, который колонку завёл.
 *     `NOT NULL DEFAULT 0` не отличает «ещё не решали» от «решили, что нет»,
 *     и безусловный бэкфилл возвращал бы галку, снятую человеком, при каждом
 *     старте контейнера — грабли фазы 12.
 *
 * Оба шага в одной транзакции, по доводу фазы 16: прогон, умерший между ALTER
 * и бэкфиллом, иначе оставил бы колонку, которую следующий старт счёл бы
 * засеянной, — и признак навсегда остался бы нулём у всех.
 */
import { addColumnIfMissing } from './migrate-phase3-data';
import { PHASE18_COLUMN, PHASE18_FUNNELS_IN_LEAK } from './migrate-phase18-data';

export interface Phase18Result {
  /** Воронок, помеченных как заведённые в ЛИК (только в прогон, заводящий колонку). */
  funnelsMarked: number;
}

function hasColumn(
  sqlite: import('better-sqlite3').Database,
  table: string,
  column: string,
): boolean {
  return (sqlite.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[])
    .some((r) => r.name === column);
}

export function runMigratePhase18(sqlite: import('better-sqlite3').Database): Phase18Result {
  const columnExisted = hasColumn(sqlite, 'funnels', PHASE18_COLUMN.name);
  let funnelsMarked = 0;

  sqlite.transaction(() => {
    addColumnIfMissing(sqlite, 'funnels', PHASE18_COLUMN.name, PHASE18_COLUMN.ddl);
    if (columnExisted) return;
    // lower(): SQLite сравнивает TEXT побайтово, а код мог попасть в базу
    // мимо нормализации приложения («F81»). Коды ASCII, lower() честен.
    const mark = sqlite.prepare(
      `UPDATE funnels SET ${PHASE18_COLUMN.name} = 1 WHERE lower(front_code) = ?`,
    );
    for (const code of PHASE18_FUNNELS_IN_LEAK) {
      funnelsMarked += mark.run(code.toLowerCase()).changes;
    }
  })();

  return { funnelsMarked };
}
