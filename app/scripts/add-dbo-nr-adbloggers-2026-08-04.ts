/**
 * One-off (2026-08-04): завести воронку «ДБО ВК NR ADDBLOGGERS».
 *
 * Строка 47 таблицы маркетологов — «ДБО AdBlogger (посевы)», «Работает»,
 * но без лендинга, поэтому инструмент сверки опознать её не мог. Данные
 * дал владелец 04.08; всё проверено до записи:
 *
 *   - оси взяты ИЗ GetCourse, а не из названия строки. В реестре
 *     предложений 20 штук несут связку `ДБО / NR / ВК / ADDBLOGGERS вк`
 *     плюс маркер `АВ Автоворонка` (например, 8596613 «Регистрация на ДБО
 *     (ВК NR ADDBLOGGERS)»). Направление пишется именно так, со строчным
 *     «вк» на конце — это дубль канала, но менять его здесь нельзя:
 *     значение оси должно совпадать с тегом заказа буква в букву, иначе
 *     заказы к воронке не привяжутся. «Посевы» из названия строки — это
 *     ДРУГОЕ направление, оно есть в ГК отдельно (21 предложение) и
 *     принадлежит архивной `#17`;
 *   - лендинг `t.ksamata.ru/nrab/dbo/a` отвечает 200;
 *   - все десять комнат существуют на `web.ksamatacenter.com`, страницы
 *     `gc.ksamata.ru` по тем же кодам тоже отдают 200. Заполняем обе
 *     ссылки: все 518 строк дней в базе имеют и ту, и другую.
 *
 * **F-код остаётся пустым** — в реестре ЛИК такой воронки нет (прочитан
 * 04.08), а выдуманный код завтра столкнётся с настоящим (docs/leak-engine.md).
 *
 * Идемпотентно: повторный запуск ничего не делает. Отказ без записи, если
 * связка или лендинг уже за кем-то числятся.
 *
 * Запуск из `app/`:  npx tsx scripts/add-dbo-nr-adbloggers-2026-08-04.ts
 */

import { db } from '../src/db/client';
import { funnels } from '../src/db/schema';
import { createFunnel, listFunnels, getFunnel } from '../src/lib/funnels';
import { replaceDays, type DayCell } from '../src/lib/funnel-days';
import { replaceBlock, type BlockItem } from '../src/lib/funnel-blocks';

const AXES = {
  product: 'ДБО',
  contractor: 'NR',
  channel: 'ВК',
  direction: 'ADDBLOGGERS вк',
} as const;

const FUNNEL_TYPE = 'АВ Автоворонка';
const LANDING = 'https://t.ksamata.ru/nrab/dbo/a';

/** Код комнаты -> обе ссылки. Формат общий для всей базы. */
function rooms(slot: '15' | '19'): DayCell[] {
  return [1, 2, 3, 4, 5].map((day) => {
    const code = `dbo${day}-${slot}-nrab`;
    return {
      timeSlot: slot,
      dayNum: day,
      gcRoom: `https://gc.ksamata.ru/${code}`,
      webRoom: `https://web.ksamatacenter.com/room/${code}`,
      replayUrl: '',
    };
  });
}

const SEGMENT_BASE =
  'https://gc.ksamata.ru/pl/user/user/index?uc%5Bsegment_id%5D=&uc%5Brule_string%5D=%7B%22type%22%3A%22user_hasdealrule%22%2C%22inverted%22%3A0%2C%22className%22%3A%22app%3A%3Amodules%3A%3Auser%3A%3Amodels%3A%3Arule%3A%3AHasDealRule%22%2C%22params%22%3A%7B%22linkedRule%22%3A%7B%22type%22%3A%22andrule%22%2C%22inverted%22%3A0%2C%22className%22%3A%22app%3A%3Acomponents%3A%3Alogic%3A%3Arule%3A%3AAndRule%22%2C%22params%22%3A%7B%22children%22%3A%5B%7B%22type%22%3A%22deal_created_at%22%2C%22inverted%22%3A0%2C%22className%22%3A%22app%3A%3Amodules%3A%3Asales%3A%3Arules%3A%3ADealCreatedAtRule%22%2C%22params%22%3A%7B%22value%22%3A%7B%22from%22%3A%2215.07.2024%22%2C%22to%22%3A%2215.07.2024%22%2C%22toNDays%22%3Anull%2C%22fromNDays%22%3Anull%2C%22dateType%22%3A%22prev_day%22%2C%22withTime%22%3Afalse%7D%2C%22valueMode%22%3Anull%7D%7D%2C%7B%22type%22%3A%22deal_offer_id%22%2C%22inverted%22%3A0%2C%22className%22%3A%22app%3A%3Acomponents%3A%3Alogic%3A%3Arule%3A%3Asales%3A%3AOfferIdDealContextRule%22%2C%22params%22%3A%7B%22value%22%3A%7B%22selected_id%22%3A%5B8596613%5D%2C%22selected_tags%22%3A%5B%22%D0%90%D0%92+%D0%AD%D1%82%D0%B0%D0%BF%3A+%D0%A0%D0%B5%D0%B3%D0%B8%D1%81%D1%82%D1%80%D0%B0%D1%86%D0%B8%D1%8F%22%2C%22%D0%90%D0%92+%D0%9D%D0%B0%D0%BF%D1%80%D0%B0%D0%B2%D0%BB%D0%B5%D0%BD%D0%B8%D0%B5%3A+ADDBLOGGERS+%D0%B2%D0%BA%22%5D%2C%22all_object_with_tags%22%3Afalse%7D%2C%22valueMode%22%3Anull%7D%7D%5D%2C%22mode%22%3A%22and%22%7D%7D%2C%22countCondition%22%3Anull%7D%7D&formParams%5Bclarity_uid%5D=sndr-2073296413';

// Владелец прислал три ссылки на сегменты регистраций. Они СОВПАДАЮТ
// побайтово: разделения по времени в них нет — фильтр один и тот же
// (оффер 8596613, тег «АВ Этап: Регистрация»). Кладём одну строку и не
// выдаём три копии за три разных отчёта.
const LINKS: BlockItem[] = [
  {
    slot: null,
    label: 'Дашборд продаж',
    url: 'https://gc.ksamata.ru/pl/logic/funnel/dashboard?id=1695005#pk=0',
  },
  { slot: null, label: 'Регистрации всего', url: SEGMENT_BASE },
];

function main() {
  const existing = listFunnels(db).find(
    (item) =>
      item.axes.product === AXES.product &&
      item.axes.contractor === AXES.contractor &&
      item.axes.channel === AXES.channel &&
      item.axes.direction === AXES.direction,
  );
  if (existing) {
    console.log(
      `Связка уже за воронкой ${existing.frontCode || `#${existing.id}`} — ничего не делаю.`,
    );
    return;
  }

  const landingOwner = db
    .select({ id: funnels.id, frontCode: funnels.frontCode })
    .from(funnels)
    .all()
    .find((row) => {
      const detail = getFunnel(db, row.id);
      return (detail?.landingUrl ?? '').replace(/\/+$/, '') === LANDING.replace(/\/+$/, '');
    });
  if (landingOwner) {
    console.error(
      `Лендинг ${LANDING} уже за воронкой ` +
        `${landingOwner.frontCode || `#${landingOwner.id}`} — записи нет.`,
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
    productName: 'ДБО NR ВК ADDBLOGGERS',
    variant: '',
    landingUrl: LANDING,
    startDate: '2026-08-01',
    sourceName: 'ВК NR',
    funnelType: FUNNEL_TYPE,
    roomsReplayEnabled: false,
    ...AXES,
  });

  // replaceDays сам поднимает rooms_enabled, когда пишет непустую комнату.
  replaceDays(db, created.id, [...rooms('15'), ...rooms('19')]);
  replaceBlock(db, created.id, 'links', true, 'common', LINKS);

  console.log(
    `Заведена: #${created.id} (num ${created.num}), код «${created.frontCode || '—'}», ` +
      `статус ${created.status}`,
  );
  console.log(`  ${created.name} · ${created.funnelType}`);
  console.log(`  комнат: 10, ссылок: ${LINKS.length}`);
}

main();
