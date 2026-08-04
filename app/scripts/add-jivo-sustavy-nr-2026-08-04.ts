/**
 * One-off (2026-08-04): завести воронку «ЖИВО-суставы / NR / ВК / Реклама».
 *
 * Основание — этап 2 разбора (`docs/plans/2026-08-04-razbor-design.md`).
 * Строка 43 таблицы маркетологов: «ЖИВО Суставы 490р», статус «Работает»,
 * лендинг `t.ksamata.ru/jivo/trial/nr/a`. Воронки нет ни в базе, ни в ЛИК —
 * реестр `/app-api/api/admin/funnels` прочитан 04.08, у NR там только `f73`
 * (триал), `f74` (ЖКТ) и `f78` (ТКМ).
 *
 * Оси выведены из зеркального набора, а не угаданы. У ИНХАУЗ тройка полная,
 * у NR не хватало ровно одного элемента, и лендинги отличаются одним словом:
 *
 *   ЖИВО-суставы         f46 /jivo/trial/inhouse/a       — нет  /jivo/trial/nr/a
 *   ЖИВО-ЖКТ             f48 /jivo/trial/zhkt/inhouse/a  f74   /jivo/trial/zhkt/nr/a
 *   ЖИВО-суставы-триал   f51 /trial/inhouse/a            f73   /trial/nr/a
 *
 * **F-код остаётся пустым.** В ЛИК воронки нет, брать код неоткуда, а
 * выдуманный завтра столкнётся с настоящим — так уже вышло с `f64`–`f72`
 * (docs/leak-engine.md). Пустой код — законное состояние; впишем настоящий,
 * когда воронка появится в ЛИК. Решение владельца 2026-08-04.
 *
 * Правила:
 *   - Только через `createFunnel`, без сырого SQL: он заводит недостающие
 *     строки справочников и материализует теги пяти осей.
 *   - Идемпотентно: повторный запуск ничего не делает.
 *   - Отказ без записи, если связка уже занята другой воронкой либо если
 *     лендинг уже числится за кем-то — это значило бы, что воронка есть под
 *     другим именем и заводить вторую нельзя.
 *
 * Запуск из `app/`:  npx tsx scripts/add-jivo-sustavy-nr-2026-08-04.ts
 */

import { db } from '../src/db/client';
import { funnels } from '../src/db/schema';
import { createFunnel, listFunnels, getFunnel } from '../src/lib/funnels';

const AXES = {
  product: 'ЖИВО-суставы',
  contractor: 'NR',
  channel: 'ВК',
  direction: 'Реклама',
} as const;

const FUNNEL_TYPE = 'АВ Прямые';
const LANDING = 'https://t.ksamata.ru/jivo/trial/nr/a';

function main() {
  // 1. Такая связка уже есть? Тогда заводить нечего.
  const existing = listFunnels(db).find(
    (item) =>
      item.axes.product === AXES.product &&
      item.axes.contractor === AXES.contractor &&
      item.axes.channel === AXES.channel &&
      item.axes.direction === AXES.direction &&
      item.funnelType === FUNNEL_TYPE,
  );
  if (existing) {
    const label = existing.frontCode || `#${existing.id}`;
    console.log(`Связка уже за воронкой ${label} — ничего не делаю.`);
    return;
  }

  // 2. Лендинг уже за кем-то? Значит воронка есть под другими осями —
  //    это разбор, а не заведение второй строки на тот же адрес.
  const landingOwner = db
    .select({ id: funnels.id, frontCode: funnels.frontCode })
    .from(funnels)
    .all()
    .find((row) => {
      const detail = getFunnel(db, row.id);
      return (detail?.landingUrl ?? '').replace(/\/+$/, '') ===
        LANDING.replace(/\/+$/, '');
    });
  if (landingOwner) {
    const label = landingOwner.frontCode || `#${landingOwner.id}`;
    console.error(
      `Лендинг ${LANDING} уже числится за воронкой ${label} — записи нет.`,
    );
    process.exit(1);
  }

  const maxNum = db
    .select({ num: funnels.num })
    .from(funnels)
    .all()
    .reduce((top, row) => Math.max(top, row.num), 0);

  const created = createFunnel(db, {
    num: maxNum + 1,
    frontCode: '',
    status: 'active',
    productName: 'ЖИВО-суставы NR ВК',
    variant: '',
    landingUrl: LANDING,
    startDate: '2026-08-01',
    sourceName: 'ВК NR',
    funnelType: FUNNEL_TYPE,
    roomsEnabled: false,
    roomsReplayEnabled: false,
    ...AXES,
  });

  console.log(
    `Заведена: #${created.id} (num ${created.num}), ` +
      `код «${created.frontCode || '—'}», статус ${created.status}`,
  );
  console.log(`  ${created.name} · ${created.funnelType}`);
}

main();
