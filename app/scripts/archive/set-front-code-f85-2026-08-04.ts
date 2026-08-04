/**
 * «ЖИВО-суставы / NR / ВК / Реклама» (num=77, лендинг t.ksamata.ru/jivo/trial/nr/a)
 * получает настоящий код ЛИК — f85.
 *
 * 04.08 воронку завели с пустым кодом: в ЛИК её не было, а выдуманный код
 * завтра столкнулся бы с настоящим (так вышло с f64-f72). Сегодня воронка
 * заведена в ЛИК под f85 (`POST /app-api/api/admin/funnels`, DRAFT, productCode
 * `jivo`, id b38b0cd7-3665-4044-93bb-7f8e091753dd) — код перестал быть выдуманным
 * и переносится в базу. Максимум по реестру ЛИК на момент записи — f84,
 * так что f85 = max + 1, ровно по правилу владельца от 2026-07-28.
 *
 * Набора правил у воронки в ЛИК пока нет: его активация запускает пересчёт
 * заявок с указанной даты, дату задаёт владелец. См. docs/leak-engine.md.
 *
 * Идемпотентен: уже проставленный f85 не трогается, чужой непустой код —
 * повод остановиться, а не переписать.
 *
 * Запуск из app/:
 *   npx tsx scripts/set-front-code-f85-2026-08-04.ts
 */
import { eq } from 'drizzle-orm';
import { db } from '../src/db/client';
import { funnels } from '../src/db/schema';
import { updateFunnel } from '../src/lib/funnels';

const NUM = 77;
const CODE = 'f85';
const LANDING = 'https://t.ksamata.ru/jivo/trial/nr/a';

const row = db.select().from(funnels).where(eq(funnels.num, NUM)).get();
if (!row) {
  console.error(`num=${NUM} не найдена — ничего не делаю`);
  process.exit(1);
}
if (row.landingUrl !== LANDING) {
  console.error(`num=${NUM}: лендинг «${row.landingUrl}» ≠ ожидаемого «${LANDING}» — НЕ трогаю`);
  process.exit(1);
}
if (row.frontCode === CODE) {
  console.log(`num=${NUM} уже ${CODE} — пропускаю`);
  process.exit(0);
}
if (row.frontCode) {
  console.error(`num=${NUM} несёт код «${row.frontCode}», а не пустой — НЕ трогаю`);
  process.exit(1);
}

updateFunnel(db, row.id, { frontCode: CODE });

const after = db.select().from(funnels).where(eq(funnels.id, row.id)).get();
console.log(`id=${row.id} num=${NUM} «${row.productName}» → ${after?.frontCode}`);
