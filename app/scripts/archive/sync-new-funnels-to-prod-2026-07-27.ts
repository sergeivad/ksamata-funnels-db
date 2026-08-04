/**
 * Доливка недостающих воронок на прод через публичный API.
 *
 * Почему не подменой файла БД (как 2026-07-20). Замена тома — операция с
 * простоем и полной перезаписью: всё, что человек отредактировал в живой
 * админке с прошлой синхронизации, пропадёт молча. Сверка 2026-07-27 показала,
 * что разница между локальной базой и продом ЧИСТО ДОПОЛНЯЮЩАЯ: на проде нет
 * ничего, чего нет локально, и по 55 общим воронкам ноль расхождений. Значит
 * достаточно долить недостающие — без простоя и без риска затереть чужие правки.
 *
 * Идемпотентно: воронка, которая на проде уже есть (409 на занятый num),
 * считается доставленной и пропускается.
 *
 * num39 намеренно не переносится — это пустой черновик без осей, шаблон в него
 * не материализуется (см. resyncAllFunnels), переносить нечего.
 *
 * Запуск из app/ (сначала обязательно с --dry-run):
 *   FUNNELS_DB_PATH=/abs/path/ksamata_funnels.db npx tsx scripts/sync-new-funnels-to-prod-2026-07-27.ts --dry-run
 *   FUNNELS_DB_PATH=/abs/path/ksamata_funnels.db npx tsx scripts/sync-new-funnels-to-prod-2026-07-27.ts --apply
 */
import { eq } from 'drizzle-orm';
import { db } from '../src/db/client';
import { sources } from '../src/db/schema';
import { listFunnels, getFunnel } from '../src/lib/funnels';

const PROD = process.env.PROD_BASE_URL ?? 'https://funnels.ksamata.ru';
const SKIP_NUMS = new Set([39]);

const apply = process.argv.includes('--apply');
const dryRun = process.argv.includes('--dry-run');
if (apply === dryRun) {
  console.error('Укажи ровно один режим: --dry-run или --apply');
  process.exit(2);
}

type ProdFunnel = { num: number; frontCode: string | null; productName: string };

function sourceNameOf(sourceId: number): string | undefined {
  const row = db.select({ name: sources.name }).from(sources)
    .where(eq(sources.id, sourceId)).get();
  return row?.name ?? undefined;
}

async function main() {
const res = await fetch(`${PROD}/api/funnels`);
if (!res.ok) {
  console.error(`Прод не ответил: HTTP ${res.status}`);
  process.exit(1);
}
const prod: ProdFunnel[] = await res.json();
const prodNums = new Set(prod.map((f) => f.num));
console.log(`Прод: ${prod.length} воронок. Локально: ${listFunnels(db).length}.`);

const missing = listFunnels(db)
  .filter((f) => !prodNums.has(f.num) && !SKIP_NUMS.has(f.num))
  .sort((a, b) => a.num - b.num);

console.log(`К доливке: ${missing.length}\n`);

let created = 0;
let already = 0;
let failed = 0;

for (const item of missing) {
  const full = getFunnel(db, item.id);
  if (!full) {
    console.log(`  num=${item.num}: не читается локально — пропускаю`);
    failed += 1;
    continue;
  }
  const payload = {
    num: full.num,
    frontCode: full.frontCode ?? '',
    status: full.status,
    productName: full.productName ?? '',
    variant: full.variant ?? '',
    landingUrl: full.landingUrl ?? '',
    startDate: full.startDate ?? '',
    product: full.axes.product,
    contractor: full.axes.contractor,
    channel: full.axes.channel,
    direction: full.axes.direction,
    sourceName: sourceNameOf(full.sourceId),
  };

  if (dryRun) {
    console.log(`  num=${payload.num} ${payload.frontCode || '—'} [${payload.status}] `
      + `${payload.product} / ${payload.contractor} / ${payload.channel} / ${payload.direction}`
      + `  источник «${payload.sourceName ?? '(авто)'}»`
      + `  ${payload.landingUrl || 'без посадочной'}`);
    continue;
  }

  const post = await fetch(`${PROD}/api/funnels`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (post.status === 201) {
    console.log(`  + num=${payload.num} ${payload.frontCode} «${payload.productName}»`);
    created += 1;
  } else if (post.status === 409) {
    console.log(`  = num=${payload.num} уже на проде`);
    already += 1;
  } else {
    console.log(`  ! num=${payload.num} HTTP ${post.status}: ${(await post.text()).slice(0, 300)}`);
    failed += 1;
  }
}

if (!dryRun) {
  console.log(`\nСоздано: ${created}, уже было: ${already}, ошибок: ${failed}`);
  const after: ProdFunnel[] = await (await fetch(`${PROD}/api/funnels`)).json();
  console.log(`Воронок на проде теперь: ${after.length}`);
}
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
