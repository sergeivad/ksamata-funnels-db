/**
 * f58 «БОО / НИМБ / Ютуб / Реклама» возвращается из архива в актив.
 *
 * Решение владельца 12.08: воронку вывели из архива вручную в проде, и локальная
 * база разошлась с боевой. Правки в админке в репозиторий не возвращаются, а
 * именно эту базу копируют тесты и с неё обновляют сид Docker-образа, поэтому
 * статус выравнивается здесь — иначе следующий собранный образ принёс бы в
 * первый старт архивную f58.
 *
 * Через updateFunnel, а не UPDATE: смена статуса ре-материализует funnel_tags,
 * и правка в обход движка оставила бы теги от прежнего состояния. Набор при
 * этом не меняется ни на строку — статус в вычисление тегов не входит, — и
 * скрипт это проверяет сам.
 *
 * Побочное следствие, ожидаемое: активная воронка попадает в мониторинг
 * (collectFunnelUrls берёт только status = 'active'), так что её лендинг и
 * дашборд продаж начнут проверяться. В проде это уже произошло.
 *
 * Идемпотентен: уже активная f58 не трогается, чужой статус — повод
 * остановиться, а не переписать.
 *
 * Запуск из app/:
 *   npx tsx scripts/unarchive-f58-2026-08-12.ts
 */
import { eq, and } from 'drizzle-orm';
import { db } from '../src/db/client';
import { funnels, funnelTags, tags } from '../src/db/schema';
import { updateFunnel } from '../src/lib/funnels';
import { SCENARIOS } from '../src/lib/ab-tags';

const CODE = 'f58';
const FROM = 'archive';
const TO = 'active';

function tagSnapshot(funnelId: number): string {
  return SCENARIOS.map((scenario) => {
    const names = (
      db
        .select({ name: tags.name })
        .from(funnelTags)
        .innerJoin(tags, eq(tags.id, funnelTags.tagId))
        .where(and(eq(funnelTags.funnelId, funnelId), eq(funnelTags.tagType, scenario)))
        .all() as { name: string }[]
    )
      .map((r) => r.name)
      .sort();
    return `${scenario}: ${names.join(', ')}`;
  }).join('\n');
}

const row = db.select().from(funnels).where(eq(funnels.frontCode, CODE)).get();
if (!row) {
  console.error(`${CODE} не найдена — ничего не делаю`);
  process.exit(1);
}
if (row.status === TO) {
  console.log(`${CODE} уже «${TO}» — пропускаю`);
  process.exit(0);
}
if (row.status !== FROM) {
  console.error(`${CODE} в статусе «${row.status}», а не «${FROM}» — НЕ трогаю`);
  process.exit(1);
}

const before = tagSnapshot(row.id);
const updated = updateFunnel(db, row.id, { status: TO });
if (!updated) {
  console.error(`${CODE}: updateFunnel вернул null — ничего не записано`);
  process.exit(1);
}
const after = tagSnapshot(row.id);

console.log(`${CODE} (id ${row.id}): «${FROM}» → «${updated.status}»`);
if (before === after) {
  console.log('теги не изменились — как и должно быть');
} else {
  console.error('ТЕГИ ИЗМЕНИЛИСЬ, а статус на них влиять не должен:');
  console.error('было:\n' + before);
  console.error('стало:\n' + after);
  process.exit(1);
}
