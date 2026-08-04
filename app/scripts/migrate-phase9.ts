/**
 * Phase-9: «Лендинг воронки» перестаёт быть отдельной группой мониторинга.
 * Идемпотентно.
 *
 *   cd app/
 *   npx tsx scripts/migrate-phase9-runner.ts
 *
 * Запускается только через свой раннер — он единственная точка входа и в
 * Docker, и вручную. Своего CLI-блока у файла нет сознательно: esbuild
 * бандлит раннер вместе с этим файлом, и внутри бандла
 * `require.main === module` истинно, так что блок сработал бы на импорте
 * и миграция выполнялась бы дважды за старт контейнера.
 *
 * До Phase-9 адрес лендинга давал два вида источника: `landings` (блок
 * «Лендинги» в карточке) и `funnel_landing_url` (поле landing_url в шапке).
 * Для человека это одна сущность — страница воронки, — а на дашборде она
 * жила двумя чипами с двумя отдельными счётчиками и двумя решениями
 * «проверять или нет». Синк с этой миграции собирает оба места в `landings`;
 * фаза переводит то, что успело записаться раньше.
 *
 * Одного синка мало по двум причинам: при MONITOR_ENABLED=false он не
 * запускается вовсе, а решение человека по старой группе живёт в
 * monitor_source_kind_prefs, куда синк не пишет — оно потерялось бы молча,
 * и погашенные ленды включились бы сами.
 */

/** Вид источника, которого больше нет: адрес из поля funnels.landing_url. */
export const LEGACY_LANDING_SOURCE_KIND = 'funnel_landing_url';

/** Группа, в которую он вливается, — та же, что у блока «Лендинги». */
const LANDING_SOURCE_KIND = 'landings';

export interface Phase9Result {
  /** Цели, переведённые в группу «Лендинги». */
  retargeted: number;
  /** Решение по группе после слияния: 1 — проверять, 0 — нет, null — решения нет. */
  landingPref: number | null;
}

function hasTable(sqlite: import('better-sqlite3').Database, name: string): boolean {
  return (
    sqlite
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`)
      .get(name) !== undefined
  );
}

export function runMigratePhase9(sqlite: import('better-sqlite3').Database): Phase9Result {
  // Таблицы мониторинга заводит Phase-6. Она идёт раньше и в entrypoint, и в
  // тестах, но фаза не должна падать на базе, до которой Phase-6 не дошла:
  // entrypoint работает под `set -e`, и такое падение не пустило бы контейнер.
  if (!hasTable(sqlite, 'monitor_targets')) return { retargeted: 0, landingPref: null };

  sqlite.pragma('foreign_keys = ON');

  let retargeted = 0;
  const merge = sqlite.transaction(() => {
    // updated_at не трогаем сознательно: это отметка «когда цель менялась по
    // сути» (её гасил ретайрмент, её включал человек), а переименование группы
    // о самой цели не говорит ничего. Затерев её здесь, мы бы разом сбросили
    // историю по всем ~600 целям.
    retargeted = sqlite
      .prepare(`UPDATE monitor_targets SET source_kind = ? WHERE source_kind = ?`)
      .run(LANDING_SOURCE_KIND, LEGACY_LANDING_SOURCE_KIND).changes;

    const rows = sqlite
      .prepare(`SELECT source_kind, enabled FROM monitor_source_kind_prefs WHERE source_kind IN (?, ?)`)
      .all(LANDING_SOURCE_KIND, LEGACY_LANDING_SOURCE_KIND) as {
      source_kind: string;
      enabled: number;
    }[];

    if (rows.length > 0) {
      // При двух разных решениях побеждает «выключено». Обе группы включены по
      // умолчанию, поэтому «включено» чаще всего означает просто дефолт, а
      // «выключено» — что человек осознанно убрал эти страницы с дашборда.
      // Молча вернуть их обратно хуже, чем молча оставить погашенными: во
      // втором случае это видно на чипе, в первом — нет.
      const enabled = rows.every((r) => r.enabled === 1) ? 1 : 0;
      sqlite
        .prepare(
          `INSERT INTO monitor_source_kind_prefs (source_kind, enabled) VALUES (?, ?)
             ON CONFLICT(source_kind) DO UPDATE SET enabled = excluded.enabled`
        )
        .run(LANDING_SOURCE_KIND, enabled);
      sqlite
        .prepare(`DELETE FROM monitor_source_kind_prefs WHERE source_kind = ?`)
        .run(LEGACY_LANDING_SOURCE_KIND);
    }
  });
  merge();

  const pref = sqlite
    .prepare(`SELECT enabled FROM monitor_source_kind_prefs WHERE source_kind = ?`)
    .get(LANDING_SOURCE_KIND) as { enabled: number } | undefined;

  return { retargeted, landingPref: pref ? pref.enabled : null };
}
