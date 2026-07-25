/**
 * Заведение пяти СЕО-воронок (карта расхождений тегов, шаг 2, блок А).
 * Заготовка: docs/plans/2026-07-25-new-funnels-proposal.md
 *
 * Причина: по четвёркам `{продукт} / НИМБ / Сайт / СЕО` за период прошло
 * ~400 уникальных заказов, а воронок в базе нет — заказы безымянные
 * (класс 9 отчёта). Оси `Сайт` и `СЕО` база уже знает, сиблинги f39/f40
 * существуют, поэтому воронки заводятся копированием их формы.
 *
 * Посадочные взяты со страницы danila-susak.com/free/ и проверены на 200.
 * У ЕХ и ГП трекингового адреса t.ksamata.ru/sait/… не существует (404),
 * поэтому им проставлены публичные страницы курса.
 *
 * Идемпотентен: воронка с занятым num пропускается.
 *
 * Запуск из app/:
 *   FUNNELS_DB_PATH=/abs/path/ksamata_funnels.db npx tsx scripts/create-seo-funnels-2026-07-25.ts
 */
import { eq } from 'drizzle-orm';
import { db } from '../src/db/client';
import { funnels } from '../src/db/schema';
import { createFunnel } from '../src/lib/funnels';

type Row = { num: number; frontCode: string; productName: string;
             product: string; landingUrl: string };

const ROWS: Row[] = [
  { num: 52, frontCode: 'f59', productName: 'ЕХ НИМБ Сайт',      product: 'ЕХ',
    landingUrl: 'https://danila-susak.com/free/eatandslim/' },
  { num: 53, frontCode: 'f60', productName: 'ЩЖ НИМБ Сайт',      product: 'ЩЖ',
    landingUrl: 'https://t.ksamata.ru/sait/shzh/a' },
  { num: 54, frontCode: 'f61', productName: 'ГП НИМБ Сайт',      product: 'ГП',
    landingUrl: 'https://danila-susak.com/free/hormonal-reset/' },
  { num: 55, frontCode: 'f62', productName: 'ДЫХАНИЕ НИМБ Сайт', product: 'ДЫХАНИЕ',
    landingUrl: 'https://t.ksamata.ru/sait/dih/a' },
  { num: 56, frontCode: 'f63', productName: 'СУСТАВЫ НИМБ Сайт', product: 'СУСТАВЫ',
    landingUrl: 'https://t.ksamata.ru/sait/sust/a' },
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
    contractor: 'НИМБ',
    channel: 'Сайт',
    direction: 'СЕО',
    sourceName: 'Сайт СЕО',
  });
  console.log(`  + num=${created.num} ${created.frontCode} «${created.productName}» → ${created.name}`);
}

console.log('\n--- все СЕО-воронки в базе ---');
for (const r of db.select().from(funnels).all()) {
  if (r.productName?.includes('НИМБ Сайт')) {
    console.log(`  num=${r.num} ${r.frontCode || '—'} «${r.productName}» [${r.status}] ${r.landingUrl || '—'}`);
  }
}
