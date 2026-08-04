/**
 * Выравнивание f-кодов по LeakEngine + заведение десяти воронок блока A
 * (карта расхождений тегов, класс 14 / мёртвая половина класса 9).
 *
 * ЛИК (`leak.besales.ai/funnels/rules`, API `/app-api/api/admin/funnels`) —
 * источник истины по кодам воронок, см. docs/leak-engine.md. Правило владельца
 * от 2026-07-27: воронка есть в ЛИК → её код ЛИК; воронки в ЛИК нет → код
 * ВЫШЕ максимального кода ЛИК (сейчас f58), владелец потом заведёт её в ЛИК.
 *
 * Часть 1. Три кода, выданных 2026-07-26 «следующими свободными», на самом
 * деле заняты в ЛИК другими номерами — исправляем на настоящие.
 *
 * Часть 2. Десять новых воронок. Все с нулём заказов за январь-июль, поэтому
 * status = 'draft': это честное состояние («ещё не стартовала»), и оно не
 * порождает находок класса 13 «активная воронка молчит». Три из них есть в
 * ЛИК как DRAFT (f55/f56/f57), семь — вне ЛИК, коды f73-f79.
 *
 * Одиннадцатая четвёрка блока A, `ЖИВО-суставы-триал / НИМБ / Яндекс /
 * Реклама`, НЕ заводится: это уже существующая num48 f47, у которой и в базе,
 * и в ЛИК направление РСЯ. Владелец перетегирует предложение 8553037 в
 * GetCourse на `АВ Направление: РСЯ`, после чего четвёрка склеится сама.
 *
 * Посадочные не заполнены намеренно — воронки ещё не запущены.
 * Идемпотентен: занятый num пропускается, уже верный frontCode не трогается.
 *
 * Запуск из app/:
 *   FUNNELS_DB_PATH=/abs/path/ksamata_funnels.db npx tsx scripts/align-front-codes-with-leak-2026-07-27.ts
 */
import { eq } from 'drizzle-orm';
import { db } from '../src/db/client';
import { funnels } from '../src/db/schema';
import { createFunnel, updateFunnel } from '../src/lib/funnels';

/** num → настоящий код ЛИК (было выдано неверно 2026-07-26). */
const RECODE: { num: number; from: string; to: string; leakName: string }[] = [
  { num: 58, from: 'f65', to: 'f53', leakName: 'СУСТАВЫ / ИНХАУЗ / ВК / Реклама' },
  { num: 64, from: 'f71', to: 'f54', leakName: 'ЖИВО-жкт/ НИМБ / Яндекс / РСЯ' },
  { num: 65, from: 'f72', to: 'f58', leakName: 'БОО / НИМБ / ЮТУБ / Реклама' },
];

type Row = {
  num: number; frontCode: string; productName: string;
  product: string; contractor: string; channel: string; direction: string;
  sourceName: string; inLeak: boolean;
};

const ROWS: Row[] = [
  { num: 66, frontCode: 'f55', productName: 'ЖИВО-суставы-триал ИНХАУЗ Яндекс',
    product: 'ЖИВО-суставы-триал', contractor: 'ИНХАУЗ', channel: 'Яндекс', direction: 'РСЯ',
    sourceName: 'Яндекс РСЯ', inLeak: true },
  { num: 67, frontCode: 'f56', productName: 'ЖИВО-суставы ИНХАУЗ Яндекс',
    product: 'ЖИВО-суставы', contractor: 'ИНХАУЗ', channel: 'Яндекс', direction: 'РСЯ',
    sourceName: 'Яндекс РСЯ', inLeak: true },
  { num: 68, frontCode: 'f57', productName: 'ЖИВО-ЖКТ ИНХАУЗ Яндекс',
    product: 'ЖИВО-ЖКТ', contractor: 'ИНХАУЗ', channel: 'Яндекс', direction: 'РСЯ',
    sourceName: 'Яндекс РСЯ', inLeak: true },
  { num: 69, frontCode: 'f73', productName: 'ЖИВО-суставы-триал NR ВК',
    product: 'ЖИВО-суставы-триал', contractor: 'NR', channel: 'ВК', direction: 'Реклама',
    sourceName: 'ВК NR', inLeak: false },
  { num: 70, frontCode: 'f74', productName: 'ЖИВО-ЖКТ NR ВК',
    product: 'ЖИВО-ЖКТ', contractor: 'NR', channel: 'ВК', direction: 'Реклама',
    sourceName: 'ВК NR', inLeak: false },
  { num: 71, frontCode: 'f75', productName: 'ЖИВО-ЖКТ-апсел ИНХАУЗ ВК',
    product: 'ЖИВО-ЖКТ-апсел', contractor: 'ИНХАУЗ', channel: 'ВК', direction: 'Реклама',
    sourceName: 'ВК ИНХАУЗ', inLeak: false },
  { num: 72, frontCode: 'f76', productName: 'ЖИВО-ЖКТ-апсел НИМБ Яндекс',
    product: 'ЖИВО-ЖКТ-апсел', contractor: 'НИМБ', channel: 'Яндекс', direction: 'РСЯ',
    sourceName: 'Яндекс РСЯ', inLeak: false },
  { num: 73, frontCode: 'f77', productName: 'СУСТАВЫ ИНХАУЗ Яндекс',
    product: 'СУСТАВЫ', contractor: 'ИНХАУЗ', channel: 'Яндекс', direction: 'РСЯ',
    sourceName: 'Яндекс РСЯ', inLeak: false },
  { num: 74, frontCode: 'f78', productName: 'ТКМ NR ВК',
    product: 'ТКМ', contractor: 'NR', channel: 'ВК', direction: 'Реклама',
    sourceName: 'ВК NR', inLeak: false },
  { num: 75, frontCode: 'f79', productName: 'ГП Алексей Яндекс Реклама',
    product: 'ГП', contractor: 'Алексей', channel: 'Яндекс', direction: 'Реклама',
    sourceName: 'Яндекс Директ  (холод)', inLeak: false },
];

console.log('--- часть 1: исправление f-кодов по ЛИК ---');
for (const r of RECODE) {
  const row = db.select().from(funnels).where(eq(funnels.num, r.num)).get();
  if (!row) {
    console.log(`  num=${r.num} не найдена — пропускаю`);
    continue;
  }
  if (row.frontCode === r.to) {
    console.log(`  num=${r.num} уже ${r.to} — пропускаю`);
    continue;
  }
  if (row.frontCode !== r.from) {
    console.log(`  num=${r.num} ожидал ${r.from}, а там «${row.frontCode}» — НЕ трогаю`);
    continue;
  }
  updateFunnel(db, row.id, { frontCode: r.to });
  console.log(`  ${r.from} → ${r.to}  num=${r.num} «${row.productName}»  (ЛИК: ${r.leakName})`);
}

console.log('\n--- часть 2: заведение воронок блока A ---');
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
    status: 'draft',
    productName: row.productName,
    variant: '',
    landingUrl: '',
    startDate: '',
    product: row.product,
    contractor: row.contractor,
    channel: row.channel,
    direction: row.direction,
    sourceName: row.sourceName,
  });
  console.log(`  + num=${created.num} ${created.frontCode} «${created.productName}» `
    + `→ ${created.name} ${row.inLeak ? '(есть в ЛИК)' : '(вне ЛИК)'}`);
}

console.log('\n--- проверка: воронки от num=57 ---');
for (const r of db.select().from(funnels).all()) {
  if (r.num >= 57) {
    console.log(`  num=${r.num} ${r.frontCode || '—'} «${r.productName}» [${r.status}]`);
  }
}
