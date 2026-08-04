/**
 * Заведение девяти воронок, работающих в GetCourse, но отсутствующих в базе
 * (карта расхождений тегов, шаг 2, класс 9).
 *
 * Отбор: из 67 четвёрок класса 9 полная выгрузка за январь-июль 2026
 * (340 470 заказов) оставила 36 с заказами, из них 10 с заказом в июле —
 * то есть живых сейчас. Человек согласовал девять из десяти;
 * `ДБО / RedBananas / ТГ / Реклама` заводить не стали.
 *
 * `БОО / Внутренний / Перелив / С СВС` заводится ОДНОЙ воронкой, хотя в
 * отчёте четвёрки две: `Перелив с СВС` (15 заказов, 1 предложение) — старое
 * написание того же направления, `С СВС` (9 заказов, 18 предложений) — новое.
 * Берём новое; старые предложения человек перетегирует в GetCourse.
 *
 * Посадочные, кроме девятой, не заполнены намеренно: класс 9 — находка про
 * АВ-четвёрку, а не про ссылку, и воронка закрывает её сразу. Ссылки
 * добавляются в админке позже (у 16 из 56 существующих воронок их тоже нет).
 * Единственная проверенная — у `БОО НИМБ ЮТУБ`, отдаёт 200.
 *
 * Идемпотентен: воронка с занятым num пропускается.
 *
 * Запуск из app/:
 *   FUNNELS_DB_PATH=/abs/path/ksamata_funnels.db npx tsx scripts/create-class9-funnels-2026-07-26.ts
 */
import { eq } from 'drizzle-orm';
import { db } from '../src/db/client';
import { funnels } from '../src/db/schema';
import { createFunnel } from '../src/lib/funnels';

type Row = {
  num: number; frontCode: string; productName: string;
  product: string; contractor: string; channel: string; direction: string;
  sourceName: string; landingUrl: string; deals: number;
};

const ROWS: Row[] = [
  { num: 57, frontCode: 'f64', productName: 'ДБО NR ВК Реклама',
    product: 'ДБО', contractor: 'NR', channel: 'ВК', direction: 'Реклама',
    sourceName: 'ВК NR', landingUrl: '', deals: 239 },
  { num: 58, frontCode: 'f65', productName: 'СУСТАВЫ ВК ИНХАУЗ',
    product: 'СУСТАВЫ', contractor: 'ИНХАУЗ', channel: 'ВК', direction: 'Реклама',
    sourceName: 'ВК ИНХАУЗ', landingUrl: '', deals: 191 },
  { num: 59, frontCode: 'f66', productName: 'ЕХ NR IS',
    product: 'ЕХ', contractor: 'NR', channel: 'ВК', direction: 'In Stream',
    sourceName: 'ВК NR', landingUrl: '', deals: 132 },
  { num: 60, frontCode: 'f67', productName: 'СВС FAQ ВК',
    product: 'СВС', contractor: 'FAQ', channel: 'ВК', direction: 'Реклама',
    sourceName: 'ВК FAQ', landingUrl: '', deals: 86 },
  { num: 61, frontCode: 'f68', productName: 'ДБО FAQ ВК',
    product: 'ДБО', contractor: 'FAQ', channel: 'ВК', direction: 'Реклама',
    sourceName: 'ВК FAQ', landingUrl: '', deals: 64 },
  { num: 62, frontCode: 'f69', productName: 'БОО НИМБ Сайт',
    product: 'БОО', contractor: 'НИМБ', channel: 'Сайт', direction: 'СЕО',
    sourceName: 'Сайт СЕО', landingUrl: '', deals: 15 },
  { num: 63, frontCode: 'f70', productName: 'БОО Перелив СВС',
    product: 'БОО', contractor: 'Внутренний', channel: 'Перелив', direction: 'С СВС',
    sourceName: 'Перелив', landingUrl: '', deals: 24 },
  { num: 64, frontCode: 'f71', productName: 'ЖИВО-ЖКТ НИМБ Яндекс',
    product: 'ЖИВО-ЖКТ', contractor: 'НИМБ', channel: 'Яндекс', direction: 'РСЯ',
    sourceName: 'Яндекс РСЯ', landingUrl: '', deals: 6 },
  { num: 65, frontCode: 'f72', productName: 'БОО НИМБ ЮТУБ',
    product: 'БОО', contractor: 'НИМБ', channel: 'Ютуб', direction: 'Реклама',
    sourceName: 'ЮТУБ НИМБ', landingUrl: 'https://t.danila-susak.com/nimb/boo/a', deals: 2 },
];

for (const row of ROWS) {
  const existing = db.select({ id: funnels.id }).from(funnels)
    .where(eq(funnels.num, row.num)).get();
  if (existing) {
    console.log(`  num=${row.num} уже есть (id=${existing.id}) — пропускаю`);
    continue;
  }
  const created = createFunnel(db, {
    num: row.num,
    frontCode: row.frontCode,
    status: 'active',
    productName: row.productName,
    variant: '',
    landingUrl: row.landingUrl,
    startDate: '',
    product: row.product,
    contractor: row.contractor,
    channel: row.channel,
    direction: row.direction,
    sourceName: row.sourceName,
  });
  console.log(`  + num=${created.num} ${created.frontCode} «${created.productName}» `
    + `→ ${created.name} (${row.deals} заказов)`);
}

console.log('\n--- проверка: воронки 57-65 ---');
for (const r of db.select().from(funnels).all()) {
  if (r.num >= 57) {
    console.log(`  num=${r.num} ${r.frontCode || '—'} «${r.productName}» [${r.status}] `
      + `${r.landingUrl || 'посадочная не заполнена'}`);
  }
}
