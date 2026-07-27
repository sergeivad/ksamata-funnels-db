/**
 * Откат «ЖИВО-ЖКТ-апсел»: продукта такого нет, это апсел ВНУТРИ воронки ЖИВО-ЖКТ.
 *
 * 2026-07-27 по классу 9 были заведены три воронки под четвёрки с
 * `АВ Продукт: ЖИВО-ЖКТ-апсел`. Владелец в тот же день уточнил, что отдельным
 * продуктом это не является. Оси подтверждают: каждая из трёх совпадает
 * ось в ось с уже существующей воронкой ЖИВО-ЖКТ —
 *
 *   71 / f75  ИНХАУЗ / ВК / Реклама    = 49 / f48 (active)
 *   72 / f76  НИМБ   / Яндекс / РСЯ    = 64 / f54 (active)
 *   76 / f81  ИНХАУЗ / Яндекс / РСЯ    = 68 / f57 (draft)
 *
 * В GetCourse под это заведены три предложения «Полный доступ к Дому Здоровья
 * "ЖИВО"» (8557470, 8557473, 8581971) — один и тот же апсел, проданный из трёх
 * воронок. Их перетегирует на `АВ Продукт: ЖИВО-ЖКТ` человек: правки в
 * GetCourse из репозитория не делаются.
 *
 * Скрипт удаляет три воронки локально и на проде и убирает продукт из
 * справочника. Освобождаются коды f75, f76, f81.
 *
 * ОТКАЗЫВАЕТСЯ удалять воронку, в которой есть содержимое (блоки, дни,
 * посадочная, комментарий) или статус не `draft`: удаление необратимо, а
 * «пустой черновик» — единственное основание сносить его без разбора.
 *
 * Идемпотентен: отсутствующая воронка считается уже удалённой.
 *
 * Запуск из app/ (сначала обязательно с --dry-run):
 *   FUNNELS_DB_PATH=/abs/path/ksamata_funnels.db npx tsx scripts/drop-zhivo-zkt-apsel-2026-07-27.ts --dry-run
 *   FUNNELS_DB_PATH=/abs/path/ksamata_funnels.db npx tsx scripts/drop-zhivo-zkt-apsel-2026-07-27.ts --apply
 */
import { eq } from 'drizzle-orm';
import { db } from '../src/db/client';
import { funnels, funnelBlocks, funnelDays } from '../src/db/schema';
import { deleteFunnel, getFunnel } from '../src/lib/funnels';
import { deleteRef, listRefs } from '../src/lib/refs';

const PROD = process.env.PROD_BASE_URL ?? 'https://funnels.ksamata.ru';
const NUMS = [71, 72, 76];
const PRODUCT = 'ЖИВО-ЖКТ-апсел';

const apply = process.argv.includes('--apply');
const dryRun = process.argv.includes('--dry-run');
if (apply === dryRun) {
  console.error('Укажи ровно один режим: --dry-run или --apply');
  process.exit(2);
}

type ProdFunnel = { id: number; num: number; frontCode: string | null; status: string };

/** Пустой черновик — единственное, что этот скрипт вправе удалить. */
function blockingContent(id: number): string[] {
  const full = getFunnel(db, id);
  if (!full) return ['воронка не читается'];
  const reasons: string[] = [];
  if (full.status !== 'draft') reasons.push(`статус «${full.status}», а не draft`);
  if (full.landingUrl) reasons.push('заполнена посадочная');
  if (full.comment) reasons.push('есть комментарий');
  const blocks = db.select().from(funnelBlocks).where(eq(funnelBlocks.funnelId, id)).all();
  if (blocks.length) reasons.push(`${blocks.length} блок(ов)`);
  const days = db.select().from(funnelDays).where(eq(funnelDays.funnelId, id)).all();
  if (days.length) reasons.push(`${days.length} день(дней)`);
  return reasons;
}

async function main() {
  const prodList: ProdFunnel[] = await (await fetch(`${PROD}/api/funnels`)).json();
  const prodByNum = new Map(prodList.map((f) => [f.num, f]));
  console.log(`Прод: ${prodList.length} воронок. Локально: ${db.select().from(funnels).all().length}.\n`);

  let removed = 0;
  for (const num of NUMS) {
    const row = db.select({ id: funnels.id, code: funnels.frontCode })
      .from(funnels).where(eq(funnels.num, num)).get();

    if (!row) {
      console.log(`  = num=${num} локально уже нет`);
    } else {
      const reasons = blockingContent(row.id);
      if (reasons.length) {
        console.error(`  ! num=${num} НЕ пустой черновик: ${reasons.join(', ')} — пропускаю`);
        continue;
      }
      if (dryRun) {
        console.log(`  - num=${num} ${row.code ?? '—'}: пустой черновик, будет удалён локально`);
      } else {
        deleteFunnel(db, row.id);
        console.log(`  - num=${num} ${row.code ?? '—'} удалён локально`);
        removed += 1;
      }
    }

    const onProd = prodByNum.get(num);
    if (!onProd) {
      console.log(`    = num=${num} на проде уже нет`);
      continue;
    }
    if (dryRun) {
      console.log(`    - num=${num} на проде (id=${onProd.id}, ${onProd.status}) будет удалён`);
      continue;
    }
    const res = await fetch(`${PROD}/api/funnels/${onProd.id}`, { method: 'DELETE' });
    console.log(res.ok || res.status === 404
      ? `    - num=${num} удалён на проде (HTTP ${res.status})`
      : `    ! num=${num} прод ответил HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }

  // Продукт убираем последним: deleteRef откажет, пока на него ссылается воронка.
  const local = listRefs(db, 'products').find((r) => r.name === PRODUCT);
  if (!local) {
    console.log(`\n= продукт «${PRODUCT}» в справочнике уже отсутствует`);
  } else if (dryRun) {
    const still = db.select({ n: funnels.num }).from(funnels)
      .where(eq(funnels.productId, local.id)).all();
    console.log(`\n- продукт «${PRODUCT}» (id=${local.id}) будет удалён; сейчас на него ссылаются: `
      + (still.length ? still.map((s) => s.n).join(', ') : 'никто'));
  } else {
    const result = deleteRef(db, 'products', local.id);
    console.log(`\n- продукт «${PRODUCT}» локально: ${JSON.stringify(result)}`);
    const prodRefs = await (await fetch(`${PROD}/api/refs/products`)).json();
    const remote = (prodRefs as { id: number; name: string }[]).find((r) => r.name === PRODUCT);
    if (!remote) {
      console.log(`  = на проде продукта уже нет`);
    } else {
      const res = await fetch(`${PROD}/api/refs/products/${remote.id}`, { method: 'DELETE' });
      console.log(`  ${res.ok ? '-' : '!'} продукт на проде: HTTP ${res.status}`);
    }
  }

  if (!dryRun) {
    const after: ProdFunnel[] = await (await fetch(`${PROD}/api/funnels`)).json();
    const localCount = db.select({ id: funnels.id }).from(funnels).all().length;
    console.log(`\nУдалено локально: ${removed}. Воронок теперь: локально ${localCount}, `
      + `на проде ${after.length}.`);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
