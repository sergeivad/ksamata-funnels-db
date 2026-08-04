/**
 * One-off (2026-08-04): перевод воронки `f27` в `archive`. Локально;
 * прод — отдельным решением владельца.
 *
 * Основание — первый прогон `tools/reconcile/run.py` на выгрузке
 * `deal_export_2026-08-01_01-48-36.xlsx`. Два независимых источника сошлись:
 *
 *   - заказов по связке `ЖИВО / NR / ВК / Реклама / АВ Автоворонка` нет
 *     с 2026-07-04 — 27 дней до конца выгрузки при пороге живости 30;
 *   - таблица маркетологов «Ссылки для сбора статы», строка 37, статус «Стоп».
 *
 * Дата старта воронки 2026-06-03, то есть она прожила своё окно живости и
 * молчание про неё что-то значит — в отличие от `f73`/`f74`/`f78`, у которых
 * старт 2026-08-01 и заказов быть ещё не могло.
 *
 * Решение владельца 2026-08-04 в ответ на разбор первых двух разделов отчёта.
 *
 * Правила:
 *   - Только через `updateFunnel`, без сырого SQL: статус участвует в
 *     пересчёте тегов, и правка колонки в обход логики их рассинхронит.
 *   - Проверка тождества до записи: `front_code` и все четыре оси связки.
 *     Несовпадение любого — отказ без записи.
 *   - Идемпотентно: если воронка уже `archive`, скрипт не делает ничего.
 *
 * Запуск из `app/`:  npx tsx scripts/archive-f27-2026-08-04.ts
 */

import { eq } from 'drizzle-orm';
import { db } from '../src/db/client';
import { funnels } from '../src/db/schema';
import { getFunnel, updateFunnel } from '../src/lib/funnels';

const FRONT_CODE = 'f27';
const EXPECTED_AXES = {
  product: 'ЖИВО',
  contractor: 'NR',
  channel: 'ВК',
  direction: 'Реклама',
} as const;

function main() {
  const row = db
    .select({ id: funnels.id, status: funnels.status })
    .from(funnels)
    .where(eq(funnels.frontCode, FRONT_CODE))
    .get();

  if (!row) {
    console.error(`Воронка ${FRONT_CODE} не найдена — записи нет.`);
    process.exit(1);
  }

  const funnel = getFunnel(db, row.id);
  if (!funnel) {
    console.error(`Воронка ${FRONT_CODE} (id ${row.id}) не читается.`);
    process.exit(1);
  }

  // Тождество: код мог быть переставлен, а id — переиспользован.
  const mismatched = (
    Object.keys(EXPECTED_AXES) as (keyof typeof EXPECTED_AXES)[]
  ).filter((axis) => funnel.axes[axis] !== EXPECTED_AXES[axis]);

  if (mismatched.length > 0) {
    console.error(
      `Оси ${FRONT_CODE} не совпали с ожидаемыми — записи нет.\n` +
        mismatched
          .map(
            (axis) =>
              `  ${axis}: ожидалось «${EXPECTED_AXES[axis]}», ` +
              `в базе «${funnel.axes[axis]}»`,
          )
          .join('\n'),
    );
    process.exit(1);
  }

  if (funnel.status === 'archive') {
    console.log(`${FRONT_CODE} уже archive — ничего не делаю.`);
    return;
  }

  console.log(`${FRONT_CODE}: ${funnel.status} → archive`);
  const updated = updateFunnel(db, row.id, { status: 'archive' });
  if (!updated) {
    console.error('updateFunnel вернул null — запись не прошла.');
    process.exit(1);
  }
  console.log(`Готово: ${FRONT_CODE} теперь ${updated.status}.`);
}

main();
