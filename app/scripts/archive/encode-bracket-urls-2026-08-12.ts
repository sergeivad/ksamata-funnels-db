/**
 * One-off (2026-08-12): закодировать квадратные скобки в ссылках блока
 * «Ссылки» — `?uc[segment_id]=…` → `?uc%5Bsegment_id%5D=…`.
 *
 * Откуда взялось: `fill-dashboards-2026-08-12.ts` писал адреса из таблиц
 * владельца напрямую через `replaceBlock`, минуя проверку `checkUrlField`,
 * которая стоит в PUT-роуте блоков. В 20 адресах девяти воронок скобки
 * остались незакодированными — по RFC 3986 в query им положено быть `%5B`/`%5D`,
 * и в том же наборе данных соседние ссылки ГК уже записаны правильно.
 *
 * Почему это надо чинить, а не оставить как есть:
 *
 *   - такой блок НЕЛЬЗЯ сохранить через админку. `checkUrlField` считает скобки
 *     грязью класса A и роут отвечает 400 — причём на строку, которая уже лежит
 *     в базе. Открыв карточку любой из девяти воронок и нажав «Сохранить»,
 *     человек упирается в ошибку, ничего при этом не изменив;
 *   - при переносе этих ссылок на прод 12.08 API отбил ровно эти девять воронок.
 *     На проде они лежат в закодированном виде, здесь — в сыром: базы разошлись
 *     на 20 значений, и следующая сверка покажет это расхождением.
 *
 * Смысл адреса кодирование не меняет: GetCourse отдаёт ту же выборку.
 *
 * Идемпотентен: адрес без скобок пропускается. Результат каждой замены
 * прогоняется через `checkUrlField` — если после кодирования строка всё ещё
 * не проходит проверку, скрипт останавливается, а не пишет негодное значение.
 *
 * Запуск из app/:
 *   npx tsx scripts/encode-bracket-urls-2026-08-12.ts
 */
import { eq } from 'drizzle-orm';
import { db } from '../src/db/client';
import { funnels, funnelBlocks } from '../src/db/schema';
import { getBlock, replaceBlock } from '../src/lib/funnel-blocks';
import { checkUrlField } from '../src/lib/url-field';
import { funnelRefLabel } from '../src/lib/front-code';

/** Только скобки: остальную «грязь» (пробелы, кавычки) в базе не нашлось, и трогать её вслепую нельзя. */
function encodeBrackets(url: string): string {
  return url.replace(/\[/g, '%5B').replace(/\]/g, '%5D');
}

const withLinks = db
  .select({ funnelId: funnelBlocks.funnelId })
  .from(funnelBlocks)
  .where(eq(funnelBlocks.kind, 'links'))
  .all() as { funnelId: number }[];

let touchedFunnels = 0;
let touchedItems = 0;

for (const { funnelId } of withLinks) {
  const block = getBlock(db, funnelId, 'links');
  if (!block.items.some((i) => /[[\]]/.test(i.url))) continue;

  const row = db.select().from(funnels).where(eq(funnels.id, funnelId)).get();
  const label = row ? funnelRefLabel({ frontCode: row.frontCode ?? '', id: row.id }) : `#${funnelId}`;

  const items = block.items.map((i) => {
    if (!/[[\]]/.test(i.url)) return i;
    const url = encodeBrackets(i.url);
    const check = checkUrlField(url);
    if (check.level === 'error') {
      console.error(`${label} «${i.label}»: после кодирования всё ещё не проходит проверку — ${check.message}`);
      console.error(`  ${url}`);
      process.exit(1);
    }
    touchedItems += 1;
    console.log(`${label} «${i.label}»`);
    console.log(`   было:  ${i.url}`);
    console.log(`   стало: ${url}`);
    return { ...i, url };
  });

  replaceBlock(db, funnelId, 'links', block.enabled, block.mode, items);
  touchedFunnels += 1;
}

console.log(`\nГотово: воронок ${touchedFunnels}, адресов ${touchedItems}.`);
