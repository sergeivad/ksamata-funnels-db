/**
 * Phase-10: лендинг воронки живёт только в блоке «Лендинги». Идемпотентно.
 *
 *   cd app/
 *   npx tsx scripts/migrate-phase10-runner.ts
 *
 * Запускается только через свой раннер — он единственная точка входа и в
 * Docker, и вручную. Своего CLI-блока у файла нет сознательно: esbuild
 * бандлит раннер вместе с этим файлом, и внутри бандла
 * `require.main === module` истинно, так что блок сработал бы на импорте
 * и миграция выполнялась бы дважды за старт контейнера.
 *
 * Адрес посадочной страницы лежал в двух местах сразу: в колонке
 * `funnels.landing_url` и в блоке `landings`. Для человека это одна вещь, и
 * два места означали ровно то, чем такое всегда кончается: 25 активных воронок
 * держали адрес только в колонке, 20 — в обоих, и какое из мест правда,
 * зависело от того, кто последним редактировал. Правится же в интерфейсе
 * только блок — колонки в карточке нет вовсе.
 *
 * Поэтому: адреса из колонки дописываются в блок (те, которых там ещё нет),
 * колонка очищается. Перенос идёт первым, очистка — следом и в той же
 * транзакции: оборвись прогон посередине, потерять адрес нельзя.
 *
 * Фаза 3 (`migrate-funnel-data.ts`) когда-то уже перенесла легаси-поля в
 * блоки — эта фаза доводит до конца ту же линию для того, что накопилось в
 * колонке после неё.
 */

/** Адреса из многоссылочной колонки: разделители — пробелы, запятые, «;». */
export function splitLandingField(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const out: string[] = [];
  for (const part of String(raw).split(/[\s,;]+/)) {
    // Хвостовые кавычки и скобки встречаются в живых данных — они не часть
    // адреса. Сам адрес переносим как есть, без нормализации: блок хранит то,
    // что ввёл человек, и подменять ему ссылку миграция не должна.
    const url = part.trim().replace(/^["'«»(]+|["'«»),]+$/g, '');
    if (/^https?:\/\//i.test(url) && !out.includes(url)) out.push(url);
  }
  return out;
}

/** Сравниваем адреса как это делает человек: регистр и хвостовой «/» не в счёт. */
function sameUrlKey(url: string): string {
  return url.trim().toLowerCase().replace(/\/+$/, '');
}

export interface Phase10Result {
  /** Адреса, дописанные из колонки в блок. */
  moved: number;
  /** Воронки, у которых колонка очищена. */
  cleared: number;
}

export function runMigratePhase10(sqlite: import('better-sqlite3').Database): Phase10Result {
  sqlite.pragma('foreign_keys = ON');

  const funnels = sqlite
    .prepare(`SELECT id, landing_url FROM funnels WHERE trim(coalesce(landing_url, '')) <> ''`)
    .all() as { id: number; landing_url: string }[];

  if (funnels.length === 0) return { moved: 0, cleared: 0 };

  const selectBlock = sqlite.prepare(
    `SELECT id FROM funnel_blocks WHERE funnel_id = ? AND kind = 'landings'`
  );
  const insertBlock = sqlite.prepare(
    `INSERT INTO funnel_blocks (funnel_id, kind, enabled, mode) VALUES (?, 'landings', 1, 'common')`
  );
  const enableBlock = sqlite.prepare(`UPDATE funnel_blocks SET enabled = 1 WHERE id = ?`);
  const selectItems = sqlite.prepare(
    `SELECT url, position FROM funnel_block_items WHERE block_id = ? ORDER BY position`
  );
  const insertItem = sqlite.prepare(
    `INSERT INTO funnel_block_items (block_id, slot, label, url, position) VALUES (?, NULL, '', ?, ?)`
  );
  const clearField = sqlite.prepare(`UPDATE funnels SET landing_url = '' WHERE id = ?`);

  let moved = 0;
  let cleared = 0;

  const migrate = sqlite.transaction(() => {
    for (const funnel of funnels) {
      const urls = splitLandingField(funnel.landing_url);

      // Колонка с мусором вместо адреса (такое в базе встречается) очищается
      // тоже: переносить нечего, а держать её ради нечитаемой строки — значит
      // оставить второе место жить.
      if (urls.length > 0) {
        let blockId = (selectBlock.get(funnel.id) as { id: number } | undefined)?.id;
        if (blockId === undefined) {
          blockId = Number(insertBlock.run(funnel.id).lastInsertRowid);
        }

        const existing = selectItems.all(blockId) as { url: string; position: number }[];
        const seen = new Set(existing.map((i) => sameUrlKey(i.url)));
        let position = existing.reduce((max, i) => Math.max(max, i.position), -1);

        let added = 0;
        for (const url of urls) {
          const key = sameUrlKey(url);
          if (seen.has(key)) continue;
          seen.add(key);
          position += 1;
          insertItem.run(blockId, url, position);
          added += 1;
        }

        if (added > 0) {
          moved += added;
          // Блок с адресами обязан быть включённым: выключенный не виден ни в
          // карточке, ни в мониторинге, и перенос «потерял» бы страницу.
          enableBlock.run(blockId);
        }
      }

      clearField.run(funnel.id);
      cleared += 1;
    }
  });
  migrate();

  return { moved, cleared };
}
