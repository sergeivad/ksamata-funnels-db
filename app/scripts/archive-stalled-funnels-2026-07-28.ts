/**
 * Девять активных воронок в архив: трафика на них больше нет.
 *
 * Замер по 66 выгрузкам deal_export (01.04.2026 — 26.07.2026), заказы
 * привязаны к воронке по АВ-четвёрке и дедуплицированы по id заказа:
 *
 *   num  код   продукт            всего   30 дней   90 дней
 *    63  f70   БОО Перелив СВС        9         0         1
 *    65  f58   БОО НИМБ ЮТУБ          2         2         2
 *     6  f6    БОО НИМБ РСЯ        9678         2        14
 *    12  f12   ЖКТ NR ВК           7099         1       170
 *    13  f13   ЖКТ NR IS           4083         3         4
 *    18  —     ДБО HT ВК            257         1        18
 *    19  f19   БОО HT ВК           9995         3      2091
 *    34  f33   ЖИВО НИМБ РСЯ       2262         2      2260
 *    45  f43   КВИЗЫ ЖИВО НИМБ     2262         2      2260
 *
 * Последние три показательны: тысячи заказов за 90 дней и единицы за 30 —
 * это не «мало продаёт», а «остановилось недавно». Решение владельца
 * 2026-07-28: трафика на все девять больше нет, архивировать.
 *
 * ВТОРАЯ ВОЛНА, тот же день. Владелец посмотрел список активных и назвал ещё
 * три связки, по которым трафик тоже прекращён:
 *
 *   num  код   продукт            всего   30 дней   90 дней
 *    14  —     ЖКТ NR МП           1198         3        10
 *    17  —     ДБО FAQ MAX          402         4       114
 *    10  —     СВС НИМБ РСЯ          57         9        32
 *
 * У этих трёх заказы за последний месяц ЕСТЬ — я показал числа, владелец
 * подтвердил решение. Правило отставки по дате здесь и страхует: заказ
 * после 2026-07-28 вернёт связку в отчёт сам.
 *
 * У num 17 название расходится с тегами: «ДБО FAQ MAX», а подрядчик в
 * четвёрке — NR. Что из двух верно, не выяснено; на архивацию не влияет,
 * но при возврате воронки в работу это надо решить.
 *
 * num 34 и num 45 делят ОДНУ АВ-четвёрку `ЖИВО / НИМБ / Яндекс / РСЯ` —
 * отсюда одинаковые числа: заказы между ними по тегам не разделяются. Это
 * известная коллизия ключа (класс 8 карты расхождений), и она же означает,
 * что защита по осям для этих двух совпадёт — их различает только num.
 *
 * Архивация обратима, поэтому скрипт не проверяет содержимое воронки (в
 * отличие от drop-*). Но он ОТКАЗЫВАЕТСЯ трогать воронку, чьи оси не совпали
 * с ожидаемой четвёркой: номера — вещь подвижная, а перепутать воронку при
 * смене статуса так же неприятно, как при удалении.
 *
 * Идемпотентен: воронка, уже лежащая в архиве, пропускается.
 *
 * Запуск из app/ (сначала обязательно с --dry-run):
 *   FUNNELS_DB_PATH=/abs/path/ksamata_funnels.db npx tsx scripts/archive-stalled-funnels-2026-07-28.ts --dry-run
 *   FUNNELS_DB_PATH=/abs/path/ksamata_funnels.db npx tsx scripts/archive-stalled-funnels-2026-07-28.ts --apply
 */
import { eq } from 'drizzle-orm';
import { db } from '../src/db/client';
import { funnels } from '../src/db/schema';
import { getFunnel, updateFunnel } from '../src/lib/funnels';

const PROD = process.env.PROD_BASE_URL ?? 'https://funnels.ksamata.ru';

/** Ожидаемые оси каждой воронки — защита от того, что num указывает не туда. */
const TARGETS = [
  { num: 6,  product: 'БОО',  contractor: 'НИМБ',       channel: 'Яндекс',  direction: 'РСЯ' },
  { num: 12, product: 'ЖКТ',  contractor: 'NR',         channel: 'ВК',      direction: 'Реклама' },
  { num: 13, product: 'ЖКТ',  contractor: 'NR',         channel: 'ВК',      direction: 'In Stream' },
  { num: 18, product: 'ДБО',  contractor: 'HT',         channel: 'ВК',      direction: 'Реклама' },
  { num: 19, product: 'БОО',  contractor: 'HT',         channel: 'ВК',      direction: 'Реклама' },
  { num: 34, product: 'ЖИВО', contractor: 'НИМБ',       channel: 'Яндекс',  direction: 'РСЯ' },
  { num: 45, product: 'ЖИВО', contractor: 'НИМБ',       channel: 'Яндекс',  direction: 'РСЯ' },
  { num: 63, product: 'БОО',  contractor: 'Внутренний', channel: 'Перелив', direction: 'С СВС' },
  { num: 65, product: 'БОО',  contractor: 'НИМБ',       channel: 'Ютуб',    direction: 'Реклама' },
  // Вторая волна, 2026-07-28.
  { num: 10, product: 'СВС',  contractor: 'НИМБ',       channel: 'Яндекс',  direction: 'РСЯ' },
  { num: 14, product: 'ЖКТ',  contractor: 'NR',         channel: 'ВК',      direction: 'Маркетплатформа' },
  { num: 17, product: 'ДБО',  contractor: 'NR',         channel: 'МАКС',    direction: 'Посевы' },
];

const apply = process.argv.includes('--apply');
const dryRun = process.argv.includes('--dry-run');
if (apply === dryRun) {
  console.error('Укажи ровно один режим: --dry-run или --apply');
  process.exit(2);
}

type ProdFunnel = { id: number; num: number; frontCode: string | null; status: string };

/** Расхождения осей с ожидаемыми. Пустой массив — воронка та самая. */
function axesMismatch(id: number, want: (typeof TARGETS)[number]): string[] {
  const full = getFunnel(db, id);
  if (!full) return ['воронка не читается'];
  return (['product', 'contractor', 'channel', 'direction'] as const)
    .filter((axis) => full.axes[axis] !== want[axis])
    .map((axis) => `${axis}: «${full.axes[axis] || '—'}» вместо «${want[axis]}»`);
}

async function main() {
  const prodList: ProdFunnel[] = await (await fetch(`${PROD}/api/funnels`)).json();
  const prodByNum = new Map(prodList.map((f) => [f.num, f]));
  console.log(`Прод: ${prodList.length} воронок. Локально: `
    + `${db.select({ id: funnels.id }).from(funnels).all().length}.\n`);

  let archived = 0;
  for (const want of TARGETS) {
    const row = db.select({ id: funnels.id, code: funnels.frontCode, status: funnels.status })
      .from(funnels).where(eq(funnels.num, want.num)).get();

    if (!row) {
      console.error(`  ! num=${want.num} локально не найдена — пропускаю`);
      continue;
    }
    const mismatch = axesMismatch(row.id, want);
    if (mismatch.length) {
      console.error(`  ! num=${want.num} оси не совпали (${mismatch.join('; ')}) — пропускаю`);
      continue;
    }
    if (row.status === 'archive') {
      console.log(`  = num=${want.num} ${row.code ?? '—'} уже в архиве`);
    } else if (dryRun) {
      console.log(`  - num=${want.num} ${row.code ?? '—'}: «${row.status}» → «archive»`);
    } else {
      updateFunnel(db, row.id, { status: 'archive' });
      console.log(`  - num=${want.num} ${row.code ?? '—'} в архиве локально`);
      archived += 1;
    }

    const onProd = prodByNum.get(want.num);
    if (!onProd) {
      console.error(`    ! num=${want.num} на проде не найдена`);
      continue;
    }
    if (onProd.status === 'archive') {
      console.log(`    = num=${want.num} на проде уже в архиве`);
      continue;
    }
    if (dryRun) {
      console.log(`    - num=${want.num} на проде (id=${onProd.id}, «${onProd.status}») → «archive»`);
      continue;
    }
    const res = await fetch(`${PROD}/api/funnels/${onProd.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'archive' }),
    });
    console.log(res.ok
      ? `    - num=${want.num} в архиве на проде (HTTP ${res.status})`
      : `    ! num=${want.num} прод ответил HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }

  if (!dryRun) {
    const after: ProdFunnel[] = await (await fetch(`${PROD}/api/funnels`)).json();
    const inArchive = after.filter((f) => f.status === 'archive').length;
    const stillActive = after.filter((f) => f.status === 'active').length;
    console.log(`\nЗаархивировано локально: ${archived}. `
      + `На проде: в архиве ${inArchive}, активных ${stillActive}.`);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
