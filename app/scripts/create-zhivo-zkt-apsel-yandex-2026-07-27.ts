/**
 * Резерв воронки под третий апсел ЖИВО-ЖКТ: ИНХАУЗ / Яндекс / РСЯ.
 *
 * Всплыла в классе 9 прогоном 2026-07-27: предложение «Полный доступ к Дому
 * Здоровья "ЖИВО"» появилось в реестре GetCourse прямо во время прогона
 * (7681 → 7682 предложения). Две сестринские воронки уже заведены — f75
 * (ИНХАУЗ / ВК) и f76 (НИМБ / Яндекс / РСЯ).
 *
 * Код f81 — выше максимума ЛИК (f58), по правилу владельца для воронок,
 * которых в ЛИК ещё нет (см. docs/leak-engine.md). f80 владелец забрал под
 * свою воронку, поэтому берём следующий.
 *
 * Черновик: заказов пока нет, и `draft` не порождает находок класса 13
 * «активная воронка молчит».
 *
 * Идемпотентен: занятый num пропускается.
 *
 * Запуск из app/:
 *   FUNNELS_DB_PATH=/abs/path/ksamata_funnels.db npx tsx scripts/create-zhivo-zkt-apsel-yandex-2026-07-27.ts
 */
import { eq } from 'drizzle-orm';
import { db } from '../src/db/client';
import { funnels } from '../src/db/schema';
import { createFunnel } from '../src/lib/funnels';

const NUM = 76;

const existing = db.select({ id: funnels.id }).from(funnels)
  .where(eq(funnels.num, NUM)).get();

if (existing) {
  console.log(`num=${NUM} уже есть (id=${existing.id}) — пропускаю`);
} else {
  const created = createFunnel(db, {
    num: NUM,
    frontCode: 'f81',
    status: 'draft',
    productName: 'ЖИВО-ЖКТ-апсел ИНХАУЗ Яндекс',
    variant: '',
    landingUrl: '',
    startDate: '',
    product: 'ЖИВО-ЖКТ-апсел',
    contractor: 'ИНХАУЗ',
    channel: 'Яндекс',
    direction: 'РСЯ',
    sourceName: 'Яндекс РСЯ',
  });
  console.log(`+ num=${created.num} ${created.frontCode} «${created.productName}» → ${created.name}`);
}
