/**
 * Снос пустого черновика num=39.
 *
 * Он и был причиной расхождения «на проде 72 воронки, локально 73»: доливка
 * 2026-07-27 (sync-new-funnels-to-prod-2026-07-27.ts) намеренно его пропустила
 * — черновик без осей, шаблон в него не материализуется (см. resyncAllFunnels),
 * переносить было нечего. Владелец 2026-07-27 подтвердил, что заготовки под
 * ним нет, и черновик надо удалить.
 *
 * Состояние на момент решения: создан 18.07, правлен 19.07, дальше не тронут.
 * Ноль блоков, ноль дней, ноль тегов, ноль оверрайдов; front_code, variant,
 * product_name, landing_url и comment пусты. `product_id`/`contractor_id`
 * заполнены, но оси живут в funnel_tags — а их нет, значит осей у воронки нет.
 *
 * ОТКАЗЫВАЕТСЯ удалять воронку, в которой появилось содержимое или сменился
 * статус: удаление необратимо, а «пустой черновик» — единственное основание
 * сносить его без разбора. Та же проверка, что в drop-zhivo-zkt-apsel.
 *
 * Идемпотентен: отсутствующая воронка считается уже удалённой. На проде её
 * нет и не было — прод проверяется на случай, если её туда всё же занесли.
 *
 * Запуск из app/ (сначала обязательно с --dry-run):
 *   FUNNELS_DB_PATH=/abs/path/ksamata_funnels.db npx tsx scripts/drop-empty-draft-39-2026-07-27.ts --dry-run
 *   FUNNELS_DB_PATH=/abs/path/ksamata_funnels.db npx tsx scripts/drop-empty-draft-39-2026-07-27.ts --apply
 */
import { eq } from 'drizzle-orm';
import { db } from '../src/db/client';
import { funnels, funnelBlocks, funnelDays, funnelTags, funnelTagOverrides } from '../src/db/schema';
import { deleteFunnel, getFunnel } from '../src/lib/funnels';

const PROD = process.env.PROD_BASE_URL ?? 'https://funnels.ksamata.ru';
const NUM = 39;

const apply = process.argv.includes('--apply');
const dryRun = process.argv.includes('--dry-run');
if (apply === dryRun) {
  console.error('Укажи ровно один режим: --dry-run или --apply');
  process.exit(2);
}

type ProdFunnel = { id: number; num: number; status: string };

/** Пустой черновик — единственное, что этот скрипт вправе удалить. */
function blockingContent(id: number): string[] {
  const full = getFunnel(db, id);
  if (!full) return ['воронка не читается'];
  const reasons: string[] = [];
  if (full.status !== 'draft') reasons.push(`статус «${full.status}», а не draft`);
  if (full.landingUrl) reasons.push('заполнена посадочная');
  if (full.comment) reasons.push('есть комментарий');
  if (full.frontCode) reasons.push(`есть front_code «${full.frontCode}»`);
  if (full.variant) reasons.push(`есть вариант «${full.variant}»`);
  const counts: [string, number][] = [
    ['блок(ов)', db.select().from(funnelBlocks).where(eq(funnelBlocks.funnelId, id)).all().length],
    ['день(дней)', db.select().from(funnelDays).where(eq(funnelDays.funnelId, id)).all().length],
    ['тег(ов)', db.select().from(funnelTags).where(eq(funnelTags.funnelId, id)).all().length],
    ['оверрайд(ов)',
      db.select().from(funnelTagOverrides).where(eq(funnelTagOverrides.funnelId, id)).all().length],
  ];
  for (const [label, n] of counts) if (n) reasons.push(`${n} ${label}`);
  return reasons;
}

async function main() {
  const prodList: ProdFunnel[] = await (await fetch(`${PROD}/api/funnels`)).json();
  const localCount = db.select({ id: funnels.id }).from(funnels).all().length;
  console.log(`Прод: ${prodList.length} воронок. Локально: ${localCount}.\n`);

  const row = db.select({ id: funnels.id }).from(funnels).where(eq(funnels.num, NUM)).get();
  if (!row) {
    console.log(`= num=${NUM} локально уже нет`);
  } else {
    const reasons = blockingContent(row.id);
    if (reasons.length) {
      console.error(`! num=${NUM} НЕ пустой черновик: ${reasons.join(', ')} — не трогаю`);
      process.exit(1);
    }
    if (dryRun) {
      console.log(`- num=${NUM}: пустой черновик, будет удалён локально`);
    } else {
      deleteFunnel(db, row.id);
      console.log(`- num=${NUM} удалён локально`);
    }
  }

  const onProd = prodList.find((f) => f.num === NUM);
  if (!onProd) {
    console.log(`= num=${NUM} на проде нет (его туда и не переносили)`);
  } else if (dryRun) {
    console.log(`- num=${NUM} на проде (id=${onProd.id}, «${onProd.status}») будет удалён`);
  } else {
    const res = await fetch(`${PROD}/api/funnels/${onProd.id}`, { method: 'DELETE' });
    console.log(res.ok || res.status === 404
      ? `- num=${NUM} удалён на проде (HTTP ${res.status})`
      : `! num=${NUM} прод ответил HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }

  if (!dryRun) {
    const after: ProdFunnel[] = await (await fetch(`${PROD}/api/funnels`)).json();
    const left = db.select({ id: funnels.id }).from(funnels).all().length;
    console.log(`\nВоронок теперь: локально ${left}, на проде ${after.length}.`);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
