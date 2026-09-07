/**
 * ЦЕЛЬ — БАЗА РЕПОЗИТОРИЯ (корневой `ksamata_funnels.db`). Прод не трогает —
 * для него отдельный скрипт `add-landings-prod-2026-09-07.cjs`, пишущий
 * через собственный HTTP API прода.
 *
 * ЗАЧЕМ И НА КАКИХ ДАННЫХ. Источник — выгрузка LeakEngine за август 2026
 * (`~/Downloads/leakengine_landings_by_funnel_august_2026.xlsx`): уникальные
 * лендинги по воронкам, реально принимавшие трафик, query/UTM/fragment в
 * адресах срезаны. Блок «Лендинги» собирался вручную и по таблице
 * маркетологов, а не из ЛИК, поэтому часть посадочных страниц в него не
 * попала. Скрипт ТОЛЬКО дописывает недостающее в конец существующего
 * списка — ничего не удаляет и не переупорядочивает: 38 воронок, 74 адреса
 * из выгрузки, накладываемых на 81 уже существующий пункт блока «Лендинги».
 *
 * Одна строка выгрузки исключена руками ДО попадания в этот файл: f19 /
 * `https://t.ksamata.ru/` — это «Личный кабинет» ksamata, а не лендинг
 * воронки, и в PAYLOAD ниже её нет.
 *
 * ПРАВИЛА:
 *   - Воронка ищется по F-коду (`normalizeFrontCode`); нет такого кода в
 *     базе — сообщаем и пропускаем, скрипт не падает и не трогает остальные.
 *   - Слияние — без учёта регистра и хвостового слэша
 *     (`u.trim().replace(/\/+$/,'').toLowerCase()`). Адрес уже есть в блоке —
 *     пропускаем; существующие пункты остаются как есть и в том же порядке,
 *     новые дописываются в конец в порядке из выгрузки.
 *   - Перед записью КАЖДЫЙ адрес блока — и уже лежащий, и новый — проходит
 *     `checkUrlField`. `replaceBlock` сам URL не валидирует (это делает
 *     PUT-роут, см. CLAUDE.md), а «слипшийся» адрес завёл бы в мониторинге
 *     вечно падающую цель. Уровень `error` на ЛЮБОЙ воронке — стоп с
 *     ненулевым кодом и печатью воронки/адреса, ничего не записано вообще
 *     (проверка идёт для всех воронок ДО первой записи).
 *   - Воронка, которой дописывать нечего (все адреса уже в блоке), вообще не
 *     трогается — `replaceBlock` для неё не вызывается.
 *   - У новых пунктов `slot: null`, `label: ''` — так устроены все 81
 *     существующих пункта блока «Лендинги» на сегодня; подписи из выгрузки
 *     не переносим.
 *   - Блок, в который дописываем, включаем (`enabled = true`) — прецедент
 *     Phase 10 (см. CLAUDE.md); режим (`mode`) берём тем, что уже стоит у
 *     блока (`getBlock` вернёт `'common'`, если блока ещё не было).
 *
 * Путь к базе — `resolveCliDbPath()` (см. `scripts/cli-db-path.ts`): дефолт
 * — корневой `ksamata_funnels.db` относительно расположения ЭТОГО файла (не
 * от cwd), либо `FUNNELS_DB_PATH`, если задан.
 *
 * Идемпотентен: повторный `--apply` не находит новых адресов ни у одной
 * воронки и ничего не пишет.
 *
 * Запуск из `app/`:
 *   npx tsx scripts/add-landings-2026-09-07.ts --dry-run
 *   npx tsx scripts/add-landings-2026-09-07.ts --apply
 */

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../src/db/schema';
import { resolveCliDbPath } from './cli-db-path';
import { getBlock, replaceBlock, type BlockItem } from '../src/lib/funnel-blocks';
import { type BlockMode } from '../src/lib/blocks';
import { checkUrlField } from '../src/lib/url-field';
import { normalizeFrontCode } from '../src/lib/front-code';

// F-код → лендинги из выгрузки LeakEngine за август 2026 (см. шапку выше).
// Исключение: f19 / https://t.ksamata.ru/ («Личный кабинет») сюда не входит.
const PAYLOAD: Record<string, string[]> = {
  f7: [
    'https://land.zhizn-bez-boli.ru/sustavy/a',
    'https://t.sustavy-spina.ru/',
    'https://t.sustavy-spina.ru/spb',
    'https://t.zhizn-bez-boli.ru/',
    'https://t.zhizn-bez-boli.ru/2',
  ],
  f9: [
    'https://land.tirolab.ru/rsya/tirol/a',
    'https://t.tirolab.ru/rsya/shzh/a',
  ],
  f11: [
    'https://t.ksamata.ru/nr/dbo/a',
  ],
  f13: [
    'https://t.ksamata.ru/nr/zkt/b',
  ],
  f15: [
    'https://t.ksamata.ru/nr/dbo/a',
    'https://t.ksamata.ru/nr/dbo/b',
  ],
  f19: [
    'https://t.ksamata.ru/ht/boo/a',
    'https://t.ksamata.ru/ht/boo/c',
    'https://t.ksamata.ru/sust-ht',
  ],
  f21: [
    'https://lp.ksamata.ru/sh-izh/yh',
  ],
  f22: [
    'https://lp.ksamata.ru/detox_ya',
    'https://lp.ksamata.ru/detox-yhe',
    'https://lp.ksamata.ru/rd_yan',
    'https://lp.ksamata.ru/sh-izh/yh',
    'https://lp.ksamata.ru/zmk_ya',
  ],
  f23: [
    'https://lp.ksamata.ru/rd_yan',
    'https://lp.ksamata.ru/rd_yhe',
  ],
  f24: [
    'https://gc.ksamata.ru/detoks_ya',
    'https://gc.ksamata.ru/rd_ya',
    'https://gc.ksamata.ru/zm_ya',
    'https://lp.ksamata.ru/detoks_ya',
    'https://lp.ksamata.ru/detox_ya',
    'https://lp.ksamata.ru/rd_ya',
    'https://lp.ksamata.ru/rd_yan',
    'https://lp.ksamata.ru/sh-izh-yr',
    'https://lp.ksamata.ru/sz-ya',
    'https://lp.ksamata.ru/zm_ya',
    'https://lp.ksamata.ru/zmk_ya',
  ],
  f25: [
    'https://lp.ksamata.ru/sh-izh-yr',
  ],
  f26: [
    'https://lp.ksamata.ru/rd_ya',
  ],
  f27: [
    'https://quiz-light.ksamata.ru/quiz/nr',
    'https://quiz-zkt.ksamata.ru/quiz/nr',
    'https://quiz.ksamata.ru/quiz/nr',
    'https://t.ksamata.ru/jivo/nr/a',
    'https://t.ksamata.ru/nr/zkt/b',
    'https://t.ksamata.ru/nr/zkt/d',
  ],
  f28: [
    'https://lp.ksamata.ru/detox_inhaus',
    'https://t.ksamata.ru/inhaus/boo/a',
    'https://t.ksamata.ru/inhaus/boo/b',
  ],
  f29: [
    'https://lp.ksamata.ru/vknimb/svs/a',
  ],
  f30: [
    'https://t.ksamata.ru/faq/dih/a',
    'https://t.ksamata.ru/jivo/faq/a',
  ],
  f31: [
    'https://t.ksamata.ru/dih/rsya/a',
  ],
  f32: [
    'https://t.sust-bez-problem.ru/sust/rsya/a',
  ],
  f34: [
    'https://t.ksamata.ru/ttk/rsya/a',
  ],
  f35: [
    'https://t.ksamata.ru/sust/nr/a',
  ],
  f42: [
    'https://t.zhkt-start.ru/zkt/rsya/b',
  ],
  f45: [
    'https://gc.sustav-zdorov.ru/jivo/sust/nimb/a',
    'https://t.sustavy-start.ru/jivo/trial/nimb/a',
    'https://t.sustavy-start.ru/jivo/trial/nimb/e',
  ],
  f46: [
    'https://gc.ksamata.ru/jivo/sust/inhouse/b',
    'https://t.ksamata.ru/jivo/trial/inhouse/a',
  ],
  f48: [
    'https://t.ksamata.ru/jivo/trial/zhkt/inhouse/a',
  ],
  f50: [
    'https://t.danila-susak.com/nimb/dbo/a',
  ],
  f51: [
    'https://t.ksamata.ru/jivo/trial/inhouse/a',
    'https://t.ksamata.ru/trial/inhouse/a',
  ],
  f52: [
    'https://t.ksamata.ru/inhaus/dih/a',
  ],
  f53: [
    'https://t.ksamata.ru/sust/inhaus/a',
  ],
  f54: [
    'https://t.zabota-o-zhkt.ru/jivo/trial/zhkt/nimb/a',
  ],
  f55: [
    'https://t.zdravo-telo.ru/rsy/trial/inhouse/a',
  ],
  f56: [
    'https://t.zdravo-telo.ru/rsy/jivo/trial/inhouse/a',
  ],
  f57: [
    'https://t.zdravo-telo.ru/rsy/jivo/trial/zhkt/inhouse/a',
  ],
  f58: [
    'https://t.danila-susak.com/nimb/boo/a',
    'https://t.danila-susak.com/nimb/boo/b',
  ],
  f73: [
    'https://t.ksamata.ru/trial/nr/a',
  ],
  f74: [
    'https://t.ksamata.ru/jivo/trial/zhkt/nr/a',
  ],
  f80: [
    'https://t.ksamata.ru/sust/inhousya/a',
  ],
  f84: [
    'https://t.ksamata.ru/inhaus/dbo/a',
  ],
  f85: [
    'https://t.ksamata.ru/jivo/trial/nr/a',
  ],
};

/** Сравнение адресов без учёта регистра и хвостового слэша. */
function normUrl(u: string): string {
  return u.trim().replace(/\/+$/, '').toLowerCase();
}

type PendingWrite = {
  funnelId: number;
  frontCode: string;
  mode: BlockMode;
  items: BlockItem[];
  addedCount: number;
};

function main(): void {
  const apply = process.argv.includes('--apply');
  const dryRun = process.argv.includes('--dry-run');
  if (apply === dryRun) {
    console.error('Укажи ровно один режим: --dry-run или --apply');
    process.exit(2);
  }

  const dbPath = resolveCliDbPath();
  console.log(`База: ${dbPath}`);
  console.log(`Режим: ${dryRun ? 'ПРОБНЫЙ (ничего не пишем)' : 'ЗАПИСЬ'}\n`);

  const sqlite = new Database(dbPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite, { schema });

  const rows = db
    .select({ id: schema.funnels.id, frontCode: schema.funnels.frontCode })
    .from(schema.funnels)
    .all();

  const byCode = new Map<string, { id: number; frontCode: string }>();
  for (const r of rows) {
    const code = normalizeFrontCode(r.frontCode ?? '');
    if (code) byCode.set(code, { id: r.id, frontCode: r.frontCode ?? '' });
  }

  const pending: PendingWrite[] = [];
  let missing = 0;
  let unchanged = 0;
  let hadError = false;

  for (const [rawCode, urls] of Object.entries(PAYLOAD)) {
    const funnel = byCode.get(normalizeFrontCode(rawCode));
    if (!funnel) {
      console.log(`  ? ${rawCode}: такого F-кода в базе нет — пропускаю`);
      missing++;
      continue;
    }

    const block = getBlock(db, funnel.id, 'landings');
    const existingNorm = new Set(block.items.map((i) => normUrl(i.url)));
    const toAdd = urls.filter((u) => !existingNorm.has(normUrl(u)));

    if (toAdd.length === 0) {
      console.log(
        `  = ${rawCode}: все ${urls.length} адресов уже в блоке (пунктов: ${block.items.length}) — пропускаю`
      );
      unchanged++;
      continue;
    }

    const items: BlockItem[] = [
      ...block.items,
      ...toAdd.map((u): BlockItem => ({ slot: null, label: '', url: u })),
    ];

    // Проверяем КАЖДЫЙ адрес будущего блока — и старый, и новый.
    for (const it of items) {
      const check = checkUrlField(it.url);
      if (check.level === 'error') {
        console.error(`  ! СТОП: ${rawCode} — «${it.url}»: ${check.message}`);
        hadError = true;
      } else if (check.level === 'warn') {
        console.warn(`  ! ${rawCode}: «${it.url}» — ${check.message}`);
      }
    }

    console.log(`  + ${rawCode}: было ${block.items.length}, дописываем ${toAdd.length}`);
    for (const u of toAdd) console.log(`        → ${u}`);

    pending.push({
      funnelId: funnel.id,
      frontCode: rawCode,
      mode: block.mode,
      items,
      addedCount: toAdd.length,
    });
  }

  if (hadError) {
    console.error(
      '\nОстановлено: хотя бы один адрес не проходит проверку checkUrlField. Ничего не записано.'
    );
    sqlite.close();
    process.exit(1);
  }

  console.log(
    `\nИтого: к правке — ${pending.length}, без изменений — ${unchanged}, ` +
      `без такого F-кода в базе — ${missing}.`
  );

  if (dryRun) {
    sqlite.close();
    return;
  }

  for (const p of pending) {
    replaceBlock(db, p.funnelId, 'landings', true, p.mode, p.items);
    console.log(`  записано: ${p.frontCode} (+${p.addedCount})`);
  }

  sqlite.close();
  console.log(`\nГотово: воронок записано — ${pending.length}.`);
}

main();
