/**
 * Три воронки в архив по решению владельца 2026-07-28.
 *
 *   num  код   четвёрка                      заказов*  предложения в GetCourse
 *    59  f66   ЕХ / NR / ВК / In Stream          132    11, этапы Оплата+Регистрация
 *    60  f67   СВС / FAQ / ВК / Реклама           86     3, этап ТОЛЬКО Мессенджер
 *    61  f68   ДБО / FAQ / ВК / Реклама           64    18, этапы Оплата+Регистрация
 *
 * * уникальные заказы за январь–июль по разбору класса 9 от 2026-07-26.
 *
 * Все три заведены 2026-07-26 не человеком, а по следам разметки в GetCourse
 * (класс 9 карты расхождений: заказы шли, воронки в базе не было). Ни у одной
 * нет ни посадочной, ни комнат — заполнять их не начинали. Владелец посмотрел
 * список и сказал: трафика нет, в архив.
 *
 * `f64` (ДБО / NR / ВК / Реклама) из той же партии в архив НЕ идёт — владелец
 * назвал только эти три.
 *
 * Архивация обратима, поэтому содержимое воронки скрипт не проверяет. Но он
 * ОТКАЗЫВАЕТСЯ трогать воронку, чьи оси не совпали с ожидаемой четвёркой:
 * номера подвижны, а перепутать воронку при смене статуса неприятно.
 * Идемпотентен: воронка, уже лежащая в архиве, пропускается.
 *
 * Запуск из app/ (сначала --dry-run):
 *   FUNNELS_DB_PATH=/abs/path/ksamata_funnels.db npx tsx scripts/archive-three-funnels-2026-07-28.ts --dry-run
 *   FUNNELS_DB_PATH=/abs/path/ksamata_funnels.db npx tsx scripts/archive-three-funnels-2026-07-28.ts --apply
 */
import { eq } from 'drizzle-orm';
import { db } from '../src/db/client';
import { funnels } from '../src/db/schema';
import { getFunnel, updateFunnel } from '../src/lib/funnels';

const PROD = process.env.PROD_BASE_URL ?? 'https://funnels.ksamata.ru';

const TARGETS = [
  { num: 59, code: 'f66', product: 'ЕХ',  contractor: 'NR',  channel: 'ВК', direction: 'In Stream' },
  { num: 60, code: 'f67', product: 'СВС', contractor: 'FAQ', channel: 'ВК', direction: 'Реклама' },
  { num: 61, code: 'f68', product: 'ДБО', contractor: 'FAQ', channel: 'ВК', direction: 'Реклама' },
];

const apply = process.argv.includes('--apply');
const dryRun = process.argv.includes('--dry-run');
if (apply === dryRun) {
  console.error('Укажи ровно один режим: --dry-run или --apply');
  process.exit(2);
}
const skipProd = process.argv.includes('--skip-prod');

function axesMismatch(id: number, want: (typeof TARGETS)[number]): string[] {
  const full = getFunnel(db, id);
  if (!full) return ['воронка не читается'];
  return (['product', 'contractor', 'channel', 'direction'] as const)
    .filter((a) => full.axes[a] !== want[a])
    .map((a) => `${a}: «${full.axes[a] || '—'}» вместо «${want[a]}»`);
}

type ProdFunnel = { id: number; num: number; status: string };

async function main() {
  const prodList: ProdFunnel[] = skipProd ? [] : await (await fetch(`${PROD}/api/funnels`)).json();
  const prodByNum = new Map(prodList.map((f) => [f.num, f]));
  console.log(skipProd ? 'Прод пропущен (--skip-prod).\n' : `Прод: ${prodList.length} воронок.\n`);

  for (const want of TARGETS) {
    const row = db.select({ id: funnels.id, status: funnels.status })
      .from(funnels).where(eq(funnels.num, want.num)).get();
    if (!row) { console.error(`  ! num=${want.num} локально не найдена`); continue; }

    const mismatch = axesMismatch(row.id, want);
    if (mismatch.length) {
      console.error(`  ! num=${want.num} ${want.code} оси не совпали (${mismatch.join('; ')}) — пропускаю`);
      continue;
    }
    if (row.status === 'archive') console.log(`  = num=${want.num} ${want.code} уже в архиве`);
    else if (dryRun) console.log(`  - num=${want.num} ${want.code}: «${row.status}» → «archive»`);
    else { updateFunnel(db, row.id, { status: 'archive' }); console.log(`  - num=${want.num} ${want.code} в архиве локально`); }

    if (skipProd) continue;
    const onProd = prodByNum.get(want.num);
    if (!onProd) { console.error(`    ! num=${want.num} на проде не найдена`); continue; }
    if (onProd.status === 'archive') { console.log(`    = на проде уже в архиве`); continue; }
    if (dryRun) { console.log(`    - на проде (id=${onProd.id}, «${onProd.status}») → «archive»`); continue; }
    const res = await fetch(`${PROD}/api/funnels/${onProd.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'archive' }),
    });
    console.log(res.ok ? `    - в архиве на проде (HTTP ${res.status})`
      : `    ! прод ответил HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
