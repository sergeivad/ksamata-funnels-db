/**
 * Phase-15: правописание тега этапа предсписка — «Предписок» → «Предсписок».
 * Идемпотентно.
 *
 *   cd app/
 *   npx tsx scripts/migrate-phase15-runner.ts
 *
 * Запускается только через свой раннер — он единственная точка входа и в
 * Docker, и вручную. Своего CLI-блока у файла нет сознательно: esbuild
 * бандлит раннер вместе с этим файлом, и внутри бандла
 * `require.main === module` истинно, так что блок сработал бы на импорте
 * и миграция выполнялась бы дважды за старт контейнера.
 *
 * Зачем. Тег этапа повторяет живой реестр предложений GetCourse дословно —
 * наборы сравниваются с ним посимвольно. До августа 2026 GetCourse писал этап
 * с опечаткой, «Предписок» без «с», и повторять её было обязательно. Между
 * снимками реестра 30.07 и 01.09 он опечатку исправил: 30.07 старое написание
 * несли 14 предложений и ни одного — новое; 01.09 старого нет вовсе, а новое
 * несут 34, причём те же 14 живы, у них просто сменился тег. Сверка с реестром
 * при этом не ломалась, а тихо давала ноль совпадений — то есть выглядела как
 * «расхождений нет».
 *
 * Почему отдельная фаза, а не одна правка константы. Строку шаблона фаза 14
 * сеет РАЗОВО, за маркером `phase14_predspisok_seed`: человек вправе очистить
 * набор в /tags, и безусловный сид возвращал бы снятое при каждом старте.
 * На существующей базе маркер уже стоит, поэтому смена константы туда не
 * доедет — шаблон так и останется со старым написанием, а материализация
 * фазы 14 (она читает tag_templates, а не константу) будет исправно
 * раскладывать старое написание по 460+ строкам funnel_tags при каждом старте.
 *
 * Три шага, все безусловные и самогасящиеся — переписывать нечего, как только
 * старого написания в базе не осталось:
 *
 *  1. tag_templates — строка шаблона сценария.
 *  2. funnel_tag_overrides — персональные правки, если кто-то вписал тег
 *     руками. На момент разбора таких нет ни одной, но шаг дешёвый, а
 *     оверрайд со старым написанием пережил бы фазу и всплыл бы в наборе
 *     одной воронки.
 *  3. tags — глобальное имя тега. Переименование строки здесь переносит все
 *     материализованные строки funnel_tags разом: они ссылаются на tag_id,
 *     а не на текст. Прямой правки funnel_tags не происходит вовсе.
 *
 * Порядок в цепочке — ПОСЛЕ фазы 14. На первом старте после выката 14
 * материализует ещё старое написание (шаблон в этот момент старый), 15
 * переписывает шаблон и имя тега; на всех следующих 14 уже читает новый
 * шаблон, а 15 не находит работы. Итог одинаковый в обоих случаях.
 *
 * Из цепочки не убираем: шаг 3 самовосстанавливающийся, а Python-импорт и
 * ручные скрипты в теории способны вернуть старое имя в tags.
 */

import { PHASE15_NEW_STAGE_TAG, PHASE15_OLD_STAGE_TAG } from './migrate-phase15-data';

type Sqlite = import('better-sqlite3').Database;

export interface Phase15Result {
  /** Строк tag_templates, переведённых на новое написание. */
  templateRows: number;
  /** Строк tag_templates со старым написанием, снятых как дубль нового. */
  templateRowsDropped: number;
  /** Строк funnel_tag_overrides, переведённых на новое написание. */
  overrideRows: number;
  /** Строк funnel_tag_overrides со старым написанием, снятых как дубль нового. */
  overrideRowsDropped: number;
  /** Строка tags переименована (нового имени в базе ещё не было). */
  tagRenamed: boolean;
  /** Старая строка tags слита в уже существующую новую и удалена. */
  tagMerged: boolean;
  /** Строк funnel_tags, оказавшихся под новым написанием. */
  funnelTagRows: number;
}

function tableExists(sqlite: Sqlite, name: string): boolean {
  return (
    sqlite.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(name) !==
    undefined
  );
}

/**
 * Строка шаблона.
 *
 * UNIQUE у tag_templates нет, поэтому слепой UPDATE в сценарии, где новое
 * написание уже есть, задвоил бы строку — набор от этого не изменился бы
 * (движок схлопывает дубли), но в /tags человек увидел бы тег дважды.
 * Поэтому: где новое уже есть — старое снимаем, где нет — переименовываем.
 */
function fixTemplates(sqlite: Sqlite): { renamed: number; dropped: number } {
  if (!tableExists(sqlite, 'tag_templates')) return { renamed: 0, dropped: 0 };

  const dropped = sqlite
    .prepare(
      `DELETE FROM tag_templates
        WHERE name = ?
          AND scenario IN (SELECT scenario FROM tag_templates WHERE name = ?)`
    )
    .run(PHASE15_OLD_STAGE_TAG, PHASE15_NEW_STAGE_TAG).changes;

  const renamed = sqlite
    .prepare(`UPDATE tag_templates SET name = ? WHERE name = ?`)
    .run(PHASE15_NEW_STAGE_TAG, PHASE15_OLD_STAGE_TAG).changes;

  return { renamed, dropped };
}

/**
 * Персональные оверрайды.
 *
 * Здесь UNIQUE(funnel_id, tag_type, name) есть, так что слепой UPDATE не
 * задвоил бы, а упал. Развилка та же и по той же причине; `op` при этом не
 * смотрим сознательно: если у воронки уже есть строка с новым написанием,
 * решение человека выражено ею, а не одноимённой строкой из прошлого.
 */
function fixOverrides(sqlite: Sqlite): { renamed: number; dropped: number } {
  if (!tableExists(sqlite, 'funnel_tag_overrides')) return { renamed: 0, dropped: 0 };

  const dropped = sqlite
    .prepare(
      `DELETE FROM funnel_tag_overrides
        WHERE name = ?
          AND EXISTS (
            SELECT 1 FROM funnel_tag_overrides n
             WHERE n.funnel_id = funnel_tag_overrides.funnel_id
               AND n.tag_type  = funnel_tag_overrides.tag_type
               AND n.name      = ?
          )`
    )
    .run(PHASE15_OLD_STAGE_TAG, PHASE15_NEW_STAGE_TAG).changes;

  const renamed = sqlite
    .prepare(`UPDATE funnel_tag_overrides SET name = ? WHERE name = ?`)
    .run(PHASE15_NEW_STAGE_TAG, PHASE15_OLD_STAGE_TAG).changes;

  return { renamed, dropped };
}

/**
 * Имя тега в глобальном справочнике `tags`.
 *
 * Обычный случай — простое переименование строки: все материализованные
 * строки funnel_tags ссылаются на tag_id и переезжают сами, ни одна из них
 * не правится. Слияние нужно на базе, где новое имя успело появиться раньше
 * (например, шаблон правили через /api/tag-templates, и resyncAllFunnels
 * завёл новую строку, а старая осталась сиротой): там строки funnel_tags
 * переводятся на новый tag_id, а старая строка справочника удаляется.
 */
function fixTagName(sqlite: Sqlite): { renamed: boolean; merged: boolean } {
  const oldRow = sqlite.prepare(`SELECT id FROM tags WHERE name = ?`).get(PHASE15_OLD_STAGE_TAG) as
    | { id: number }
    | undefined;
  if (!oldRow) return { renamed: false, merged: false };

  const newRow = sqlite.prepare(`SELECT id FROM tags WHERE name = ?`).get(PHASE15_NEW_STAGE_TAG) as
    | { id: number }
    | undefined;

  if (!newRow) {
    sqlite.prepare(`UPDATE tags SET name = ? WHERE id = ?`).run(PHASE15_NEW_STAGE_TAG, oldRow.id);
    return { renamed: true, merged: false };
  }

  // UPDATE OR IGNORE, потому что у funnel_tags есть UNIQUE(funnel_id, tag_id,
  // tag_type): строка, у которой новый тег в этом сценарии уже есть, не
  // переезжает, а остаётся дублем — и снимается следующим DELETE.
  sqlite
    .prepare(`UPDATE OR IGNORE funnel_tags SET tag_id = ? WHERE tag_id = ?`)
    .run(newRow.id, oldRow.id);
  sqlite.prepare(`DELETE FROM funnel_tags WHERE tag_id = ?`).run(oldRow.id);
  sqlite.prepare(`DELETE FROM tags WHERE id = ?`).run(oldRow.id);
  return { renamed: false, merged: true };
}

export function runMigratePhase15(sqlite: Sqlite): Phase15Result {
  sqlite.pragma('foreign_keys = ON');

  let result: Phase15Result = {
    templateRows: 0,
    templateRowsDropped: 0,
    overrideRows: 0,
    overrideRowsDropped: 0,
    tagRenamed: false,
    tagMerged: false,
    funnelTagRows: 0,
  };

  // Всё одной транзакцией: шаблон со старым написанием и тег с новым (или
  // наоборот) — не состояние, а рассинхрон, и следующая материализация
  // разложила бы его по всем воронкам.
  const tx = sqlite.transaction(() => {
    const templates = fixTemplates(sqlite);
    const overrides = fixOverrides(sqlite);
    const tag = fixTagName(sqlite);

    const rows = sqlite
      .prepare(
        `SELECT COUNT(*) AS n
           FROM funnel_tags ft JOIN tags g ON g.id = ft.tag_id
          WHERE g.name = ?`
      )
      .get(PHASE15_NEW_STAGE_TAG) as { n: number };

    result = {
      templateRows: templates.renamed,
      templateRowsDropped: templates.dropped,
      overrideRows: overrides.renamed,
      overrideRowsDropped: overrides.dropped,
      tagRenamed: tag.renamed,
      tagMerged: tag.merged,
      funnelTagRows: rows.n,
    };
  });
  tx();

  return result;
}
