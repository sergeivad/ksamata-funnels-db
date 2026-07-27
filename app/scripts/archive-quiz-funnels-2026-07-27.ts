/**
 * Квизовые воронки в архив: все три давно не продают.
 *
 * Замер по 62 выгрузкам deal_export (апрель 2026 — 26 июля 2026):
 *
 *   29  БОО Яндекс Реклама квиз   последний заказ 2026-04-21,  34 заказа
 *   31  СВС Яндекс Реклама квиз   последний заказ 2026-05-26,  21 заказ
 *   30  ДБО Яндекс Реклама квиз   последний заказ 2026-06-18, 753 заказа
 *
 * Это не дыра в покрытии: в июльских выгрузках 116 тысяч заказов, соседние
 * воронки f21/f22 в них есть. Квизы молчат по-настоящему. Решение владельца
 * 2026-07-27: архивировать все три, включая №30 (он шёл ровно и оборвался
 * на пике в середине июня — причину выяснять отдельно).
 *
 * Побочный эффект, ради которого это и делалось: их предложения в GetCourse
 * несут `АВ Время: 17` и `АВ Время: 20` (46 предложений), которые база
 * выразить не умеет — `tag_type` и `funnel_days.time_slot` зашиты в 15/19.
 * После архивации чинить эту разметку незачем. На ЖИВЫХ воронках f21/f22/f37
 * остаётся ещё 22 предложения с `АВ Время: 17` — их разбирают отдельно, этот
 * скрипт их не касается.
 *
 * Архивация обратима, поэтому скрипт не проверяет содержимое воронки (в
 * отличие от drop-*). Но он ОТКАЗЫВАЕТСЯ трогать воронку, чьи оси не совпали
 * с ожидаемой четвёркой: номера — вещь подвижная, а перепутать воронку при
 * смене статуса так же неприятно, как при удалении.
 *
 * Идемпотентен: воронка, уже лежащая в архиве, пропускается.
 *
 * Запуск из app/ (сначала обязательно с --dry-run):
 *   FUNNELS_DB_PATH=/abs/path/ksamata_funnels.db npx tsx scripts/archive-quiz-funnels-2026-07-27.ts --dry-run
 *   FUNNELS_DB_PATH=/abs/path/ksamata_funnels.db npx tsx scripts/archive-quiz-funnels-2026-07-27.ts --apply
 */
import { eq } from 'drizzle-orm';
import { db } from '../src/db/client';
import { funnels } from '../src/db/schema';
import { getFunnel, updateFunnel } from '../src/lib/funnels';

const PROD = process.env.PROD_BASE_URL ?? 'https://funnels.ksamata.ru';

/** Ожидаемые оси каждой воронки — защита от того, что num указывает не туда. */
const TARGETS = [
  { num: 29, product: 'БОО', contractor: 'Алексей', channel: 'Яндекс', direction: 'Квиз' },
  { num: 30, product: 'ДБО', contractor: 'Алексей', channel: 'Яндекс', direction: 'Квиз' },
  { num: 31, product: 'СВС', contractor: 'Алексей', channel: 'Яндекс', direction: 'Квиз' },
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
    console.log(`\nЗаархивировано локально: ${archived}. На проде в архиве всего: ${inArchive}.`);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
