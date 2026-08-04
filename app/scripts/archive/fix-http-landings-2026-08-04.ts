/**
 * Два лендинга активных воронок записаны по http:// — сервер отвечает на них
 * переадресацией на https://, и мониторинг показывал вторую строку с конечным
 * адресом («стрелочка с дублирующим лендом»). Переписываем адреса на https,
 * чтобы проверка попадала с первого раза.
 *
 *   f38 (num=2)  lp.ksamata.ru/izh-yo          — landing_url + пункт блока «Лендинги»
 *   f47 (num=48) t.sustavy-legko.ru/trial/nimb/a — landing_url
 *
 * Обе https-версии проверены вручную: 200 без дальнейших переадресаций.
 * Третий http-адрес в базе (num=29, boo-kvrd) — в архивной воронке, вне
 * мониторинга; сознательно не трогаем.
 *
 * Идемпотентен: уже переписанный адрес пропускается, чужой — повод остановиться.
 *
 * Запуск из app/:
 *   npx tsx scripts/fix-http-landings-2026-08-04.ts
 */
import { eq } from 'drizzle-orm';
import { db } from '../src/db/client';
import { funnels } from '../src/db/schema';
import { updateFunnel } from '../src/lib/funnels';
import { getBlock, replaceBlock } from '../src/lib/funnel-blocks';

const TARGETS = [
  { num: 2,  from: 'http://lp.ksamata.ru/izh-yo',            to: 'https://lp.ksamata.ru/izh-yo' },
  { num: 48, from: 'http://t.sustavy-legko.ru/trial/nimb/a', to: 'https://t.sustavy-legko.ru/trial/nimb/a' },
];

for (const t of TARGETS) {
  const row = db.select().from(funnels).where(eq(funnels.num, t.num)).get();
  if (!row) {
    console.error(`num=${t.num} не найдена — ничего не делаю`);
    process.exit(1);
  }

  // 1. Поле карточки.
  if (row.landingUrl === t.to) {
    console.log(`num=${t.num}: landing_url уже https — пропускаю`);
  } else if (row.landingUrl !== t.from) {
    console.error(`num=${t.num}: landing_url «${row.landingUrl}» ≠ ожидаемого «${t.from}» — НЕ трогаю`);
    process.exit(1);
  } else {
    updateFunnel(db, row.id, { landingUrl: t.to });
    console.log(`num=${t.num} ${row.frontCode}: landing_url ${t.from} → ${t.to}`);
  }

  // 2. Тот же адрес в блоке «Лендинги», если он там есть.
  const block = getBlock(db, row.id, 'landings');
  if (block.items.some((i) => i.url === t.from)) {
    const items = block.items.map((i) => (i.url === t.from ? { ...i, url: t.to } : i));
    replaceBlock(db, row.id, 'landings', block.enabled, block.mode, items);
    console.log(`num=${t.num} ${row.frontCode}: блок «Лендинги» ${t.from} → ${t.to}`);
  }
}
