/**
 * F-коды трём активным воронкам, у которых кода не было (2026-07-28).
 *
 *   num  четвёрка                              код
 *     4  ГП / Внутренний / Ютуб / Органика     f81
 *    27  БОО / Внутренний / Перелив / С ДБО    f82
 *    28  ДБО / Внутренний / Перелив / С БОО    f83
 *
 * ПОЧЕМУ ИМЕННО ЭТИ ТРИ. Без кода в базе было десять воронок, но семь из них —
 * архивные. F-код нужен затем, чтобы воронка одинаково называлась у нас и в
 * LeakEngine; архивные в LEAK не заводим, значит и код им не нужен. Остаются
 * три активные — их предстоит завести в LEAK наравне с остальными.
 *
 * ПОЧЕМУ С f81, А НЕ f4/f27/f28. Номера f4, f27, f28 формально свободны, но
 * дыры в нумерации — это чужие номера: их выдаёт LEAK и может выдать в любой
 * момент. Решение владельца — брать выше максимума. Максимум по обеим системам
 * сейчас f80, поэтому f81, f82, f83. Это то же правило, что зашито в
 * `nextFrontCode` (см. lib/front-code.ts): следующий код считается от
 * максимума КОДОВ, а не от `num`.
 *
 * Порядок раздачи — по возрастанию `num`, чтобы связь читалась однозначно.
 *
 * Правка не трогает ни оси, ни теги, ни комнаты — только колонку `front_code`.
 * Уникальность обеспечивает частичный индекс Phase-7, а `updateFunnel` до него
 * проверяет занятость сам и отдаёт ConflictError с указанием владельца кода.
 *
 * Защита: воронка с несовпавшими осями пропускается; занятый код пропускается.
 * Идемпотентно: воронка, у которой код уже стоит, не трогается.
 *
 * Запуск из app/ (сначала --dry-run):
 *   FUNNELS_DB_PATH=/abs/path/ksamata_funnels.db npx tsx scripts/assign-front-codes-2026-07-28.ts --dry-run
 *   FUNNELS_DB_PATH=/abs/path/ksamata_funnels.db npx tsx scripts/assign-front-codes-2026-07-28.ts --apply
 */
import { eq } from 'drizzle-orm';
import { db } from '../src/db/client';
import { funnels } from '../src/db/schema';
import { getFunnel, updateFunnel } from '../src/lib/funnels';

const PROD = process.env.PROD_BASE_URL ?? 'https://funnels.ksamata.ru';

type Axes = { product: string; contractor: string; channel: string; direction: string };

const TARGETS: { num: number; code: string; axes: Axes }[] = [
  { num:  4, code: 'f81', axes: { product: 'ГП',  contractor: 'Внутренний', channel: 'Ютуб',    direction: 'Органика' } },
  { num: 27, code: 'f82', axes: { product: 'БОО', contractor: 'Внутренний', channel: 'Перелив', direction: 'С ДБО' } },
  { num: 28, code: 'f83', axes: { product: 'ДБО', contractor: 'Внутренний', channel: 'Перелив', direction: 'С БОО' } },
];

const apply = process.argv.includes('--apply');
const dryRun = process.argv.includes('--dry-run');
if (apply === dryRun) {
  console.error('Укажи ровно один режим: --dry-run или --apply');
  process.exit(2);
}
const skipProd = process.argv.includes('--skip-prod');

function axesMismatch(id: number, want: Axes): string[] {
  const full = getFunnel(db, id);
  if (!full) return ['воронка не читается'];
  return (['product', 'contractor', 'channel', 'direction'] as const)
    .filter((a) => full.axes[a] !== want[a])
    .map((a) => `${a}: «${full.axes[a] || '—'}» вместо «${want[a]}»`);
}

type ProdFunnel = { id: number; num: number; frontCode: string | null };

async function main() {
  const prodList: ProdFunnel[] = skipProd ? [] : await (await fetch(`${PROD}/api/funnels`)).json();
  const prodByNum = new Map(prodList.map((f) => [f.num, f]));
  console.log(skipProd ? 'Прод пропущен (--skip-prod).\n' : `Прод: ${prodList.length} воронок.\n`);

  for (const t of TARGETS) {
    const row = db.select({ id: funnels.id, code: funnels.frontCode })
      .from(funnels).where(eq(funnels.num, t.num)).get();
    if (!row) { console.error(`  ! num=${t.num} локально не найдена`); continue; }

    const current = (row.code ?? '').trim();
    const mismatch = axesMismatch(row.id, t.axes);
    const taken = db.select({ num: funnels.num })
      .from(funnels).where(eq(funnels.frontCode, t.code)).get();

    if (current === t.code) console.log(`  = num=${t.num}: код уже ${t.code}`);
    else if (current !== '') console.error(`  ! num=${t.num}: код уже «${current}», ожидался пустой — пропускаю`);
    else if (mismatch.length) console.error(`  ! num=${t.num} оси не совпали (${mismatch.join('; ')}) — пропускаю`);
    else if (taken) console.error(`  ! код ${t.code} занят воронкой num=${taken.num} — пропускаю`);
    else if (dryRun) console.log(`  - num=${t.num}: «—» → «${t.code}»  (${t.axes.product} / ${t.axes.contractor} / ${t.axes.channel} / ${t.axes.direction})`);
    else { updateFunnel(db, row.id, { frontCode: t.code }); console.log(`  - num=${t.num}: код ${t.code} проставлен локально`); }

    if (skipProd) continue;
    const onProd = prodByNum.get(t.num);
    if (!onProd) { console.error(`    ! num=${t.num} на проде не найдена`); continue; }
    const prodCode = (onProd.frontCode ?? '').trim();
    if (prodCode === t.code) { console.log(`    = на проде уже ${t.code}`); continue; }
    if (prodCode !== '') { console.error(`    ! на проде код «${prodCode}» — пропускаю`); continue; }
    if (dryRun) { console.log(`    - на проде (id=${onProd.id}): «—» → «${t.code}»`); continue; }
    const res = await fetch(`${PROD}/api/funnels/${onProd.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ frontCode: t.code }),
    });
    console.log(res.ok ? `    - код ${t.code} проставлен на проде (HTTP ${res.status})`
      : `    ! прод ответил HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
