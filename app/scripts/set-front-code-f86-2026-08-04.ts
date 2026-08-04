/**
 * One-off (2026-08-04): «ДБО / NR / ВК / ADDBLOGGERS вк» получает код `f86`.
 *
 * Код назначает база — правило владельца от 2026-08-04 (docs/leak-engine.md):
 * воронка заводится здесь и сразу получает `max(F) + 1`, владелец переносит
 * её в ЛИК под тем же кодом. Раньше было наоборот, и воронка ждала кода
 * столько, сколько до неё не доходили руки.
 *
 * `max + 1` считается по ОБЕИМ сторонам: на 04.08 максимум и в базе, и в
 * реестре ЛИК — `f85`, значит `f86`. Не первая дыра: дыры (`f10`, `f14`,
 * `f17`, `f18`, `f20`, `f44`, `f49`) — чужие номера.
 *
 * Идемпотентен: уже проставленный `f86` не трогается, чужой непустой код —
 * повод остановиться, а не переписать.
 *
 * Запуск из `app/`:  npx tsx scripts/set-front-code-f86-2026-08-04.ts
 */

import { eq } from 'drizzle-orm';
import { db } from '../src/db/client';
import { funnels } from '../src/db/schema';
import { getFunnel, updateFunnel } from '../src/lib/funnels';
import { nextFrontCode, normalizeFrontCode } from '../src/lib/front-code';

const LANDING = 'https://t.ksamata.ru/nrab/dbo/a';
const EXPECTED_AXES = {
  product: 'ДБО',
  contractor: 'NR',
  channel: 'ВК',
  direction: 'ADDBLOGGERS вк',
} as const;

// Максимум по реестру ЛИК на 2026-08-04, прочитан GET /app-api/api/admin/funnels.
// Сверяется с максимумом базы: код обязан быть выше обоих.
const LEAK_MAX = 'f85';

function main() {
  const row = db
    .select({ id: funnels.id, frontCode: funnels.frontCode })
    .from(funnels)
    .where(eq(funnels.landingUrl, LANDING))
    .get();

  if (!row) {
    console.error(`Воронка с лендингом ${LANDING} не найдена — записи нет.`);
    process.exit(1);
  }

  const funnel = getFunnel(db, row.id);
  if (!funnel) {
    console.error(`Воронка #${row.id} не читается — записи нет.`);
    process.exit(1);
  }

  const mismatched = (Object.keys(EXPECTED_AXES) as (keyof typeof EXPECTED_AXES)[])
    .filter((axis) => funnel.axes[axis] !== EXPECTED_AXES[axis]);
  if (mismatched.length > 0) {
    console.error(
      `Оси #${row.id} не совпали с ожидаемыми — записи нет.\n` +
        mismatched
          .map(
            (axis) =>
              `  ${axis}: ждали «${EXPECTED_AXES[axis]}», нашли «${funnel.axes[axis]}»`,
          )
          .join('\n'),
    );
    process.exit(1);
  }

  const codes = db
    .select({ frontCode: funnels.frontCode })
    .from(funnels)
    .all()
    .map((r) => r.frontCode ?? '');

  const code = nextFrontCode([...codes, LEAK_MAX]);
  const current = normalizeFrontCode(row.frontCode ?? '');

  if (current === code) {
    console.log(`#${row.id} уже ${code} — ничего не делаю.`);
    return;
  }
  if (current) {
    console.error(
      `#${row.id} уже несёт код «${current}» — переписывать не буду. ` +
        `Если он неверен, это отдельное решение.`,
    );
    process.exit(1);
  }

  console.log(`#${row.id}: код пуст → ${code} (максимум базы и ЛИК — ${LEAK_MAX})`);
  const updated = updateFunnel(db, row.id, { frontCode: code });
  if (!updated) {
    console.error('updateFunnel вернул null — запись не прошла.');
    process.exit(1);
  }
  console.log(`Готово: ${updated.frontCode} — ${updated.name}`);
}

main();
