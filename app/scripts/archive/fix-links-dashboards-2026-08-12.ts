/**
 * f9 и f16: в блоке «Ссылки» под подписью «Дашборд продаж» лежит побайтовая
 * копия «Регистрации всего» — ошибка вставки в админке. Верный адрес дашборда
 * сохранился только в колонке `funnels.dash_sales_url`, которую фаза 11
 * выводит из обращения. Ставим его в блок ДО прогона фазы: тогда фаза увидит
 * адрес уже на месте и не создаст второй пункт с той же подписью.
 *
 * Идемпотентен: уже починенный пункт пропускается, неожиданное содержимое —
 * повод остановиться, а не «поправить как-нибудь».
 *
 * Запуск из app/:
 *   npx tsx scripts/fix-links-dashboards-2026-08-12.ts
 */
import { eq } from 'drizzle-orm';
import { db } from '../src/db/client';
import { funnels } from '../src/db/schema';
import { getBlock, replaceBlock } from '../src/lib/funnel-blocks';

const LABEL = 'Дашборд продаж';

const TARGETS = [
  { frontCode: 'f9',  to: 'https://gc.ksamata.ru/pl/logic/funnel/dashboard?id=1630392#pk=alltime' },
  { frontCode: 'f16', to: 'https://gc.ksamata.ru/pl/logic/funnel/dashboard?id=1665622#pk=alltime' },
];

for (const t of TARGETS) {
  const row = db.select().from(funnels).where(eq(funnels.frontCode, t.frontCode)).get();
  if (!row) {
    console.error(`${t.frontCode} не найдена — ничего не делаю`);
    process.exit(1);
  }

  const block = getBlock(db, row.id, 'links');
  const idx = block.items.findIndex((i) => i.label.trim() === LABEL);
  if (idx === -1) {
    console.error(`${t.frontCode}: пункта «${LABEL}» в блоке нет — НЕ трогаю`);
    process.exit(1);
  }

  if (block.items[idx].url === t.to) {
    console.log(`${t.frontCode}: «${LABEL}» уже верный — пропускаю`);
    continue;
  }

  // Единственное ожидаемое неверное содержимое — копия «Регистрации всего».
  // Что-либо ещё означает, что данные с 12.08.2026 изменились, и подменять их
  // вслепую нельзя.
  const regTotal = block.items.find((i) => i.label.trim() === 'Регистрации всего');
  if (!regTotal || regTotal.url !== block.items[idx].url) {
    console.error(`${t.frontCode}: «${LABEL}» содержит не копию «Регистрации всего» — НЕ трогаю`);
    process.exit(1);
  }

  const items = block.items.map((i, n) => (n === idx ? { ...i, url: t.to } : i));
  replaceBlock(db, row.id, 'links', block.enabled, block.mode, items);
  console.log(`${t.frontCode}: «${LABEL}» → ${t.to}`);
}
