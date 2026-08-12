/**
 * Phase-12: у типа воронки появляется признак «есть эфиры по времени».
 * Идемпотентно.
 *
 *   cd app/
 *   npx tsx scripts/migrate-phase12-runner.ts
 *
 * Запускается только через свой раннер — он единственная точка входа и в
 * Docker, и вручную. Своего CLI-блока у файла нет сознательно: esbuild
 * бандлит раннер вместе с этим файлом, и внутри бандла
 * `require.main === module` истинно, так что блок сработал бы на импорте
 * и миграция выполнялась бы дважды за старт контейнера.
 *
 * Зачем. Тег «АВ Время: …» в реестре предложений GetCourse стоит только на
 * оплатах вебинарных воронок: у «АВ Прямые» — на одном предложении из 71 (и то
 * по ошибке), у квизов — ни на одном из 24. У нас же он приезжал в набор любой
 * воронки из шаблона tag_templates, потому что зависел от сценария, а не от
 * типа. Человек копировал набор оплаты у прямой воронки и получал время,
 * которого у неё нет.
 *
 * Признак кладём в справочник, а не в список внутри кода: набор маркеров
 * задаёт GetCourse, пятый может появиться без нашего участия — тогда галка
 * ставится в /refs. Тот же довод, по которому фаза 8 завела сам справочник.
 *
 * Три шага, и второй отличается от третьего условием запуска:
 *
 *  1. Колонка `has_time`, если её ещё нет.
 *  2. Нули у безвременных маркеров — ТОЛЬКО в прогон, который эту колонку и
 *     завёл. `NOT NULL DEFAULT 1` не отличает «ещё не решали» от «решили, что
 *     время есть», так что безусловный бэкфилл затирал бы решение, принятое
 *     человеком в /refs, при каждом старте контейнера.
 *  3. Снятие тегов времени с воронок безвременных типов — при КАЖДОМ прогоне.
 *
 * Третий шаг правит funnel_tags напрямую, в обход движка шаблонов и
 * оверрайдов, чего обычно делать нельзя. Здесь можно ровно потому, что
 * удаляются те и только те строки, которых движок теперь и не построит:
 * ближайшая материализация даёт тот же результат (проверяется тестом).
 * Безусловность делает шаг самовосстанавливающимся — если строка времени
 * когда-нибудь приедет мимо приложения, следующий старт её подметёт.
 */
import { addColumnIfMissing } from './migrate-phase3-data';
import { PHASE12_FUNNEL_TYPE_COLUMN } from './migrate-phase12-data';
import { TIMELESS_FUNNEL_TYPES } from '../src/lib/funnel-type';
import { TIME_TAG_PREFIX } from '../src/lib/ab-tags';

export interface Phase12Result {
  /** Типов, помеченных как безвременные (только в прогон, заводящий колонку). */
  typesMarked: number;
  /** Снятых строк funnel_tags с тегом времени. */
  tagRowsRemoved: number;
}

function hasColumn(sqlite: import('better-sqlite3').Database, table: string, column: string): boolean {
  return (sqlite.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[])
    .some((r) => r.name === column);
}

export function runMigratePhase12(sqlite: import('better-sqlite3').Database): Phase12Result {
  sqlite.pragma('foreign_keys = ON');

  const columnExisted = hasColumn(sqlite, 'funnel_types', PHASE12_FUNNEL_TYPE_COLUMN.name);
  addColumnIfMissing(
    sqlite,
    'funnel_types',
    PHASE12_FUNNEL_TYPE_COLUMN.name,
    PHASE12_FUNNEL_TYPE_COLUMN.ddl,
  );

  let typesMarked = 0;
  let tagRowsRemoved = 0;

  sqlite.transaction(() => {
    if (!columnExisted) {
      const mark = sqlite.prepare('UPDATE funnel_types SET has_time = 0 WHERE name = ?');
      for (const name of TIMELESS_FUNNEL_TYPES) typesMarked += mark.run(name).changes;
    }

    // Строки таблицы funnel_tags, чей тег начинается на «АВ Время: », у воронок
    // безвременного типа. Сам тег в таблице tags остаётся — он в ходу у
    // вебинарных воронок; удалять его оттуда нельзя.
    tagRowsRemoved = sqlite.prepare(`
      DELETE FROM funnel_tags
       WHERE tag_id IN (SELECT id FROM tags WHERE name LIKE ? ESCAPE '\\')
         AND funnel_id IN (
               SELECT f.id FROM funnels f
                 JOIN funnel_types ft ON ft.id = f.funnel_type_id
                WHERE ft.has_time = 0
             )
    `).run(`${TIME_TAG_PREFIX}%`).changes;
  })();

  return { typesMarked, tagRowsRemoved };
}
