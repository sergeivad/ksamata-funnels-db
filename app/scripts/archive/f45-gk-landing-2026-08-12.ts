/**
 * One-off (2026-08-12): у f45 второй лендинг — ГК-версия.
 *
 * Строка 4 таблицы «ЖИВО — ДБ_СТАТА ПОДРЯДЧИКИ» («СУСТАВЫ ЖИВО (490р)»,
 * подрядчик «РСЯ ГК», лендинг `gc.sustavy-start.ru/jivo/sust/nimb/a`) идёт
 * без F-кода, и такого лендинга не было ни у одной воронки. Владелец
 * подтвердил 12.08: это второй лендинг существующей воронки.
 *
 * Воронка — f45: строка 3 той же таблицы несёт тот же продукт и того же
 * подрядчика в обычной версии (`t.sustavy-start.ru/jivo/trial/nimb/a`).
 * Ровно та же пара уже есть у f56, где `t.zdravo-telo.ru/rsy/jivo/trial/
 * inhouse/a` и `gc.zdravo-telo.ru/jivo/sust/inhouse/a` лежат в блоке
 * «Лендинги» вдвоём, — отсюда и разметка выборок «— ГК-лендинг».
 *
 * Лендинг идёт ТОЛЬКО в блок «Лендинги»: колонка `funnels.landing_url`
 * выведена из обращения фазой 10 и приложением не читается.
 *
 * Идемпотентно: повторный запуск ничего не меняет.
 *
 * Запуск из `app/`:  npx tsx scripts/f45-gk-landing-2026-08-12.ts [--apply]
 */

import { eq } from 'drizzle-orm';
import { db } from '../src/db/client';
import { funnels } from '../src/db/schema';
import { getBlock, replaceBlock, type BlockItem } from '../src/lib/funnel-blocks';

const FRONT_CODE = 'f45';
const LANDING = 'https://gc.sustavy-start.ru/jivo/sust/nimb/a';
const LINKS: { label: string; url: string }[] = [
  { label: 'Заявки — ГК-лендинг', url: 'https://gc.ksamata.ru/pl/user/user/index?uc[segment_id]=36296681' },
  { label: 'Оплаты — ГК-лендинг', url: 'https://gc.ksamata.ru/pl/user/user/index?uc[segment_id]=36296688' },
];

const norm = (u: string) => decodeURIComponent(u.trim()).split('#')[0].replace(/\/+$/, '').toLowerCase();
const sameLabel = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

const apply = process.argv.includes('--apply');

const funnel = db.select().from(funnels).where(eq(funnels.frontCode, FRONT_CODE)).get();
if (!funnel) throw new Error(`Воронка ${FRONT_CODE} не найдена`);

const landings = getBlock(db, funnel.id, 'landings');
const landingItems: BlockItem[] = landings.items.map((i) => ({ ...i }));
const hasLanding = landingItems.some((i) => norm(i.url) === norm(LANDING));
if (!hasLanding) {
  landingItems.push({ slot: null, label: '', url: LANDING });
  console.log(`+ лендинг ${LANDING}`);
} else {
  console.log('лендинг уже на месте');
}

const links = getBlock(db, funnel.id, 'links');
const linkItems: BlockItem[] = links.items.map((i) => ({ ...i }));
let linksChanged = false;
for (const { label, url } of LINKS) {
  const at = linkItems.findIndex((i) => sameLabel(i.label, label));
  if (at === -1) {
    linkItems.push({ slot: null, label, url });
    linksChanged = true;
    console.log(`+ «${label}»`);
  } else if (norm(linkItems[at].url) !== norm(url)) {
    console.log(`! «${label}» — уже стоит другой адрес, не трогаю`);
  }
}

if (hasLanding && !linksChanged) {
  console.log('\nНичего менять не нужно.');
} else if (!apply) {
  console.log('\nСУХОЙ ПРОГОН. Запустить с --apply, чтобы записать.');
} else {
  db.transaction((tx) => {
    if (!hasLanding) replaceBlock(tx, funnel.id, 'landings', true, landings.mode, landingItems);
    if (linksChanged) replaceBlock(tx, funnel.id, 'links', true, links.mode, linkItems);
  });
  console.log('\nЗАПИСАНО.');
}
