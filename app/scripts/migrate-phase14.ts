/**
 * Phase-14: пятый сценарий тегов — «Предсписок».
 * Идемпотентно.
 *
 *   cd app/
 *   npx tsx scripts/migrate-phase14-runner.ts
 *
 * Запускается только через свой раннер — он единственная точка входа и в
 * Docker, и вручную. Своего CLI-блока у файла нет сознательно: esbuild
 * бандлит раннер вместе с этим файлом, и внутри бандла
 * `require.main === module` истинно, так что блок сработал бы на импорте
 * и миграция выполнялась бы дважды за старт контейнера.
 *
 * Зачем. В реестре предложений GetCourse живёт этап «Предписок», которого в
 * модели базы не было: `tag_type` разрешал ровно четыре значения. 16 живых
 * предложений (и 2555 заказов на момент разбора 25.07) не привязывались ни к
 * одному сценарию — этим и занимались классы 3 и 6 отчёта аудита. Набор
 * предсписка устроен как мессенджер: этап плюс оси плюс маркер типа, без тега
 * времени.
 *
 * Решение владельца 2026-08-25: набор получают ВСЕ воронки, как мессенджер.
 * Сценарий — часть модели, а не свойство отдельной воронки.
 *
 * Три шага, и они разные по условию запуска:
 *
 *  1. Расширить CHECK у трёх таблиц. Их именно три (funnel_tags,
 *     tag_templates, funnel_tag_overrides), и PHASE5_DDL расширить их не может:
 *     он `CREATE TABLE IF NOT EXISTS`, то есть на существующей базе не делает
 *     ничего. SQLite не умеет ALTER для CHECK — только перестройка таблицы.
 *     Шаг сам себя гасит: DDL, где сценарий уже перечислен, пропускается.
 *  2. Засеять строку шаблона — ОДИН раз, за маркером в schema_migrations.
 *     Не «вставить, если строк нет»: человек вправе очистить шаблон в /tags,
 *     и безусловный сид возвращал бы снятое при каждом старте контейнера.
 *  3. Материализовать funnel_tags для нового сценария — при КАЖДОМ прогоне.
 *
 * Третий шаг правит funnel_tags напрямую, в обход движка шаблонов и
 * оверрайдов, чего обычно делать нельзя. Здесь можно ровно по доводу фазы 12:
 * пишутся те и только те строки, которые построит движок, что закреплено
 * тестом «материализация после фазы даёт тот же набор». Безусловность делает
 * шаг самовосстанавливающимся.
 */

import {
  PHASE14_SCENARIO,
  PHASE14_SEED_MARKER,
  PHASE14_STAGE_TAG,
  PHASE14_SCENARIO_TABLES,
} from './migrate-phase14-data';
import { AXIS_PREFIXES, TIME_TAG_PREFIX } from '../src/lib/ab-tags';

type Sqlite = import('better-sqlite3').Database;

export interface Phase14Result {
  /** Таблиц, у которых расширен CHECK (0 на повторном прогоне). */
  tablesRebuilt: string[];
  /** Строка шаблона засеяна этим прогоном. */
  templateSeeded: boolean;
  /** Строк funnel_tags, записанных для нового сценария. */
  tagRows: number;
  /** Воронок, пропущенных из-за пустых осей (пустые черновики). */
  funnelsSkipped: number;
}

function tableSql(sqlite: Sqlite, name: string): string | undefined {
  const row = sqlite
    .prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?`)
    .get(name) as { sql: string } | undefined;
  return row?.sql;
}

/**
 * Расширяет CHECK одной таблицы, перестраивая её целиком.
 *
 * DDL не переписывается руками, а берётся из sqlite_master и правится точечно:
 * так колонки, внешние ключи и UNIQUE переезжают дословно, без шанса потерять
 * что-нибудь при перепечатке. Место правки ищется по единственному вхождению
 * `'messenger'` — если их вдруг не одно, фаза падает, а не гадает.
 */
function widenCheck(sqlite: Sqlite, table: string, column: string): boolean {
  const sql = tableSql(sqlite, table);
  if (!sql) return false; // таблицы нет — фазы 5/3 до неё не дошли, не наше дело
  if (sql.includes(`'${PHASE14_SCENARIO}'`)) return false; // уже расширен

  // Убеждаемся, что правим тот CHECK, который имели в виду, а не однофамильца.
  if (!sql.includes(`CHECK(${column} IN (`)) {
    throw new Error(`phase14: в DDL таблицы ${table} не найден CHECK по колонке ${column}. DDL: ${sql}`);
  }

  const anchor = "'messenger'";
  const hits = sql.split(anchor).length - 1;
  if (hits !== 1) {
    throw new Error(
      `phase14: в DDL таблицы ${table} ожидалось одно вхождение ${anchor}, найдено ${hits}. ` +
        `DDL: ${sql}`
    );
  }
  const tmp = `${table}_phase14_new`;
  const newSql = sql
    .replace(/^CREATE TABLE\s+("?)[A-Za-z_][A-Za-z0-9_]*\1/, `CREATE TABLE "${tmp}"`)
    .replace(anchor, `${anchor}, '${PHASE14_SCENARIO}'`);
  if (!newSql.startsWith(`CREATE TABLE "${tmp}"`)) {
    throw new Error(`phase14: не удалось переименовать таблицу в DDL ${table}. DDL: ${sql}`);
  }

  // Индексы забираем из sqlite_master: автоиндексы UNIQUE(...) идут с sql=NULL
  // и переезжают сами вместе с текстом DDL, поэтому их отфильтровываем.
  const indexes = (
    sqlite
      .prepare(`SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = ? AND sql IS NOT NULL`)
      .all(table) as { sql: string }[]
  ).map((r) => r.sql);

  const columns = (sqlite.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[])
    .map((r) => `"${r.name}"`)
    .join(', ');

  // foreign_keys выключаем СНАРУЖИ транзакции: внутри прагма — no-op.
  sqlite.pragma('foreign_keys = OFF');
  try {
    const rebuild = sqlite.transaction(() => {
      sqlite.exec(newSql);
      sqlite.exec(`INSERT INTO "${tmp}" (${columns}) SELECT ${columns} FROM "${table}"`);
      sqlite.exec(`DROP TABLE "${table}"`);
      sqlite.exec(`ALTER TABLE "${tmp}" RENAME TO "${table}"`);
      for (const idx of indexes) sqlite.exec(idx);

      const fkErrors = sqlite.pragma('foreign_key_check') as unknown[];
      if (fkErrors.length > 0) {
        throw new Error(
          `phase14: foreign_key_check не прошёл после перестройки ${table}: ${JSON.stringify(fkErrors)}`
        );
      }
    });
    rebuild();
  } finally {
    sqlite.pragma('foreign_keys = ON');
  }
  return true;
}

/**
 * Сид строки шаблона, один раз за базу.
 *
 * Развилка «строки уже есть» — для СВЕЖЕЙ базы: там сценарий приходит из
 * PHASE5_TEMPLATE_SEED, и фазе остаётся только поставить маркер, чтобы не
 * задвоить строку.
 */
function seedTemplate(sqlite: Sqlite): boolean {
  sqlite.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY)`);
  const done = sqlite
    .prepare(`SELECT 1 FROM schema_migrations WHERE name = ?`)
    .get(PHASE14_SEED_MARKER);
  if (done) return false;

  const already = sqlite
    .prepare(`SELECT 1 FROM tag_templates WHERE scenario = ?`)
    .get(PHASE14_SCENARIO);

  const tx = sqlite.transaction(() => {
    if (!already) {
      sqlite
        .prepare(`INSERT INTO tag_templates (scenario, name, position) VALUES (?, ?, 0)`)
        .run(PHASE14_SCENARIO, PHASE14_STAGE_TAG);
    }
    sqlite.prepare(`INSERT INTO schema_migrations (name) VALUES (?)`).run(PHASE14_SEED_MARKER);
  });
  tx();
  return !already;
}

const AXIS_ORDER = [
  AXIS_PREFIXES.product,
  AXIS_PREFIXES.contractor,
  AXIS_PREFIXES.channel,
  AXIS_PREFIXES.direction,
];

/**
 * Пересобирает строки funnel_tags нового сценария — ровно так, как это делает
 * computeTagSet: шаблон (минус remove, минус идентичность), затем оси, затем
 * маркер типа, затем add-оверрайды; дубли схлопываются, первый выигрывает.
 */
function materialize(sqlite: Sqlite): { tagRows: number; funnelsSkipped: number } {
  const markerNames = new Set(
    (sqlite.prepare(`SELECT name FROM funnel_types`).all() as { name: string }[]).map((r) => r.name)
  );
  const isIdentity = (name: string) =>
    AXIS_ORDER.some((p) => name.startsWith(p)) || markerNames.has(name);

  const templateNames = (
    sqlite
      .prepare(`SELECT name FROM tag_templates WHERE scenario = ? ORDER BY position, id`)
      .all(PHASE14_SCENARIO) as { name: string }[]
  ).map((r) => r.name);

  const funnels = sqlite
    .prepare(
      `SELECT f.id AS id, t.name AS marker, COALESCE(t.has_time, 1) AS hasTime
         FROM funnels f
         LEFT JOIN funnel_types t ON t.id = f.funnel_type_id
        ORDER BY f.id`
    )
    .all() as { id: number; marker: string | null; hasTime: number }[];

  const axisRows = sqlite.prepare(
    `SELECT g.name AS name
       FROM funnel_tags ft JOIN tags g ON g.id = ft.tag_id
      WHERE ft.funnel_id = ? AND ft.tag_type = 'reg'`
  );
  const overrideRows = sqlite.prepare(
    `SELECT name, op FROM funnel_tag_overrides
      WHERE funnel_id = ? AND tag_type = ? ORDER BY position, id`
  );
  const insertTag = sqlite.prepare(`INSERT INTO tags (name) VALUES (?) ON CONFLICT(name) DO NOTHING`);
  const selectTag = sqlite.prepare(`SELECT id FROM tags WHERE name = ?`);
  const wipe = sqlite.prepare(`DELETE FROM funnel_tags WHERE funnel_id = ? AND tag_type = ?`);
  const insertRow = sqlite.prepare(
    `INSERT INTO funnel_tags (funnel_id, tag_id, tag_type, position) VALUES (?, ?, ?, ?)
       ON CONFLICT DO NOTHING`
  );

  let tagRows = 0;
  let funnelsSkipped = 0;

  const run = sqlite.transaction(() => {
    for (const f of funnels) {
      // Оси читаются из тегов сценария reg — единственного места, где живут
      // канал и направление (см. getAxesForFunnel в src/lib/funnels.ts).
      const regNames = (axisRows.all(f.id) as { name: string }[]).map((r) => r.name);
      const axes: string[] = [];
      for (const prefix of AXIS_ORDER) {
        const hit = regNames.find((n) => n.startsWith(prefix));
        if (hit) axes.push(hit);
      }
      // Все четыре оси пусты — это пустой черновик. resyncAllFunnels такие
      // пропускает, чтобы содержимое черновика не зависело от того, правил ли
      // кто-то шаблон между его заведением и первым сохранением.
      if (axes.length === 0) {
        funnelsSkipped += 1;
        continue;
      }

      const ov = overrideRows.all(f.id, PHASE14_SCENARIO) as { name: string; op: string }[];
      const removeSet = new Set(ov.filter((o) => o.op === 'remove' && !isIdentity(o.name)).map((o) => o.name));
      const dropTime = f.hasTime === 0;

      const names: string[] = [];
      const seen = new Set<string>();
      const push = (n: string) => {
        if (seen.has(n)) return;
        seen.add(n);
        names.push(n);
      };
      for (const n of templateNames) {
        if (isIdentity(n)) continue;
        if (dropTime && n.startsWith(TIME_TAG_PREFIX)) continue;
        if (removeSet.has(n)) continue;
        push(n);
      }
      for (const n of axes) push(n);
      if (f.marker) push(f.marker);
      for (const o of ov) {
        if (o.op !== 'add') continue;
        if (isIdentity(o.name)) continue;
        if (dropTime && o.name.startsWith(TIME_TAG_PREFIX)) continue;
        push(o.name);
      }

      wipe.run(f.id, PHASE14_SCENARIO);
      names.forEach((name, position) => {
        insertTag.run(name);
        const tag = selectTag.get(name) as { id: number };
        insertRow.run(f.id, tag.id, PHASE14_SCENARIO, position);
        tagRows += 1;
      });
    }
  });
  run();

  return { tagRows, funnelsSkipped };
}

export function runMigratePhase14(sqlite: Sqlite): Phase14Result {
  sqlite.pragma('foreign_keys = ON');

  const tablesRebuilt: string[] = [];
  for (const { table, column } of PHASE14_SCENARIO_TABLES) {
    if (widenCheck(sqlite, table, column)) tablesRebuilt.push(table);
  }

  const templateSeeded = seedTemplate(sqlite);
  const { tagRows, funnelsSkipped } = materialize(sqlite);

  return { tablesRebuilt, templateSeeded, tagRows, funnelsSkipped };
}
