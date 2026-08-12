/**
 * Phase-11: адреса дашбордов и подсчётов регистраций живут только в блоке
 * «Ссылки». Идемпотентно.
 *
 *   cd app/
 *   npx tsx scripts/migrate-phase11-runner.ts
 *
 * Запускается только через свой раннер — он единственная точка входа и в
 * Docker, и вручную. Своего CLI-блока у файла нет сознательно: esbuild
 * бандлит раннер вместе с этим файлом, и внутри бандла
 * `require.main === module` истинно, так что блок сработал бы на импорте
 * и миграция выполнялась бы дважды за старт контейнера.
 *
 * Семь колонок `funnels` держали те же адреса, что и блок `links`, но правит
 * человек только блок: полей карточки у колонок нет вовсе, и приложение их
 * не читает и не пишет. Два места кончились тем, чем всегда: у f9 и f16 в
 * блоке лежала копия «Регистрации всего» под подписью «Дашборд продаж», а
 * верный адрес дашборда остался только в колонке.
 *
 * Правило переноса — то же, что у фазы 10: дописать в блок то, чего в нём ещё
 * нет, сравнивая адреса без учёта регистра и хвостового слэша. Подписи в
 * сравнении НЕ участвуют, поэтому понятия «конфликт» у фазы нет: расхождение
 * выглядит как «этого адреса в блоке нет» и дописывается вторым пунктом.
 * Ничего не теряется, а лишний пункт человек снимает в админке.
 *
 * Блок `links` (в отличие от `landings`, который фаза 10 переносила туда же)
 * умеет режим «по времени»: пункт со slot = NULL в нём не рисует ни редактор,
 * ни карточка — он есть в базе, но человеку не виден и не доступен для
 * правки, а колонка при этом уже пуста. Фаза читает режим существующего
 * блока и в `by_time` кладёт пункт в слот 15:00, а не в оба сразу: адрес не
 * привязан ко времени, и один видимый пункт, который человек может
 * перетащить, лучше двух, которые придётся сверять между собой. Вновь
 * созданный блок фаза всегда делает `common`, так что для него slot остаётся
 * NULL, как и раньше.
 *
 * Фаза остаётся в цепочке навсегда: колонки продолжают писать Python-скрипты
 * импорта (tools/data-import/), и каждый старт контейнера подметает то, что
 * попало туда в обход приложения.
 */

/** Колонка → подпись пункта блока. Та же таблица, что в migrate-funnel-data.ts. */
export const LINK_COLUMNS: { col: string; label: string }[] = [
  { col: 'dash_sales_url',   label: 'Дашборд продаж' },
  { col: 'dash_pereliv_url', label: 'Дашборд перелива' },
  { col: 'regi_total_url',   label: 'Регистрации всего' },
  { col: 'regi_15_url',      label: 'Регистрации 15:00' },
  { col: 'regi_19_url',      label: 'Регистрации 19:00' },
  { col: 'regi_notime_url',  label: 'Регистрации без времени' },
  { col: 'predspisok_url',   label: 'Предсписок' },
];

/** Сравниваем адреса как это делает человек: регистр и хвостовой «/» не в счёт. */
function sameUrlKey(url: string): string {
  return url.trim().toLowerCase().replace(/\/+$/, '');
}

export interface Phase11Result {
  /** Адреса, дописанные из колонок в блок. */
  moved: number;
  /** Воронки, у которых колонки очищены. */
  cleared: number;
}

export function runMigratePhase11(sqlite: import('better-sqlite3').Database): Phase11Result {
  sqlite.pragma('foreign_keys = ON');

  // Имена колонок — литералы этого файла, не пользовательский ввод.
  const colNames = LINK_COLUMNS.map((c) => c.col);
  const anyFilled = colNames.map((c) => `trim(coalesce(${c}, '')) <> ''`).join(' OR ');

  const rows = sqlite
    .prepare(`SELECT id, ${colNames.join(', ')} FROM funnels WHERE ${anyFilled}`)
    .all() as (Record<string, string | null> & { id: number })[];

  if (rows.length === 0) return { moved: 0, cleared: 0 };

  const selectBlock = sqlite.prepare(
    `SELECT id, mode FROM funnel_blocks WHERE funnel_id = ? AND kind = 'links'`
  );
  const insertBlock = sqlite.prepare(
    `INSERT INTO funnel_blocks (funnel_id, kind, enabled, mode) VALUES (?, 'links', 1, 'common')`
  );
  const enableBlock = sqlite.prepare(`UPDATE funnel_blocks SET enabled = 1 WHERE id = ?`);
  const selectItems = sqlite.prepare(
    `SELECT url, position FROM funnel_block_items WHERE block_id = ? ORDER BY position`
  );
  const insertItem = sqlite.prepare(
    `INSERT INTO funnel_block_items (block_id, slot, label, url, position) VALUES (?, ?, ?, ?, ?)`
  );
  const clearCols = sqlite.prepare(
    `UPDATE funnels SET ${colNames.map((c) => `${c} = ''`).join(', ')} WHERE id = ?`
  );

  let moved = 0;
  let cleared = 0;

  const migrate = sqlite.transaction(() => {
    for (const row of rows) {
      // Колонка с мусором вместо адреса (такое в базе встречается) не
      // переносится, но гасится тоже: переносить нечего, а держать второе
      // место ради нечитаемой строки — значит оставить его жить.
      const pending = LINK_COLUMNS.map(({ col, label }) => ({
        label,
        url: String(row[col] ?? '').trim(),
      })).filter((p) => /^https?:\/\//i.test(p.url));

      if (pending.length > 0) {
        const existingBlock = selectBlock.get(row.id) as { id: number; mode: string } | undefined;
        let blockId: number;
        let blockMode: string;
        if (existingBlock === undefined) {
          blockId = Number(insertBlock.run(row.id).lastInsertRowid);
          blockMode = 'common';
        } else {
          blockId = existingBlock.id;
          blockMode = existingBlock.mode;
        }

        // В блоке «по времени» пункт со slot = NULL не рисует ни редактор
        // (BlockListField фильтрует по '15'/'19'), ни карточка — перенос
        // спрятал бы адрес ровно там же, откуда его вытащил. Кладём в
        // первый слот: адрес не привязан ко времени, и один видимый пункт,
        // который человек может подвинуть, лучше двух, которые придётся
        // сверять между собой. Новый блок фаза всегда создаёт 'common' —
        // для него ветка не применяется.
        const itemSlot = blockMode === 'by_time' ? '15' : null;

        const existing = selectItems.all(blockId) as { url: string; position: number }[];
        const seen = new Set(existing.map((i) => sameUrlKey(i.url)));
        let position = existing.reduce((max, i) => Math.max(max, i.position), -1);

        let added = 0;
        for (const { label, url } of pending) {
          const key = sameUrlKey(url);
          if (seen.has(key)) continue;
          seen.add(key);
          position += 1;
          insertItem.run(blockId, itemSlot, label, url, position);
          added += 1;
        }

        if (added > 0) {
          moved += added;
          // Блок со ссылками обязан быть включённым: выключенный не виден в
          // карточке, и перенос «потерял» бы адрес из виду.
          enableBlock.run(blockId);
        }
      }

      clearCols.run(row.id);
      cleared += 1;
    }
  });
  migrate();

  return { moved, cleared };
}
