/**
 * Phase-13: вид блока `meditation` переименован в `upsell`.
 * Идемпотентно.
 *
 *   cd app/
 *   npx tsx scripts/migrate-phase13-runner.ts
 *
 * Запускается только через свой раннер — он единственная точка входа и в
 * Docker, и вручную. Своего CLI-блока у файла нет сознательно: esbuild
 * бандлит раннер вместе с этим файлом, и внутри бандла
 * `require.main === module` истинно, так что блок сработал бы на импорте
 * и миграция выполнялась бы дважды за старт контейнера.
 *
 * Блок давно называется не «Медитацией»: в него кладут дожимные материалы и
 * допродажи, и заголовок в реестре теперь «Допродажи / дожим». Слаг остался
 * от первой версии карточки (июнь 2026) и читался как обещание совсем другого
 * содержимого — ровно тот сорт расхождения, который в этой базе уже стоил
 * дорого (мёртвая `room_id_f1`, `landing_url` в двух местах). Наружу слаг не
 * виден: и CSV-экспорт, и подписи групп мониторинга берут заголовок из
 * BLOCK_KINDS, — так что переименование меняет только код и строки в базе.
 *
 * Прямой UPDATE, а не пересоздание строк: у цели мониторинга на `id` висят
 * monitor_state и monitor_events, и удаление с повторной вставкой стёрло бы
 * историю проверок. По той же причине не трогаем updated_at — переименование
 * группы не говорит о самой цели ничего.
 *
 * Фаза остаётся в цепочке, хотя после первого прогона ей нечего делать:
 * старый слаг никто больше не пишет (Phase-3 разбирает легаси-колонки один
 * раз по маркеру и уже с новым слагом). Пустой прогон стоит трёх UPDATE по
 * индексу, а выпавшая из цепочки миграция — непромигрированного прода.
 */

import { PHASE13_NEW_KIND, PHASE13_OLD_KIND } from './migrate-phase13-data';

export interface Phase13Result {
  /** Блоков воронок, переведённых на новый слаг. */
  blocks: number;
  /** Целей мониторинга, у которых переименована группа. */
  targets: number;
  /** Решение человека по группе: 1 — перенесено, 0 — переносить было нечего. */
  prefs: number;
  /**
   * Воронки, у которых на момент прогона были блоки под обоими слагами сразу.
   * Их старый блок оставлен как есть: слить два блока в один автоматически
   * нельзя (у каждого свои enabled, mode и список пунктов), а уронить фазу —
   * значит не пустить контейнер, entrypoint работает под `set -e`.
   */
  collisions: number[];
}

function hasTable(sqlite: import('better-sqlite3').Database, name: string): boolean {
  return (
    sqlite
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`)
      .get(name) !== undefined
  );
}

export function runMigratePhase13(sqlite: import('better-sqlite3').Database): Phase13Result {
  sqlite.pragma('foreign_keys = ON');

  const result: Phase13Result = { blocks: 0, targets: 0, prefs: 0, collisions: [] };

  const rename = sqlite.transaction(() => {
    // funnel_blocks(funnel_id, kind) уникален, поэтому переводим только те
    // воронки, у которых блока с новым слагом ещё нет. До выката кода такой
    // не появится вовсе; проверка нужна на случай повторного прогона поверх
    // базы, где блок уже завели заново под новым именем.
    result.collisions = (
      sqlite
        .prepare(
          `SELECT o.funnel_id AS funnelId
             FROM funnel_blocks o
             JOIN funnel_blocks n ON n.funnel_id = o.funnel_id AND n.kind = ?
            WHERE o.kind = ?
            ORDER BY o.funnel_id`
        )
        .all(PHASE13_NEW_KIND, PHASE13_OLD_KIND) as { funnelId: number }[]
    ).map((r) => r.funnelId);

    result.blocks = sqlite
      .prepare(
        `UPDATE funnel_blocks SET kind = ?
          WHERE kind = ?
            AND funnel_id NOT IN (SELECT funnel_id FROM funnel_blocks WHERE kind = ?)`
      )
      .run(PHASE13_NEW_KIND, PHASE13_OLD_KIND, PHASE13_NEW_KIND).changes;

    // Таблицы мониторинга заводит Phase-6. Она идёт раньше и в entrypoint, и в
    // тестах, но фаза не должна падать на базе, до которой Phase-6 не дошла.
    if (hasTable(sqlite, 'monitor_targets')) {
      // monitor_targets уникален по url, а не по (url, source_kind), так что
      // столкновения здесь быть не может.
      result.targets = sqlite
        .prepare(`UPDATE monitor_targets SET source_kind = ? WHERE source_kind = ?`)
        .run(PHASE13_NEW_KIND, PHASE13_OLD_KIND).changes;
    }

    if (hasTable(sqlite, 'monitor_source_kind_prefs')) {
      // Решение человека по группе переносим, только если под новым слагом
      // его ещё нет. Строка под новым именем могла появиться лишь после
      // переименования, то есть она свежее — затирать её старой нельзя.
      result.prefs = sqlite
        .prepare(
          `UPDATE monitor_source_kind_prefs SET source_kind = ?
            WHERE source_kind = ?
              AND NOT EXISTS (SELECT 1 FROM monitor_source_kind_prefs WHERE source_kind = ?)`
        )
        .run(PHASE13_NEW_KIND, PHASE13_OLD_KIND, PHASE13_NEW_KIND).changes;
      sqlite
        .prepare(`DELETE FROM monitor_source_kind_prefs WHERE source_kind = ?`)
        .run(PHASE13_OLD_KIND);
    }
  });
  rename();

  return result;
}
