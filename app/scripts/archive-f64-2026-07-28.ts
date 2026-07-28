/**
 * `f64` (num 57, ДБО / NR / ВК / Реклама) в архив — это не воронка.
 *
 * Заведена 2026-07-26 по следам разметки в GetCourse (класс 9 карты
 * расхождений: заказы шли, воронки в базе не было). Разбор 2026-07-28 показал,
 * что заказы принадлежат не ей.
 *
 * ЧТО ПОКАЗАЛ ЗАМЕР. Под четвёркой `ДБО / NR / ВК / Реклама` в реестре
 * GetCourse лежат ровно три предложения, и НИ ОДНОГО регистрационного:
 *
 *   [draft] «3 НОВЫХ ВИДЕОКУРСА»    ×2   этап Оплата     — апселл
 *   [draft] «Предсписок ДБО ВК NR»        этап Предписок
 *
 * Для сравнения, у соседних четвёрок с тем же подрядчиком регистрация есть:
 *
 *   ДБО / NR / ВК / In Stream        28 предложений, «Регистрация на ДБО (ВК NR IS) (бывш. Сода)»
 *   ДБО / NR / ВК / Маркетплатформа  17 предложений, «Регистрация на ДБО (ВК NR 2)»
 *
 * Это и есть две живые воронки NR, обе давно заведены — `f11` и `f15`, и обе
 * есть в LeakEngine. `f64` в LEAK нет вовсе. Владелец подтвердил скриншотом
 * реестра, что актуальных воронок NR по ДБО ровно две.
 *
 * Вывод: `f64` — хвост этих двух воронок. Апселлу и странице предсписка
 * проставили «Направление: Реклама» вместо In Stream и Маркетплатформы, из-за
 * чего аудит увидел «новую четвёрку с заказами». Заказы, по которым она попала
 * в класс 9, — это продажи апселла покупателям из `f11` и `f15`.
 *
 * Ни посадочной, ни комнат у неё нет и не было. Архивация обратима.
 *
 * После этой правки все активные воронки, которых нет в LEAK, укомплектованы:
 * девять штук, у каждой есть комнаты.
 *
 * Идемпотентен, отказывается трогать воронку с несовпавшими осями.
 *
 * Запуск из app/ (сначала --dry-run):
 *   FUNNELS_DB_PATH=/abs/path/ksamata_funnels.db npx tsx scripts/archive-f64-2026-07-28.ts --dry-run
 *   FUNNELS_DB_PATH=/abs/path/ksamata_funnels.db npx tsx scripts/archive-f64-2026-07-28.ts --apply
 */
import { eq } from 'drizzle-orm';
import { db } from '../src/db/client';
import { funnels } from '../src/db/schema';
import { getFunnel, updateFunnel } from '../src/lib/funnels';

const PROD = process.env.PROD_BASE_URL ?? 'https://funnels.ksamata.ru';

const TARGET = {
  num: 57, code: 'f64',
  axes: { product: 'ДБО', contractor: 'NR', channel: 'ВК', direction: 'Реклама' },
};

const apply = process.argv.includes('--apply');
const dryRun = process.argv.includes('--dry-run');
if (apply === dryRun) {
  console.error('Укажи ровно один режим: --dry-run или --apply');
  process.exit(2);
}
const skipProd = process.argv.includes('--skip-prod');

type ProdFunnel = { id: number; num: number; status: string };

async function main() {
  const prodList: ProdFunnel[] = skipProd ? [] : await (await fetch(`${PROD}/api/funnels`)).json();
  const onProd = prodList.find((f) => f.num === TARGET.num);
  console.log(skipProd ? 'Прод пропущен (--skip-prod).' : `Прод: ${prodList.length} воронок.`);

  const row = db.select({ id: funnels.id, status: funnels.status })
    .from(funnels).where(eq(funnels.num, TARGET.num)).get();
  if (!row) { console.error(`  ! num=${TARGET.num} локально не найдена`); return; }

  const full = getFunnel(db, row.id);
  const mismatch = !full ? ['воронка не читается']
    : (['product', 'contractor', 'channel', 'direction'] as const)
        .filter((a) => full.axes[a] !== TARGET.axes[a])
        .map((a) => `${a}: «${full.axes[a] || '—'}» вместо «${TARGET.axes[a]}»`);

  if (mismatch.length) console.error(`  ! оси не совпали (${mismatch.join('; ')}) — пропускаю`);
  else if (row.status === 'archive') console.log(`  = ${TARGET.code} уже в архиве`);
  else if (dryRun) console.log(`  - ${TARGET.code}: «${row.status}» → «archive»`);
  else { updateFunnel(db, row.id, { status: 'archive' }); console.log(`  - ${TARGET.code} в архиве локально`); }

  if (skipProd) return;
  if (!onProd) { console.error(`  ! num=${TARGET.num} на проде не найдена`); return; }
  if (onProd.status === 'archive') { console.log('    = на проде уже в архиве'); return; }
  if (dryRun) { console.log(`    - на проде (id=${onProd.id}, «${onProd.status}») → «archive»`); return; }
  const res = await fetch(`${PROD}/api/funnels/${onProd.id}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'archive' }),
  });
  console.log(res.ok ? `    - в архиве на проде (HTTP ${res.status})`
    : `    ! прод ответил HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
