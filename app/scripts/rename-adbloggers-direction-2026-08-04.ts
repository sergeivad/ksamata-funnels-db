/**
 * One-off (2026-08-04): ось направления `ADDBLOGGERS вк` → `ADDBLOGGERS`.
 *
 * Владелец переименовал тег в GetCourse и поправил ЛИК. Проверено в тот же
 * день: в реестре предложений со старым тегом — 0 штук, с новым — 20;
 * в ЛИК у `f86` активен набор правил `v2` с новым тегом (`v1` в ARCHIVED).
 * База осталась последней стороной со старым значением.
 *
 * Ось идентичности меняется ТОЛЬКО через `updateFunnel`: она материализуется
 * в `funnel_tags`, и правка колонки в обход логики оставила бы тег прежним —
 * то есть заказы перестали бы привязываться молча.
 *
 * Старый тег `АВ Направление: ADDBLOGGERS вк` после замены остаётся в
 * таблице `tags` осиротевшим — его никто не держит. Скрипт это сообщает;
 * удаление тегов через refs API запрещено намеренно (теги принадлежат
 * движку шаблонов), поэтому чистится отдельно.
 *
 * Идемпотентно. Запуск из `app/`:
 *   npx tsx scripts/rename-adbloggers-direction-2026-08-04.ts
 */

import { eq } from 'drizzle-orm';
import { db } from '../src/db/client';
import { funnels, tags, funnelTags } from '../src/db/schema';
import { getFunnel, updateFunnel } from '../src/lib/funnels';

const LANDING = 'https://t.ksamata.ru/nrab/dbo/a';
const OLD = 'ADDBLOGGERS вк';
const NEW = 'ADDBLOGGERS';
const OLD_TAG = `АВ Направление: ${OLD}`;

function main() {
  const row = db
    .select({ id: funnels.id })
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

  const label = funnel.frontCode || `#${row.id}`;
  if (funnel.axes.direction === NEW) {
    console.log(`${label} уже несёт «${NEW}» — ничего не делаю.`);
  } else if (funnel.axes.direction !== OLD) {
    console.error(
      `У ${label} направление «${funnel.axes.direction}», а не «${OLD}» — ` +
        `записи нет: это уже другая правка.`,
    );
    process.exit(1);
  } else {
    console.log(`${label}: «${OLD}» → «${NEW}»`);
    const updated = updateFunnel(db, row.id, { direction: NEW });
    if (!updated) {
      console.error('updateFunnel вернул null — запись не прошла.');
      process.exit(1);
    }
    console.log(`  теперь: ${updated.name}`);
  }

  const stale = db.select({ id: tags.id }).from(tags).where(eq(tags.name, OLD_TAG)).get();
  if (stale) {
    const holders = db
      .select({ funnelId: funnelTags.funnelId })
      .from(funnelTags)
      .where(eq(funnelTags.tagId, stale.id))
      .all();
    console.log(
      holders.length === 0
        ? `  тег «${OLD_TAG}» осиротел (id ${stale.id}) — держателей нет`
        : `  ВНИМАНИЕ: тег «${OLD_TAG}» ещё держат ${holders.length} воронок`,
    );
  }
}

main();
